/* Madhuram online shop: home delivery and takeaway, on phones and PCs. */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const LS = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (_) { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
const S = {
  info: null, items: new Map(), cart: LS.get('mpc_cart', {}), mode: localStorage.getItem('mpc_mode') || '', dayIdx: 0, slot: '',
  me: null, sms: false, after: '', fav: new Set(LS.get('mpc_fav', [])), sort: 'popular', only: '', instock: false,
  recent: LS.get('mpc_recent', []), active: 0, page: 'home', tok: 0, hist: [],
};

async function get(path) {
  const r = await fetch(`/api/shop${path}`);
  const d = await r.json().catch(() => ({ ok: false, error: 'Please check the internet and try again.' }));
  if (!d.ok) throw new Error(d.error || 'Please try again.');
  return d;
}
async function post(path, body) {
  const r = await fetch(`/api/shop${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({ ok: false, error: 'Please try again.' }));
  if (!d.ok) { const e = new Error(d.error || 'Please try again.'); e.status = r.status; throw e; }
  return d;
}
const remember = (list) => { for (const it of list) S.items.set(it.id, it); return list; };

// ------------------------------------------------------------------ money and quantities
const paise = (v) => Math.round(Number(v || 0) * 100);
const rs = (p) => `₹${(p / 100).toFixed(p % 100 ? 2 : 0)}`;
const step = (it) => (it.unit === 'kg' ? 0.25 : 1);
const fmtQ = (q, it) => (it.unit === 'kg' ? (q < 1 ? `${Math.round(q * 1000)} g` : `${+q.toFixed(3)} kg`) : `${q}`);
const lineP = (it, q) => Math.round(paise(it.price) * q);
const unitLine = (it) => (it.unit === 'kg' ? 'Per 1 kg' : 'Per 1 pc');
const fmtDate = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
// product names as typed in the shop's list ("carrot .", "Cabbage...") shown neatly
const nice = (n) => { const t = String(n || '').replace(/[\s.]+$/, '').replace(/\s+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const shortCat = (n) => String(n || '').replace(/\s*items?\.?\s*$/i, '').replace(/\.+$/, '').trim() || n;
// the bigger of the offer saving and the MRP saving
function saving(it) {
  const p = Number(it.price);
  const was = Math.max(Number(it.regular) || 0, Number(it.mrp) || 0);
  return was > p ? { was, pct: Math.round((1 - p / was) * 100) } : null;
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = ''; }, 2400); }

// ------------------------------------------------------------------ pictures: the shop's photo, else a 3D picture chosen from the name
const FE = (slug) => `/fe/${slug}.webp`;
const ART = [
  [/juice|shake|lassi|smoothie|mojito|soda|frooti|maaza|slice|coke|cola|pepsi|fanta|sprite|7 ?up|bovonto|mirinda|limca|thums|\btang\b|rasna|nannari|sherbet|drink|rose ?milk/, 'cup-with-straw'],
  [/ice ?cream|\bcone\b|kulfi|\btub\b|cornetto|sundae|cassata/, 'soft-ice-cream'],
  [/sandwich|burger|omlet|omelette|pizza/, 'sandwich'],
  [/corn ?flakes|flakes|chocos|muesli|\boats\b|cereal|kellog|kellgg/, 'bowl-with-spoon'],
  [/biscuit|cookie|marie|oreo|bourbon|good ?day|bikis|jim ?jam|digestive|cracker|monaco|krack|50-50|treat/, 'cookie'],
  [/chocolate|choco|dairy ?milk|\bcdm\b|kit ?kat|5 ?star|\bperk\b|munch|\bsilk\b|bournville|bounty|snickers|kinder|galaxy|\bfuse\b|eclair/, 'chocolate-bar'],
  [/cake|muffin|swiss roll|brownie|pastry/, 'cupcake'],
  [/bread|\bbun\b|\bpav\b|rusk|toast|\bbred\b/, 'bread'],
  [/popcorn|chips|lays|bingo|kurkure|cheetos|pringles|act ?ii|act ?2|nachos|crisps|puffs|snack|mixture|muruk|pakoda|bhujia|namkeen|haldiram|chakli|\bsev\b|boondi|\bpori\b|time ?pass/, 'popcorn'],
  [/pasta|macaroni|spaghetti|pazzta/, 'spaghetti'],
  [/noodle|maggi|ramen|vermicelli|semiya|idiyappam|\bnood/, 'steaming-bowl'],
  [/soup/, 'pot-of-food'],
  [/cerelac|nan ?pro|lactogen|nestogen|\bbaby\b/, 'baby-bottle'],
  [/horlicks|boost|complan|bournvita|pediasure|protinex|ensure|\bmalt/, 'glass-of-milk'],
  [/coffee|\bbru\b|nescafe|narasu|chicory|decoction/, 'hot-beverage'],
  [/\btea\b|chai|red label|3 roses|taj mahal/, 'teacup-without-handle'],
  [/masala|chill?i powder|chilly|turmeric|haldi|jeera|cumin|mustard|\bhing\b|asafoetida|sambar|rasam|garam|dhaniya|fenugreek|cardamom|elaichi|clove|cinnamon|spice|vathal|vadam|pepper powder/, 'hot-pepper'],
  [/pickle|thokku|achar|\bjam\b|ketchup|sauce|mayo|spread|vinegar|\bpaste\b/, 'jar'],
  [/honey/, 'honey-pot'],
  [/\bghee\b|butter(?! ?(beans|fruit|scot|scit|milk))/, 'butter'],
  [/paneer|cheese/, 'cheese-wedge'],
  [/milk|curd|yogh?urt|dahi|aavin|heritage/, 'glass-of-milk'],
  [/\beggs?\b/, 'egg'],
  [/sunflower|sundrop|saffola|gold ?winner|fortune/, 'sunflower'],
  [/groundnut|peanut|\bgn oil|kadalai|chikki/, 'peanuts'],
  [/\boil\b|gingelly|sesame|idhayam/, 'olive'],
  [/\brava\b|atta|maida|flour|sooji|semolina|ragi|wheat|besan|bajji|bonda|batter|dosa|idly|idli|puttu|millet|varagu|samai|thinai/, 'sheaf-of-rice'],
  [/rice|boiled|ponni|basmati|samba|biriyani|biryani/, 'cooked-rice'],
  [/\bdal\b|dhal|toor|moong|urad|\borid|chana|chenna|\bgram\b|rajma|lentil/, 'beans'],
  [/\bsalt\b/, 'salt'],
  [/sugar|jaggery|karuppatti|vellam|candy|toffee|lollipop|poppins|\bgems\b|mentos|tic ?tac|chewing|\bgum\b|center fresh|\bsweets\b|soan|laddu|halwa|mysore pak|jalebi/, 'candy'],
  [/badam|almond|cashew|pista|pistachio|walnut|raisin|kismis|dry ?fruit|anjeer|\bnuts?\b|\bdates?\b/, 'chestnut'],
  [/camphor|agarbatti|incense|kumkum|vibhuti|kovil|pooja|\bdiya\b|wick|sambrani/, 'diya-lamp'],
  [/paper ?plate|\bplates?\b|tissue|\bfoil\b|napkin/, 'roll-of-paper'],
  [/match ?box|matches/, 'fire'],
  [/banana ?(leaf|flower|steem|stem)|valai ?(ilai|poo|thandu)|vazhai ?maram/, 'leafy-green'],
  [/green apple/, 'green-apple'],
  [/(?<!custard )apple/, 'red-apple'],
  [/banana|bannana|nendram|rasthali|karpuram|karpooram|yelakki|poovan|valakkai/, 'banana'],
  [/grape/, 'grapes'],
  [/mango/, 'mango'],
  [/orange|sweet ?lime|mosambi|sathukudi|kamala|malta|kinnow|tangerine/, 'tangerine'],
  [/lemon|\blime\b|elumichai/, 'lemon'],
  [/water ?melon/, 'watermelon'],
  [/melon|kirni/, 'melon'],
  [/pineapple/, 'pineapple'],
  [/strawberry/, 'strawberry'],
  [/blue ?berr/, 'blueberries'],
  [/cherr/, 'cherries'],
  [/kiwi/, 'kiwi-fruit'],
  [/\bpears?\b|pears/, 'pear'],
  [/peach/, 'peach'],
  [/coconut|thengai|coconat/, 'coconut'],
  [/avocado|butter ?fruit/, 'avocado'],
  [/tomato|tomsato/, 'tomato'],
  [/onion/, 'onion'],
  [/sweet ?potato|sakkaraivalli|vethalavalli/, 'roasted-sweet-potato'],
  [/potato|urulai/, 'potato'],
  [/carrot/, 'carrot'],
  [/brinjal|eggplant|kathiri/, 'eggplant'],
  [/capsicum|bell pepper/, 'bell-pepper'],
  [/chill?i|milagai|chille/, 'hot-pepper'],
  [/cucumber|vellari|kakdi/, 'cucumber'],
  [/\bcorn\b|sweetcorn|sweet corn|baby ?corn/, 'ear-of-corn'],
  [/mushroom/, 'mushroom'],
  [/garlic|poondu/, 'garlic'],
  [/ginger(?! leaf)|\binji\b/, 'ginger-root'],
  [/brocc|brocli/, 'broccoli'],
  [/\bpeas\b|piese|green ?peas|pattani|beans|avarai|cluster|mochai|payar/, 'pea-pod'],
  [/cabbage|cabbge|lettuce|lettisce|celery|chellery|keerai|spinach|greens?\b|methi|coriander|\bmint\b|pudina|curry ?leaf|leaf|leaves|sprouts|drum ?stick|gourd|guard|pagarkai|peerkangai|pudalangai|kovakkai|chow ?chow|nookal|radish|beetroot|turnip|pumpkin|poosani|\byaa?m\b|kizhanghu|karunai|karanai|sembu|sempu|lad(y|ies) ?finger|okra|vendakkai|tinda|sundakkai|dosakkai|cauliflower|couliflower|vizhangai|sukkuni|zucchini|coorkan|paruval/, 'leafy-green'],
];
const CAT_ART = [
  [/vegetable|\bveg|greens/, 'leafy-green'], [/fruit/, 'red-apple'], [/biscuit/, 'cookie'], [/green tea|\btea\b/, 'teacup-without-handle'],
  [/coffee/, 'hot-beverage'], [/horlicks|complan|boost|health drink/, 'glass-of-milk'], [/flour|atta/, 'sheaf-of-rice'],
  [/dates|dry ?fruit|nuts/, 'chestnut'], [/rice/, 'cooked-rice'], [/oil|ghee/, 'olive'], [/dairy|milk/, 'glass-of-milk'], [/bakery|bread/, 'bread'],
  [/snack/, 'popcorn'], [/drink|juice|beverage/, 'cup-with-straw'], [/chocolate|sweet/, 'chocolate-bar'], [/food|grocery|provision/, 'fork-and-knife-with-plate'],
  [/washing|detergent/, 'bubbles'], [/glass cleaner|cleaner|clean/, 'sponge'], [/hand ?wash|body ?wash|face ?wash|face ?splash|soap/, 'soap'],
  [/paste/, 'tooth'], [/tooth ?brush/, 'toothbrush'], [/blade|razor|shav/, 'razor'], [/lip/, 'lipstick'],
  [/shampoo|hair|spray|talc|cream|lotion|mouth|care|perfume|deo/, 'lotion-bottle'], [/baby/, 'baby-bottle'], [/child|toy/, 'teddy-bear'],
  [/medicine|pharma/, 'pill'], [/match/, 'fire'], [/pooja|puja/, 'diya-lamp'],
];
const FOODISH = /food|vegetable|\bveg|fruit|grocery|provision|biscuit|tea|coffee|horlicks|complan|boost|flour|dates|rice|oil|dairy|bakery|snack|drink|juice|chocolate|sweet/;
function artFor(name, cat) {
  const n = String(name || '').toLowerCase();
  const c = String(cat || '').toLowerCase();
  const byName = () => (ART.find(([re]) => re.test(n)) || [])[1];
  const byCat = () => (CAT_ART.find(([re]) => re.test(c)) || [])[1];
  return (!c || FOODISH.test(c) ? byName() || byCat() : byCat() || byName()) || 'shopping-bags';
}
const catArt = (name) => artFor('', name);
const pic = (it, cls = '') => (it.image ? `<img class="ph ${cls}" src="${esc(it.image)}" alt="" loading="lazy">`
  : `<img class="art ${cls}" src="${FE(artFor(it.name, it.cat))}" alt="" loading="lazy">`);
const VF = '<svg class="vf" viewBox="0 0 24 24" aria-label="Verified"><path fill="#3b82f6" d="M12 1.6l2.5 1.8 3.1-.1 1 2.9 2.5 1.9-.9 3 .9 3-2.5 1.9-1 2.9-3.1-.1L12 22.4l-2.5-1.8-3.1.1-1-2.9-2.5-1.9.9-3-.9-3 2.5-1.9 1-2.9 3.1.1z"/><path d="m8 12.2 2.7 2.7L16.3 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ------------------------------------------------------------------ basket
function saveCart() { LS.set('mpc_cart', S.cart); drawBars(); }
function cartSums() {
  let total = 0; let mrp = 0; let n = 0;
  for (const [id, q] of Object.entries(S.cart)) {
    const it = S.items.get(Number(id));
    if (!it) continue;
    const sv = saving(it);
    n += 1; total += lineP(it, q);
    mrp += sv ? Math.round(paise(sv.was) * q) : lineP(it, q);
  }
  return { n, total, saved: mrp - total };
}
function deliveryCharge(total) {
  const s = S.info.shop;
  if (S.mode !== 'delivery') return 0;
  const free = paise(s.online_free_delivery_above);
  return free && total >= free ? 0 : paise(s.online_delivery_charge);
}
function setQty(it, q) {
  q = +Math.max(0, q).toFixed(3);
  if (q > Number(it.available)) { q = Number(it.available); toast(`Only ${fmtQ(q, it)}${it.unit === 'kg' ? '' : ' left'} available now`); }
  if (q <= 0) delete S.cart[it.id]; else S.cart[it.id] = q;
  saveCart();
  refreshItem(it);
  if (S.page === 'cart') { const y = window.scrollY; cartView(); window.scrollTo(0, y); }
  if (S.page === 'detail' && S.detBar) S.detBar();
}
function refreshItem(it) {
  $$(`.pc[data-pid="${it.id}"]`).forEach((el) => {
    $('.act', el).innerHTML = actHtml(it);
    $('.pc-b', el).classList.toggle('q', !!S.cart[it.id]);
  });
}

// ------------------------------------------------------------------ product card
function actHtml(it) {
  if (!it.in_stock) return '<span class="so">Sold out</span>';
  const q = S.cart[it.id] || 0;
  return q ? `<span class="qp"><button data-d="-1" aria-label="Less">${ico('minus')}</button><b>${fmtQ(q, it)}</b><button data-d="1" aria-label="More">${ico('plus')}</button></span>`
    : `<button class="add" data-d="1" aria-label="Add ${esc(it.name)}">${ico('plus')}</button>`;
}
function card(it) {
  const sv = saving(it);
  const rib = sv && (Number(it.regular) > Number(it.price) || sv.pct >= 5);      // an offer, or a real saving on MRP
  return `<div class="pc${it.in_stock ? '' : ' out'}" data-pid="${it.id}">${rib ? `<span class="rib">${ico('tag')}${sv.pct}% OFF</span>` : ''}
    <a class="pc-img" href="#p=${it.id}" aria-label="${esc(nice(it.name))}">${pic(it)}</a>
    <div class="pc-b${S.cart[it.id] ? ' q' : ''}"><a class="pc-t" href="#p=${it.id}"><div class="pc-p">${rs(paise(it.price))}${it.unit === 'kg' ? '<small>/kg</small>' : ''}</div>
      <div class="pc-n">${esc(nice(it.name))}</div><div class="pc-u">${unitLine(it)}${sv ? ` · <s>${rs(paise(sv.was))}</s>` : ''}</div></a><div class="act">${actHtml(it)}</div></div></div>`;
}

// ------------------------------------------------------------------ header bits, bottom bars
const avatar = () => `<span class="av">${S.me ? esc(S.me.name.trim().slice(0, 1).toUpperCase()) : '<img src="/img/logo.webp" alt="">'}</span>`;
function locText() {
  const s = S.info.shop;
  if (S.mode === 'delivery') return S.me && S.me.address ? `Deliver to ${S.me.address}` : `Home delivery · ${s.online_area || 'near the shop'}`;
  return `Takeaway · ${s.address || s.name}`;
}
function drawBars() {
  const c = cartSums();
  $$('[data-cartn]').forEach((b) => { b.hidden = !c.n; b.textContent = c.n; });
  $$('[data-ordn]').forEach((b) => { b.hidden = !S.active; b.textContent = S.active; });
  $$('[data-orddot]').forEach((b) => { b.hidden = !S.active; });
  $('#cbItems').textContent = `${c.n} item${c.n === 1 ? '' : 's'}`;
  $('#cbTotal').textContent = rs(c.total);
  $('#cartbar').hidden = !c.n || !['home', 'cats', 'list', 'search'].includes(S.page);
  const nav = { home: 'home', cats: 'cats', list: 'cats', search: 'search', orders: 'orders', track: 'orders', account: 'account', auth: 'account' }[S.page];
  $$('.bnav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
  document.body.dataset.page = S.page;
  if (!S.info) return;
  const acct = $('#pcAcct');
  acct.className = `pc-acct${S.me ? '' : ' login'}`;
  acct.innerHTML = S.me ? `${avatar()}<span>${esc(S.me.name.split(' ')[0])}</span>` : 'Log in';
  $('#pcLoc').innerHTML = `${ico(S.mode === 'delivery' ? 'scooter' : 'bag')}<span>${esc(locText())}</span>${ico('down')}`;
}
const view = () => $('#view');
const appbar = (title, right = '') => `<div class="appbar"><button class="ab-back" data-back aria-label="Back">${ico('left')}</button><h1>${esc(title)}</h1><div class="ab-r">${right}</div></div>`;
const closedNote = () => (S.info.shop.online_enabled === '1' ? '' : `<div class="notice">We are not taking online orders right now. Please call the shop${
  S.info.shop.phone ? `: <a href="tel:${esc(S.info.shop.phone)}"><b>${esc(S.info.shop.phone)}</b></a>` : ''}.</div>`);
const emptyState = (art, title, text, btn = '') => `<div class="empty-state"><img src="${FE(art)}" alt=""><h2>${esc(title)}</h2><p>${esc(text)}</p>${btn}</div>`;

// ------------------------------------------------------------------ sheets (bottom on phones, centred on PCs)
function sheet(html) {
  $('#sheetCard').innerHTML = `<div class="grab"></div>${html}`;
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  return $('#sheetCard');
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.style.overflow = '';
  if (S.stopScan) { S.stopScan(); S.stopScan = null; }
}
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

function modeSheet() {
  const s = S.info.shop;
  const first = S.info.slots[0] && S.info.slots[0].slots[0];
  const dc = paise(s.online_delivery_charge);
  const free = paise(s.online_free_delivery_above);
  const opt = (m, art, title, sub) => `<button class="opt ${S.mode === m ? 'on' : ''}" data-m="${m}"><img src="${FE(art)}" alt=""><span><b>${title}</b><span>${sub}</span></span><i class="rad"></i></button>`;
  const c = sheet(`<h2>How would you like your order?</h2>
    ${s.online_delivery === '1' ? opt('delivery', 'motor-scooter', 'Home delivery', `${s.online_area ? `${esc(s.online_area)}. ` : ''}${dc ? `Delivery ${rs(dc)}` : 'Free delivery'}${dc && free ? `, free above ${rs(free)}` : ''}.`) : ''}
    ${s.online_pickup === '1' ? opt('pickup', 'shopping-bags', 'Takeaway', `Collect at the counter${s.address ? `: ${esc(s.address)}` : ''}. No queue.`) : ''}
    ${first ? `<p class="small mut">Earliest time: ${esc(S.info.slots[0].label)}, ${esc(first.l)}</p>` : ''}`);
  $$('[data-m]', c).forEach((b) => b.addEventListener('click', () => { setMode(b.dataset.m); closeSheet(); }));
}
function setMode(m) {
  const s = S.info.shop;
  if (m === 'delivery' && s.online_delivery !== '1') m = 'pickup';
  if (m === 'pickup' && s.online_pickup !== '1') m = 'delivery';
  S.mode = m;
  localStorage.setItem('mpc_mode', m);
  $$('.loc span').forEach((el) => { el.textContent = locText(); });
  if (S.page === 'cart') cartView();
  drawBars();
}

const SORTS = { popular: 'Popular', price_asc: 'Price: low to high', price_desc: 'Price: high to low', offers: 'Biggest saving', name: 'Name A to Z' };
function sortSheet(onDone, { offersFixed = false } = {}) {
  const c = sheet(`<h2>Sort and filter</h2>
    ${Object.entries(SORTS).map(([k, l]) => `<button class="opt ${S.sort === k ? 'on' : ''}" data-s="${k}"><span><b>${l}</b></span><i class="rad"></i></button>`).join('')}
    <h2 style="margin-top:16px">Show</h2>
    ${offersFixed ? '' : `<button class="opt ${S.only === 'offers' ? 'on' : ''}" data-t="only"><img src="${FE('label')}" alt=""><span><b>Only offers</b><span>Products below MRP or on offer</span></span><i class="rad"></i></button>`}
    <button class="opt ${S.instock ? 'on' : ''}" data-t="instock"><img src="${FE('package')}" alt=""><span><b>Only in stock</b><span>Hide sold-out products</span></span><i class="rad"></i></button>
    <button class="btn-g wide" id="sApply" style="margin-top:8px">Show products</button>`);
  $$('[data-s]', c).forEach((b) => b.addEventListener('click', () => { S.sort = b.dataset.s; $$('[data-s]', c).forEach((x) => x.classList.toggle('on', x === b)); }));
  $$('[data-t]', c).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.t === 'only') S.only = S.only ? '' : 'offers'; else S.instock = !S.instock;
    b.classList.toggle('on');
  }));
  $('#sApply', c).addEventListener('click', () => { closeSheet(); onDone(); });
}

// ------------------------------------------------------------------ taps that work on every page
document.addEventListener('click', (e) => {
  const d = e.target.closest('[data-d]');
  if (d) {
    const el = d.closest('[data-pid]');
    const it = el && S.items.get(Number(el.dataset.pid));
    e.preventDefault(); e.stopPropagation();
    if (it && it.in_stock) setQty(it, +((S.cart[it.id] || 0) + Number(d.dataset.d) * step(it)).toFixed(3));
    return;
  }
  if (e.target.closest('[data-back]')) { e.preventDefault(); goBack(); return; }
  if (e.target.closest('[data-loc]')) { e.preventDefault(); modeSheet(); return; }
  const a = e.target.closest('[data-after]');
  if (a) S.after = a.dataset.after;
});
function goBack() { if (S.hist.length > 1) history.back(); else location.hash = '#'; }

// ------------------------------------------------------------------ home
function banners() {
  const s = S.info.shop;
  const o = S.info.offers || {};
  const first = S.info.slots[0] && S.info.slots[0].slots[0];
  const from = first ? first.l.split('–')[0] : '';
  const veg = S.info.cats.find((c) => /veg|fruit/i.test(c.name));
  const per = Number(s.loyalty_points_per_100) || 0;
  const list = (S.info.banners || []).map((b) => ({ photo: b.img, k: b.kicker, b: b.title, d: b.sub, href: b.link ? `#${b.link}` : '', go: b.link ? 'Get Now' : '' }));
  if (o.count) {
    list.push({ k: o.pct ? 'Offers up to' : 'Special offers', b: o.pct ? `${o.pct}% OFF` : `${o.count} products`, d: o.till ? `Till ${fmtDate(o.till)}` : 'Limited time only',
      href: '#offers', go: 'Get Now', art: ['tomato', 'bell-pepper', 'broccoli', 'onion'], bg: 'linear-gradient(120deg,#f6f5ef,#e8ede0)', id: 'offers' });
  }
  list.push({ k: 'Fresh every morning', b: 'Fruits & Vegetables', d: from ? `${S.mode === 'delivery' ? 'Delivered' : 'Ready'} from ${from}` : 'Picked fresh daily',
    href: veg ? `#cat=${veg.id}` : '#cats', go: 'Order Now', art: ['broccoli', 'tomato', 'carrot', 'banana'], bg: 'linear-gradient(120deg,#f2f7ef,#dcecd9)' });
  if (s.online_delivery === '1' && paise(s.online_free_delivery_above)) {
    list.push({ k: 'Home delivery', b: 'FREE Delivery', d: `On orders above ${rs(paise(s.online_free_delivery_above))}`, href: '#cats', go: 'Shop Now',
      art: ['motor-scooter', 'shopping-bags', 'package'], bg: 'linear-gradient(120deg,#f2f4fd,#dfe5fa)' });
  }
  if (s.loyalty_enabled === '1' && per) {
    list.push({ k: 'Loyalty points', b: `Earn ${per} point${per === 1 ? '' : 's'}`, d: 'On every ₹100 you spend', href: S.me ? '#account' : '#signup',
      go: S.me ? 'My Points' : 'Join Now', art: ['coin', 'wrapped-gift', 'party-popper'], bg: 'linear-gradient(120deg,#fff8ec,#fbe7c4)' });
  }
  if (s.online_pickup === '1') {
    list.push({ k: 'Takeaway', b: 'Skip the queue', d: 'Order now, collect at the counter', href: '#cats', go: 'Order Now',
      art: ['shopping-bags', 'stopwatch', 'shopping-cart'], bg: 'linear-gradient(120deg,#f6f6f4,#e7e8e3)' });
  }
  return list.slice(0, 5);
}
const bnrHtml = (b) => `<a class="bnr${b.photo ? ' photo' : ''}" ${b.href ? `href="${b.href}"` : ''} ${b.bg ? `style="--bg:${b.bg}"` : ''} ${b.id ? `data-bn="${b.id}"` : ''}>
  ${b.photo ? `<img class="bnr-img" src="${esc(b.photo)}" alt="">` : `<div class="bnr-art">${(b.art || []).slice(0, 3).map((a, i) => `<img class="a${i + 1}" src="${FE(a)}" alt="">`).join('')}</div>`}
  <div class="bnr-t">${b.k ? `<span class="k">${esc(b.k)}</span>` : ''}${b.b ? `<b>${esc(b.b)}</b>` : ''}${b.d ? `<span class="d">${esc(b.d)}</span>` : ''}${b.go ? `<span class="go">${esc(b.go)}</span>` : ''}</div></a>`;
function carousel() {
  const el = $('#bnrs');
  clearInterval(S.bnrTimer);
  if (!el || el.children.length < 2) return;
  const dots = $$('.dots-tab i');
  const stepW = () => el.children[1].offsetLeft - el.children[0].offsetLeft;
  const idx = () => Math.round(el.scrollLeft / stepW());
  el.addEventListener('scroll', () => { const i = idx(); dots.forEach((d, k) => d.classList.toggle('on', k === i)); }, { passive: true });
  let hold = 0;
  el.addEventListener('pointerdown', () => { hold = Date.now(); });
  S.bnrTimer = setInterval(() => {
    if (!document.body.contains(el)) { clearInterval(S.bnrTimer); return; }
    if (Date.now() - hold < 8000) return;
    const visible = Math.max(1, Math.round(el.clientWidth / stepW()));
    const n = idx() + 1 > el.children.length - visible ? 0 : idx() + 1;
    el.scrollTo({ left: n * stepW(), behavior: 'smooth' });
  }, 5000);
}
// a long one-word name ("Vegetables") is made a little smaller instead of being cut
function fitLabels() {
  $$('.cc-n').forEach((el) => {
    el.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && fs > 9.5) { fs -= 0.5; el.style.fontSize = `${fs}px`; }
  });
}
window.addEventListener('resize', () => { clearTimeout(fitLabels.t); fitLabels.t = setTimeout(fitLabels, 150); });
const circ = (c) => `<a class="circ" href="#cat=${c.id}"><span class="circ-i"><img src="${FE(catArt(c.name))}" alt=""></span><span class="circ-n">${esc(shortCat(c.name))}</span></a>`;
const ccTile = (href, art, name) => `<a class="cc" href="${href}"><span class="cc-i"><img src="${FE(art)}" alt=""></span><span class="cc-n">${esc(name)}</span></a>`;

async function homeView() {
  S.page = 'home';
  const tok = ++S.tok;
  const live = () => tok === S.tok;
  const s = S.info.shop;
  const cats = S.info.cats;
  const bl = banners();
  view().innerHTML = `
    <div class="mhd"><div class="who"><a href="#account" aria-label="Profile">${avatar()}</a><span class="who-t">
      <a class="who-n" href="#account"><span>${esc(S.me ? S.me.name : s.name)}</span>${S.me && S.me.verified ? VF : ''}</a>
      <button class="loc" data-loc type="button"><span>${esc(locText())}</span>${ico('down')}</button></span></div>
      <div class="hd-btns"><a class="cbtn" href="#cart" aria-label="Basket">${ico('bag')}<b class="bdg g" data-cartn hidden></b></a>
        <a class="cbtn" href="#orders" aria-label="My orders">${ico('bell')}<b class="bdg" data-ordn hidden></b></a></div></div>
    <a class="srch home-srch" href="#search">${ico('search')}<span class="ph-t">What would you like to buy today?</span><span class="srch-f">${ico('sliders')}</span></a>
    ${closedNote()}
    ${bl.length ? `<div class="bnr-wrap"><div class="bnrs" id="bnrs">${bl.map(bnrHtml).join('')}</div>
      ${bl.length > 1 ? `<div class="dots-tab">${bl.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</div>` : ''}
    <div class="catcard"><div class="cc-grid">${ccTile('#offers', 'fire', 'Best Deals')}${cats.slice(0, 9).map((c) => ccTile(`#cat=${c.id}`, catArt(c.name), shortCat(c.name))).join('')}</div>
      <a class="cc-more" href="#cats">${ico('clover')}View More Categories</a></div>
    <section class="sec" id="againSec" hidden><div class="sec-h"><h2>Buy again</h2></div><div class="rail" id="again"></div></section>
    <section class="sec" id="offSec" hidden><div class="sec-h"><h2>Today's offers</h2><a href="#offers">View all</a></div><div class="rail" id="offers"></div></section>
    ${cats.length > 4 ? `<section class="sec circ-sec"><div class="sec-h"><h2>More categories</h2><a href="#cats">View all</a></div>
      <div class="circ-row">${cats.slice(4).map(circ).join('')}</div></section>` : ''}
    <section class="sec"><div class="sec-h"><h2>Best sellers</h2><a href="#search">View all</a></div><div class="rail" id="pop"><span class="mut small">Loading…</span></div></section>
    ${cats.slice(0, 3).map((c) => `<section class="sec" data-cs="${c.id}" hidden><div class="sec-h"><h2>${esc(c.name)}</h2><a href="#cat=${c.id}">View all</a></div><div class="rail"></div></section>`).join('')}
    <p class="credit">Pictures: the shop's photos, <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (CC BY-SA)
      and <a href="/fe/LICENSE.txt" target="_blank">Microsoft Fluent Emoji</a> (MIT). Pictures are for illustration; packs may differ.</p>`;
  carousel();
  fitLabels();
  drawBars();
  const fill = (el, items) => { el.innerHTML = remember(items).map(card).join(''); };
  const jobs = [
    get('/items?sort=popular&limit=12').then(({ items }) => { if (live()) { if (items.length) fill($('#pop'), items); else $('#pop').closest('.sec').hidden = true; } }),
    get('/items?only=offers&sort=offers&limit=12').then(({ items }) => {
      if (!live() || !items.length) return;
      $('#offSec').hidden = false; fill($('#offers'), items);
      const arts = [...new Set(items.filter((i) => !i.image).map((i) => artFor(i.name, i.cat)))].slice(0, 3);
      const bn = $('[data-bn="offers"] .bnr-art');
      if (bn && arts.length >= 3) bn.innerHTML = arts.map((a, i) => `<img class="a${i + 1}" src="${FE(a)}" alt="">`).join('');
    }),
    ...cats.slice(0, 3).map((c) => get(`/items?cat=${c.id}&sort=popular&limit=12`).then(({ items }) => {
      const sec = live() && $(`[data-cs="${c.id}"]`);
      if (sec && items.length) { sec.hidden = false; fill($('.rail', sec), items); }
    })),
  ];
  if (S.me) jobs.push(get('/account/again').then(({ items }) => { if (live() && items.length) { $('#againSec').hidden = false; fill($('#again'), items); } }));
  const r = await Promise.allSettled(jobs);
  if (live() && r[0].status === 'rejected') $('#pop').innerHTML = `<div class="err">${esc(r[0].reason.message)}</div>`;
}

// ------------------------------------------------------------------ categories, lists, search
function catsView() {
  S.page = 'cats';
  ++S.tok;
  const o = S.info.offers || {};
  view().innerHTML = `${appbar('Categories', `<a class="ab-btn" href="#search" aria-label="Search">${ico('search')}</a>`)}${closedNote()}
    <div class="page"><div class="cat-grid"><a class="ct" href="#offers"><img src="${FE('fire')}" alt=""><b>Best Deals</b><span>${o.count ? `${o.count} on offer` : 'Below MRP'}</span></a>
    ${S.info.cats.map((c) => `<a class="ct" href="#cat=${c.id}"><img src="${FE(catArt(c.name))}" alt="" loading="lazy"><b>${esc(c.name)}</b><span>${Number(c.items)} item${Number(c.items) === 1 ? '' : 's'}</span></a>`).join('')}</div></div>`;
}

function chipsHtml({ cat = '', offersFixed = false } = {}) {
  return `<div class="chips"><button class="chip ic" data-sort aria-label="Sort and filter">${ico('sliders')}</button>
    <button class="chip" data-sort>${ico('sort')}${esc(SORTS[S.sort])}</button>
    ${offersFixed ? '' : `<button class="chip ${S.only === 'offers' ? 'on' : ''}" data-tog="only">${ico('tag')}Offers</button>`}
    <button class="chip ${S.instock ? 'on' : ''}" data-tog="instock">In stock</button>
    ${S.info.cats.slice(0, 14).filter((c) => String(c.id) !== String(cat)).map((c) => `<a class="chip" href="#cat=${c.id}">${esc(shortCat(c.name))}</a>`).join('')}</div>`;
}
function bindChips(rerun, opts = {}) {
  $$('[data-sort]').forEach((b) => b.addEventListener('click', () => sortSheet(rerun, opts)));
  $$('[data-tog]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tog === 'only') S.only = S.only ? '' : 'offers'; else S.instock = !S.instock;
    rerun();
  }));
}
function redrawChips(opts) {
  const old = $('.chips');
  if (old) { old.outerHTML = chipsHtml(opts); }
}

// a grid of products with "Show more"
async function results(el, params) {
  const tok = ++S.tok;
  let offset = 0;
  let count = 0;
  const LIM = 40;
  el.innerHTML = '<div class="grid"></div><div class="more"></div>';
  const load = async () => {
    const q = new URLSearchParams({ ...params, sort: S.sort, limit: LIM, offset });
    if (S.only && !params.only) q.set('only', S.only);
    if (S.instock) q.set('instock', '1');
    const { items } = await get(`/items?${q}`);
    if (tok !== S.tok) return [];
    remember(items);
    offset += items.length; count += items.length;
    $('.grid', el).insertAdjacentHTML('beforeend', items.map(card).join(''));
    if (!count) $('.grid', el).outerHTML = emptyState('shopping-cart', 'Nothing found', 'Try another word, or look in the categories.', '<a class="btn-o" href="#cats">See categories</a>');
    const more = $('.more', el);
    more.innerHTML = items.length === LIM ? '<button class="more-btn">Show more</button>' : '';
    if ($('button', more)) $('button', more).addEventListener('click', (e) => { e.target.disabled = true; e.target.textContent = 'Loading…'; load().catch((x) => toast(x.message)); });
    $$('[data-count]').forEach((c) => { c.textContent = `${count}${items.length === LIM ? '+' : ''} item${count === 1 ? '' : 's'}`; });
    return items;
  };
  return load();
}

async function listView({ cat = '', only = '', saved = false }) {
  S.page = 'list';
  const c = S.info.cats.find((x) => String(x.id) === String(cat));
  const title = c ? c.name : only ? 'Best Deals' : saved ? 'Saved items' : 'Products';
  const opts = { cat, offersFixed: !!only };
  view().innerHTML = `${appbar(title, `<a class="ab-btn" href="#search" aria-label="Search">${ico('search')}</a>`)}${closedNote()}
    <div class="page">${saved ? '' : chipsHtml(opts)}<div class="res-h"><span data-count></span></div><div id="res"></div></div>`;
  drawBars();
  if (saved) {
    const ids = [...S.fav].slice(0, 60);
    if (!ids.length) { $('#res').innerHTML = emptyState('red-heart', 'No saved items', 'Tap the heart on a product to save it here.', '<a class="btn-o" href="#">Start shopping</a>'); return; }
    await results($('#res'), { ids: ids.join(',') });
    return;
  }
  const rerun = () => { redrawChips(opts); bindChips(rerun, opts); results($('#res'), { ...(cat ? { cat } : {}), ...(only ? { only } : {}) }).catch((e) => toast(e.message)); };
  bindChips(rerun, opts);
  await results($('#res'), { ...(cat ? { cat } : {}), ...(only ? { only } : {}) });
}

function addRecent(v) {
  v = v.trim();
  if (v.length < 2) return;
  S.recent = [v, ...S.recent.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 8);
  LS.set('mpc_recent', S.recent);
}
async function searchView(q = '', code = '') {
  S.page = 'search';
  view().innerHTML = `<div class="appbar srch-bar"><button class="ab-back" data-back aria-label="Back">${ico('left')}</button>
      <label class="srch">${ico('search')}<input id="sq" type="search" placeholder="Search fruits, vegetables, groceries" value="${esc(q)}" autocomplete="off" enterkeyhint="search">
      ${'BarcodeDetector' in window ? `<button type="button" class="srch-f" id="scanB" aria-label="Scan a barcode">${ico('scan')}</button>` : ''}</label></div>
    <div class="appbar pc-only"><h1 id="sTitle">Search</h1></div>${closedNote()}
    <div class="page">${chipsHtml()}<div id="sres"></div></div>`;
  drawBars();
  const run = async (v) => {
    v = String(v || '').trim();
    const box = $('#sres');
    if (!box) return;
    if ($('#sTitle')) $('#sTitle').textContent = code ? 'Scanned product' : v ? `Results for “${v}”` : 'Search';
    if (!v && !code) {
      box.innerHTML = `${S.recent.length ? `<div class="res-h"><h2>Recent searches</h2><button class="small mut" id="clr" type="button">Clear</button></div>
        <div class="recent">${S.recent.map((r) => `<a href="#q=${encodeURIComponent(r)}">${ico('clock')}${esc(r)}</a>`).join('')}</div>` : ''}
        <div class="res-h"><h2>Top items</h2><span data-count></span></div><div id="sgrid"></div>`;
      if ($('#clr')) $('#clr').addEventListener('click', () => { S.recent = []; LS.set('mpc_recent', []); run(''); });
      await results($('#sgrid'), {});
      return;
    }
    box.innerHTML = `<div class="res-h"><h2>${code ? 'Scanned product' : `Results for “${esc(v)}”`}</h2><span data-count></span></div><div id="sgrid"></div>`;
    const items = await results($('#sgrid'), code ? { code } : { q: v });
    if (code && items.length === 1) location.replace(`#p=${items[0].id}`);
  };
  S.runSearch = (v) => { run(v).catch((e) => toast(e.message)); };
  const inp = $('#sq');
  let t;
  inp.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const v = inp.value.trim();
      history.replaceState(null, '', v ? `#q=${encodeURIComponent(v)}` : '#search');
      S.hist[S.hist.length - 1] = location.hash;
      S.runSearch(v);
    }, 300);
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { addRecent(inp.value); inp.blur(); } });
  if ($('#scanB')) $('#scanB').addEventListener('click', scan);
  const rerun = () => { redrawChips(); bindChips(rerun); S.runSearch(inp.value); };
  bindChips(rerun);
  if (!q && !code && window.innerWidth < 1000) setTimeout(() => inp.focus(), 60);
  if (q) addRecent(q);
  await run(q);
}

// ------------------------------------------------------------------ product details
function detailText(it) {
  if (it.unit === 'kg') return 'Fresh and loose. Choose the weight you need; it is weighed when your order is packed and the bill shows the exact weight.';
  return `${it.mrp ? `MRP ${rs(paise(it.mrp))}, inclusive of all taxes. ` : ''}Please check the pack for ingredients, use-by date and storage. The picture is for illustration.`;
}
async function detailView(id) {
  S.page = 'detail';
  const tok = ++S.tok;
  let it = S.items.get(id);
  if (!it) { const { items } = await get(`/items?ids=${id}`); remember(items); it = items[0]; }
  if (!it) throw new Error('This product is not available online right now.');
  if (tok !== S.tok) return;
  const s = S.info.shop;
  const sv = saving(it);
  let q = S.cart[it.id] || step(it);
  const attrs = [
    it.cat ? ['Category', esc(it.cat)] : null,
    ['Sold by', it.unit === 'kg' ? 'Weight (in steps of 250 g)' : 'Piece'],
    it.mrp ? ['MRP', rs(paise(it.mrp))] : null,
    sv ? ['You save', `${rs(paise(sv.was) - paise(it.price))} (${sv.pct}%)`] : null,
    it.offer_to ? ['Offer price till', fmtDate(it.offer_to)] : null,
  ].filter(Boolean);
  view().innerHTML = `<div class="det">${appbar('Details', `<button class="ab-btn" id="shareB" aria-label="Share">${ico('share')}</button>
      <button class="ab-btn fav ${S.fav.has(it.id) ? 'on' : ''}" id="favB" aria-label="Save">${ico('heart')}</button>`)}
    <div class="det-cols"><div class="det-img">${pic(it)}</div>
    <div class="det-sheet">
      <div class="det-top"><div class="det-name"><h2>${esc(nice(it.name))}</h2>${it.name_ta ? `<div class="ta">${esc(it.name_ta)}</div>` : ''}</div>
        <div class="det-pr"><b>${rs(paise(it.price))}${it.unit === 'kg' ? '<small>/kg</small>' : ''}</b>${sv ? `<s>${rs(paise(sv.was))}</s>` : ''}
          <span class="${it.in_stock ? '' : 'bad'}">${it.in_stock ? 'In Stock' : 'Sold out'}</span></div></div>
      <p class="det-desc">${esc(detailText(it))}</p>
      <div class="det-store"><span class="ds-logo"><img src="/img/logo.webp" alt=""></span><span><b>${esc(s.name)}</b>
        <small>${S.mode === 'delivery' ? `Home delivery${s.online_area ? ` · ${esc(s.online_area)}` : ''}` : 'Takeaway from the shop'}</small></span></div>
      <dl class="det-attr">${attrs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <div class="det-bar" id="detBar"></div>
      <section class="sec"><div class="sec-h"><h2>People also ordered</h2>${it.cat_id ? `<a href="#cat=${it.cat_id}">View all</a>` : ''}</div>
        <div class="rail" id="similar"><span class="mut small">Loading…</span></div></section>
    </div></div></div>`;
  drawBars();
  S.detBar = () => {
    const bar = $('#detBar');
    if (!bar) return;
    const inCart = S.cart[it.id] || 0;
    const last = q <= step(it);
    bar.innerHTML = it.in_stock ? `<div class="qpill"><button type="button" id="qm" class="${last ? 'del' : ''}" aria-label="${last ? 'Remove' : 'Less'}">${ico(last ? 'trash' : 'minus')}</button>
        <b>${fmtQ(q, it)}</b><button type="button" id="qp" aria-label="More">${ico('plus')}</button></div>
      <button class="btn-g" id="addB">${inCart && inCart === q ? 'View Basket' : inCart ? 'Update Basket' : 'Add to Basket'} - ${rs(lineP(it, q))}</button>`
      : '<button class="btn-g" disabled>Sold out right now</button>';
    if (!it.in_stock) return;
    $('#qm').addEventListener('click', () => {
      if (last) { if (inCart) { setQty(it, 0); toast('Removed from the basket'); } return; }
      q = +(q - step(it)).toFixed(3); S.detBar();
    });
    $('#qp').addEventListener('click', () => {
      if (q + step(it) > Number(it.available)) { toast(`Only ${fmtQ(Number(it.available), it)} available now`); return; }
      q = +(q + step(it)).toFixed(3); S.detBar();
    });
    $('#addB').addEventListener('click', () => {
      if (inCart && inCart === q) { location.hash = '#cart'; return; }
      setQty(it, q); toast(inCart ? 'Basket updated' : 'Added to the basket');
    });
  };
  S.detBar();
  $('#favB').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (S.fav.has(it.id)) { S.fav.delete(it.id); toast('Removed from saved items'); } else { S.fav.add(it.id); toast('Saved. Find it in Profile, Saved items.'); }
    LS.set('mpc_fav', [...S.fav]); b.classList.toggle('on', S.fav.has(it.id));
  });
  $('#shareB').addEventListener('click', async () => {
    const url = `${location.origin}/shop/#p=${it.id}`;
    try {
      if (navigator.share) await navigator.share({ title: nice(it.name), text: `${nice(it.name)}: ${rs(paise(it.price))}${it.unit === 'kg' ? '/kg' : ''} at ${s.name}`, url });
      else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    } catch (_) { /* closed */ }
  });
  try {
    const { items } = await get(`/items?${new URLSearchParams({ cat: it.cat_id || '', sort: 'popular', limit: 10, exclude: it.id })}`);
    if (tok === S.tok) {
      if (items.length) $('#similar').innerHTML = remember(items).map(card).join('');
      else $('#similar').closest('.sec').hidden = true;
    }
  } catch (_) { if ($('#similar')) $('#similar').closest('.sec').hidden = true; }
}

// ------------------------------------------------------------------ basket and checkout
function cartView() {
  S.page = 'cart';
  const s = S.info.shop;
  const lines = Object.entries(S.cart).map(([id, q]) => [S.items.get(Number(id)), q]).filter(([it]) => it);
  if (!lines.length) {
    view().innerHTML = `${appbar('My Basket')}<div class="page">${emptyState('shopping-cart', 'Your basket is empty', 'Add fruits, vegetables and daily needs.', '<a class="btn-g" href="#" style="display:inline-flex;max-width:260px">Start shopping</a>')}</div>`;
    drawBars();
    return;
  }
  const c = cartSums();
  const dc = deliveryCharge(c.total);
  const minOrder = paise(s.online_min_order);
  const saved = LS.get('mpc_me', {});
  const days = S.info.slots;
  if (S.dayIdx >= days.length) S.dayIdx = 0;
  const per = Number(s.loyalty_points_per_100) || 0;
  const earn = s.loyalty_enabled === '1' ? Math.floor(Math.floor(c.total / 10000) * per) : 0;
  const placeLabel = S.me ? 'Place Order' : 'Log in to order';
  const closed = s.online_enabled !== '1';
  view().innerHTML = `${appbar('My Basket', '<button class="ab-btn" id="clearB" aria-label="Empty the basket">' + ico('trash') + '</button>')}${closedNote()}
    <div class="page"><div class="cart-cols"><div class="main-col">
    <div class="modes">
      ${s.online_delivery === '1' ? `<button class="mode-c ${S.mode === 'delivery' ? 'on' : ''}" data-mode="delivery"><img src="${FE('motor-scooter')}" alt=""><b>Home delivery</b>
        <span>${paise(s.online_delivery_charge) ? `${rs(paise(s.online_delivery_charge))}${paise(s.online_free_delivery_above) ? `, free above ${rs(paise(s.online_free_delivery_above))}` : ''}` : 'Free'}</span></button>` : ''}
      ${s.online_pickup === '1' ? `<button class="mode-c ${S.mode === 'pickup' ? 'on' : ''}" data-mode="pickup"><img src="${FE('shopping-bags')}" alt=""><b>Takeaway</b><span>Collect at the counter</span></button>` : ''}</div>
    <div class="box"><h3>${c.n} item${c.n === 1 ? '' : 's'} in your basket</h3>
      ${lines.map(([it, q]) => `<div class="cl" data-pid="${it.id}"><a class="ce" href="#p=${it.id}">${pic(it)}</a>
        <div class="cm"><b>${esc(nice(it.name))}</b><span>${rs(paise(it.price))}${it.unit === 'kg' ? '/kg · weighed when packed' : ' each'}</span><span class="lt">${rs(lineP(it, q))}</span></div>
        <div class="qpill"><button data-d="-1" class="${q <= step(it) ? 'del' : ''}" aria-label="${q <= step(it) ? 'Remove' : 'Less'}">${ico(q <= step(it) ? 'trash' : 'minus')}</button>
          <b>${fmtQ(q, it)}</b><button data-d="1" aria-label="More">${ico('plus')}</button></div></div>`).join('')}
      <a class="add-more" href="#">${ico('plus')}Add more items</a></div>
    <div class="box"><h3>${S.mode === 'delivery' ? 'Delivery' : 'Pickup'} time</h3>
      ${days.length ? `<div class="days">${days.map((d, i) => `<button type="button" data-day="${i}" class="${i === S.dayIdx ? 'on' : ''}">${esc(d.label)}</button>`).join('')}</div>
      <div class="slots">${days[S.dayIdx].slots.map((x) => `<button type="button" data-slot="${x.v}" class="${x.v === S.slot ? 'on' : ''}">${esc(x.l)}</button>`).join('')}</div>`
    : '<div class="mut small">No time slots are open now. Please try again later.</div>'}</div>
    ${S.me ? '' : `<div class="box"><h3>Log in to place your order</h3><p class="small mut" style="margin-top:-6px">Your mobile number is your login. New here? Sign up in a minute.</p>
      <div style="display:flex;gap:10px"><a class="btn-g" href="#login" data-after="#cart">Log in</a><a class="btn-o" href="#signup" data-after="#cart" style="flex:1">Sign up</a></div></div>`}
    <form class="box" id="of" ${S.me ? '' : 'hidden'}><h3>Your details</h3>
      <div class="field"><label>Name</label><input name="name" required value="${esc((S.me && S.me.name) || saved.name || '')}" autocomplete="name"></div>
      <div class="field"><label>Mobile</label><div class="fixed">${esc(S.me ? S.me.phone : '')} ${S.me && S.me.verified ? '<span class="pill">Verified</span>' : ''}</div></div>
      ${S.mode === 'delivery' ? `<div class="field"><label>Delivery address with landmark</label><textarea name="address" rows="2">${esc((S.me && S.me.address) || saved.address || '')}</textarea></div>` : ''}
      <div class="field"><label>Note for the shop (optional)</label><input name="notes" placeholder="e.g. ripe bananas, call before coming"></div>
      <div class="field"><label>Pay by</label><select name="pay"><option value="cash">Cash</option><option value="upi">UPI${s.upi_id ? ` (${esc(s.upi_id)})` : ''}</option></select></div>
      <input name="website" class="hp" tabindex="-1" autocomplete="off"><div id="oerr"></div>
      <p class="small mut">You pay when you ${S.mode === 'delivery' ? 'receive the order' : 'collect'}. The shop confirms on WhatsApp. Weighed items are billed at the exact weight.</p></form>
    </div><div class="side">
    <div class="box"><h3>Bill details</h3>
      <div class="bill-row"><span>Items total</span><span>${rs(c.total)}</span></div>
      ${S.mode === 'delivery' ? `<div class="bill-row"><span>Delivery charge</span><span>${dc ? rs(dc) : '<b class="okc">FREE</b>'}</span></div>` : ''}
      <div class="bill-row total"><span>To pay (approx.)</span><span>${rs(c.total + dc)}</span></div>
      ${c.saved > 0 ? `<div class="save-strip">You save ${rs(c.saved)} on this order</div>` : ''}
      ${earn > 0 ? `<p class="small okc" style="margin:10px 0 0">You earn about ${earn} loyalty point${earn === 1 ? '' : 's'}${S.me && Number(S.me.points) ? ` (you have ${Number(S.me.points)})` : ''}.</p>` : ''}
      ${S.mode === 'delivery' && dc && paise(s.online_free_delivery_above) ? `<p class="small mut" style="margin:10px 0 0">Add ${rs(paise(s.online_free_delivery_above) - c.total)} more for free delivery.</p>` : ''}
      ${S.mode === 'delivery' && c.total < minOrder ? `<div class="err">Minimum order for delivery is ${rs(minOrder)}. Add ${rs(minOrder - c.total)} more, or choose takeaway.</div>` : ''}
      <div class="place" style="margin-top:14px"><button class="btn-g wide" data-place ${closed ? 'disabled' : ''}>${placeLabel} - ${rs(c.total + dc)}</button></div></div>
    </div></div></div>
    <div class="cart-bar"><div class="tot"><span>To pay</span><b>${rs(c.total + dc)}</b></div><button class="btn-g" data-place ${closed ? 'disabled' : ''}>${placeLabel}</button></div>`;
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('[data-day]').forEach((b) => b.addEventListener('click', () => { S.dayIdx = Number(b.dataset.day); S.slot = ''; const y = window.scrollY; cartView(); window.scrollTo(0, y); }));
  $$('[data-slot]').forEach((b) => b.addEventListener('click', () => { S.slot = b.dataset.slot; $$('[data-slot]').forEach((x) => x.classList.toggle('on', x === b)); }));
  $$('[data-place]').forEach((b) => b.addEventListener('click', placeOrder));
  $('#clearB').addEventListener('click', () => { if (confirm('Remove everything from the basket?')) { S.cart = {}; saveCart(); cartView(); } });
  drawBars();
}

async function placeOrder() {
  if (!S.me) { S.after = '#cart'; location.hash = '#login'; return; }
  const f = $('#of');
  const err = $('#oerr');
  err.innerHTML = '';
  const fail = (m) => { err.innerHTML = `<div class="err">${esc(m)}</div>`; f.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  if (!S.slot) {
    toast(`Please choose a ${S.mode === 'delivery' ? 'delivery' : 'pickup'} time`);
    const el = $('.days') || $('.slots');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (!f.name.value.trim()) { fail('Please enter your name.'); return; }
  const lines = Object.entries(S.cart).map(([id, q]) => ({ id: Number(id), qty: String(q) }));
  const body = { mode: S.mode, slot: S.slot, name: f.name.value, address: f.address ? f.address.value : '', notes: f.notes.value, pay: f.pay.value, website: f.website.value, lines };
  const btns = $$('[data-place]');
  btns.forEach((b) => { b.disabled = true; b.textContent = 'Placing order…'; });
  try {
    const r = await fetch('/api/shop/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (r.status === 401) { S.me = null; S.after = '#cart'; location.hash = '#login'; return; }
    if (!d.ok) throw new Error(d.error);
    if (body.address) S.me.address = body.address;
    const mine = LS.get('mpc_orders', []);
    mine.unshift({ n: d.number, t: d.token, at: new Date().toISOString() });
    LS.set('mpc_orders', mine.slice(0, 15));
    S.cart = {}; S.slot = ''; S.active += 1; saveCart();
    location.hash = `#o=${d.token}`;
  } catch (e) {
    fail(e.message || 'Please try again.');
    btns.forEach((b) => { b.disabled = false; b.textContent = 'Place Order'; });
  }
}

// ------------------------------------------------------------------ my orders and tracking
const OPEN = ['new', 'accepted', 'ready', 'out'];
const ORDER_ART = { new: 'package', accepted: 'shopping-bags', ready: 'shopping-bags', out: 'motor-scooter', done: 'party-popper', cancelled: 'package' };
const orderRow = (o) => `<a class="box order-row" href="#o=${o.token}"><img src="${FE(ORDER_ART[o.status] || 'package')}" alt="">
  <span class="or-t"><b>${esc(o.number)}</b> <span class="pill ${o.status === 'cancelled' ? 'red' : o.status === 'done' ? 'grey' : ''}">${esc(o.status === 'done' ? 'Completed' : o.status === 'cancelled' ? 'Cancelled' : 'In progress')}</span>
  <span class="or-s">${o.mode === 'delivery' ? 'Home delivery' : 'Takeaway'} · ${esc(o.slot_label)}</span></span><span class="or-a">${rs(paise(o.bill_total || o.est_total))}</span></a>`;
async function ordersView() {
  S.page = 'orders';
  view().innerHTML = `${appbar('My Orders')}<div class="page narrow" id="olist"><div class="loading">Loading…</div></div>`;
  drawBars();
  let orders;
  if (S.me) orders = (await get('/account/orders')).orders;
  else {
    const mine = LS.get('mpc_orders', []);
    orders = (await Promise.all(mine.map((m) => get(`/track/${m.t}`).then((r) => ({ ...r.order, token: m.t })).catch(() => null)))).filter(Boolean);
  }
  if (S.page !== 'orders') return;
  S.active = orders.filter((o) => OPEN.includes(o.status)).length;
  drawBars();
  $('#olist').innerHTML = orders.map(orderRow).join('') || emptyState('package', 'No orders yet', 'Your orders and their status show here.', '<a class="btn-g" href="#" style="display:inline-flex;max-width:260px">Start shopping</a>')
    + (S.me ? '' : '<p class="small mut" style="text-align:center">Log in to see orders placed on other phones. <a class="okc" href="#login">Log in</a></p>');
}

let trackTimer;
async function trackView(token) {
  S.page = 'track';
  const { order: o } = await get(`/track/${token}`);
  const steps = ['new', 'accepted', o.mode === 'pickup' ? 'ready' : 'out', 'done'];
  const names = { new: 'Order received', accepted: 'Packing your order', ready: 'Ready to collect', out: 'On the way to you', done: 'Completed' };
  const at = steps.indexOf(o.status);
  view().innerHTML = `${appbar(`Order ${o.number}`)}<div class="page narrow">
    <div class="status-card ${o.status === 'cancelled' ? 'cancel' : ''}"><img src="${FE(ORDER_ART[o.status] || 'package')}" alt="">
      <div><div class="small">${o.mode === 'delivery' ? 'Home delivery' : 'Takeaway'} · ${esc(o.slot_label)}</div><div class="st">${esc(o.status_label)}</div>
      ${o.status === 'cancelled' && o.note ? `<div class="small">Reason: ${esc(o.note)}</div>` : ''}</div></div>
    ${o.status !== 'cancelled' ? `<div class="box"><ol class="steps">${steps.map((st, i) => `<li class="${i <= at ? 'done' : ''}">${names[st]}</li>`).join('')}</ol></div>` : ''}
    ${o.lines.some((l) => l.note) ? '<div class="notice">Some items were not available. They are not charged, and anything already paid for them is refunded.</div>' : ''}
    <div class="box"><h3>Items</h3>${o.lines.map((l) => `<div class="cl" ${l.note && !Number(l.qty) ? 'style="opacity:.55"' : ''}><span class="ce">${pic({ ...l })}</span>
      <div class="cm"><b>${esc(nice(l.name))}</b><span>${esc(l.qty)} ${l.unit === 'kg' ? 'kg' : 'pc'} × ${rs(paise(l.price))}</span>
      ${l.note ? `<span class="bad">${esc(l.note)}${l.ordered ? ` (you ordered ${esc(l.ordered)})` : ''}</span>` : ''}</div>
      <b>${rs(Math.round(paise(l.price) * Number(l.qty)))}</b></div>`).join('')}
      ${Number(o.delivery_charge) ? `<div class="bill-row"><span>Delivery charge</span><span>${rs(paise(o.delivery_charge))}</span></div>` : ''}
      <div class="bill-row total"><span>${o.bill_no ? `Bill ${esc(o.bill_no)}` : 'Approx. total'}</span><span>${rs(paise(o.bill_total || o.est_total))}</span></div></div>
    <div class="box small">Questions? ${o.shop.phone ? `Call <a href="tel:${esc(o.shop.phone)}" class="okc"><b>${esc(o.shop.phone)}</b></a>` : 'Call the shop'}.
      ${o.shop.upi_id ? `<br>UPI: <b>${esc(o.shop.upi_id)}</b>` : ''}</div>
    <button class="btn-g wide" id="again">${ico('undo')}Order these items again</button></div>`;
  drawBars();
  $('#again').addEventListener('click', async () => {
    const ids = o.lines.map((l) => l.id).filter(Boolean);
    if (!ids.length) { location.hash = '#'; return; }
    const { items } = await get(`/items?ids=${ids.join(',')}`);
    remember(items);
    let added = 0;
    for (const l of o.lines) {
      const it = S.items.get(l.id);
      if (!it || !it.in_stock) continue;
      const want = Number(l.ordered || l.qty) || step(it);
      S.cart[it.id] = Math.min(want, Number(it.available));
      added += 1;
    }
    saveCart();
    toast(added ? `${added} item${added === 1 ? '' : 's'} added to the basket` : 'These items are not available now');
    if (added) location.hash = '#cart';
  });
  clearTimeout(trackTimer);
  if (OPEN.includes(o.status)) trackTimer = setTimeout(() => { if (location.hash === `#o=${token}`) trackView(token).catch(() => {}); }, 20000);
}

// ------------------------------------------------------------------ account: log in, sign up (SMS code), forgot password, profile
function authView(kind) {
  S.page = 'auth';
  const tabs = `<div class="auth-tabs"><a href="#login" class="${kind === 'login' ? 'on' : ''}">Log in</a><a href="#signup" class="${kind === 'signup' ? 'on' : ''}">Sign up</a></div>`;
  const forms = {
    login: `<form id="af"><div class="field"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="tel" required placeholder="10-digit mobile number"></div>
      <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
      <label class="show"><input type="checkbox" id="showpw"> Show password</label><div id="aerr"></div>
      <button class="btn-g">Log in</button><p class="small" style="text-align:center;margin-top:16px"><a href="#forgot" class="okc">Forgot password?</a></p></form>`,
    signup: `<form id="af"><div class="field"><label>Your name</label><input name="name" autocomplete="name" required></div>
      <div class="field"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="tel" required placeholder="10-digit mobile number"></div>
      <div class="field"><label>Create a password (at least 6 letters or numbers)</label><input name="password" type="password" autocomplete="new-password" required minlength="6"></div>
      <label class="show"><input type="checkbox" id="showpw"> Show password</label>
      ${S.sms ? `<div class="field" id="otpBox" hidden><label>6-digit code sent by SMS</label><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
        <button type="button" class="link" id="resend">Send the code again</button></div>` : ''}
      <div id="aerr"></div><button class="btn-g" id="abtn">${S.sms ? 'Send code by SMS' : 'Create account'}</button>
      ${S.sms ? '<p class="small mut" style="text-align:center">A 6-digit code is sent to your mobile.</p>' : ''}</form>`,
    forgot: S.sms ? `<form id="af"><p class="small mut">We send a code to your mobile number. Then choose a new password.</p>
      <div class="field"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="tel" required></div>
      <div class="field" id="otpBox" hidden><label>6-digit code sent by SMS</label><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
      <div class="field" id="pwBox" hidden><label>New password</label><input name="password" type="password" autocomplete="new-password" minlength="6"></div>
      <div id="aerr"></div><button class="btn-g" id="abtn">Send code by SMS</button></form>`
      : `<p style="text-align:center">To set a new password, please call the shop${S.info.shop.phone ? ` on <a href="tel:${esc(S.info.shop.phone)}" class="okc"><b>${esc(S.info.shop.phone)}</b></a>` : ''}.
      The shop sets a new password for your mobile number.</p><a class="btn-o wide" href="#login">Back to log in</a>`,
  };
  view().innerHTML = `${appbar(kind === 'forgot' ? 'Forgot password' : kind === 'signup' ? 'Sign up' : 'Log in')}<div class="page"><div class="auth">
    <div class="auth-head"><img src="/img/logo.webp" alt=""><h1>${kind === 'forgot' ? 'Forgot password' : kind === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
    <p>${esc(S.info.shop.name)}</p></div>${kind === 'forgot' ? '' : tabs}${forms[kind]}</div></div>`;
  drawBars();
  const f = $('#af');
  if (!f) return;
  const err = (m) => { $('#aerr').innerHTML = m ? `<div class="err">${esc(m)}</div>` : ''; };
  if ($('#showpw')) $('#showpw').addEventListener('change', (e) => { $$('[type=password],[data-pw]', f).forEach((i) => { i.dataset.pw = 1; i.type = e.target.checked ? 'text' : 'password'; }); });
  const done = async (me, msg) => {
    S.me = me; toast(msg);
    const to = S.after || '#'; S.after = '';
    location.hash = to;
    loadActive();
  };
  let codeSent = false;
  const sendCode = async (purpose) => {
    await post('/account/otp', { phone: f.phone.value, purpose });
    codeSent = true; $('#otpBox').hidden = false; f.code.focus();
    toast('Code sent by SMS');
  };
  if ($('#resend')) $('#resend').addEventListener('click', () => sendCode('signup').catch((e) => err(e.message)));
  f.addEventListener('submit', async (e) => {
    e.preventDefault(); err('');
    const btn = $('button.btn-g', f); btn.disabled = true;
    try {
      if (kind === 'login') {
        const r = await post('/account/login', { phone: f.phone.value, password: f.password.value });
        await done(r.me, `Welcome, ${r.me.name}!`);
      } else if (kind === 'signup') {
        if (S.sms && !codeSent) { await sendCode('signup'); btn.textContent = 'Create account'; return; }
        const r = await post('/account/signup', { name: f.name.value, phone: f.phone.value, password: f.password.value, code: f.code ? f.code.value : '' });
        await done(r.me, 'Account created');
      } else {
        if (!codeSent) { await sendCode('reset'); $('#pwBox').hidden = false; btn.textContent = 'Set new password'; return; }
        const r = await post('/account/reset', { phone: f.phone.value, code: f.code.value, password: f.password.value });
        await done(r.me, 'Password changed');
      }
    } catch (ex) { err(ex.message); } finally { btn.disabled = false; }
  });
  setTimeout(() => { const first = $('input', f); if (first && window.innerWidth > 760) first.focus(); }, 50);
}

function accountView() {
  S.page = 'account';
  const m = S.me;
  const s = S.info.shop;
  const per = Number(s.loyalty_points_per_100) || 0;
  const row = (attr, icon, title, sub = '', cls = '') => `<${attr.startsWith('href') ? 'a' : 'button type="button"'} ${attr} class="${cls}"><span class="mi">${ico(icon)}</span>
    <span class="mt">${title}${sub ? `<small>${sub}</small>` : ''}</span>${cls ? '' : ico('right', 'chev')}</${attr.startsWith('href') ? 'a' : 'button'}>`;
  view().innerHTML = `${appbar('Profile')}<div class="page narrow">
    <div class="box prof">${avatar()}<div><h2>${esc(m.name)}${m.verified ? VF : ''}</h2><div class="mut">${esc(m.phone)}${m.verified || !S.sms ? '' : ' · <span class="pill grey">not verified yet</span>'}</div></div></div>
    ${s.loyalty_enabled === '1' ? `<div class="box pts"><img src="${FE('coin')}" alt=""><div><div class="small mut">Loyalty points</div><div class="pts-n">${Number(m.points || 0)}</div>
      <div class="small mut">Earn ${per} point${per === 1 ? '' : 's'} for every ₹100, in the shop and online. 1 point = ${rs(Math.round(Number(s.loyalty_point_value) * 100))} off a later bill${
        Number(s.loyalty_min_redeem) ? ` (from ${Number(s.loyalty_min_redeem)} points)` : ''}. Ask the cashier to use them.</div></div></div>` : ''}
    <div class="box menu">
      ${row('href="#orders"', 'activity', 'My orders', 'Track orders and order again')}
      ${row('href="#saved"', 'heart', 'Saved items', `${S.fav.size} saved`)}
      ${row('data-edit', 'pin', 'My details', m.address ? esc(m.address) : 'Name and delivery address')}
      ${row('data-pw', 'lock', 'Change password')}
      ${s.phone ? row(`href="tel:${esc(s.phone)}"`, 'phone', 'Call the shop', esc(s.phone)) : ''}
      ${row('data-out', 'logout', 'Log out', '', 'red')}
    </div></div>`;
  drawBars();
  const save = async (body, el) => {
    try {
      const r = await post('/account/update', { name: m.name, address: m.address, password: '', new_password: '', ...body });
      S.me = r.me; closeSheet(); toast('Saved'); accountView();
    } catch (ex) { $('.perr', el).innerHTML = `<div class="err">${esc(ex.message)}</div>`; }
  };
  $('[data-edit]').addEventListener('click', () => {
    const c = sheet(`<h2>My details</h2><form><div class="field"><label>Name</label><input name="name" value="${esc(m.name)}" required></div>
      <div class="field"><label>Delivery address with landmark</label><textarea name="address" rows="3">${esc(m.address)}</textarea></div>
      <div class="perr"></div><button class="btn-g wide" style="margin-top:16px">Save</button></form>`);
    $('form', c).addEventListener('submit', (e) => { e.preventDefault(); save({ name: e.target.name.value, address: e.target.address.value }, c); });
  });
  $('[data-pw]').addEventListener('click', () => {
    const c = sheet(`<h2>Change password</h2><form><div class="field"><label>Current password</label><input name="password" type="password" autocomplete="current-password" required></div>
      <div class="field"><label>New password (at least 6 letters or numbers)</label><input name="new_password" type="password" autocomplete="new-password" minlength="6" required></div>
      <div class="perr"></div><button class="btn-g wide" style="margin-top:16px">Change password</button></form>`);
    $('form', c).addEventListener('submit', (e) => { e.preventDefault(); save({ password: e.target.password.value, new_password: e.target.new_password.value }, c); });
  });
  $('[data-out]').addEventListener('click', async () => {
    await post('/account/logout'); S.me = null; S.active = 0; toast('Logged out'); location.hash = '#';
  });
}

// ------------------------------------------------------------------ scan a pack's barcode with the phone camera
async function scan() {
  if (!('BarcodeDetector' in window)) { toast('Scanning works in Chrome on Android. Please type the name.'); return; }
  const c = sheet(`<h2>Scan a barcode</h2><p class="mut small">Point the camera at the barcode on the pack.</p><video autoplay playsinline muted></video>
    <button class="btn-o wide" data-close style="margin-top:14px">Cancel</button>`);
  let stream;
  S.stopScan = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('video', c);
    v.srcObject = stream;
    const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
    const loop = async () => {
      if ($('#sheet').hidden) return;
      const codes = await det.detect(v).catch(() => []);
      if (codes.length) { closeSheet(); location.hash = `#code=${encodeURIComponent(codes[0].rawValue)}`; return; }
      requestAnimationFrame(loop);
    };
    loop();
  } catch (_) { closeSheet(); toast('Camera not available. Please type the name.'); }
}

// ------------------------------------------------------------------ routing
async function loadActive() {
  if (!S.me) { S.active = 0; drawBars(); return; }
  try {
    const { orders } = await get('/account/orders');
    S.active = orders.filter((o) => OPEN.includes(o.status)).length;
  } catch (_) { /* later */ }
  drawBars();
}
async function route() {
  const h = decodeURIComponent(location.hash);
  if (S.hist.length > 1 && S.hist[S.hist.length - 2] === location.hash) S.hist.pop();
  else if (S.hist[S.hist.length - 1] !== location.hash) S.hist.push(location.hash);
  if (!$('#sheet').hidden) closeSheet();
  ++S.tok;
  clearInterval(S.bnrTimer);
  S.detBar = null;
  window.scrollTo(0, 0);
  if (!h.startsWith('#q=') && document.activeElement !== $('#pcq')) $('#pcq').value = '';
  try {
    if (h.startsWith('#o=')) await trackView(h.slice(3));
    else if (h === '#orders') await ordersView();
    else if (h === '#account') (S.me ? accountView() : authView('login'));
    else if (h === '#login' || h === '#signup' || h === '#forgot') (S.me && h !== '#forgot' ? accountView() : authView(h.slice(1)));
    else if (h === '#cart') cartView();
    else if (h === '#cats') catsView();
    else if (h === '#offers') await listView({ only: 'offers' });
    else if (h === '#saved') await listView({ saved: true });
    else if (h.startsWith('#cat=')) await listView({ cat: h.slice(5) });
    else if (h.startsWith('#p=')) await detailView(Number(h.slice(3)));
    else if (h === '#search') await searchView('');
    else if (h.startsWith('#q=')) await searchView(h.slice(3));
    else if (h.startsWith('#code=')) await searchView('', h.slice(6));
    else await homeView();
  } catch (e) {
    view().innerHTML = `${appbar('')}<div class="page">${emptyState('package', 'Something went wrong', e.message, '<a class="btn-o" href="#">Go to home</a>')}</div>`;
  }
  drawBars();
}

(async () => {
  try {
    S.info = await get('/info');
  } catch (e) { view().innerHTML = `<div class="page">${emptyState('package', 'Could not open the shop', e.message, '<button class="btn-o" onclick="location.reload()">Try again</button>')}</div>`; return; }
  const s = S.info.shop;
  document.title = `${s.name} | Order online`;
  $('#pcName').textContent = s.name;
  fillIcons();
  try { const a = await get('/account'); S.me = a.me; S.sms = a.sms; } catch (_) { /* browse without an account */ }
  if (!S.mode) S.mode = s.online_delivery === '1' ? 'delivery' : 'pickup';
  setMode(S.mode);
  // prices in the basket always come from the shop, never from what was saved on the phone
  const ids = Object.keys(S.cart);
  if (ids.length) {
    try {
      const { items } = await get(`/items?ids=${ids.join(',')}`);
      remember(items);
      for (const id of ids) if (!S.items.has(Number(id))) delete S.cart[id];
      saveCart();
    } catch (_) { /* shown later */ }
  }
  $('#pcLoc').addEventListener('click', modeSheet);
  let t;
  $('#pcq').addEventListener('input', (e) => {
    clearTimeout(t);
    const v = e.target.value.trim();
    t = setTimeout(() => {
      if (S.page === 'search' && S.runSearch) { history.replaceState(null, '', v ? `#q=${encodeURIComponent(v)}` : '#search'); S.hist[S.hist.length - 1] = location.hash; S.runSearch(v); }
      else if (v.length >= 2) location.hash = `#q=${encodeURIComponent(v)}`;
    }, 300);
  });
  $('#pcq').addEventListener('keydown', (e) => { if (e.key === 'Enter') addRecent(e.target.value); });
  window.addEventListener('hashchange', route);
  await route();
  loadActive();
})();
