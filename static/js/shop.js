/* Customer online shop: browse what is in stock, cart (kept on the phone), choose takeaway / delivery and a slot, order. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = v => '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const csrf = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  const KEY = 'mpc-shop-cart';
  let cart = {}; try { cart = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { cart = {}; }
  const known = {};               // id -> item (from the last lists shown)
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) { /* private mode */ } drawBar(); };
  const step = it => it.weighed ? 0.25 : 1;
  const fmtQ = (q, it) => it.weighed ? (q < 1 ? Math.round(q * 1000) + ' g' : (+q.toFixed(3)) + ' kg') : q + ' pc';
  let cat = '', t;

  function tile(it) {
    const q = cart[it.id] ? cart[it.id].qty : 0, avail = Number(it.available);
    return `<article class="sh-item ${it.in_stock ? '' : 'out'}" data-id="${it.id}">
      <div class="nm">${esc(it.name.split(' · ')[0])}</div>${it.name_ta ? `<div class="ta">${esc(it.name_ta.split(' · ')[0])}</div>` : ''}
      <div class="vr">${esc(it.name.split(' · ').slice(1).join(' · '))}</div>
      <div class="pr">${inr(it.price)}<small>/${it.weighed ? 'kg' : 'pc'}</small>${it.mrp && Number(it.mrp) > Number(it.price) ? `<s>${inr(it.mrp)}</s>` : ''}</div>
      <div class="st">${it.in_stock ? (avail < 5 ? `Only ${avail} ${it.unit} left` : 'In stock') : 'Out of stock'}</div>
      ${it.in_stock ? (q ? `<div class="qty"><button data-d="-1" aria-label="Less">−</button><b>${fmtQ(q, it)}</b><button data-d="1" aria-label="More">+</button></div>`
        : `<button class="sh-btn add" data-d="1">Add</button>`) : ''}</article>`;
  }
  async function load() {
    const q = $('#q').value.trim();
    const r = await fetch(`/shop/api/items/?q=${encodeURIComponent(q)}&cat=${encodeURIComponent(cat)}`, { headers: { Accept: 'application/json' } });
    const items = (await r.json()).items || [];
    items.forEach(it => known[it.id] = it);
    $('#items').innerHTML = items.map(tile).join('') || `<p class="sh-empty">No products found${q ? ` for “${esc(q)}”` : ''}. Try another word or the Tamil name.</p>`;
  }
  function change(id, dir) {
    const it = known[id]; if (!it) return;
    const max = Number(it.available), cur = cart[id] ? cart[id].qty : 0;
    let q = Math.round((cur + dir * step(it)) * 1000) / 1000;
    if (q > max) q = max;
    if (q <= 0) delete cart[id]; else cart[id] = { qty: q, name: it.name, name_ta: it.name_ta, price: Number(it.price), weighed: it.weighed, unit: it.unit };
    save(); $$(`.sh-item[data-id="${id}"]`).forEach(el => el.outerHTML = tile(it));
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const card = b.closest('[data-id]'); if (card) change(+card.dataset.id, +b.dataset.d);
  });
  $('#cats').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; cat = b.dataset.cat; $$('#cats button').forEach(x => x.classList.toggle('on', x === b)); load(); });
  $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 200); });

  // ---- cart bar and order sheet
  const itemsTotal = () => Object.values(cart).reduce((s, l) => s + l.qty * l.price, 0);
  function drawBar() {
    const n = Object.keys(cart).length;
    $('#cartbar').hidden = !n; $('#cb-n').textContent = `${n} item${n === 1 ? '' : 's'}`; $('#cb-t').textContent = inr(itemsTotal());
  }
  const mode = () => (document.querySelector('input[name=mode]:checked') || {}).value;
  function drawSheet() {
    $('#cartlines').innerHTML = Object.entries(cart).map(([id, l]) => `<div class="sh-line" data-id="${id}"><div><b>${esc(l.name.split(' · ')[0])}</b><span>${esc(l.name.split(' · ').slice(1).join(' · '))}</span></div>
      <div class="qty sm"><button type="button" data-d="-1">−</button><b>${fmtQ(l.qty, l)}</b><button type="button" data-d="1">+</button></div><div class="am">${inr(l.qty * l.price)}</div></div>`).join('') || '<p class="sh-empty">Your cart is empty.</p>';
    const it = itemsTotal(), del = mode() === 'delivery' && SHOP.charge > 0 && !(SHOP.freeAbove && it >= SHOP.freeAbove) ? SHOP.charge : 0;
    $('#sum-items').textContent = inr(it); $('#row-del').hidden = !del; $('#sum-del').textContent = inr(del); $('#sum-all').textContent = inr(it + del);
    $('#addr-wrap').hidden = mode() !== 'delivery';
  }
  $('#cartlines').addEventListener('click', e => {
    const b = e.target.closest('[data-d]'); if (!b) return; e.stopPropagation();
    const id = +b.closest('[data-id]').dataset.id, l = cart[id], dir = +b.dataset.d;
    if (!known[id]) known[id] = { id, name: l.name, name_ta: l.name_ta, price: l.price, weighed: l.weighed, unit: l.unit, available: 1e9, in_stock: true };
    change(id, dir); drawSheet();
  });
  const slotData = JSON.parse($('#slots').textContent);
  function drawSlots() { const d = slotData[+$('#day').value] || { slots: [] }; $('#slot').innerHTML = d.slots.map(s => `<option value="${s.v}">${esc(s.l)}</option>`).join('') || '<option value="">No slots</option>'; }
  $('#day').addEventListener('change', drawSlots); drawSlots();
  $$('input[name=mode]').forEach(r => r.addEventListener('change', drawSheet));
  $('#go').addEventListener('click', () => { drawSheet(); $('#err').textContent = ''; try { const me = JSON.parse(localStorage.getItem('mpc-shop-me')) || {}; ['name', 'phone', 'address'].forEach(k => { if (me[k] && !$('#' + k).value) $('#' + k).value = me[k]; }); } catch (e) { /* ignore */ } $('#dlg').showModal(); });
  let sending = false;
  $('#place').addEventListener('click', async () => {
    if (sending) return; $('#err').textContent = '';
    const body = { name: $('#name').value, phone: $('#phone').value, mode: mode(), slot: $('#slot').value, address: $('#address').value, pay: $('#pay').value,
      notes: $('#notes').value, website: $('#website').value, lines: Object.entries(cart).map(([id, l]) => ({ id: +id, qty: l.qty })) };
    if (!body.lines.length) { $('#err').textContent = 'Your cart is empty.'; return; }
    sending = true; $('#place').disabled = true; $('#place').textContent = 'Placing order…';
    try {
      const r = await fetch('/shop/api/order/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.ok) { $('#err').textContent = d.error || 'Could not place the order.'; return; }
      try { localStorage.setItem('mpc-shop-me', JSON.stringify({ name: body.name, phone: body.phone, address: body.address })); } catch (e) { /* ignore */ }
      cart = {}; save(); location.href = d.url;
    } catch (e) { $('#err').textContent = 'No connection. Check your internet and try again.'; }
    finally { sending = false; $('#place').disabled = false; $('#place').textContent = 'Place order'; }
  });

  // ---- scan a product with the phone camera (Android Chrome); everyone can type the number
  let stream = null, timer = null;
  async function findCode(code) {
    const r = await fetch(`/shop/api/items/?code=${encodeURIComponent(code)}`, { headers: { Accept: 'application/json' } });
    const items = (await r.json()).items || [];
    items.forEach(it => known[it.id] = it);
    $('#scanres').innerHTML = items.length ? `<div class="sh-grid one">${items.map(tile).join('')}</div>` : `<p class="sh-err">Barcode ${esc(code)} is not in our online shop. Ask at the counter.</p>`;
  }
  function stopCam() { if (timer) clearInterval(timer); timer = null; if (stream) stream.getTracks().forEach(tr => tr.stop()); stream = null; }
  $('#scan').addEventListener('click', async () => {
    $('#scanres').innerHTML = ''; $('#scandlg').showModal();
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { $('#cam').hidden = true; $('#scanmsg').textContent = 'This phone cannot scan from the browser – type the number printed under the barcode.'; $('#code').focus(); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = $('#cam'); v.hidden = false; v.srcObject = stream; await v.play();
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
      timer = setInterval(async () => { try { const f = await det.detect(v); if (f.length) { stopCam(); v.hidden = true; $('#code').value = f[0].rawValue; findCode(f[0].rawValue); } } catch (e) { /* keep trying */ } }, 400);
    } catch (e) { $('#cam').hidden = true; $('#scanmsg').textContent = 'Camera not allowed – type the number printed under the barcode.'; }
  });
  $('#codego').addEventListener('click', () => { const c = $('#code').value.trim(); if (c) findCode(c); });
  $('#scanclose').addEventListener('click', () => { stopCam(); $('#scandlg').close(); });
  $('#scandlg').addEventListener('close', stopCam);

  drawBar(); load();
})();
