/* Billing counter. The scanner types into #scan and presses Enter. Every change is saved on the
   server immediately, so refreshing the page never loses the bill. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const scan = $('#scan'), qtyBox = $('#qty');
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dlgEl = $('#dlg'), dlg = new bootstrap.Modal(dlgEl);
  let S = null, sel = -1, busy = false, pending = null, lastSale = null;
  const WA_ON = document.getElementById('pos').dataset.wa === '1' && !!window.WA;

  async function call(url, body) {
    const opt = body === undefined ? { headers: { Accept: 'application/json' } }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf, Accept: 'application/json' }, body: JSON.stringify(body) };
    let r;
    try { r = await fetch(url, opt); } catch (e) { flash('Cannot reach the billing service on this PC. Check that the Madhuram window is still running.', 'danger'); throw e; }
    if (r.status === 403 || r.redirected) { flash('Session ended. Log in again.', 'danger'); setTimeout(() => location.reload(), 1500); throw new Error('auth'); }
    const data = await r.json();
    if (data.draft) { S = data; render(); }
    return data;
  }

  function flash(msg, kind, ms) {
    const f = $('#flash');
    f.className = 'alert flash alert-' + (kind || 'info');
    f.innerHTML = msg;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => f.classList.add('d-none'), ms || 3500);
  }
  function beep(ok) {
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
      o.frequency.value = ok ? 1200 : 220; g.gain.value = .08; o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + (ok ? .06 : .35));
    } catch (e) { /* no audio */ }
  }

  function render() {
    const tb = $('#lines');
    if (sel >= S.lines.length) sel = S.lines.length - 1;
    tb.innerHTML = S.lines.map((l, i) => `<tr class="${i === sel ? 'sel' : ''}" data-i="${i}">
      <td class="text-muted">${i + 1}</td>
      <td><div class="nm">${esc(l.name)}</div><div class="small text-muted"><span class="ta">${esc(l.name_ta)}</span> ${esc(l.sku)}${l.override ? ' · <span class="text-danger">price changed</span>' : ''}</div>${l.notes.length ? `<div class="offer"><i class="bi bi-tag"></i> ${esc(l.notes.join(' · '))}</div>` : ''}</td>
      <td class="r fs-5">${esc(l.qty)} <small>${l.unit}</small></td>
      <td class="r">${inr(l.rate)}${l.weighed ? '<small>/kg</small>' : ''}</td>
      <td class="r ${Number(l.discount) ? 'text-success' : 'text-muted'}">${Number(l.discount) ? '−' + inr(l.discount) : '—'}</td>
      <td class="r fw-bold fs-5">${inr(l.net)}</td></tr>`).join('');
    $('#empty').style.display = S.lines.length ? 'none' : '';
    $('#total').textContent = inr(S.total);
    $('#gross').textContent = inr(S.gross);
    $('#disc').textContent = inr(S.discount);
    $('#count').textContent = S.count + (S.count === 1 ? ' line' : ' lines');
    $('#bill-ref').textContent = S.held.length ? S.held.length + ' held' : '';
    $('#cust').innerHTML = S.customer ? `${esc(S.customer.name)} <span class="text-muted small">${esc(S.customer.phone)} · ${S.customer.points} pts</span> <button class="btn btn-sm btn-link p-0" id="cust-clear">remove</button>` : 'Walk-in customer';
    const sh = S.shift;
    $('#status-strip').innerHTML = (sh ? `<span><i class="bi bi-circle-fill text-success"></i> Shift ${sh.id} · ${esc(sh.cashier)}</span>` : `<span class="text-danger fw-bold"><i class="bi bi-exclamation-octagon"></i> No shift open – <a href="/cash/">open a shift</a> before taking payment</span>`)
      + `<span>Enter = add · F2 search · F12 pay</span>` + (S.problems.length ? `<span class="text-danger">${esc(S.problems.join(' '))}</span>` : '');
    const rows = tb.querySelectorAll('tr');
    if (rows[sel]) rows[sel].scrollIntoView({ block: 'nearest' });
  }

  function focusScan() { if (!dlgEl.classList.contains('show')) { scan.focus(); scan.select(); } }

  async function doScan(raw) {
    let code = raw.trim(), q = qtyBox.value.trim();
    if (!code) return;
    const star = code.indexOf('*');
    if (star > 0) { q = code.slice(0, star); code = code.slice(star + 1); }
    scan.value = ''; qtyBox.value = '';
    const d = await call('/api/pos/scan/', { code, qty: q });
    if (d.ok) { beep(true); sel = S.lines.findIndex(l => l.id === d.added); render(); if (d.note) flash(esc(d.note), 'info', 1500); return; }
    if (d.unknown) { beep(false); return unknownDialog(d.unknown, d.can_link, d.can_add); }
    if (d.needs_qty) return weightDialog(d.item, code);
    if (d.needs_approval) return approve(d.error, a => call('/api/pos/scan/', Object.assign({ code, qty: q }, a)));
    beep(false); flash(esc(d.error), 'danger', 5000);
  }

  // ---------------- dialogs
  function open(title, body, foot, onShown) {
    $('#dlg-title').innerHTML = title; $('#dlg-body').innerHTML = body; $('#dlg-foot').innerHTML = foot || '';
    dlgEl.querySelector('.modal-dialog').classList.toggle('modal-xl', !!open.wide); open.wide = false;
    dlgEl.addEventListener('shown.bs.modal', function h() { dlgEl.removeEventListener('shown.bs.modal', h); if (onShown) onShown(); }, { once: true });
    dlg.show();
  }
  dlgEl.addEventListener('hidden.bs.modal', () => { busy = false; focusScan(); });
  const close = () => dlg.hide();

  function weightDialog(item, code) {
    open(`Weight for ${esc(item.name)}`, `<p class="mb-2">Rate <b>${inr(item.price)}/kg</b> · in stock ${esc(item.on_hand)} kg</p>
      <label class="form-label" for="w">Weight in kg (up to 3 decimals, e.g. 0.375)</label>
      <input id="w" class="form-control form-control-lg fs-2" inputmode="decimal" autocomplete="off">
      <div class="mt-2 fs-5">Amount: <b id="w-amt">—</b></div><p class="text-danger mb-0" id="w-err"></p>`,
      `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel (Esc)</button><button class="btn btn-success btn-lg" id="w-ok">Add (Enter)</button>`,
      () => $('#w').focus());
    const w = $('#w');
    w.addEventListener('input', () => { const v = parseFloat(w.value); $('#w-amt').textContent = isNaN(v) ? '—' : inr(Math.round(v * item.price * 100) / 100); });
    const go = async () => {
      if (!/^\d*(\.\d{1,3})?$/.test(w.value.trim()) || !(parseFloat(w.value) > 0)) { $('#w-err').textContent = 'Enter the weight in kg with at most 3 decimals.'; return; }
      const d = await call('/api/pos/scan/', { code, qty: w.value.trim() });
      if (d.ok) { beep(true); sel = S.lines.findIndex(l => l.id === d.added); render(); close(); } else $('#w-err').textContent = d.error;
    };
    $('#w-ok').onclick = go; w.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  // New product scanned: add it on the spot (or link the code to a product that already exists).
  function unknownDialog(code, canLink, canAdd) {
    open('<span class="text-primary"><i class="bi bi-upc-scan"></i> New barcode – not in the system yet</span>',
      `<div class="alert alert-warning fs-5 mb-3">Barcode <b class="font-monospace">${esc(code)}</b> is not in the system.<br><b>Nothing was added. The bill is unchanged.</b></div>
       <div class="d-grid gap-2">
         <button class="btn btn-primary btn-lg py-3 fs-4" id="u-add"><i class="bi bi-plus-circle"></i> Add as a NEW product and bill it <kbd>Enter</kbd></button>
         <button class="btn btn-outline-primary btn-lg" id="u-link"><i class="bi bi-link-45deg"></i> It is a product we already sell – link this barcode <kbd>L</kbd></button>
       </div>${canAdd ? '' : '<p class="small text-muted mt-2 mb-0">Your role needs a manager\'s user name and PIN to add or link products.</p>'}`,
      `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Back to bill (Esc)</button>`, () => $('#u-add').focus());
    $('#u-add').onclick = () => quickAddDialog(code, canAdd);
    $('#u-link').onclick = () => linkDialog(code, canLink);
    $('#u-add').addEventListener('keydown', e => { if (e.key.toLowerCase() === 'l') { e.preventDefault(); linkDialog(code, canLink); } });
  }

  function quickAddDialog(code, canAdd) {
    open.wide = true;
    open('<i class="bi bi-plus-circle"></i> New product', QuickAdd.html({ code, lockCode: true, stockRequired: true, needApprover: !canAdd }),
      `<span class="me-auto small text-muted">Enter = next box · Ctrl+Enter = save</span><button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel (Esc)</button><button class="btn btn-primary btn-lg" id="qa-ok">Save and add to bill</button>`);
    const qa = QuickAdd.bind($('#dlg-body'), { code, stockRequired: true, onSaved: it => {
      close(); flash(`New product <b>${esc(it.name)}</b> (${esc(it.sku)}) saved at ${inr(it.price)}.`, 'success', 2500);
      setTimeout(() => doScan(code), 200);
    } });
    $('#qa-ok').onclick = () => qa.save();
  }

  function linkDialog(code, canLink) {
    open('<span class="text-danger"><i class="bi bi-exclamation-triangle"></i> Unknown barcode</span>',
      `<div class="alert alert-danger fs-5 mb-3">Barcode <b class="font-monospace">${esc(code)}</b> is not linked to any product.<br><b>Nothing was added. The bill is unchanged.</b></div>
       <p>Ask a manager or purchaser to link it to the correct product. Do not sell it as a different item.</p>
       <div id="link-area"><label class="form-label" for="ls">Find the product this pack belongs to</label>
       <input id="ls" class="form-control" placeholder="Name, Tamil name or SKU">
       <div class="list-group search-results mt-2" id="lr"></div>
       <div class="row g-2 mt-2"><div class="col"><label class="form-label small" for="lq">Units per scan (24 for a carton of 24)</label><input id="lq" class="form-control" value="1"></div>
       ${canLink ? '' : '<div class="col"><label class="form-label small" for="la">Approver user name</label><input id="la" class="form-control" autocomplete="off"></div><div class="col"><label class="form-label small" for="lp">Approver PIN</label><input id="lp" type="password" class="form-control" inputmode="numeric" autocomplete="off"></div>'}</div>
       <p class="text-danger mb-0 mt-2" id="l-err"></p></div>`,
      `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Back to bill (Esc)</button><button class="btn btn-success" id="l-ok" disabled>Link and add</button>`,
      () => $('#ls').focus());
    let chosen = null;
    searchBox($('#ls'), $('#lr'), it => { chosen = it; $('#l-ok').disabled = false; $('#l-ok').textContent = 'Link to ' + it.sku + ' and add'; }, false);
    $('#l-ok').onclick = async () => {
      const body = { code, item: chosen.id, qty_per_scan: $('#lq').value };
      if (!canLink) { body.approver = $('#la').value; body.pin = $('#lp').value; }
      const d = await call('/api/pos/link-barcode/', body);
      if (!d.ok) { $('#l-err').textContent = d.error; return; }
      close(); flash(`Barcode ${esc(code)} linked to ${esc(chosen.name)}.`, 'success');
      setTimeout(() => doScan(code), 250);
    };
  }

  function searchBox(input, list, onPick, activeOnly) {
    let items = [], idx = 0, t;
    const draw = () => { list.innerHTML = items.map((it, i) => `<button type="button" class="list-group-item list-group-item-action ${i === idx ? 'active' : ''}" data-i="${i}">
      <div class="d-flex justify-content-between"><b>${esc(it.name)}</b><span>${it.price ? inr(it.price) + '/' + it.unit : '<span class="text-danger">no price</span>'}</span></div>
      <div class="small"><span class="ta">${esc(it.name_ta)}</span> · ${esc(it.sku)}${it.plu ? ' · PLU ' + esc(it.plu) : ''} · stock ${esc(it.on_hand)}${it.active ? '' : ' · <b>inactive</b>'}</div></button>`).join(''); };
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = input.value.trim(); if (!q) { items = []; draw(); return; }
        const r = await fetch('/api/pos/search/?q=' + encodeURIComponent(q) + (activeOnly === false ? '&all=1' : ''), { headers: { Accept: 'application/json' } });
        items = (await r.json()).results || []; idx = 0; draw();
      }, 120);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, items.length - 1); draw(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); draw(); e.preventDefault(); }
      if (e.key === 'Enter' && items[idx]) { e.preventDefault(); onPick(items[idx]); }
    });
    list.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { idx = +b.dataset.i; draw(); onPick(items[idx]); } });
  }

  function searchDialog() {
    open('Find a product · பொருள் தேடல்', `<input id="sq" class="form-control form-control-lg" placeholder="English or Tamil name, SKU, PLU or barcode"><div class="list-group search-results mt-2" id="sr"></div>`, '', () => $('#sq').focus());
    searchBox($('#sq'), $('#sr'), async it => {
      if (it.weighed) { close(); setTimeout(() => weightDialog(it, it.sku), 300); return; }
      const d = await call('/api/pos/add/', { item: it.id, qty: qtyBox.value.trim() || 1 });
      qtyBox.value = '';
      if (d.ok) { beep(true); sel = S.lines.findIndex(l => l.id === d.added); render(); close(); } else flash(esc(d.error), 'danger');
    });
  }

  function approve(message, retry) {
    open('Manager approval needed', `<p>${esc(message)}</p><div class="row g-2"><div class="col"><label class="form-label" for="ap-u">Approver user name</label><input id="ap-u" class="form-control" autocomplete="off"></div>
      <div class="col"><label class="form-label" for="ap-p">PIN</label><input id="ap-p" type="password" class="form-control" inputmode="numeric" autocomplete="off"></div></div><p class="text-danger mt-2 mb-0" id="ap-err"></p>`,
      `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button><button class="btn btn-success" id="ap-ok">Approve</button>`, () => $('#ap-u').focus());
    const go = async () => {
      const d = await retry({ approver: $('#ap-u').value, pin: $('#ap-p').value });
      if (d.ok) { close(); flash('Approved and saved.', 'success'); if (pending) { const p = pending; pending = null; p(d); } } else $('#ap-err').textContent = d.error;
    };
    $('#ap-ok').onclick = go; $('#ap-p').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function lineAction(kind) {
    const l = S.lines[sel];
    if (!l) { flash('Choose a line with ↑ ↓ first.', 'warning'); return; }
    if (kind === 'qty') {
      open(`Quantity · ${esc(l.name)}`, `<label class="form-label" for="nq">${l.weighed ? 'Weight in kg (3 decimals)' : 'Number of pieces'}</label><input id="nq" class="form-control form-control-lg fs-3" value="${esc(l.qty)}" inputmode="decimal"><p class="text-danger mt-2 mb-0" id="nq-err"></p>`,
        `<button class="btn btn-success" id="nq-ok">Save (Enter)</button>`, () => { $('#nq').focus(); $('#nq').select(); });
      const go = async () => { const d = await call(`/api/pos/line/${l.id}/qty/`, { qty: $('#nq').value }); if (d.ok) close(); else $('#nq-err').textContent = d.error; };
      $('#nq-ok').onclick = go; $('#nq').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    }
    if (kind === 'price' || kind === 'discount') {
      const isP = kind === 'price';
      open(isP ? `Change price · ${esc(l.name)}` : `Discount · ${esc(l.name)}`,
        `<p>Catalogue price ${inr(l.list_price)}${l.mrp ? ' · MRP ' + inr(l.mrp) : ''}. This is recorded with your name${isP ? '' : ' and the approver'}.</p>
        <div class="row g-2"><div class="col-md-4"><label class="form-label" for="pv">${isP ? 'New price ₹' + (l.weighed ? ' per kg' : '') : 'Discount ₹ for this line'}</label><input id="pv" class="form-control form-control-lg" inputmode="decimal"></div>
        <div class="col-md-8"><label class="form-label" for="pr">Reason</label><input id="pr" class="form-control form-control-lg" placeholder="${isP ? 'e.g. shelf price mismatch' : 'e.g. slightly damaged pack'}"></div></div>
        <div class="row g-2 mt-1"><div class="col"><label class="form-label small" for="pa">Approver user name (if your role cannot)</label><input id="pa" class="form-control" autocomplete="off"></div><div class="col"><label class="form-label small" for="pp">Approver PIN</label><input id="pp" type="password" class="form-control" inputmode="numeric" autocomplete="off"></div></div>
        <p class="text-danger mt-2 mb-0" id="pv-err"></p>`, `<button class="btn btn-success" id="pv-ok">Save</button>`, () => $('#pv').focus());
      $('#pv-ok').onclick = async () => {
        const body = { reason: $('#pr').value, approver: $('#pa').value, pin: $('#pp').value };
        body[isP ? 'price' : 'amount'] = $('#pv').value;
        const d = await call(`/api/pos/line/${l.id}/${kind}/`, body);
        if (d.ok) close(); else $('#pv-err').textContent = d.error;
      };
    }
    if (kind === 'remove') {
      call(`/api/pos/line/${l.id}/remove/`, {}).then(() => flash(`Removed ${esc(l.name)}.`, 'warning', 1500));
    }
  }

  function holdDialog() {
    if (!S.lines.length) return flash('Nothing to hold.', 'warning');
    open('Hold this bill', `<label class="form-label" for="hl">Label (customer name or note)</label><input id="hl" class="form-control form-control-lg" value="${S.customer ? esc(S.customer.name) : ''}">`,
      `<button class="btn btn-success" id="hl-ok">Hold (Enter)</button>`, () => $('#hl').focus());
    const go = async () => { const d = await call('/api/pos/hold/', { label: $('#hl').value }); if (d.ok) { close(); flash('Bill held. Recall it with F9.', 'success'); } };
    $('#hl-ok').onclick = go; $('#hl').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }
  function recallDialog() {
    if (!S.held.length) return flash('No held bills.', 'info');
    open('Recall a held bill', `<div class="list-group">${S.held.map(h => `<button class="list-group-item list-group-item-action" data-h="${h.id}"><b>${esc(h.label)}</b> · ${h.lines} lines · held ${h.at}</button>`).join('')}</div><p class="text-danger mt-2" id="rc-err"></p>`);
    $('#dlg-body').querySelectorAll('[data-h]').forEach(b => b.onclick = async () => { const d = await call(`/api/pos/recall/${b.dataset.h}/`, {}); if (d.ok) close(); else $('#rc-err').textContent = d.error; });
  }
  function cancelDialog() {
    if (!S.lines.length) return;
    open('<span class="text-danger">Cancel this bill?</span>', `<p>All ${S.lines.length} lines will be removed. The cancellation is recorded with the reason.</p>
      <label class="form-label" for="cr">Reason</label><input id="cr" class="form-control" placeholder="e.g. customer left without paying">
      <div class="row g-2 mt-1"><div class="col"><label class="form-label small" for="ca">Approver (if needed)</label><input id="ca" class="form-control" autocomplete="off"></div><div class="col"><label class="form-label small" for="cp">PIN</label><input id="cp" type="password" class="form-control" autocomplete="off"></div></div><p class="text-danger mt-2 mb-0" id="cr-err"></p>`,
      `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Keep bill</button><button class="btn btn-danger" id="cr-ok">Cancel bill</button>`, () => $('#cr').focus());
    $('#cr-ok').onclick = async () => { const d = await call('/api/pos/cancel/', { reason: $('#cr').value, approver: $('#ca').value, pin: $('#cp').value }); if (d.ok) { close(); flash('Bill cancelled.', 'warning'); } else $('#cr-err').textContent = d.error; };
  }
  function customerDialog() {
    open('Customer (optional)', `<input id="cq" class="form-control form-control-lg" placeholder="Phone number or name"><div class="list-group search-results mt-2" id="cl"></div>
      <hr><div class="small text-muted mb-1">New customer</div><div class="row g-2"><div class="col-md-6"><input id="cn" class="form-control" placeholder="Name"></div><div class="col-md-4"><input id="cph" class="form-control" placeholder="10-digit phone" inputmode="tel"></div><div class="col-md-2"><button class="btn btn-outline-success w-100" id="cadd">Add</button></div></div><p class="text-danger mt-2 mb-0" id="c-err"></p>`,
      '<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Walk-in (Esc)</button>', () => $('#cq').focus());
    let res = [], t;
    $('#cq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
      const r = await fetch('/api/customers/search/?q=' + encodeURIComponent($('#cq').value), { headers: { Accept: 'application/json' } }); res = (await r.json()).results || [];
      $('#cl').innerHTML = res.map((c, i) => `<button class="list-group-item list-group-item-action" data-c="${c.id}">${esc(c.name)} · ${esc(c.phone)} · ${c.points} pts</button>`).join('');
      $('#cl').querySelectorAll('[data-c]').forEach(b => b.onclick = async () => { await call('/api/pos/customer/', { id: +b.dataset.c }); close(); });
    }, 150); });
    $('#cadd').onclick = async () => { const d = await call('/api/customers/quick-add/', { name: $('#cn').value, phone: $('#cph').value }); if (d.ok) close(); else $('#c-err').textContent = d.error; };
  }

  function payDialog(mode) {
    if (!S.lines.length) return flash('The bill is empty.', 'warning');
    if (!S.shift) return flash('Open a cashier shift before taking payment.', 'danger', 5000);
    const total = Number(S.total);
    const credit = S.customer && S.customer.credit_allowed;
    open(`Payment · ${S.count} lines`, `<div id="pay-box"><div class="d-flex justify-content-between align-items-end mb-3"><div><div class="text-muted">To pay</div><div class="pay-big">${inr(total)}</div></div>
      <div class="text-end"><div class="text-muted">Change to give</div><div class="pay-big text-success" id="chg">₹0.00</div></div></div>
      <div class="pay-grid">
        <label for="p-cash" class="fw-semibold">Cash received</label><input id="p-cash" class="form-control form-control-lg" inputmode="decimal" placeholder="0"><div class="d-flex gap-1 flex-wrap">${[0, 100, 200, 500, 2000].map(v => `<button type="button" class="btn btn-sm btn-outline-secondary" data-cash="${v}">${v ? '₹' + v : 'Exact'}</button>`).join('')}</div>
        <label for="p-upi" class="fw-semibold">UPI</label><input id="p-upi" class="form-control form-control-lg" inputmode="decimal" placeholder="0"><input id="r-upi" class="form-control" placeholder="UPI txn ref (optional)">
        <label for="p-card" class="fw-semibold">Card</label><input id="p-card" class="form-control form-control-lg" inputmode="decimal" placeholder="0"><input id="r-card" class="form-control" placeholder="Approval code (optional)">
        ${credit ? `<label for="p-credit" class="fw-semibold">Credit</label><input id="p-credit" class="form-control form-control-lg" inputmode="decimal" placeholder="0"><div class="small text-muted">Limit left ${inr(S.customer.credit_left)}</div>` : ''}
      </div>
      <div class="mt-2 d-flex gap-2"><button type="button" class="btn btn-outline-success" data-all="upi">All UPI</button><button type="button" class="btn btn-outline-success" data-all="card">All card</button></div>
      ${WA_ON ? `<div class="wa-row mt-3"><label for="p-wa" class="fw-semibold"><i class="bi bi-whatsapp"></i> WhatsApp bill to</label>
        <input id="p-wa" class="form-control form-control-lg" inputmode="tel" autocomplete="off" placeholder="Customer's mobile (optional)" value="${esc((S.customer && S.customer.phone) || '')}">
        <span class="small text-muted">Opens the bill in WhatsApp after saving – press Send there.</span></div>` : ''}
      <div class="alert alert-warning mt-3 mb-0 small">For UPI and card, check the payment shows <b>successful</b> on the phone / card machine before pressing Complete.</div>
      <p class="text-danger fs-5 mt-2 mb-0" id="pay-err"></p></div>`,
      `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Back (Esc)</button><button class="btn btn-success btn-lg px-5" id="pay-ok">Complete sale (Enter)</button>`,
      () => { $('#p-cash').focus(); });
    const val = id => { const e = $(id); return e ? (parseFloat(e.value) || 0) : 0; };
    const upd = () => {
      const non = val('#p-upi') + val('#p-card') + val('#p-credit');
      const due = Math.max(total - non, 0), cash = val('#p-cash');
      const chg = $('#chg'), short = due - cash;
      if (short > 0.004 && (cash > 0 || non > 0)) { chg.textContent = 'Still to pay ' + inr(short); chg.className = 'pay-big text-danger'; }
      else { chg.textContent = inr(Math.max(cash - due, 0)); chg.className = 'pay-big text-success'; }
    };
    $('#dlg-body').querySelectorAll('input').forEach(i => i.addEventListener('input', upd));
    $('#dlg-body').querySelectorAll('[data-cash]').forEach(b => b.onclick = () => { const non = val('#p-upi') + val('#p-card') + val('#p-credit'); const due = Math.max(total - non, 0); $('#p-cash').value = +b.dataset.cash || due.toFixed(2); upd(); $('#p-cash').focus(); });
    $('#dlg-body').querySelectorAll('[data-all]').forEach(b => b.onclick = () => { ['#p-cash', '#p-upi', '#p-card'].forEach(i => $(i).value = ''); $('#p-' + b.dataset.all).value = total.toFixed(2); upd(); });
    let sending = false;
    const go = async (extra) => {
      const wa = $('#p-wa') ? $('#p-wa').value.trim() : '';
      if (wa && !WA.valid(wa)) { $('#pay-err').textContent = 'WhatsApp: enter the 10-digit mobile number, or clear the box.'; $('#p-wa').focus(); return; }
      if (sending) return; sending = true; $('#pay-ok').disabled = true;
      const pays = [];
      if (!$('#p-cash').value && !val('#p-upi') && !val('#p-card') && !val('#p-credit')) $('#p-cash').value = total.toFixed(2);  // Enter on an empty box = exact cash
      if ($('#p-cash').value) pays.push({ method: 'cash', tendered: $('#p-cash').value });
      if (val('#p-upi')) pays.push({ method: 'upi', amount: $('#p-upi').value, reference: $('#r-upi').value });
      if (val('#p-card')) pays.push({ method: 'card', amount: $('#p-card').value, reference: $('#r-card').value });
      if (val('#p-credit')) pays.push({ method: 'credit', amount: $('#p-credit').value });
      let d;
      try { d = await call('/api/pos/checkout/', Object.assign({ draft: S.draft, payments: pays, customer: S.customer && S.customer.id }, extra || {})); }
      catch (e) { $('#pay-err').textContent = 'Network problem. Press Complete again – the same bill can never be saved twice.'; sending = false; $('#pay-ok').disabled = false; return; }
      sending = false; if ($('#pay-ok')) $('#pay-ok').disabled = false;
      if (d.ok) { close(); done(d, wa); return; }
      if (d.needs_approval) { pending = done; close(); setTimeout(() => approve(d.error, a => call('/api/pos/checkout/', Object.assign({ draft: d.draft_prev || S.draft, payments: pays, customer: S.customer && S.customer.id }, a))), 300); return; }
      $('#pay-err').textContent = d.error;
    };
    $('#pay-ok').onclick = () => go();
    $('#pay-box').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });  // dies with the dialog
    if (mode === 'cash') { $('#p-cash').value = total.toFixed(2); upd(); go(); }                       // F10: exact cash, one key
    if (mode === 'upi') { $('#p-upi').value = total.toFixed(2); upd(); setTimeout(() => $('#pay-ok').focus(), 60); }  // F3: all UPI, confirm with Enter
  }

  function done(d, wa) {
    lastSale = { id: d.sale, phone: wa || (S.customer && S.customer.phone) || '' };
    $('#last-sale').classList.remove('d-none');
    $('#last-no').textContent = d.bill_no; $('#last-change').textContent = inr(d.change);
    $('#last-print').href = d.receipt + '?print=1&reprint=1';
    $('#last-open').href = '/sales/' + d.sale + '/';
    flash(`<b>Bill ${esc(d.bill_no)} saved.</b> ${Number(d.change) ? 'Give change <b>' + inr(d.change) + '</b>' : ''}`, 'success', 6000);
    beep(true);
    if (wa) sendWa(d.sale, wa, d.bill_no);
    // The paper bill is compulsory: it prints for every sale (WhatsApp is only an extra copy).
    setTimeout(() => printReceipt(d.receipt + '?print=1'), wa ? 400 : 0);
  }
  async function sendWa(saleId, phone, billNo) {
    try { const r = await WA.send(saleId, phone); flash(`<i class="bi bi-whatsapp"></i> Bill ${esc(billNo || '')} opened in WhatsApp for ${esc(r.to)} – <b>press Send in WhatsApp</b>.`, 'success', 6000); }
    catch (e) { flash(esc(e.message), 'danger', 6000); }
  }
  function waDialog() {
    if (!lastSale) return;
    open('<i class="bi bi-whatsapp text-success"></i> Send the last bill on WhatsApp', `<label class="form-label" for="wa-n">Customer's mobile number</label>
      <input id="wa-n" class="form-control form-control-lg" inputmode="tel" autocomplete="off" value="${esc(lastSale.phone)}" placeholder="98765 43210">
      <p class="small text-muted mt-2 mb-0">The bill opens in the shop's WhatsApp with this number. Check it and press Send.</p><p class="text-danger mb-0" id="wa-err"></p>`,
      `<button class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel (Esc)</button><button class="btn btn-wa btn-lg" id="wa-ok"><i class="bi bi-whatsapp"></i> Open in WhatsApp</button>`, () => { $('#wa-n').focus(); $('#wa-n').select(); });
    const go = async () => { const n = $('#wa-n').value.trim(); if (!WA.valid(n)) { $('#wa-err').textContent = 'Enter the 10-digit mobile number.'; return; }
      try { const r = await WA.send(lastSale.id, n); lastSale.phone = n; close(); flash(`<i class="bi bi-whatsapp"></i> Opened in WhatsApp for ${esc(r.to)} – press Send there.`, 'success', 5000); } catch (e) { $('#wa-err').textContent = e.message; } };
    $('#wa-ok').onclick = go; $('#wa-n').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }
  function printReceipt(url) {
    // Print through a hidden frame; if the printer fails, the bill is already saved and can be reprinted.
    let f = document.getElementById('print-frame');
    if (f) f.remove();
    f = document.createElement('iframe'); f.id = 'print-frame'; f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    f.src = url; document.body.appendChild(f);
  }

  // ---------------- keyboard
  const keyMap = {
    F2: searchDialog, F4: () => (sel >= 0 ? lineAction('qty') : qtyBox.focus()), F5: () => lineAction('price'), F6: () => lineAction('discount'),
    F7: customerDialog, F8: holdDialog, F9: recallDialog, F12: () => payDialog(), F10: () => payDialog('cash'), F3: () => payDialog('upi'), Delete: () => lineAction('remove'), cancel: cancelDialog,
  };
  document.addEventListener('keydown', e => {
    if (dlgEl.classList.contains('show')) return;
    if (keyMap[e.key]) { e.preventDefault(); keyMap[e.key](); return; }
    if (e.key === 'F1') { e.preventDefault(); focusScan(); return; }
    if (e.ctrlKey && e.key === 'Backspace') { e.preventDefault(); cancelDialog(); return; }
    if (e.target === scan && scan.value) return;
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, S.lines.length - 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    if ((e.key === '+' || e.key === '-') && e.target === scan && S.lines[sel] && !S.lines[sel].weighed) {
      e.preventDefault(); const l = S.lines[sel]; call(`/api/pos/line/${l.id}/qty/`, { qty: Math.max(0, Number(l.qty) + (e.key === '+' ? 1 : -1)) });
    }
    if (e.key === 'Escape') focusScan();
  });
  if ($('#last-wa')) $('#last-wa').onclick = waDialog;
  document.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => keyMap[b.dataset.k] && keyMap[b.dataset.k]()));
  $('#lines').addEventListener('click', e => { const tr = e.target.closest('tr'); if (tr) { sel = +tr.dataset.i; render(); focusScan(); } });
  $('#lines').addEventListener('dblclick', () => lineAction('qty'));
  document.addEventListener('click', e => { if (e.target.id === 'cust-clear') call('/api/pos/customer/', { clear: true }); });
  $('#scan-form').addEventListener('submit', e => { e.preventDefault(); if (!busy) doScan(scan.value); });
  qtyBox.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); focusScan(); } });
  window.addEventListener('focus', () => setTimeout(focusScan, 50));

  call('/api/pos/state/').then(() => { sel = S.lines.length - 1; render(); focusScan(); });
})();
