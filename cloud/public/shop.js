/* Madhuram – customers' online shop: see what is in stock, order for takeaway or home delivery, track the order. No login. */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const S = { info: null, items: new Map(), cart: JSON.parse(localStorage.getItem('mpc_cart') || '{}'), cat: '', q: '' };

const paise = (v) => Math.round(Number(v || 0) * 100);
const rs = (p) => `₹${(p / 100).toFixed(2)}`;
const step = (it) => (it.unit === 'kg' ? 0.25 : 1);
const fmtQ = (q, it) => (it.unit === 'kg' ? (q < 1 ? `${Math.round(q * 1000)} g` : `${+q.toFixed(3)} kg`) : `${q}`);
function toast(m) { const t = $('#toast'); t.textContent = m; t.className = 'show'; setTimeout(() => { t.className = ''; }, 2500); }

async function get(path) {
  const r = await fetch(`/api/shop${path}`);
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'Please try again.');
  return d;
}

function saveCart() { localStorage.setItem('mpc_cart', JSON.stringify(S.cart)); drawBar(); }
function cartTotal() {
  let t = 0; let n = 0;
  for (const [id, q] of Object.entries(S.cart)) {
    const it = S.items.get(Number(id));
    if (it) { t += Math.round(paise(it.price) * q); n += 1; }
  }
  return { t, n };
}
function drawBar() {
  const { t, n } = cartTotal();
  $('#cartbar').hidden = !n || location.hash.startsWith('#cart') || location.hash.startsWith('#o=');
  $('#cartsum').textContent = `${n} item${n === 1 ? '' : 's'} · ${rs(t)}`;
}

// ------------------------------------------------------------------ product list
async function listView() {
  const s = S.info.shop;
  const main = $('#shop');
  if (s.online_enabled !== '1') {
    main.innerHTML = `<div class="notice">Online orders are closed right now. Please call the shop${s.phone ? `: <a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : ''}.</div>`;
    return;
  }
  main.innerHTML = `<div class="bar"><input id="q" placeholder="Search · தேடுக (e.g. tomato, அரிசி)" value="${esc(S.q)}">
      ${'BarcodeDetector' in window ? '<button id="scan">Scan</button>' : ''}</div>
    <div class="chips"><button data-c="" class="${S.cat ? '' : 'on'}">All</button>${S.info.cats.map((c) => `<button data-c="${c.id}" class="${String(c.id) === S.cat ? 'on' : ''}">${esc(c.name)}</button>`).join('')}</div>
    ${s.online_delivery === '1' ? `<p class="small muted">Home delivery${s.online_area ? ` ${esc(s.online_area)}` : ''} · minimum ${rs(paise(s.online_min_order))} ·
      charge ${rs(paise(s.online_delivery_charge))}${Number(s.online_free_delivery_above) ? `, free above ${rs(paise(s.online_free_delivery_above))}` : ''}</p>` : ''}
    <div class="grid" id="grid"><p class="muted">Loading…</p></div>`;
  let t;
  $('#q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.q = e.target.value; loadItems(); }, 300); });
  $$('.chips button').forEach((b) => b.addEventListener('click', () => { S.cat = b.dataset.c; $$('.chips button').forEach((x) => x.classList.toggle('on', x === b)); loadItems(); }));
  if ($('#scan')) $('#scan').addEventListener('click', scan);
  await loadItems();
}
async function loadItems(code = '') {
  const qs = new URLSearchParams({ q: S.q, cat: S.cat, code });
  const { items } = await get(`/items?${qs}`);
  for (const it of items) S.items.set(it.id, it);
  const grid = $('#grid');
  if (!grid) return;
  grid.innerHTML = items.length ? items.map((it) => card(it)).join('') : '<p class="muted">Nothing found.</p>';
  bindCards(grid);
  drawBar();
}
function card(it) {
  const q = S.cart[it.id] || 0;
  return `<div class="card ${it.in_stock ? '' : 'out'}" data-id="${it.id}"><b>${esc(it.name)}</b><span class="ta small muted">${esc(it.name_ta)}</span>
    <span class="p">${rs(paise(it.price))}${it.unit === 'kg' ? '<span class="small">/kg</span>' : ''}${it.mrp && Number(it.mrp) > Number(it.price) ? `<span class="mrp">${rs(paise(it.mrp))}</span>` : ''}</span>
    ${it.in_stock ? `<div class="qty">${q ? `<button data-d="-1">−</button><span>${fmtQ(q, it)}</span><button data-d="1">+</button>` : '<button data-d="1" class="primary" style="width:100%">Add</button>'}</div>`
    : '<span class="small bad">Out of stock</span>'}</div>`;
}
// one click handler for the whole grid (cards are redrawn after every change)
function bindCards(root) {
  if (root.dataset.bound) return;
  root.dataset.bound = '1';
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const el = b.closest('.card');
    const it = S.items.get(Number(el.dataset.id));
    let q = +((S.cart[it.id] || 0) + Number(b.dataset.d) * step(it)).toFixed(3);
    if (q > Number(it.available)) { toast(`Only ${it.available} ${it.unit} available`); q = Number(it.available); }
    if (q <= 0) delete S.cart[it.id]; else S.cart[it.id] = q;
    saveCart();
    el.outerHTML = card(it);
  });
}
async function scan() {
  const main = $('#shop');
  const box = document.createElement('div');
  box.className = 'box';
  box.innerHTML = '<p>Point the camera at the barcode on the pack.</p><video autoplay playsinline muted></video><button id="stop" style="margin-top:8px">Close</button>';
  main.prepend(box);
  let stream;
  const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); box.remove(); };
  $('#stop', box).addEventListener('click', stop);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('video', box);
    v.srcObject = stream;
    const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'code_128'] });
    const loop = async () => {
      if (!box.isConnected) return;
      const codes = await det.detect(v).catch(() => []);
      if (codes.length) { stop(); S.q = ''; await loadItems(codes[0].rawValue); return; }
      requestAnimationFrame(loop);
    };
    loop();
  } catch (_) { stop(); toast('Camera not available. Type the name instead.'); }
}

// ------------------------------------------------------------------ cart and checkout
function cartView() {
  const s = S.info.shop;
  const lines = Object.entries(S.cart).map(([id, q]) => [S.items.get(Number(id)), q]).filter(([it]) => it);
  const { t } = cartTotal();
  const main = $('#shop');
  if (!lines.length) { main.innerHTML = '<div class="box">Your cart is empty. <a href="#">Add products</a></div>'; return; }
  const modes = [s.online_pickup === '1' && ['pickup', 'Takeaway · கடையில் வாங்க'], s.online_delivery === '1' && ['delivery', 'Home delivery · வீட்டு டெலிவரி']].filter(Boolean);
  const saved = JSON.parse(localStorage.getItem('mpc_me') || '{}');
  main.innerHTML = `<a href="#">‹ Add more</a><div class="box" style="margin-top:8px"><h3 style="margin-top:0">Your order</h3>
      ${lines.map(([it, q]) => `<div class="line"><span>${esc(it.name)}<br><span class="small muted">${fmtQ(q, it)} × ${rs(paise(it.price))}</span></span>
      <b>${rs(Math.round(paise(it.price) * q))}</b></div>`).join('')}
      <div class="line"><span>Items</span><b>${rs(t)}</b></div><div class="line" id="dline" hidden><span>Delivery charge</span><b id="dch"></b></div>
      <div class="line"><span><b>Approx. total</b><br><span class="small muted">Weighed items may change a little.</span></span><b id="gt">${rs(t)}</b></div></div>
    <form id="of" class="box"><div class="modes">${modes.map(([v, l], i) => `<label class="${i === 0 ? 'on' : ''}"><input type="radio" name="mode" value="${v}" ${i === 0 ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
      <label>Day</label><select id="day">${S.info.slots.map((d, i) => `<option value="${i}">${esc(d.label)}</option>`).join('')}</select>
      <label>Time</label><div class="slots" id="slots"></div><input type="hidden" name="slot">
      <label>Your name</label><input name="name" required value="${esc(saved.name || '')}" autocomplete="name">
      <label>Mobile (WhatsApp)</label><input name="phone" required inputmode="tel" value="${esc(saved.phone || '')}" autocomplete="tel">
      <div id="addr"><label>Delivery address with landmark</label><textarea name="address" rows="2">${esc(saved.address || '')}</textarea></div>
      <label>Notes (optional)</label><input name="notes" placeholder="e.g. ripe bananas, call before coming">
      <label>Pay by</label><select name="pay"><option value="cash">Cash</option><option value="upi">UPI${s.upi_id ? ` (${esc(s.upi_id)})` : ''}</option></select>
      <input name="website" class="hp" tabindex="-1" autocomplete="off">
      <div class="err" id="oerr" hidden></div>
      <button class="primary" style="width:100%;margin-top:12px;padding:14px">Place order</button>
      <p class="small muted">You pay when you collect / when it is delivered. The shop confirms on WhatsApp.</p></form>`;
  const f = $('#of');
  const drawSlots = () => {
    const d = S.info.slots[Number($('#day').value)];
    $('#slots').innerHTML = d ? d.slots.map((x) => `<button type="button" data-v="${x.v}">${esc(x.l)}</button>`).join('') : '<span class="muted">No slots</span>';
    f.slot.value = '';
    $$('#slots button').forEach((b) => b.addEventListener('click', () => { f.slot.value = b.dataset.v; $$('#slots button').forEach((x) => x.classList.toggle('on', x === b)); }));
  };
  const drawMode = () => {
    const del = f.mode.value === 'delivery';
    $$('.modes label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    $('#addr').hidden = !del;
    let ch = 0;
    if (del) { ch = paise(s.online_delivery_charge); if (Number(s.online_free_delivery_above) && t >= paise(s.online_free_delivery_above)) ch = 0; }
    $('#dline').hidden = !del; $('#dch').textContent = ch ? rs(ch) : 'Free'; $('#gt').textContent = rs(t + ch);
  };
  $('#day').addEventListener('change', drawSlots);
  $$('[name=mode]', f).forEach((r) => r.addEventListener('change', drawMode));
  drawSlots(); drawMode();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#oerr'); err.hidden = true;
    if (!f.slot.value) { err.hidden = false; err.textContent = 'Please choose a time.'; return; }
    const body = { mode: f.mode.value, slot: f.slot.value, name: f.name.value, phone: f.phone.value, address: f.address.value, notes: f.notes.value,
      pay: f.pay.value, website: f.website.value, lines: lines.map(([it, q]) => ({ id: it.id, qty: String(q) })) };
    const btn = $('button.primary', f); btn.disabled = true;
    try {
      const r = await fetch('/api/shop/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      localStorage.setItem('mpc_me', JSON.stringify({ name: body.name, phone: body.phone, address: body.address }));
      const mine = JSON.parse(localStorage.getItem('mpc_orders') || '[]');
      mine.unshift({ n: d.number, t: d.token });
      localStorage.setItem('mpc_orders', JSON.stringify(mine.slice(0, 10)));
      S.cart = {}; saveCart();
      location.hash = `#o=${d.token}`;
    } catch (ex) { err.hidden = false; err.textContent = ex.message || 'Please try again.'; } finally { btn.disabled = false; }
  });
}

// ------------------------------------------------------------------ order tracking
let trackTimer;
async function trackView(token) {
  const { order: o } = await get(`/track/${token}`);
  const steps = ['new', 'accepted', o.mode === 'pickup' ? 'ready' : 'out', 'done'];
  const names = { new: 'Received', accepted: 'Processing', ready: 'Ready to collect', out: 'Delivery person coming', done: 'Completed' };
  const at = steps.indexOf(o.status);
  $('#shop').innerHTML = `<div class="box"><h2 style="margin:0">Order ${esc(o.number)}</h2><p>${esc(o.name)} · ${o.mode === 'delivery' ? 'Home delivery' : 'Takeaway'}<br>${esc(o.slot_label)}</p>
    ${o.status === 'cancelled' ? `<div class="err">Cancelled: ${esc(o.note)}</div>` : `<div class="steps">${steps.map((s, i) => `<div class="${i <= at ? 'done' : ''}">${names[s]}</div>`).join('')}</div>
      <p style="font-size:1.1rem"><b>${esc(o.status_label)}</b></p>`}
    ${o.lines.some((l) => l.note) ? '<div class="notice">Some items were not available. You are <b>not charged</b> for them; if you already paid, the shop refunds the difference.</div>' : ''}
    ${o.bill_no ? `<p class="ok">Bill ${esc(o.bill_no)} · ${rs(paise(o.bill_total))}. Thank you!</p>` : ''}
    ${o.lines.map((l) => `<div class="line" ${l.note && !Number(l.qty) ? 'style="text-decoration:line-through;color:#6b7689"' : ''}><span>${esc(l.name)} <span class="small muted">${esc(l.qty)} ${l.unit === 'kg' ? 'kg' : ''}</span>
      ${l.note ? `<br><span class="small bad">${esc(l.note)}${l.ordered ? ` (you ordered ${esc(l.ordered)})` : ''}</span>` : ''}</span><b>${rs(Math.round(paise(l.price) * Number(l.qty)))}</b></div>`).join('')}
    ${Number(o.delivery_charge) ? `<div class="line"><span>Delivery</span><b>${rs(paise(o.delivery_charge))}</b></div>` : ''}
    <div class="line"><b>Approx. total</b><b>${rs(paise(o.est_total))}</b></div>
    <p class="small muted">This page updates by itself. Questions? ${o.shop.phone ? `Call <a href="tel:${esc(o.shop.phone)}">${esc(o.shop.phone)}</a>` : 'Call the shop'}.</p>
    <a class="btn" href="#">Order more</a></div>`;
  clearTimeout(trackTimer);
  if (!['done', 'cancelled'].includes(o.status)) trackTimer = setTimeout(() => { if (location.hash === `#o=${token}`) trackView(token).catch(() => {}); }, 30000);
}

async function route() {
  drawBar();
  const h = location.hash;
  try {
    if (h.startsWith('#o=')) return await trackView(h.slice(3));
    if (h === '#cart') return cartView();
    return await listView();
  } catch (e) {
    $('#shop').innerHTML = `<div class="err">${esc(e.message)}</div>`;
    return undefined;
  }
}

(async () => {
  try {
    S.info = await get('/info');
  } catch (e) { $('#shop').innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const s = S.info.shop;
  document.title = `${s.name} – order online`;
  $('#sname').textContent = s.name;
  $('#sinfo').textContent = [s.name_ta, s.phone].filter(Boolean).join(' · ');
  // cart prices come from the server, never from the saved cart
  const ids = Object.keys(S.cart);
  if (ids.length) {
    try {
      const { items } = await get(`/items?ids=${ids.join(',')}`);
      for (const it of items) S.items.set(it.id, it);
      for (const id of ids) if (!S.items.has(Number(id))) delete S.cart[id];       // no longer sold online
      saveCart();
    } catch (_) { /* shown by the list */ }
  }
  const mine = JSON.parse(localStorage.getItem('mpc_orders') || '[]');
  if (mine.length && !location.hash) $('#sinfo').insertAdjacentHTML('beforeend', ` · <a href="#o=${esc(mine[0].t)}">My last order ${esc(mine[0].n)}</a>`);
  $('#gocart').addEventListener('click', () => { location.hash = '#cart'; });
  window.addEventListener('hashchange', route);
  route();
})();
