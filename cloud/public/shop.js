/* Madhuram – customers' online shop. One page for home delivery and takeaway. No login: the cart and "my orders" stay on the phone. */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const S = {
  info: null, items: new Map(), cart: JSON.parse(localStorage.getItem('mpc_cart') || '{}'),
  mode: localStorage.getItem('mpc_mode') || '', q: '', dayIdx: 0, slot: '',
};

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

// ------------------------------------------------------------------ pictures: a friendly emoji per product / category, on a pastel tile
const PICS = [
  [/apple/i, '🍎'], [/banana|plantain|vazhai|வாழை/i, '🍌'], [/mango|மாம்/i, '🥭'], [/grape/i, '🍇'], [/orange|mosambi|sathukudi/i, '🍊'], [/lemon|lime/i, '🍋'],
  [/water ?melon/i, '🍉'], [/pine ?apple/i, '🍍'], [/papaya|pappaya/i, '🍈'], [/pomegranate/i, '🔴'], [/guava/i, '🍐'], [/coconut|தேங்காய்/i, '🥥'], [/strawberr/i, '🍓'],
  [/tomato|தக்காளி/i, '🍅'], [/onion|வெங்காய/i, '🧅'], [/potato|உருளை/i, '🥔'], [/carrot/i, '🥕'], [/brinjal|egg ?plant|கத்தரி/i, '🍆'], [/chilli|chili|mirchi/i, '🌶️'],
  [/garlic|பூண்டு/i, '🧄'], [/ginger|இஞ்சி/i, '🫚'], [/corn/i, '🌽'], [/beans|avarai|அவரை/i, '🫛'], [/cucumber|vellari/i, '🥒'], [/cabbage|cauli|broc/i, '🥦'],
  [/leaf|keerai|spinach|coriander|mint|curry/i, '🌿'], [/mushroom/i, '🍄'], [/pumpkin|gourd|பூசணி|பாகற்/i, '🎃'],
  [/milk|பால்/i, '🥛'], [/curd|yog|தயிர்/i, '🥣'], [/butter|ghee|நெய்/i, '🧈'], [/cheese|paneer/i, '🧀'], [/egg|முட்டை/i, '🥚'],
  [/bread|bun|rusk/i, '🍞'], [/cake/i, '🍰'], [/biscuit|cookie|marie|good ?day/i, '🍪'], [/chocolate|dairy milk|kitkat|5 ?star|choco/i, '🍫'],
  [/chips|snack|mixture|murukku/i, '🍿'], [/candy|toffee|sweet/i, '🍬'], [/juice|maaza|frooti|slice/i, '🧃'], [/cola|pepsi|sprite|bovonto|soda|drink/i, '🥤'],
  [/tea|chai|தேநீர்/i, '🍵'], [/coffee|bru|nescafe/i, '☕'], [/horlicks|boost|bournvita/i, '🥤'], [/rice|அரிசி|ponni/i, '🍚'], [/dhal|dal|gram|paruppu|பருப்பு/i, '🫘'],
  [/atta|flour|maida|rava|sooji|மாவு/i, '🌾'], [/oil|எண்ணெய்/i, '🫒'], [/sugar|சர்க்கரை|jaggery/i, '🍯'], [/salt|உப்பு/i, '🧂'],
  [/masala|spice|turmeric|pepper|jeera|mustard|மஞ்சள்/i, '🌶️'], [/noodle|maggi|pasta|vermi/i, '🍜'], [/oats|cornflakes|chocos|kellogg/i, '🥣'], [/pickle|ஊறுகாய்/i, '🫙'],
  [/dates|பேரீச்/i, '🌴'], [/nuts|cashew|badam|almond|dry fruit/i, '🥜'], [/soap|சோப்/i, '🧼'], [/shampoo|conditioner/i, '🧴'], [/paste|tooth/i, '🪥'],
  [/brush/i, '🪥'], [/detergent|washing|surf|tide|rin|ariel/i, '🫧'], [/clean|phenyl|lizol|harpic|vim/i, '🧽'], [/cream|lotion|face|fair/i, '💆'],
  [/spray|deo|perfume|scent/i, '🌸'], [/shav|blade|razor|gillette/i, '🪒'], [/baby|diaper|cerelac/i, '🍼'], [/medic|tablet|balm|vicks|syrup/i, '💊'],
  [/match|agarbatti|camphor|karpur|fire/i, '🔥'], [/oil|hair/i, '💧'], [/talc|powder/i, '🫙'], [/vegetable/i, '🥦'], [/fruit/i, '🍎'], [/food/i, '🍱'],
];
const TINTS = ['#fff1e6', '#eaf7ee', '#fff6d9', '#ffe9ee', '#e8f1ff', '#f2ecff', '#e6f8f6', '#fdf0e2'];
const pic = (text) => (PICS.find(([re]) => re.test(text || '')) || [null, '🛒'])[1];
const itemPic = (it) => pic(`${it.name} ${it.name_ta}`) !== '🛒' ? pic(`${it.name} ${it.name_ta}`) : pic(it.cat);
const tint = (k) => TINTS[[...String(k)].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];

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
  $('#cartbar').hidden = !c.n || hash.startsWith('#cart') || hash.startsWith('#o=') || hash.startsWith('#orders');
  $('#cbItems').textContent = `${c.n} item${c.n === 1 ? '' : 's'}`;
  $('#cbTotal').textContent = rs(c.total);
  $('#navCount').hidden = !c.n; $('#navCount').textContent = c.n;
  const page = hash.startsWith('#cart') ? 'cart' : hash.startsWith('#orders') || hash.startsWith('#o=') ? 'orders' : hash.startsWith('#cat') ? 'cats' : 'home';
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
      ${off ? `<span class="tag">${off}%<br>OFF</span>` : ''}${it.popular ? '<span class="pop">★ Popular</span>' : ''}</div>
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
    card$.innerHTML = `<div class="grab"></div><button class="x" data-close aria-label="Close">✕</button>
      <div class="big-img" style="background:${it.image ? '#fff' : tint(it.cat || it.name)}">${it.image ? `<img src="${esc(it.image)}" alt="">` : itemPic(it)}${off ? `<span class="tag">${off}%<br>Save</span>` : ''}</div>
      <h2>${esc(it.name)}</h2><div class="ta mut">${esc(it.name_ta)}</div>
      <div style="margin-top:6px"><span class="bp">${rs(paise(it.price))}${it.unit === 'kg' ? '<small>/kg</small>' : ''}</span>
        ${off ? `<span class="mrp" style="display:inline;margin-left:6px">MRP ${rs(paise(it.mrp))}</span>` : ''}${it.popular ? '<span class="sold">★ Popular here</span>' : ''}</div>
      <p class="small mut">${it.in_stock ? `In stock${it.unit === 'kg' ? ' · loose, weighed when packed (the bill shows the exact weight)' : ''}` : '<b class="bad">Sold out right now</b>'}
        ${it.cat ? ` · ${esc(it.cat)}` : ''}</p>
      <div class="sec-h"><h2>Picked for you</h2></div><div class="rail" id="similar"><div class="mut small">Loading…</div></div>`;
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
    `<a class="banner b-green" href="#cats"><h3>Fresh &amp; healthy<br>fruits &amp; veggies</h3><p>Picked every morning. Order now, ${S.mode === 'delivery' ? 'delivered' : 'ready to collect'} ${firstSlot ? `from ${esc(firstSlot.l)}` : 'today'}.</p><span class="cta">Order now</span><span class="art">🥦</span></a>`,
    Number(s.online_free_delivery_above) && s.online_delivery === '1' ? `<a class="banner b-yellow" href="#cats"><h3>Free delivery</h3><p>On orders above ${rs(paise(s.online_free_delivery_above))}${s.online_area ? ` · ${esc(s.online_area)}` : ''}.</p><span class="cta">Shop now</span><span class="art">🛵</span></a>` : '',
    s.online_pickup === '1' ? `<a class="banner b-teal" href="#cats"><h3>Order &amp; pick up</h3><p>Skip the queue – we pack it, you collect at the counter.</p><span class="cta">Takeaway</span><span class="art">🛍️</span></a>` : '',
  ].filter(Boolean);
  view().innerHTML = `${closedNote()}
    <div class="banners" id="banners">${banners.join('')}</div><div class="dots">${banners.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>
    <section><div class="sec-h"><h2>Shop by category</h2><a href="#cats">See all ›</a></div>
      <div class="cats-row">${S.info.cats.slice(0, 14).map(catTile).join('')}</div></section>
    <section id="offersSec" hidden><div class="sec-h"><h2>Offers for you 🔥</h2></div><div class="rail" id="offers"></div></section>
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
const catTile = (c) => `<a class="cat" href="#cat=${c.id}"><div class="ci" style="background:${tint(c.name)}">${pic(c.name)}</div><div class="cn">${esc(c.name)}</div></a>`;

function catsView() {
  view().innerHTML = `${closedNote()}<div class="page"><h1>All categories</h1><div class="cat-grid">${S.info.cats.map(catTile).join('')}</div></div>`;
}

async function listView({ cat = '', q = '', code = '' }) {
  const c = S.info.cats.find((x) => String(x.id) === String(cat));
  view().innerHTML = `${closedNote()}<div class="page"><h1>${c ? `${pic(c.name)} ${esc(c.name)}` : q ? `Results for “${esc(q)}”` : 'Scanned product'}</h1>
    ${c ? `<div class="cats-row" style="margin-bottom:10px">${S.info.cats.map((x) => `<a class="cat" href="#cat=${x.id}" style="flex-basis:70px;${String(x.id) === String(cat) ? 'color:var(--g-d)' : ''}">
      <div class="ci" style="width:58px;height:58px;font-size:1.7rem;background:${String(x.id) === String(cat) ? 'var(--g-s2)' : tint(x.name)}">${pic(x.name)}</div><div class="cn">${esc(x.name)}</div></a>`).join('')}</div>` : ''}
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
    view().innerHTML = '<div class="page"><div class="empty" style="font-size:3rem">🛒</div><div class="empty">Your cart is empty.<br><br><a class="btn-g" href="#" style="display:inline-block;padding:12px 22px">Start shopping</a></div></div>';
    return;
  }
  const c = cartSums();
  const dc = deliveryCharge(c.total);
  const minOrder = paise(s.online_min_order);
  const saved = JSON.parse(localStorage.getItem('mpc_me') || '{}');
  const days = S.info.slots;
  if (S.dayIdx >= days.length) S.dayIdx = 0;
  view().innerHTML = `${closedNote()}<div class="page"><h1>My cart</h1>
    <div class="box"><div class="seg">
      ${s.online_delivery === '1' ? `<label class="${S.mode === 'delivery' ? 'on' : ''}"><input type="radio" name="cmode" value="delivery" ${S.mode === 'delivery' ? 'checked' : ''}> 🛵 Home delivery</label>` : ''}
      ${s.online_pickup === '1' ? `<label class="${S.mode === 'pickup' ? 'on' : ''}"><input type="radio" name="cmode" value="pickup" ${S.mode === 'pickup' ? 'checked' : ''}> 🛍️ Takeaway</label>` : ''}</div>
      <p class="small mut" style="margin:8px 0 0">${S.mode === 'delivery' ? `We deliver${s.online_area ? ` ${esc(s.online_area)}` : ''}. Minimum order ${rs(minOrder)}.` : `Collect at the shop${s.address ? `: ${esc(s.address)}` : ''}.`}</p></div>
    <div class="box"><h3>${c.n} item${c.n === 1 ? '' : 's'}</h3>
      ${lines.map(([it, q]) => `<div class="cl" data-pid="${it.id}"><div class="ce" style="background:${it.image ? '#fff' : tint(it.cat || it.name)}">${it.image ? `<img src="${esc(it.image)}" alt="">` : itemPic(it)}</div>
        <div class="cm"><b>${esc(it.name)}</b><span>${rs(paise(it.price))}${it.unit === 'kg' ? '/kg' : ''}${it.unit === 'kg' ? ' · approx., weighed when packed' : ''}</span></div>
        <div class="cr pr"><span>${rs(lineP(it, q))}</span><span class="act">${actHtml(it)}</span></div></div>`).join('')}</div>
    <div class="box"><h3>Bill details</h3>
      <div class="bill-row"><span>Items total</span><span>${rs(c.total)}</span></div>
      ${S.mode === 'delivery' ? `<div class="bill-row"><span>Delivery charge</span><span>${dc ? rs(dc) : '<b class="okc">FREE</b>'}</span></div>` : ''}
      <div class="bill-row total"><span>To pay (approx.)</span><span>${rs(c.total + dc)}</span></div>
      ${c.saved > 0 ? `<div class="save-strip">🎉 You save ${rs(c.saved)} on MRP</div>` : ''}
      ${S.mode === 'delivery' && dc && paise(s.online_free_delivery_above) ? `<p class="small mut">Add ${rs(paise(s.online_free_delivery_above) - c.total)} more for free delivery.</p>` : ''}
      ${S.mode === 'delivery' && c.total < minOrder ? `<div class="err">Minimum order for delivery is ${rs(minOrder)}. Add ${rs(minOrder - c.total)} more, or choose takeaway.</div>` : ''}</div>
    <div class="box"><h3>${S.mode === 'delivery' ? 'Delivery' : 'Pickup'} time</h3>
      ${days.length ? `<div class="days">${days.map((d, i) => `<button type="button" data-day="${i}" class="${i === S.dayIdx ? 'on' : ''}">${esc(d.label)}</button>`).join('')}</div>
      <div class="slots">${days[S.dayIdx].slots.map((x) => `<button type="button" data-slot="${x.v}" class="${x.v === S.slot ? 'on' : ''}">${esc(x.l)}</button>`).join('')}</div>`
    : '<div class="mut small">No time slots available now.</div>'}</div>
    <form class="box" id="of"><h3>Your details</h3>
      <div class="field"><label>Name</label><input name="name" required value="${esc(saved.name || '')}" autocomplete="name"></div>
      <div class="field"><label>Mobile (WhatsApp)</label><input name="phone" required inputmode="tel" value="${esc(saved.phone || '')}" autocomplete="tel"></div>
      ${S.mode === 'delivery' ? `<div class="field"><label>Delivery address with landmark</label><textarea name="address" rows="2">${esc(saved.address || '')}</textarea></div>` : ''}
      <div class="field"><label>Note for the shop (optional)</label><input name="notes" placeholder="e.g. ripe bananas, call before coming"></div>
      <div class="field"><label>Pay by</label><select name="pay"><option value="cash">Cash</option><option value="upi">UPI${s.upi_id ? ` (${esc(s.upi_id)})` : ''}</option></select></div>
      <input name="website" class="hp" tabindex="-1" autocomplete="off"><div id="oerr"></div>
      <p class="small mut">You pay when you ${S.mode === 'delivery' ? 'receive the order' : 'collect'}. The shop confirms on WhatsApp. Weighed items are billed at the exact weight.</p></form>
    <div style="height:70px"></div></div>
    <div class="place"><button class="btn-g" id="placeBtn" style="width:100%" ${s.online_enabled === '1' ? '' : 'disabled'}>Place order · ${rs(c.total + dc)} ›</button></div>`;
  $$('[name=cmode]').forEach((r) => r.addEventListener('change', () => setMode(r.value)));
  $$('[data-day]').forEach((b) => b.addEventListener('click', () => { S.dayIdx = Number(b.dataset.day); S.slot = ''; cartView(); }));
  $$('[data-slot]').forEach((b) => b.addEventListener('click', () => { S.slot = b.dataset.slot; $$('[data-slot]').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#placeBtn').addEventListener('click', placeOrder);
  drawBars();
}

async function placeOrder() {
  const f = $('#of');
  const err = $('#oerr');
  err.innerHTML = '';
  const fail = (m) => { err.innerHTML = `<div class="err">${esc(m)}</div>`; f.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  if (!S.slot) { fail(`Please choose a ${S.mode === 'delivery' ? 'delivery' : 'pickup'} time.`); $('.days').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  if (!f.name.value.trim()) { fail('Please enter your name.'); return; }
  const lines = Object.entries(S.cart).map(([id, q]) => ({ id: Number(id), qty: String(q) }));
  const body = { mode: S.mode, slot: S.slot, name: f.name.value, phone: f.phone.value, address: f.address ? f.address.value : '', notes: f.notes.value,
    pay: f.pay.value, website: f.website.value, lines };
  const btn = $('#placeBtn');
  btn.disabled = true; btn.textContent = 'Placing order…';
  try {
    const r = await fetch('/api/shop/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    localStorage.setItem('mpc_me', JSON.stringify({ name: body.name, phone: body.phone, address: body.address || JSON.parse(localStorage.getItem('mpc_me') || '{}').address || '' }));
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
  const mine = JSON.parse(localStorage.getItem('mpc_orders') || '[]');
  view().innerHTML = `<div class="page"><h1>My orders</h1><div id="olist">${mine.length ? '<div class="mut small">Loading…</div>' : '<div class="empty">No orders yet from this phone.</div>'}</div></div>`;
  if (!mine.length) return;
  const rows = await Promise.all(mine.map((m) => get(`/track/${m.t}`).then((r) => ({ ...r.order, token: m.t })).catch(() => null)));
  $('#olist').innerHTML = rows.filter(Boolean).map((o) => `<a class="box order-row" href="#o=${o.token}"><span><b>${esc(o.number)}</b>
    <span class="pill ${o.status === 'cancelled' ? 'red' : o.status === 'done' ? 'grey' : ''}">${esc(o.status === 'done' ? 'Completed' : o.status === 'cancelled' ? 'Cancelled' : 'In progress')}</span><br>
    <span class="small mut">${o.mode === 'delivery' ? '🛵 Delivery' : '🛍️ Takeaway'} · ${esc(o.slot_label)}</span></span><b>${rs(paise(o.bill_total || o.est_total))} ›</b></a>`).join('');
}

let trackTimer;
async function trackView(token) {
  const { order: o } = await get(`/track/${token}`);
  const steps = ['new', 'accepted', o.mode === 'pickup' ? 'ready' : 'out', 'done'];
  const names = { new: 'Received', accepted: 'Processing', ready: 'Ready to collect', out: 'On the way', done: 'Completed' };
  const icon = { new: '🧾', accepted: '📦', ready: '🛍️', out: '🛵', done: '✅', cancelled: '❌' }[o.status];
  const at = steps.indexOf(o.status);
  view().innerHTML = `<div class="page"><h1>Order ${esc(o.number)}</h1>
    <div class="status-card"><div class="small">${o.mode === 'delivery' ? '🛵 Home delivery' : '🛍️ Takeaway'} · ${esc(o.slot_label)}</div>
      <div class="st">${icon} ${esc(o.status_label)}</div>${o.status === 'cancelled' && o.note ? `<div class="small">Reason: ${esc(o.note)}</div>` : ''}</div>
    ${o.status !== 'cancelled' ? `<div class="steps">${steps.map((s, i) => `<div class="${i <= at ? 'done' : ''}">${names[s]}</div>`).join('')}</div>` : ''}
    ${o.lines.some((l) => l.note) ? '<div class="notice" style="margin:0 0 12px">Some items were not available. You are <b>not charged</b> for them; if you already paid, the shop refunds the difference.</div>' : ''}
    <div class="box"><h3>Items</h3>${o.lines.map((l) => `<div class="cl" ${l.note && !Number(l.qty) ? 'style="opacity:.55;text-decoration:line-through"' : ''}>
      <div class="ce" style="background:${tint(l.name)}">${pic(`${l.name} ${l.name_ta}`)}</div>
      <div class="cm"><b>${esc(l.name)}</b><span>${esc(l.qty)} ${l.unit === 'kg' ? 'kg' : 'pc'} × ${rs(paise(l.price))}</span>
      ${l.note ? `<span class="bad" style="display:block">${esc(l.note)}${l.ordered ? ` (you ordered ${esc(l.ordered)})` : ''}</span>` : ''}</div>
      <div class="cr">${rs(Math.round(paise(l.price) * Number(l.qty)))}</div></div>`).join('')}
      ${Number(o.delivery_charge) ? `<div class="bill-row"><span>Delivery charge</span><span>${rs(paise(o.delivery_charge))}</span></div>` : ''}
      <div class="bill-row total"><span>${o.bill_no ? `Bill ${esc(o.bill_no)}` : 'Approx. total'}</span><span>${rs(paise(o.bill_total || o.est_total))}</span></div></div>
    <div class="box small">Questions? ${o.shop.phone ? `Call <a href="tel:${esc(o.shop.phone)}"><b>${esc(o.shop.phone)}</b></a>` : 'Call the shop'}.
      ${o.shop.upi_id ? `<br>UPI: <b>${esc(o.shop.upi_id)}</b>` : ''}<br><span class="mut">This page updates by itself.</span></div>
    <a class="btn-g" href="#" style="display:block">Order more</a></div>`;
  clearTimeout(trackTimer);
  if (!['done', 'cancelled'].includes(o.status)) trackTimer = setTimeout(() => { if (location.hash === `#o=${token}`) trackView(token).catch(() => {}); }, 20000);
  drawBars();
}

// ------------------------------------------------------------------ scan a pack's barcode with the phone camera
async function scan() {
  if (!('BarcodeDetector' in window)) { toast('Scanning works in Chrome on Android. Please type the name.'); $('#q').focus(); return; }
  const card$ = $('#sheetCard');
  card$.innerHTML = '<div class="grab"></div><button class="x" data-close>✕</button><h2>Scan a barcode</h2><p class="mut small">Point the camera at the barcode on the pack.</p><video autoplay playsinline muted></video>';
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
  document.title = `${s.name} – order online`;
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
