/* Madhuram cloud – billing counter. The product list is kept in this browser, so scanning and searching need no
   trip to the server; only "Complete sale" goes to the cloud. The open bill is kept on this PC until it is saved. */
'use strict';

const POS = {
  cat: null, catAt: 0, byId: new Map(), byCode: new Map(), byPlu: new Map(), bySku: new Map(), cats: [],
  bill: null, sel: -1, results: [], resSel: 0, tileCat: '', shift: null, busy: false, last: null,
};

// ------------------------------------------------------------------ product list in the browser
async function loadCatalogue(force = false) {
  if (!force && POS.cat && Date.now() - POS.catAt < 5 * 60000) return;
  const res = await fetch('/api/catalog', { credentials: 'same-origin', cache: force ? 'no-cache' : 'default' });
  if (!res.ok) throw new Error('Could not load the product list. Check the internet and reload.');
  const data = await res.json();
  if (POS.cat && POS.cat.version === data.version) { POS.catAt = Date.now(); return; }
  POS.cat = data;
  POS.catAt = Date.now();
  POS.byId.clear(); POS.byCode.clear(); POS.byPlu.clear(); POS.bySku.clear();
  const count = new Map();
  for (const r of data.items) {
    const it = { id: r[0], sku: r[1], plu: r[2], name: r[3], name_ta: r[4], unit: r[5], price: Money.paise(r[6]), mrp: r[7] === null ? null : Money.paise(r[7]),
      gst: r[8], tax: r[9], stock: r[10], cat: r[11], key: `${r[3]} ${r[4]} ${r[1]}`.toLowerCase() };
    POS.byId.set(it.id, it);
    if (it.plu) POS.byPlu.set(it.plu, it);
    POS.bySku.set(it.sku.toUpperCase(), it);
    if (it.cat) count.set(it.cat, (count.get(it.cat) || 0) + 1);
  }
  for (const [code, id, per] of data.barcodes) POS.byCode.set(code, { id, per: Money.milli(per) || 1000 });
  POS.cats = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map((x) => x[0]).sort();
}

// ------------------------------------------------------------------ the open bill (saved on this PC per counter)
const billKey = () => `mpc_bill_${myCounter()}`;
const newBill = () => ({ uuid: crypto.randomUUID(), lines: [], customer: null });
function loadBill() {
  try { POS.bill = JSON.parse(localStorage.getItem(billKey())) || newBill(); } catch (_) { POS.bill = newBill(); }
  if (!POS.bill.uuid) POS.bill = newBill();
}
function saveBill() { localStorage.setItem(billKey(), JSON.stringify(POS.bill)); }

function lineCalc(l) {
  const it = POS.byId.get(l.id);
  const rate = l.rate ?? (it ? it.price : 0);
  const gross = Money.line(rate, l.qty);
  return { it, rate, gross, net: gross - (l.disc || 0) };
}
function totals() {
  let total = 0; let items = 0; let saved = 0;
  for (const l of POS.bill.lines) {
    const c = lineCalc(l);
    total += c.net; items += 1;
    if (c.it && c.it.mrp) saved += Math.max(0, Money.line(c.it.mrp, l.qty) - c.net);
  }
  return { total, items, saved };
}

function addItem(it, qty) {
  if (!it) return;
  if (it.price === null) { toast(`${it.name} has no price. Set it in Products.`, true); return; }
  const weighed = it.unit === 'kg';
  if (!qty) {
    if (weighed) { weightDialog(it); return; }
    qty = 1000;
  }
  if (!weighed && qty % 1000) { toast(`${it.name} is sold by the piece.`, true); return; }
  const same = !weighed && POS.bill.lines.findIndex((l) => l.id === it.id && l.rate == null && !l.disc);
  if (same !== false && same >= 0) {
    POS.bill.lines[same].qty += qty;
    POS.sel = same;
  } else {
    POS.bill.lines.push({ id: it.id, qty, rate: null, disc: 0, note: '' });
    POS.sel = POS.bill.lines.length - 1;
  }
  saveBill();
  renderBill();
  beep();
}

let audio;
function beep() {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = 1500; g.gain.value = 0.04; o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.05);
  } catch (_) { /* no sound */ }
}

// ------------------------------------------------------------------ what was scanned or typed
function ean13ok(code) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (s % 10)) % 10 === Number(code[12]);
}
function scaleLabel(code) {
  const s = App.settings;
  if (s.scale_enabled !== '1' || !/^\d+$/.test(code) || code.length !== 13) return null;
  const prefixes = s.scale_prefixes.split(',').map((p) => p.trim()).filter(Boolean);
  if (!prefixes.some((p) => code.startsWith(p))) return null;
  if (s.scale_check_digit === '1' && !ean13ok(code)) throw new Error('Scale label check digit is wrong. Scan again or type the weight.');
  const itemCode = String(Number(code.substr(Number(s.scale_item_start), Number(s.scale_item_length))));
  const raw = code.substr(Number(s.scale_value_start), Number(s.scale_value_length));
  const dec = Number(s.scale_value_decimals);
  const qty = Math.round(Number(raw) * 10 ** (3 - dec));
  const it = POS.byPlu.get(itemCode) || POS.byPlu.get(itemCode.padStart(Number(s.scale_item_length), '0'));
  if (!it) throw new Error(`Scale item code ${itemCode} is not a PLU of any product.`);
  if (!qty) throw new Error('Scale label shows zero weight.');
  return { it, qty };
}
function resolve(text) {
  let qty = null;
  const m = text.match(/^(\d+(?:\.\d+)?)\s*[*xX]\s*(.+)$/);       // "3*8901234567890" = 3 of that item
  if (m) { qty = Money.milli(m[1]); text = m[2].trim(); }
  const sl = scaleLabel(text);
  if (sl) return sl;
  const bc = POS.byCode.get(text);
  if (bc) return { it: POS.byId.get(bc.id), qty: qty ? Math.round(qty * bc.per / 1000) : bc.per };
  const byPlu = POS.byPlu.get(text) || POS.byPlu.get(String(Number(text)));
  if (byPlu && /^\d{1,5}$/.test(text)) return { it: byPlu, qty };
  const bySku = POS.bySku.get(text.toUpperCase());
  if (bySku) return { it: bySku, qty };
  return { it: null, qty, text };
}
function search(text) {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out = [];
  for (const it of POS.byId.values()) {
    if (words.every((w) => it.key.includes(w))) { out.push(it); if (out.length >= 40) break; }
  }
  return out;
}

function onScan(e) {
  const input = e.target;
  const text = input.value.trim();
  if (!text) return;
  if (POS.results.length && !/^\d{6,}$/.test(text)) {      // typed a name: take the highlighted result
    addItem(POS.results[POS.resSel]);
    input.value = ''; showResults([]);
    return;
  }
  let r;
  try { r = resolve(text); } catch (err) { toast(err.message, true); input.select(); return; }
  input.value = '';
  showResults([]);
  if (r.it) { addItem(r.it, r.qty); return; }
  if (/^\d{8,14}$/.test(r.text)) { unknownBarcode(r.text); return; }
  const found = search(r.text);
  if (found.length === 1) addItem(found[0], r.qty);
  else if (found.length) { input.value = r.text; showResults(found); }
  else toast(`"${r.text}" not found.`, true);
}

async function unknownBarcode(code) {
  posEvent('unknown_barcode', 0, `Unknown barcode ${code}`);
  const d = modal(`<h3>New barcode: ${esc(code)}</h3><p>This product is not in the list yet.</p>
    <div class="actions"><button data-close>Cancel</button><button id="link">Search & link to a product</button><button class="primary" id="add" autofocus>Add new product</button></div>`);
  $('#add', d).addEventListener('click', async () => {
    d.close();
    let approval = null;
    if (!can('products')) {
      approval = await managerApproval('products', 'Adding a new product needs the owner or a manager.');
      if (!approval) return;
    }
    productDialog(null, async (item) => {
      await loadCatalogue(true);
      addItem(POS.byId.get(item.id));
      renderTiles();
    }, { barcode: code, approval });
  });
  $('#link', d).addEventListener('click', async () => {
    d.close();
    let approval = null;
    if (!can('products')) {
      approval = await managerApproval('products', 'Linking a barcode to a product needs the owner or a manager.');
      if (!approval) return;
    }
    linkDialog(code, approval);
  });
}
function linkDialog(code, approval) {
  const d = modal(`<h3>Link barcode ${esc(code)}</h3><input id="lq" placeholder="Type the product name" autofocus><div class="results" id="lr" style="margin-top:8px"></div>
    <div class="actions"><button data-close>Cancel</button></div>`);
  $('#lq', d).addEventListener('input', (e) => {
    $('#lr', d).innerHTML = search(e.target.value).slice(0, 15).map((it) => `<div data-id="${it.id}"><span>${esc(it.name)}</span><b>${inr(it.price)}</b></div>`).join('');
    $$('#lr div', d).forEach((row) => row.addEventListener('click', async () => {
      const r = await api(`/products/${row.dataset.id}`);
      try {
        await api('/products', { method: 'POST', body: { ...r.item, codes: [...r.item.codes, code], approval } });
        d.close();
        await loadCatalogue(true);
        addItem(POS.byId.get(Number(row.dataset.id)));
        toast('Barcode linked.');
      } catch (err) { toast(err.message, true); }
    }));
  });
}

function weightDialog(it, lineIndex = null) {
  const cur = lineIndex !== null ? POS.bill.lines[lineIndex].qty : null;
  const d = modal(`<h3>${esc(it.name)}</h3><p class="muted">${inr(it.price)} per ${it.unit === 'kg' ? 'kg' : 'piece'}</p>
    <form><label>${it.unit === 'kg' ? 'Weight in kg (0.5 = 500 g, 0.25 = 250 g)' : 'Quantity'}</label>
    <input name="q" inputmode="decimal" value="${cur ? Money.qty(cur) : ''}" autofocus required>
    <div class="row" style="margin-top:8px">${(it.unit === 'kg' ? ['0.25', '0.5', '1', '1.5', '2'] : ['1', '2', '3', '5', '10']).map((v) => `<button type="button" data-v="${v}">${v}</button>`).join('')}</div>
    <p id="amt" class="muted"></p>
    <div class="actions"><button type="button" data-close>Cancel</button><button class="primary">OK</button></div></form>`);
  const input = $('[name=q]', d);
  const show = () => { const q = Money.milli(input.value); $('#amt', d).textContent = q ? `Amount: ${inr(Money.line(it.price, q))}` : ''; };
  input.addEventListener('input', show); show();
  $$('[data-v]', d).forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.v; show(); input.focus(); }));
  $('form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    const q = Money.milli(input.value);
    if (!q || q <= 0) { toast('Enter the quantity.', true); return; }
    if (it.unit !== 'kg' && q % 1000) { toast('Use a whole number for this item.', true); return; }
    d.close('ok');
    if (lineIndex !== null) { POS.bill.lines[lineIndex].qty = q; saveBill(); renderBill(); } else addItem(it, q);
  });
}

// ------------------------------------------------------------------ line changes
function changeQty() {
  const l = POS.bill.lines[POS.sel];
  if (!l || l.delivery) return;
  weightDialog(POS.byId.get(l.id) || { name: 'Item', price: lineCalc(l).rate, unit: 'pcs' }, POS.sel);
}
function posEvent(action, value, summary) {
  api('/pos/event', { method: 'POST', body: { action, value: Money.rs(value || 0), summary, counter: myCounter() } }).catch(() => {});
}
function removeLine() {
  if (POS.sel < 0 || !POS.bill.lines[POS.sel]) return;
  const gone = POS.bill.lines[POS.sel];
  const c = lineCalc(gone);
  posEvent('line_remove', c.net, `Removed ${c.it ? c.it.name : gone.name || 'item'} ${Money.qty(gone.qty)} (${inr(c.net)})`);
  POS.bill.lines.splice(POS.sel, 1);
  POS.sel = Math.min(POS.sel, POS.bill.lines.length - 1);
  saveBill(); renderBill();
}
function priceDialog() {
  const l = POS.bill.lines[POS.sel];
  if (!l) { toast('Select a line on the bill first.', true); return; }
  const c = lineCalc(l);
  const d = modal(`<h3>Price / discount: ${esc(c.it ? c.it.name : '')}</h3>
    <form><div class="grid2"><div><label>Price ₹ (list ${inr(c.it ? c.it.price : 0)})</label><input name="rate" inputmode="decimal" value="${Money.rs(c.rate)}" autofocus></div>
    <div><label>Discount on this line ₹</label><input name="disc" inputmode="decimal" value="${l.disc ? Money.rs(l.disc) : ''}"></div></div>
    <label>Reason</label><input name="note" value="${esc(l.note || '')}" placeholder="e.g. damaged pack, regular customer">
    <p class="small muted">${can('price_override') ? '' : 'A manager must approve with their PIN.'}</p>
    <div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Apply</button></div></form>`);
  $('form', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const rate = Money.paise(f.rate);
    const disc = Money.paise(f.disc || '0') || 0;
    if (rate === null || rate < 0 || disc < 0) { toast('Check the amounts.', true); return; }
    const listPrice = c.it ? c.it.price : rate;
    if (disc > Money.line(rate, l.qty)) { toast('Discount is more than the line amount.', true); return; }
    if ((rate !== listPrice || disc) && f.note.trim().length < 3) { toast('Write the reason.', true); return; }
    d.close('ok');
    const upd = { rate: rate === listPrice ? null : rate, disc, note: f.note.trim() };
    if (upd.rate !== null && !can('price_override')) {
      upd.approval_price = await managerApproval('price_override', `Price of ${c.it.name}: ${inr(listPrice)} → ${inr(rate)}`);
      if (!upd.approval_price) return;
    }
    if (disc && !can('discount_approve')) {
      upd.approval_disc = await managerApproval('discount_approve', `Discount ${inr(disc)} on ${c.it.name}`);
      if (!upd.approval_disc) return;
    }
    Object.assign(l, upd);
    saveBill(); renderBill();
  });
}

// ------------------------------------------------------------------ customer (F7)
function customerDialog() {
  const d = modal(`<h3>Customer</h3><input id="cq" placeholder="Search name or mobile number" autofocus>
    <div class="results" id="cr" style="margin-top:8px"></div>
    <h3 style="margin-top:14px">New customer</h3><form class="grid2"><div><label>Mobile (10 digits)</label><input name="phone" inputmode="tel" required></div>
    <div><label>Name</label><input name="name"></div><div class="actions" style="grid-column:1/-1">
    ${POS.bill.customer ? '<button type="button" id="cnone">Remove customer</button>' : ''}<button type="button" data-close>Close</button><button class="primary">Use this customer</button></div></form>`);
  let t;
  $('#cq', d).addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const { customers } = await api(`/customers?q=${encodeURIComponent(e.target.value)}`);
      $('#cr', d).innerHTML = customers.map((c) => `<div data-id="${c.id}"><span><b>${esc(c.name)}</b> ${esc(c.phone || '')}</span>${Number(c.balance) > 0 ? `<span class="bad">owes ${inr(c.balance)}</span>` : ''}</div>`).join('') ||
        '<div class="muted">No match. Add as a new customer below.</div>';
      $$('#cr div[data-id]', d).forEach((row) => row.addEventListener('click', () => {
        const c = customers.find((x) => x.id === Number(row.dataset.id));
        POS.bill.customer = { id: c.id, name: c.name, phone: c.phone, balance: c.balance };
        saveBill(); renderBill(); d.close();
      }));
    }, 250);
  });
  $('form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const phone = f.phone.replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) { toast('Mobile number must have 10 digits.', true); return; }
    POS.bill.customer = { phone, name: f.name.trim() || 'Customer' };
    saveBill(); renderBill(); d.close();
  });
  if ($('#cnone', d)) $('#cnone', d).addEventListener('click', () => { POS.bill.customer = null; saveBill(); renderBill(); d.close(); });
}

// ------------------------------------------------------------------ hold / cancel
const heldKey = () => `mpc_held_${myCounter()}`;
function holdDialog() {
  const held = JSON.parse(localStorage.getItem(heldKey()) || '[]');
  const d = modal(`<h3>Hold bills</h3>
    ${POS.bill.lines.length ? '<button class="primary" id="hold">Hold this bill and start a new one</button>' : ''}
    <div class="results" style="margin-top:10px">${held.map((b, i) => `<div data-i="${i}"><span>${esc(b.at)} · ${b.lines.length} items${b.customer ? ` · ${esc(b.customer.name)}` : ''}</span><b>Recall</b></div>`).join('') || '<div class="muted">No bills on hold.</div>'}</div>
    <div class="actions"><button data-close>Close</button></div>`);
  if ($('#hold', d)) $('#hold', d).addEventListener('click', () => {
    held.push({ ...POS.bill, at: new Date().toTimeString().slice(0, 5) });
    localStorage.setItem(heldKey(), JSON.stringify(held));
    POS.bill = newBill(); POS.sel = -1; saveBill(); renderBill(); d.close();
  });
  $$('[data-i]', d).forEach((row) => row.addEventListener('click', () => {
    if (POS.bill.lines.length) { toast('Complete or hold the current bill first.', true); return; }
    const [b] = held.splice(Number(row.dataset.i), 1);
    delete b.at;
    localStorage.setItem(heldKey(), JSON.stringify(held));
    POS.bill = b; POS.sel = b.lines.length - 1; saveBill(); renderBill(); d.close();
  }));
}
function cancelBill() {
  if (!POS.bill.lines.length) return;
  if (!confirm('Cancel this bill? All items will be removed.')) return;
  const t = totals();
  posEvent('bill_cancel', t.total, `Bill cancelled with ${t.items} items (${inr(t.total)})${POS.bill.order_no ? ` – online order ${POS.bill.order_no} stays open` : ''}`);
  POS.bill = newBill(); POS.sel = -1; saveBill(); renderBill();
}

// ------------------------------------------------------------------ payment
function payDialog() {
  if (!POS.bill.lines.length) return;
  const { total } = totals();
  const d = modal(`<h3>Payment · ${inr(total)}</h3>
    <form><div class="grid3"><div><label>UPI ₹</label><input name="upi" inputmode="decimal"></div>
      <div><label>Card ₹</label><input name="card" inputmode="decimal"></div>
      <div><label>UPI / card ref.</label><input name="ref"></div></div>
      ${POS.bill.customer ? `<label>Credit / udhaar ₹ (${esc(POS.bill.customer.name)} pays later${POS.bill.customer.balance && Number(POS.bill.customer.balance) ? `, already owes ${inr(POS.bill.customer.balance)}` : ''})</label>
        <input name="credit" inputmode="decimal">` : '<p class="small muted">For credit (udhaar), choose the customer first (F7).</p>'}
      <label>Cash given by customer ₹</label><input name="cash" inputmode="decimal" autofocus>
      <div class="row" style="margin-top:8px">${[50, 100, 200, 500, 2000].map((v) => `<button type="button" data-v="${v}">${v}</button>`).join('')}</div>
      <p>Cash to take: <b id="cashdue"></b> · Change: <span class="change" id="chg">₹0.00</span></p>
      <div class="actions"><button type="button" data-close>Cancel</button><button class="primary big">Complete sale (Enter)</button></div></form>`);
  const f = $('form', d);
  const calc = () => {
    const upi = Money.paise(f.upi.value || '0') || 0;
    const card = Money.paise(f.card.value || '0') || 0;
    const credit = f.credit ? Money.paise(f.credit.value || '0') || 0 : 0;
    const due = total - upi - card - credit;
    const given = f.cash.value ? Money.paise(f.cash.value) : due;
    $('#cashdue', d).textContent = inr(Math.max(0, due));
    $('#chg', d).textContent = inr(Math.max(0, (given ?? 0) - Math.max(0, due)));
    return { upi, card, credit, due, given };
  };
  ['upi', 'card', 'cash', 'credit'].forEach((n) => f[n] && f[n].addEventListener('input', calc));
  $$('[data-v]', d).forEach((b) => b.addEventListener('click', () => { f.cash.value = b.dataset.v; calc(); f.cash.focus(); }));
  calc();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = calc();
    if (c.due < 0) { toast('UPI + card + credit is more than the bill.', true); return; }
    if (c.given === null || c.given < c.due) { toast('Cash given is less than the cash to take.', true); return; }
    const pays = [];
    if (c.due > 0) pays.push({ method: 'cash', amount: Money.rs(c.due), tendered: Money.rs(c.given) });
    if (c.upi) pays.push({ method: 'upi', amount: Money.rs(c.upi), reference: f.ref.value });
    if (c.card) pays.push({ method: 'card', amount: Money.rs(c.card), reference: f.ref.value });
    if (c.credit) pays.push({ method: 'credit', amount: Money.rs(c.credit) });
    d.close('ok');
    if (c.credit && !can('credit_sale') && !POS.bill.approval_credit) {
      const tok = await managerApproval('credit_sale', `${inr(c.credit)} on credit for ${POS.bill.customer.name}`);
      if (!tok) return;
      POS.bill.approval_credit = tok; saveBill();
    }
    complete(pays);
  });
}

async function complete(payments) {
  if (POS.busy || !POS.bill.lines.length) return;
  if (!POS.shift) { toast(`Open the shift on ${myCounter()} first (Cash closing).`, true); return; }
  POS.busy = true;
  const btns = $$('.paybtn'); btns.forEach((b) => { b.disabled = true; });
  $('#status').textContent = 'Saving bill…';
  try {
    const body = {
      uuid: POS.bill.uuid, counter: myCounter(), customer: POS.bill.customer, order_id: POS.bill.order_id, approval_credit: POS.bill.approval_credit,
      lines: POS.bill.lines.map((l) => ({ id: l.id, qty: Money.qty(l.qty), rate: l.rate == null ? undefined : Money.rs(l.rate), delivery: l.delivery || undefined,
        disc: l.disc ? Money.rs(l.disc) : undefined, note: l.note, approval_price: l.approval_price, approval_disc: l.approval_disc })),
      payments,
    };
    const { bill } = await api('/checkout', { method: 'POST', body });
    POS.last = bill;
    POS.bill = newBill(); POS.sel = -1; saveBill();
    renderBill();
    const cash = bill.payments.find((p) => p.method === 'cash');
    $('#status').innerHTML = `<b>${esc(bill.bill_no)}</b> saved · ${inr(bill.total)}${cash && Number(cash.change_amt) ? ` · <span class="change">Change ${inr(cash.change_amt)}</span>` : ''}`;
    printBill(bill);
    if (bill.customer && bill.customer.phone && App.settings.whatsapp_bill === '1') {
      $('#status').insertAdjacentHTML('beforeend', ` <a class="btn" target="_blank" rel="noopener" href="${esc(waLink(bill.customer.phone, billText(bill)))}">WhatsApp bill</a>`);
    }
    loadCatalogue().catch(() => {});
  } catch (err) {
    $('#status').textContent = '';
    if (err.offline) toast('NOT SAVED – no internet. The bill is kept. Fix the internet and press the payment key again.', true);
    else toast(err.message, true);
  } finally {
    POS.busy = false;
    btns.forEach((b) => { b.disabled = false; });
    const s = $('#scan'); if (s) s.focus();
  }
}

// ------------------------------------------------------------------ screen
function showResults(list) {
  POS.results = list; POS.resSel = 0;
  const box = $('#results');
  if (!box) return;
  box.hidden = !list.length;
  box.innerHTML = list.map((it, i) => `<div data-i="${i}" class="${i === 0 ? 'sel' : ''}"><span>${esc(it.name)} <span class="ta muted small">${esc(it.name_ta)}</span></span>
    <b>${inr(it.price)}${it.unit === 'kg' ? '/kg' : ''}</b></div>`).join('');
  $$('div[data-i]', box).forEach((row) => row.addEventListener('mousedown', (e) => {
    e.preventDefault();
    addItem(POS.results[Number(row.dataset.i)]); $('#scan').value = ''; showResults([]);
  }));
}
function moveResult(step) {
  if (!POS.results.length) return false;
  POS.resSel = (POS.resSel + step + POS.results.length) % POS.results.length;
  $$('#results div[data-i]').forEach((r, i) => r.classList.toggle('sel', i === POS.resSel));
  const sel = $('#results .sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
  return true;
}

function renderTiles() {
  const box = $('#tiles');
  if (!box) return;
  $('#cats').innerHTML = [['', 'Loose (kg)'], ...POS.cats.map((c) => [c, c])].map(([v, l]) =>
    `<button data-c="${esc(v)}" class="${POS.tileCat === v ? 'on' : ''}">${esc(l)}</button>`).join('');
  $$('#cats button').forEach((b) => b.addEventListener('click', () => { POS.tileCat = b.dataset.c; renderTiles(); }));
  const list = [...POS.byId.values()].filter((it) => (POS.tileCat ? it.cat === POS.tileCat : it.unit === 'kg')).slice(0, 120);
  box.innerHTML = list.map((it) => `<button class="tile" data-id="${it.id}"><b>${esc(it.name)}</b><span class="s ta">${esc(it.name_ta)}</span>
    <span class="p">${inr(it.price)}${it.unit === 'kg' ? '/kg' : ''}</span></button>`).join('') ||
    `<p class="muted">${POS.byId.size ? 'No products here.' : 'No products are selling yet. Add products (Products & stock) or import the list.'}</p>`;
  $$('.tile', box).forEach((t) => t.addEventListener('click', () => { addItem(POS.byId.get(Number(t.dataset.id))); $('#scan').focus(); }));
}

function renderBill() {
  const box = $('#lines');
  if (!box) return;
  const b = POS.bill;
  box.innerHTML = b.lines.length ? `<table>${b.lines.map((l, i) => {
    const c = lineCalc(l);
    const name = l.delivery ? l.name : c.it ? c.it.name : '(product removed – delete this line)';
    return `<tr data-i="${i}" class="click ${i === POS.sel ? 'sel' : ''}"><td><div class="nm">${esc(name)}</div>
      <div class="sub">${Money.qty(l.qty)} ${c.it && c.it.unit === 'kg' ? 'kg' : ''} × ${inr(c.rate)}${l.rate != null ? ' (price changed)' : ''}
      ${l.disc ? ` · discount ${inr(l.disc)}` : ''}</div></td><td class="r"><b>${inr(c.net)}</b></td></tr>`;
  }).join('')}</table>` : '<div class="empty-bill">Scan a barcode, type a name, or tap a product.</div>';
  $$('tr[data-i]', box).forEach((tr) => tr.addEventListener('click', () => { POS.sel = Number(tr.dataset.i); renderBill(); }));
  const sel = $('tr.sel', box); if (sel) sel.scrollIntoView({ block: 'nearest' });
  const t = totals();
  $('#total').textContent = inr(t.total);
  $('#count').textContent = `${t.items} item${t.items === 1 ? '' : 's'}${t.saved ? ` · saves ${inr(t.saved)} on MRP` : ''}`;
  $('#cust').innerHTML = (b.order_no ? `<span class="pill">Online order ${esc(b.order_no)}</span> ` : '') +
    (b.customer ? `Customer: <b>${esc(b.customer.name)}</b> ${esc(b.customer.phone || '')}${Number(b.customer.balance) > 0 ? ` <span class="bad small">owes ${inr(b.customer.balance)}</span>` : ''}`
      : '<span class="muted">No customer (F7)</span>');
}

function renderShift() {
  const box = $('#shiftbox');
  if (!box) return;
  if (POS.shift) { box.innerHTML = `<span class="pill">Shift open · ${esc(POS.shift.cashier)}</span>`; return; }
  box.innerHTML = can('cash') ? `<form id="qopen" class="row"><span class="pill bad">No shift open</span>
      <input name="float" inputmode="decimal" placeholder="Opening cash ₹" style="width:140px" required><button class="primary">Open shift</button></form>`
    : '<span class="pill bad">No shift open – ask the manager</span>';
  if ($('#qopen')) $('#qopen').addEventListener('submit', (e) => { e.preventDefault(); submitting($('button', e.target), async () => {
    await api('/shift/open', { method: 'POST', body: { counter: myCounter(), float: e.target.float.value } });
    await refreshShift();
    toast('Shift opened.');
    $('#scan').focus();
  }); });
}
async function refreshShift() {
  const { shift } = await api(`/shift?counter=${encodeURIComponent(myCounter())}`);
  POS.shift = shift;
  renderShift();
}

function keys(e) {
  if ($('dialog')) return;
  const inScan = e.target.id === 'scan';
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) && !inScan;
  const fk = { F2: () => $('#scan').focus(), F3: () => complete([{ method: 'upi', amount: Money.rs(totals().total) }]), F4: changeQty,
    F5: priceDialog, F7: customerDialog, F8: holdDialog, F9: cancelBill,
    F10: () => { const t = Money.rs(totals().total); complete([{ method: 'cash', amount: t, tendered: t }]); }, F12: payDialog };
  if (fk[e.key]) { e.preventDefault(); if (!typing) fk[e.key](); return; }
  if (typing) return;
  if (inScan && e.key === 'ArrowDown' && moveResult(1)) { e.preventDefault(); return; }
  if (inScan && e.key === 'ArrowUp' && moveResult(-1)) { e.preventDefault(); return; }
  if (inScan && e.target.value) { if (e.key === 'Escape') { e.target.value = ''; showResults([]); } return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = POS.bill.lines.length; if (!n) return;
    POS.sel = Math.max(0, Math.min(n - 1, POS.sel + (e.key === 'ArrowDown' ? 1 : -1))); renderBill();
  } else if (e.key === 'Delete') { e.preventDefault(); removeLine(); }
  else if ((e.key === '+' || e.key === '-') && POS.sel >= 0) {
    e.preventDefault();
    const l = POS.bill.lines[POS.sel]; const it = POS.byId.get(l.id);
    if (it && it.unit === 'kg') { changeQty(); return; }
    l.qty = Math.max(1000, l.qty + (e.key === '+' ? 1000 : -1000)); saveBill(); renderBill();
  }
}

App.views.bill = async (main) => {
  if (!myCounter()) {
    main.innerHTML = '<h1>Billing</h1><p>First choose which counter this PC is.</p><button class="primary big" id="pc">Choose counter</button>';
    $('#pc').addEventListener('click', () => pickCounter(route));
    return;
  }
  await loadCatalogue();
  loadBill();
  POS.sel = POS.bill.lines.length - 1;
  main.innerHTML = `<div class="pos">
    <div class="pos-left">
      <div class="pos-head"><button class="counter-btn" id="pc">${esc(myCounter())}</button><span id="shiftbox"></span>
        <span class="muted small" id="status" style="flex:1"></span></div>
      <input id="scan" class="scan" placeholder="Scan barcode, or type name / PLU / code and press Enter" autocomplete="off" autofocus>
      <div class="results" id="results" hidden></div>
      <div class="cats" id="cats"></div>
      <div class="tiles" id="tiles"></div>
    </div>
    <div class="pos-right">
      <div class="row cust"><span id="cust" style="flex:1"></span><button id="cbtn">Customer F7</button></div>
      <div class="bill"><div class="bill-lines" id="lines"></div>
        <div class="bill-total"><span class="muted" id="count"></span><span class="t" id="total">₹0.00</span></div></div>
      <div class="pay-row"><button class="primary big paybtn" id="pcash">Cash exact F10</button><button class="primary big paybtn" id="pupi">UPI F3</button>
        <button class="big paybtn" id="pany">Payment F12</button></div>
      <div class="row"><button id="bqty">Qty F4</button><button id="bprice">Price/Disc F5</button><button id="bdel">Remove Del</button>
        <button id="bhold">Hold F8</button><button class="danger" id="bcancel">Cancel F9</button>
        <button id="blast" ${POS.last ? '' : 'disabled'}>Reprint last</button></div>
      <div class="keys"><span><kbd>F2</kbd> scan box</span><span><kbd>↑↓</kbd> select line</span><span><kbd>+</kbd>/<kbd>−</kbd> qty</span>
        <span><kbd>3*code</kbd> = 3 pieces</span></div>
    </div></div>`;
  const scan = $('#scan');
  scan.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onScan(e); } });
  scan.addEventListener('input', () => {
    const v = scan.value.trim();
    if (v.length >= 2 && !/^\d+$/.test(v)) showResults(search(v.replace(/^\d+(\.\d+)?\s*[*xX]\s*/, ''))); else showResults([]);
  });
  $('#pc').addEventListener('click', () => pickCounter(route));
  $('#cbtn').addEventListener('click', customerDialog);
  $('#pcash').addEventListener('click', () => { const t = Money.rs(totals().total); complete([{ method: 'cash', amount: t, tendered: t }]); });
  $('#pupi').addEventListener('click', () => complete([{ method: 'upi', amount: Money.rs(totals().total) }]));
  $('#pany').addEventListener('click', payDialog);
  $('#bqty').addEventListener('click', changeQty);
  $('#bprice').addEventListener('click', priceDialog);
  $('#bdel').addEventListener('click', removeLine);
  $('#bhold').addEventListener('click', holdDialog);
  $('#bcancel').addEventListener('click', cancelBill);
  $('#blast').addEventListener('click', () => POS.last && printBill(POS.last, true));
  renderTiles();
  renderBill();
  await refreshShift();
  document.addEventListener('keydown', keys);
  const refresh = setInterval(() => loadCatalogue().then(renderTiles).catch(() => {}), 5 * 60000);
  App.leave = () => { document.removeEventListener('keydown', keys); clearInterval(refresh); };
  scan.focus();
};
