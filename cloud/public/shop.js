/* Madhuram online shop: home delivery and takeaway from one page. */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const S = {
  info: null, items: new Map(), cart: JSON.parse(localStorage.getItem('mpc_cart') || '{}'),
  mode: localStorage.getItem('mpc_mode') || '', q: '', dayIdx: 0, slot: '', me: null, sms: false, after: '',
};
async function post(path, body) {
  const r = await fetch(`/api/shop${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({ ok: false, error: 'Please try again.' }));
  if (!d.ok) { const e = new Error(d.error || 'Please try again.'); e.status = r.status; throw e; }
  return d;
}

// ------------------------------------------------------------------ money and quantities
const paise = (v) => Math.round(Number(v || 0) * 100);
const rs = (p) => `₹${(p / 100).toFixed(p % 100 ? 2 : 0)}`;
const step = (it) => (it.unit === 'kg' ? 0.25 : 1);
const fmtQ = (q, it) => (it.unit === 'kg' ? (q < 1 ? `${Math.round(q * 1000)} g` : `${+q.toFixed(3)} kg`) : `${q}`);
const lineP = (it, q) => Math.round(paise(it.price) * q);
const offPct = (it) => (it.mrp && Number(it.mrp) > Number(it.price) ? Math.round((1 - Number(it.price) / Number(it.mrp)) * 100) : 0);
function toast(m) { const t = $('#toast'); t.textContent = m; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = ''; }, 2400); }

async function get(path) {
  const r = await fetch(`/api/shop${path}`);
  const d = await r.json();
  if (!d.ok) throw new Error(d.error || 'Please try again.');
  return d;
}
const remember = (list) => { for (const it of list) S.items.set(it.id, it); return list; };

// ------------------------------------------------------------------ pictures: product photo, or a plain line icon for its product group
const GROUP_TINT = { fruit: '#fdeee6', veg: '#e8f4ea', dairy: '#eaf1fb', bakery: '#f8efe3', snacks: '#f9eedf', drink: '#e9f3f6', oil: '#f6f3df',
  staples: '#f4efe6', clean: '#e9f0f7', care: '#f3ecf6', baby: '#eef3f9', pill: '#f7eaea', box: '#eff2f0' };
const pic = (text) => ico(groupOf(text), 'pic');
const itemPic = (it) => ico(groupOf(`${it.name} ${it.cat}`), 'pic');
const tint = () => '#f3f5f4';
const catTint = (k) => GROUP_TINT[groupOf(k)] || GROUP_TINT.box;

// ------------------------------------------------------------------ cart
function saveCart() { localStorage.setItem('mpc_cart', JSON.stringify(S.cart)); drawBars(); }
function cartSums() {
  let items = 0; let total = 0; let mrp = 0; let n = 0;
  for (const [id, q] of Object.entries(S.cart)) {
    const it = S.items.get(Number(id));
    if (!it) continue;
    n += 1; items += it.unit === 'kg' ? 1 : q; total += lineP(it, q);
    mrp += it.mrp && Number(it.mrp) > Number(it.price) ? Math.round(paise(it.mrp) * q) : lineP(it, q);
  }
  return { n, items, total, saved: mrp - total };
}
function deliveryCharge(total) {
  const s = S.info.shop;
  if (S.mode !== 'delivery') return 0;
  const free = paise(s.online_free_delivery_above);
  return free && total >= free ? 0 : paise(s.online_delivery_charge);
}
function setQty(it, q) {
  q = +Math.max(0, q).toFixed(3);
  if (q > Number(it.available)) { toast(`Only ${it.available} ${it.unit === 'kg' ? 'kg' : ''} available now`); q = Number(it.available); }
  if (q <= 0) delete S.cart[it.id]; else S.cart[it.id] = q;
  saveCart();
  if (location.hash === '#cart' && $('#sheet').hidden) { const y = window.scrollY; cartView(); window.scrollTo(0, y); return; }
  $$(`[data-pid="${it.id}"] .pr .act`).forEach((el) => { el.innerHTML = actHtml(it); });
}
function drawBars() {
  const c = cartSums();
  const hash = location.hash;
  $('#cartbar').hidden = !c.n || /^#(cart|o=|orders|account|login|signup|forgot)/.test(hash);
  $('#cbItems').textContent = `${c.n} item${c.n === 1 ? '' : 's'}`;
  $('#cbTotal').textContent = rs(c.total);
  $('#navCount').hidden = !c.n; $('#navCount').textContent = c.n;
  $('#topCartText').textContent = c.n ? `${c.n} item${c.n === 1 ? '' : 's'} · ${rs(c.total)}` : 'Cart';
  $('#topCart').classList.toggle('full', !!c.n);
  $('#acctLink').innerHTML = `${ico('user')}<span>${S.me ? esc(S.me.name.split(' ')[0]) : 'Login'}</span>`;
  const page = hash.startsWith('#cart') ? 'cart' : /^#(account|login|signup|forgot|orders|o=)/.test(hash) ? 'account' : hash.startsWith('#cat') ? 'cats' : 'home';
  $$('.bottom a').forEach((a) => a.classList.toggle('on', a.dataset.nav === page));
}

// ------------------------------------------------------------------ product cards
const actHtml = (it) => {
  if (!it.in_stock) return '<span class="small mut">Sold out</span>';
  const q = S.cart[it.id] || 0;
  return q ? `<span class="step"><button data-d="-1" aria-label="Less">−</button><span>${fmtQ(q, it)}</span><button data-d="1" aria-label="More">+</button></span>`
    : '<button class="add" data-d="1">ADD</button>';
};
const card = (it) => {
  const off = offPct(it);
  return `<div class="pc ${it.in_stock ? '' : 'out'}" data-pid="${it.id}">
    <div class="pimg" style="background:${it.image ? '#fff' : tint(it.cat || it.name)}">${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : itemPic(it)}
      ${off ? `<span class="tag">${off}%<br>OFF</span>` : ''}${it.popular ? '<span class="pop">Bestseller</span>' : ''}</div>
    <div class="pbody"><div class="pn">${esc(it.name)}</div><div class="pt ta">${esc(it.name_ta)}</div>
      <div class="pu">${it.unit === 'kg' ? 'Per kg · choose weight' : '1 piece'}</div>
      <div class="pr"><span class="price">${rs(paise(it.price))}${it.unit === 'kg' ? '<small>/kg</small>' : ''}
        ${off ? `<span class="mrp">MRP ${rs(paise(it.mrp))}</span>` : ''}</span><span class="act">${actHtml(it)}</span></div></div></div>`;
};
// one tap handler for every product card on the page
document.addEventListener('click', (e) => {
  const cardEl = e.target.closest('[data-pid]');
  if (!cardEl || e.target.closest('.sheet-card') && !e.target.closest('.pc')) return;
  const it = S.items.get(Number(cardEl.dataset.pid));
  if (!it) return;
  const d = e.target.closest('[data-d]');
  if (d) { e.stopPropagation(); if (it.in_stock) setQty(it, (S.cart[it.id] || 0) + Number(d.dataset.d) * step(it)); return; }
  openSheet(it);
});

// ------------------------------------------------------------------ product sheet (tap a product)
async function openSheet(it) {
  const off = offPct(it);
  let q = S.cart[it.id] || step(it);
  const card$ = $('#sheetCard');
  const draw = () => {
    card$.innerHTML = `<div class="grab"></div><button class="x" data-close aria-label="Close">${ico('x')}</button>
      <div class="big-img" style="background:${it.image ? '#fff' : tint(it.cat || it.name)}">${it.image ? `<img src="${esc(it.image)}" alt="">` : itemPic(it)}${off ? `<span class="tag">${off}%<br>Save</span>` : ''}</div>
      <h2>${esc(it.name)}</h2><div class="ta mut">${esc(it.name_ta)}</div>
      <div style="margin-top:6px"><span class="bp">${rs(paise(it.price))}${it.unit === 'kg' ? '<small>/kg</small>' : ''}</span>
        ${off ? `<span class="mrp" style="display:inline;margin-left:6px">MRP ${rs(paise(it.mrp))}</span>` : ''}${it.popular ? '<span class="sold">Bestseller</span>' : ''}</div>
      <p class="small mut">${it.in_stock ? `In stock${it.unit === 'kg' ? ' · loose, weighed when packed (the bill shows the exact weight)' : ''}` : '<b class="bad">Sold out right now</b>'}
        ${it.cat ? ` · ${esc(it.cat)}` : ''}</p>
      <div class="sec-h"><h2>Similar products</h2></div><div class="rail" id="similar"><div class="mut small">Loading…</div></div>`;
    $('#sheetFoot') && $('#sheetFoot').remove();
    const foot = document.createElement('div');
    foot.className = 'sheet-foot'; foot.id = 'sheetFoot';
    foot.innerHTML = it.in_stock ? `<div class="qty-box"><button data-q="-1">−</button><span>${fmtQ(q, it)}</span><button data-q="1">+</button></div>
      <button class="btn-g" id="sheetAdd">${S.cart[it.id] ? 'Update cart' : 'Add item'} · ${rs(lineP(it, q))}</button>` : '<button class="btn-g" disabled>Sold out</button>';
    $('#sheet').appendChild(foot);
    $$('[data-q]', foot).forEach((b) => b.addEventListener('click', () => { q = Math.max(step(it), +(q + Number(b.dataset.q) * step(it)).toFixed(3)); draw(); loadSimilar(); }));
    if ($('#sheetAdd', foot)) $('#sheetAdd', foot).addEventListener('click', () => { setQty(it, q); closeSheet(); toast(`${it.name} added`); });
  };
  const loadSimilar = async () => {
    try {
      const { items } = await get(`/items?${new URLSearchParams({ cat: it.cat_id || '', sort: 'popular', limit: 12, exclude: it.id })}`);
      $('#similar').innerHTML = remember(items).map(card).join('') || '<div class="mut small">—</div>';
    } catch (_) { $('#similar').innerHTML = ''; }
  };
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  draw();
  loadSimilar();
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
  if ($('#sheetFoot')) $('#sheetFoot').remove();
  if (location.hash === '#cart') { const y = window.scrollY; cartView(); window.scrollTo(0, y); }
}
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

// ------------------------------------------------------------------ pages
const view = () => $('#view');
const closedNote = () => (S.info.shop.online_enabled === '1' ? '' : `<div class="notice">We are not taking online orders right now. Please call the shop${
  S.info.shop.phone ? `: <a href="tel:${esc(S.info.shop.phone)}"><b>${esc(S.info.shop.phone)}</b></a>` : ''}.</div>`);

async function homeView() {
  const s = S.info.shop;
  const firstSlot = S.info.slots[0] && S.info.slots[0].slots[0];
  const banners = [
    `<a class="banner b-green" href="#cats"><span class="b-k">Fresh every morning</span><h3>Fruits and vegetables</h3>
      <p>${S.mode === 'delivery' ? 'Delivered' : 'Packed for pickup'} ${firstSlot ? `from ${esc(firstSlot.l.split('–')[0])}` : 'today'}</p><span class="cta">Shop now ${ico('right')}</span></a>`,
    Number(s.online_free_delivery_above) && s.online_delivery === '1' ? `<a class="banner b-dark" href="#cats"><span class="b-k">Home delivery</span><h3>Free above ${rs(paise(s.online_free_delivery_above))}</h3>
      <p>${s.online_area ? esc(s.online_area) : 'Near the shop'}</p><span class="cta">Order now ${ico('right')}</span></a>` : '',
    s.online_pickup === '1' ? `<a class="banner b-light" href="#cats"><span class="b-k">Takeaway</span><h3>Order now, collect at the counter</h3>
      <p>No waiting in the queue</p><span class="cta">Order for pickup ${ico('right')}</span></a>` : '',
  ].filter(Boolean);
  view().innerHTML = `${closedNote()}
    <div class="banners" id="banners">${banners.join('')}</div><div class="dots">${banners.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
    <section><div class="sec-h"><h2>Shop by category</h2><a href="#cats">See all ›</a></div>
      <div class="cats-row">${S.info.cats.slice(0, 14).map(catTile).join('')}</div></section>
    <section id="offersSec" hidden><div class="sec-h"><h2>On offer</h2></div><div class="rail" id="offers"></div></section>
    <section><div class="sec-h"><h2>Best sellers</h2></div><div class="grid" id="popular"><div class="mut small">Loading…</div></div></section>
    <p class="credit">Some product photos: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (CC BY-SA).
      Pictures are for illustration; packs may differ.</p>`;
  const bn = $('#banners');
  bn.addEventListener('scroll', () => { const i = Math.round(bn.scrollLeft / (bn.firstElementChild.offsetWidth + 12)); $$('.dots i').forEach((d, k) => d.classList.toggle('on', k === i)); });
  try {
    const [pop, off] = await Promise.all([get('/items?sort=popular&limit=40'), get('/items?sort=offers&limit=20')]);
    $('#popular').innerHTML = remember(pop.items).map(card).join('') || '<div class="empty">No products yet.</div>';
    if (remember(off.items).length) { $('#offersSec').hidden = false; $('#offers').innerHTML = off.items.map(card).join(''); }
  } catch (e) { $('#popular').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  drawBars();
}
const catTile = (c) => `<a class="cat" href="#cat=${c.id}"><div class="ci" style="background:${catTint(c.name)}">${pic(c.name)}</div><div class="cn">${esc(c.name)}</div></a>`;

function catsView() {
  view().innerHTML = `${closedNote()}<div class="page"><h1>All categories</h1><div class="cat-grid">${S.info.cats.map(catTile).join('')}</div></div>`;
}

async function listView({ cat = '', q = '', code = '' }) {
  const c = S.info.cats.find((x) => String(x.id) === String(cat));
  view().innerHTML = `${closedNote()}<div class="page"><h1>${c ? `${pic(c.name)} ${esc(c.name)}` : q ? `Results for “${esc(q)}”` : 'Scanned product'}</h1>
    ${c ? `<div class="cats-row" style="margin-bottom:10px">${S.info.cats.map((x) => `<a class="cat" href="#cat=${x.id}" style="flex-basis:70px;${String(x.id) === String(cat) ? 'color:var(--g-d)' : ''}">
      <div class="ci" style="width:58px;height:58px;font-size:1.7rem;background:${String(x.id) === String(cat) ? 'var(--g-s2)' : catTint(x.name)}">${pic(x.name)}</div><div class="cn">${esc(x.name)}</div></a>`).join('')}</div>` : ''}
    <div class="grid" id="list"><div class="mut small">Loading…</div></div></div>`;
  try {
    const { items } = await get(`/items?${new URLSearchParams({ cat, q, code, sort: 'popular' })}`);
    $('#list').innerHTML = remember(items).map(card).join('') || `<div class="empty">Nothing found${q ? ` for “${esc(q)}”` : ''}. Try another word.</div>`;
    if (code && items.length === 1) openSheet(items[0]);
  } catch (e) { $('#list').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  drawBars();
}

// ------------------------------------------------------------------ cart and checkout
function cartView() {
  const s = S.info.shop;
  const lines = Object.entries(S.cart).map(([id, q]) => [S.items.get(Number(id)), q]).filter(([it]) => it);
  if (!lines.length) {
    view().innerHTML = `<div class="page"><div class="empty-state">${ico('cart', 'big')}<h2>Your cart is empty</h2><a class="btn-g" href="#">Browse products</a></div></div>`;
    return;
  }
  const c = cartSums();
  const dc = deliveryCharge(c.total);
  const minOrder = paise(s.online_min_order);
  const saved = JSON.parse(localStorage.getItem('mpc_me') || '{}');
  const days = S.info.slots;
  if (S.dayIdx >= days.length) S.dayIdx = 0;
  view().innerHTML = `${closedNote()}<div class="page"><h1>My cart</h1><div class="cart-cols"><div class="main-col">
    <div class="box"><div class="seg">
      ${s.online_delivery === '1' ? `<label class="${S.mode === 'delivery' ? 'on' : ''}"><input type="radio" name="cmode" value="delivery" ${S.mode === 'delivery' ? 'checked' : ''}> ${ico('truck')} Home delivery</label>` : ''}
      ${s.online_pickup === '1' ? `<label class="${S.mode === 'pickup' ? 'on' : ''}"><input type="radio" name="cmode" value="pickup" ${S.mode === 'pickup' ? 'checked' : ''}> ${ico('bag')} Takeaway</label>` : ''}</div>
      <p class="small mut" style="margin:8px 0 0">${S.mode === 'delivery' ? `We deliver${s.online_area ? ` ${esc(s.online_area)}` : ''}. Minimum order ${rs(minOrder)}.` : `Collect at the shop${s.address ? `: ${esc(s.address)}` : ''}.`}</p></div>
    <div class="box"><h3>${c.n} item${c.n === 1 ? '' : 's'}</h3>
      ${lines.map(([it, q]) => `<div class="cl" data-pid="${it.id}"><div class="ce" style="background:${it.image ? '#fff' : tint(it.cat || it.name)}">${it.image ? `<img src="${esc(it.image)}" alt="">` : itemPic(it)}</div>
        <div class="cm"><b>${esc(it.name)}</b><span>${rs(paise(it.price))}${it.unit === 'kg' ? '/kg' : ''}${it.unit === 'kg' ? ' · approx., weighed when packed' : ''}</span></div>
        <div class="cr pr"><span>${rs(lineP(it, q))}</span><span class="act">${actHtml(it)}</span></div></div>`).join('')}</div>
    </div><div class="side">
    <div class="box"><h3>Bill details</h3>
      <div class="bill-row"><span>Items total</span><span>${rs(c.total)}</span></div>
      ${S.mode === 'delivery' ? `<div class="bill-row"><span>Delivery charge</span><span>${dc ? rs(dc) : '<b class="okc">FREE</b>'}</span></div>` : ''}
      <div class="bill-row total"><span>To pay (approx.)</span><span>${rs(c.total + dc)}</span></div>
      ${c.saved > 0 ? `<div class="save-strip">You save ${rs(c.saved)} on MRP</div>` : ''}
      ${S.mode === 'delivery' && dc && paise(s.online_free_delivery_above) ? `<p class="small mut">Add ${rs(paise(s.online_free_delivery_above) - c.total)} more for free delivery.</p>` : ''}
      ${S.mode === 'delivery' && c.total < minOrder ? `<div class="err">Minimum order for delivery is ${rs(minOrder)}. Add ${rs(minOrder - c.total)} more, or choose takeaway.</div>` : ''}</div>
    <div class="box"><h3>${S.mode === 'delivery' ? 'Delivery' : 'Pickup'} time</h3>
      ${days.length ? `<div class="days">${days.map((d, i) => `<button type="button" data-day="${i}" class="${i === S.dayIdx ? 'on' : ''}">${esc(d.label)}</button>`).join('')}</div>
      <div class="slots">${days[S.dayIdx].slots.map((x) => `<button type="button" data-slot="${x.v}" class="${x.v === S.slot ? 'on' : ''}">${esc(x.l)}</button>`).join('')}</div>`
    : '<div class="mut small">No time slots available now.</div>'}</div>
    ${S.me ? '' : `<div class="box login-cta"><b>Log in to place your order</b><p class="small mut">Your mobile number is your login. New here? Sign up in a minute.</p>
      <div class="row2"><a class="btn-g" href="#login" data-after="#cart">Log in</a><a class="btn-o" href="#signup" data-after="#cart">Sign up</a></div></div>`}
    <form class="box" id="of" ${S.me ? '' : 'hidden'}><h3>Your details</h3>
      <div class="field"><label>Name</label><input name="name" required value="${esc((S.me && S.me.name) || saved.name || '')}" autocomplete="name"></div>
      <div class="field"><label>Mobile</label><div class="fixed">${esc(S.me ? S.me.phone : '')} ${S.me && S.me.verified ? '<span class="pill">Verified</span>' : ''}</div></div>
      ${S.mode === 'delivery' ? `<div class="field"><label>Delivery address with landmark</label><textarea name="address" rows="2">${esc((S.me && S.me.address) || saved.address || '')}</textarea></div>` : ''}
      <div class="field"><label>Note for the shop (optional)</label><input name="notes" placeholder="e.g. ripe bananas, call before coming"></div>
      <div class="field"><label>Pay by</label><select name="pay"><option value="cash">Cash</option><option value="upi">UPI${s.upi_id ? ` (${esc(s.upi_id)})` : ''}</option></select></div>
      <input name="website" class="hp" tabindex="-1" autocomplete="off"><div id="oerr"></div>
      ${s.loyalty_enabled === '1' && Math.floor(Math.floor(c.total / 10000) * Number(s.loyalty_points_per_100)) > 0 ? `<p class="small okc">You earn about ${Math.floor(Math.floor(c.total / 10000) * Number(s.loyalty_points_per_100))} loyalty points on this order${S.me && Number(S.me.points) ? ` (you have ${Number(S.me.points)})` : ''}.</p>` : ''}
      <p class="small mut">You pay when you ${S.mode === 'delivery' ? 'receive the order' : 'collect'}. The shop confirms on WhatsApp. Weighed items are billed at the exact weight.</p></form>
    <div class="place"><button class="btn-g" id="placeBtn" style="width:100%" ${s.online_enabled === '1' ? '' : 'disabled'}>${S.me ? 'Place order' : 'Log in to order'} · ${rs(c.total + dc)} ›</button></div>
    <div class="spacer"></div></div></div></div>`;
  $$('[name=cmode]').forEach((r) => r.addEventListener('change', () => setMode(r.value)));
  $$('[data-day]').forEach((b) => b.addEventListener('click', () => { S.dayIdx = Number(b.dataset.day); S.slot = ''; cartView(); }));
  $$('[data-slot]').forEach((b) => b.addEventListener('click', () => { S.slot = b.dataset.slot; $$('[data-slot]').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#placeBtn').addEventListener('click', placeOrder);
  drawBars();
}

async function placeOrder() {
  if (!S.me) { S.after = '#cart'; location.hash = '#login'; return; }
  const f = $('#of');
  const err = $('#oerr');
  err.innerHTML = '';
  const fail = (m) => { err.innerHTML = `<div class="err">${esc(m)}</div>`; f.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  if (!S.slot) { fail(`Please choose a ${S.mode === 'delivery' ? 'delivery' : 'pickup'} time.`); $('.days').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  if (!f.name.value.trim()) { fail('Please enter your name.'); return; }
  const lines = Object.entries(S.cart).map(([id, q]) => ({ id: Number(id), qty: String(q) }));
  const body = { mode: S.mode, slot: S.slot, name: f.name.value, address: f.address ? f.address.value : '', notes: f.notes.value,
    pay: f.pay.value, website: f.website.value, lines };
  const btn = $('#placeBtn');
  btn.disabled = true; btn.textContent = 'Placing order…';
  try {
    const r = await fetch('/api/shop/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (r.status === 401) { S.me = null; S.after = '#cart'; location.hash = '#login'; return; }
    if (!d.ok) throw new Error(d.error);
    if (body.address) S.me.address = body.address;
    const mine = JSON.parse(localStorage.getItem('mpc_orders') || '[]');
    mine.unshift({ n: d.number, t: d.token, at: new Date().toISOString() });
    localStorage.setItem('mpc_orders', JSON.stringify(mine.slice(0, 15)));
    S.cart = {}; S.slot = ''; saveCart();
    location.hash = `#o=${d.token}`;
  } catch (e) {
    fail(e.message || 'Please try again.');
    btn.disabled = false; btn.textContent = 'Place order ›';
  }
}

// ------------------------------------------------------------------ my orders and tracking
async function ordersView() {
  if (S.me) {
    const { orders } = await get('/account/orders');
    view().innerHTML = `<div class="page narrow"><h1>My orders</h1>${orders.map((o) => `<a class="box order-row" href="#o=${o.token}"><span><b>${esc(o.number)}</b>
      <span class="pill ${o.status === 'cancelled' ? 'red' : o.status === 'done' ? 'grey' : ''}">${esc(o.status === 'done' ? 'Completed' : o.status === 'cancelled' ? 'Cancelled' : 'In progress')}</span><br>
      <span class="small mut">${o.mode === 'delivery' ? 'Delivery' : 'Takeaway'} · ${esc(o.slot_label)}</span></span><b>${rs(paise(o.bill_total || o.est_total))} ›</b></a>`).join('')
      || '<div class="empty">No orders yet. <a href="#" class="okc">Start shopping</a></div>'}</div>`;
    return;
  }
  const mine = JSON.parse(localStorage.getItem('mpc_orders') || '[]');
  view().innerHTML = `<div class="page"><h1>My orders</h1><div id="olist">${mine.length ? '<div class="mut small">Loading…</div>' : '<div class="empty">No orders yet from this phone.</div>'}</div></div>`;
  if (!mine.length) return;
  const rows = await Promise.all(mine.map((m) => get(`/track/${m.t}`).then((r) => ({ ...r.order, token: m.t })).catch(() => null)));
  $('#olist').innerHTML = rows.filter(Boolean).map((o) => `<a class="box order-row" href="#o=${o.token}"><span><b>${esc(o.number)}</b>
    <span class="pill ${o.status === 'cancelled' ? 'red' : o.status === 'done' ? 'grey' : ''}">${esc(o.status === 'done' ? 'Completed' : o.status === 'cancelled' ? 'Cancelled' : 'In progress')}</span><br>
    <span class="small mut">${o.mode === 'delivery' ? 'Delivery' : 'Takeaway'} · ${esc(o.slot_label)}</span></span><b>${rs(paise(o.bill_total || o.est_total))} ›</b></a>`).join('');
}

let trackTimer;
async function trackView(token) {
  const { order: o } = await get(`/track/${token}`);
  const steps = ['new', 'accepted', o.mode === 'pickup' ? 'ready' : 'out', 'done'];
  const names = { new: 'Received', accepted: 'Processing', ready: 'Ready to collect', out: 'On the way', done: 'Completed' };
  const icon = ico({ new: 'receipt', accepted: 'box', ready: 'bag', out: 'truck', done: 'check', cancelled: 'x' }[o.status]);
  const at = steps.indexOf(o.status);
  view().innerHTML = `<div class="page"><h1>Order ${esc(o.number)}</h1>
    <div class="status-card"><div class="small">${o.mode === 'delivery' ? 'Home delivery' : 'Takeaway'} · ${esc(o.slot_label)}</div>
      <div class="st">${icon} ${esc(o.status_label)}</div>${o.status === 'cancelled' && o.note ? `<div class="small">Reason: ${esc(o.note)}</div>` : ''}</div>
    ${o.status !== 'cancelled' ? `<div class="steps">${steps.map((s, i) => `<div class="${i <= at ? 'done' : ''}">${names[s]}</div>`).join('')}</div>` : ''}
    ${o.lines.some((l) => l.note) ? '<div class="notice" style="margin:0 0 12px">Some items were not available. They are not charged. Anything already paid for them is refunded.</div>' : ''}
    <div class="box"><h3>Items</h3>${o.lines.map((l) => `<div class="cl" ${l.note && !Number(l.qty) ? 'style="opacity:.55;text-decoration:line-through"' : ''}>
      <div class="ce" style="background:${tint(l.name)}">${pic(`${l.name} ${l.name_ta}`)}</div>
      <div class="cm"><b>${esc(l.name)}</b><span>${esc(l.qty)} ${l.unit === 'kg' ? 'kg' : 'pc'} × ${rs(paise(l.price))}</span>
      ${l.note ? `<span class="bad" style="display:block">${esc(l.note)}${l.ordered ? ` (you ordered ${esc(l.ordered)})` : ''}</span>` : ''}</div>
      <div class="cr">${rs(Math.round(paise(l.price) * Number(l.qty)))}</div></div>`).join('')}
      ${Number(o.delivery_charge) ? `<div class="bill-row"><span>Delivery charge</span><span>${rs(paise(o.delivery_charge))}</span></div>` : ''}
      <div class="bill-row total"><span>${o.bill_no ? `Bill ${esc(o.bill_no)}` : 'Approx. total'}</span><span>${rs(paise(o.bill_total || o.est_total))}</span></div></div>
    <div class="box small">Questions? ${o.shop.phone ? `Call <a href="tel:${esc(o.shop.phone)}"><b>${esc(o.shop.phone)}</b></a>` : 'Call the shop'}.
      ${o.shop.upi_id ? `<br>UPI: <b>${esc(o.shop.upi_id)}</b>` : ''}<br></div>
    <a class="btn-g" href="#" style="display:block">Order more</a></div>`;
  clearTimeout(trackTimer);
  if (!['done', 'cancelled'].includes(o.status)) trackTimer = setTimeout(() => { if (location.hash === `#o=${token}`) trackView(token).catch(() => {}); }, 20000);
  drawBars();
}

// ------------------------------------------------------------------ account: log in, sign up (SMS code), forgot password
function authView(kind) {
  const tabs = `<div class="auth-tabs"><a href="#login" class="${kind === 'login' ? 'on' : ''}">Log in</a><a href="#signup" class="${kind === 'signup' ? 'on' : ''}">Sign up</a></div>`;
  const forms = {
    login: `<form id="af"><div class="field"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="tel" required></div>
      <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
      <label class="show"><input type="checkbox" id="showpw"> Show password</label><div id="aerr"></div>
      <button class="btn-g wide">Log in</button><p class="small" style="text-align:center"><a href="#forgot" class="okc">Forgot password?</a></p></form>`,
    signup: `<form id="af"><div class="field"><label>Your name</label><input name="name" autocomplete="name" required></div>
      <div class="field"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="tel" required></div>
      <div class="field"><label>Create a password (at least 6 letters or digits)</label><input name="password" type="password" autocomplete="new-password" required minlength="6"></div>
      <label class="show"><input type="checkbox" id="showpw"> Show password</label>
      ${S.sms ? `<div class="field" id="otpBox" hidden><label>6-digit code sent by SMS</label><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
        <button type="button" class="link" id="resend">Send the code again</button></div>` : ''}
      <div id="aerr"></div><button class="btn-g wide" id="abtn">${S.sms ? 'Send code by SMS' : 'Create account'}</button>
      <p class="small mut" style="text-align:center">${S.sms ? 'A 6-digit code is sent to your mobile.' : ''}</p></form>`,
    forgot: S.sms ? `<form id="af"><p class="small mut">We send a code to your mobile number. Then choose a new password.</p>
      <div class="field"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="tel" required></div>
      <div class="field" id="otpBox" hidden><label>6-digit code sent by SMS</label><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
      <div class="field" id="pwBox" hidden><label>New password</label><input name="password" type="password" autocomplete="new-password" minlength="6"></div>
      <div id="aerr"></div><button class="btn-g wide" id="abtn">Send code by SMS</button></form>`
      : `<p>To set a new password, please call the shop${S.info.shop.phone ? ` on <a href="tel:${esc(S.info.shop.phone)}"><b>${esc(S.info.shop.phone)}</b></a>` : ''}.
      The shop sets a new password for your mobile number.</p><a class="btn-o wide" href="#login">Back to log in</a>`,
  };
  view().innerHTML = `<div class="page narrow"><div class="box auth"><div class="auth-head"><img src="/img/logo.webp" alt=""><div><h1>${kind === 'forgot' ? 'Forgot password' :
    kind === 'signup' ? 'Create your account' : 'Welcome back'}</h1><p class="small mut">${esc(S.info.shop.name)}</p></div></div>
    ${kind === 'forgot' ? '' : tabs}${forms[kind]}</div></div>`;
  const f = $('#af');
  if (!f) return;
  const err = (m) => { $('#aerr').innerHTML = m ? `<div class="err">${esc(m)}</div>` : ''; };
  if ($('#showpw')) $('#showpw').addEventListener('change', (e) => { $$('[type=password],[data-pw]', f).forEach((i) => { i.dataset.pw = 1; i.type = e.target.checked ? 'text' : 'password'; }); });
  const done = (me, msg) => { S.me = me; toast(msg); const to = S.after || '#'; S.after = ''; location.hash = to; drawBars(); };
  let codeSent = false;
  const sendCode = async (purpose) => {
    await post('/account/otp', { phone: f.phone.value, purpose });
    codeSent = true; $('#otpBox').hidden = false; f.code.focus();
    toast('Code sent by SMS.');
  };
  if ($('#resend')) $('#resend').addEventListener('click', () => sendCode('signup').catch((e) => err(e.message)));
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err('');
    const btn = $('button.btn-g', f); btn.disabled = true;
    try {
      if (kind === 'login') {
        const r = await post('/account/login', { phone: f.phone.value, password: f.password.value });
        done(r.me, `Welcome, ${r.me.name}!`);
      } else if (kind === 'signup') {
        if (S.sms && !codeSent) { await sendCode('signup'); btn.textContent = 'Create account'; return; }
        const r = await post('/account/signup', { name: f.name.value, phone: f.phone.value, password: f.password.value, code: f.code ? f.code.value : '' });
        done(r.me, 'Account created.');
      } else {
        if (!codeSent) { await sendCode('reset'); $('#pwBox').hidden = false; btn.textContent = 'Set new password'; return; }
        const r = await post('/account/reset', { phone: f.phone.value, code: f.code.value, password: f.password.value });
        done(r.me, 'Password changed.');
      }
    } catch (ex) { err(ex.message); } finally { btn.disabled = false; }
  });
  setTimeout(() => { const first = $('input', f); if (first && window.innerWidth > 760) first.focus(); }, 50);
}

function accountView() {
  const m = S.me;
  view().innerHTML = `<div class="page narrow"><div class="box acct-head"><div class="avatar">${esc(m.name.slice(0, 1).toUpperCase())}</div>
      <div><h1 style="margin:0">${esc(m.name)}</h1><div class="mut">${esc(m.phone)} ${m.verified ? '<span class="pill">Verified</span>' : '<span class="pill grey">not verified yet</span>'}</div></div></div>
    ${S.info.shop.loyalty_enabled === '1' ? `<div class="box pts-box"><div><div class="mut small">Loyalty points</div><div class="pts-n">${Number(m.points || 0)}</div></div>
      <div class="small mut">Earn ${Number(S.info.shop.loyalty_points_per_100)} point${Number(S.info.shop.loyalty_points_per_100) === 1 ? '' : 's'} for every ₹100, in the shop and online.
      1 point = ${rs(Math.round(Number(S.info.shop.loyalty_point_value) * 100))} off a later bill${Number(S.info.shop.loyalty_min_redeem) ? ` (from ${Number(S.info.shop.loyalty_min_redeem)} points)` : ''}. Tell the cashier to use your points.</div></div>` : ''}
    <a class="box order-row" href="#orders"><b>${ico('receipt')} My orders</b>${ico('right')}</a>
    <form class="box" id="pf"><h3>My details</h3>
      <div class="field"><label>Name</label><input name="name" value="${esc(m.name)}" required></div>
      <div class="field"><label>Delivery address with landmark</label><textarea name="address" rows="2">${esc(m.address)}</textarea></div>
      <details><summary class="small okc" style="margin-top:10px">Change password</summary>
        <div class="field"><label>Current password</label><input name="password" type="password" autocomplete="current-password"></div>
        <div class="field"><label>New password</label><input name="new_password" type="password" autocomplete="new-password" minlength="6"></div></details>
      <div id="perr"></div><button class="btn-g wide" style="margin-top:12px">Save</button></form>
    <button class="btn-o wide" id="logout">Log out</button></div>`;
  $('#pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await post('/account/update', { name: f.name.value, address: f.address.value, password: f.password.value, new_password: f.new_password.value });
      S.me = r.me; toast('Saved.'); accountView(); drawBars();
    } catch (ex) { $('#perr').innerHTML = `<div class="err">${esc(ex.message)}</div>`; }
  });
  $('#logout').addEventListener('click', async () => { await post('/account/logout'); S.me = null; toast('Logged out.'); location.hash = '#'; drawBars(); });
}

// ------------------------------------------------------------------ scan a pack's barcode with the phone camera
async function scan() {
  if (!('BarcodeDetector' in window)) { toast('Scanning works in Chrome on Android. Please type the name.'); $('#q').focus(); return; }
  const card$ = $('#sheetCard');
  card$.innerHTML = `<div class="grab"></div><button class="x" data-close>${ico('x')}</button><h2>Scan a barcode</h2><p class="mut small">Point the camera at the barcode on the pack.</p><video autoplay playsinline muted></video>`;
  $('#sheet').hidden = false;
  let stream;
  const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  $('#sheet').addEventListener('click', stop, { once: true });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('video', card$);
    v.srcObject = stream;
    const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
    const loop = async () => {
      if ($('#sheet').hidden) { stop(); return; }
      const codes = await det.detect(v).catch(() => []);
      if (codes.length) { stop(); $('#sheet').hidden = true; location.hash = `#code=${encodeURIComponent(codes[0].rawValue)}`; return; }
      requestAnimationFrame(loop);
    };
    loop();
  } catch (_) { stop(); $('#sheet').hidden = true; toast('Camera not available. Please type the name.'); }
}

// ------------------------------------------------------------------ delivery / takeaway switch
function setMode(m) {
  const s = S.info.shop;
  if (m === 'delivery' && s.online_delivery !== '1') m = 'pickup';
  if (m === 'pickup' && s.online_pickup !== '1') m = 'delivery';
  S.mode = m;
  localStorage.setItem('mpc_mode', m);
  $$('#mode button').forEach((b) => { b.classList.toggle('on', b.dataset.m === m); b.hidden = (b.dataset.m === 'delivery' ? s.online_delivery : s.online_pickup) !== '1'; });
  const first = S.info.slots[0] && S.info.slots[0].slots[0];
  $('#whereLine').innerHTML = m === 'delivery'
    ? `Delivery ${s.online_area ? `<b>${esc(s.online_area)}</b>` : 'to your home'}${first ? ` · earliest <b>${esc(S.info.slots[0].label)} ${esc(first.l.split('–')[0])}</b>` : ''}`
    : `Pick up at <b>${esc(s.name)}</b>${first ? ` · from <b>${esc(first.l.split('–')[0])}</b>` : ''}`;
  if (location.hash === '#cart') cartView();
  drawBars();
}

// ------------------------------------------------------------------ routing
async function route() {
  const h = decodeURIComponent(location.hash);
  if (!$('#sheet').hidden && !h.startsWith('#code=')) { $('#sheet').hidden = true; document.body.style.overflow = ''; if ($('#sheetFoot')) $('#sheetFoot').remove(); }
  window.scrollTo(0, 0);
  if (!h.startsWith('#q=') && document.activeElement !== $('#q')) $('#q').value = '';
  try {
    if (h.startsWith('#o=')) await trackView(h.slice(3));
    else if (h === '#orders') await ordersView();
    else if (h === '#account') (S.me ? accountView() : authView('login'));
    else if (h === '#login' || h === '#signup' || h === '#forgot') (S.me && h !== '#forgot' ? accountView() : authView(h.slice(1)));
    else if (h === '#cart') cartView();
    else if (h === '#cats') catsView();
    else if (h.startsWith('#cat=')) await listView({ cat: h.slice(5) });
    else if (h.startsWith('#q=')) await listView({ q: h.slice(3) });
    else if (h.startsWith('#code=')) await listView({ code: h.slice(6) });
    else await homeView();
  } catch (e) {
    view().innerHTML = `<div class="page"><div class="err">${esc(e.message)}</div></div>`;
  }
  drawBars();
}

(async () => {
  try {
    S.info = await get('/info');
  } catch (e) { view().innerHTML = `<div class="page"><div class="err">${esc(e.message)}</div></div>`; return; }
  const s = S.info.shop;
  document.title = `${s.name} | Order online`;
  $('#brandName').textContent = s.name;
  fillIcons();
  try { const a = await get('/account'); S.me = a.me; S.sms = a.sms; } catch (_) { /* browse without an account */ }
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-after]'); if (a) S.after = a.dataset.after; });
  if (!S.mode) S.mode = s.online_delivery === '1' ? 'delivery' : 'pickup';
  $$('#mode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
  setMode(S.mode);
  // prices in the cart always come from the shop, never from what was saved on the phone
  const ids = Object.keys(S.cart);
  if (ids.length) {
    try {
      const { items } = await get(`/items?ids=${ids.join(',')}`);
      remember(items);
      for (const id of ids) if (!S.items.has(Number(id))) delete S.cart[id];
      saveCart();
    } catch (_) { /* shown later */ }
  }
  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    const v = e.target.value.trim();
    t = setTimeout(() => { if (v.length >= 2) location.hash = `#q=${encodeURIComponent(v)}`; else if (!v && location.hash.startsWith('#q=')) location.hash = ''; }, 350);
  });
  $('#scanBtn').addEventListener('click', scan);
  $('#navScan').addEventListener('click', scan);
  window.addEventListener('hashchange', route);
  route();
})();
