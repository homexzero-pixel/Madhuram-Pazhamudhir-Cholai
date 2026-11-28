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
  recent: LS.get('mpc_recent', []), active: 0, page: 'home', tok: 0, rtok: 0, hist: [], addresses: null, addrId: 0, pay: LS.get('mpc_pay', 'cash'),
  sub: LS.get('mpc_sub', 'call'), drop: LS.get('mpc_drop', []), note: '', liveOrd: null,
};
// the signed-in customer, also kept on this phone so the next visit opens at once (the shop's answer replaces it a moment later)
const INFO_KEY = 'mpc_info_v2';
const HOME_KEY = 'mpc_home_v2';
const ME_KEY = 'mpc_me_v1';
let meNow = null;
Object.defineProperty(S, 'me', {
  enumerable: true,
  get: () => meNow,
  set: (v) => { meNow = v || null; try { if (meNow) LS.set(ME_KEY, meNow); else localStorage.removeItem(ME_KEY); } catch (_) { /* private mode */ } },
});

// The shop's server may be starting (a few seconds after an update): ask again quietly, behind the opening screen.
async function ask(path, opts) {
  for (let i = 0; ; i++) {
    const r = await fetch(`/api/shop${path}`, opts).catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    // the server said it is starting (nothing was done), or a page load could not connect: try again; a sent order is never sent twice
    const again = r ? r.status === 503 && d && d.starting : !(opts && opts.method === 'POST');
    if (again && i < 45) {
      if (window.Splash && Splash.keep) Splash.keep();
      await new Promise((ok) => setTimeout(ok, i < 5 ? 1000 : 2000));
      continue;
    }
    if (!d || !d.ok) { const e = new Error((d && d.error) || 'Please check the internet and try again.'); e.status = r ? r.status : 0; throw e; }
    return d;
  }
}
const get = (path) => ask(path);
const post = (path, body) => ask(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const remember = (list) => { for (const it of list) S.items.set(it.id, it); return list; };

// ------------------------------------------------------------------ money and quantities
const paise = (v) => Math.round(Number(v || 0) * 100);
const rs = (p) => `₹${(p / 100).toFixed(p % 100 ? 2 : 0)}`;
const step = (it) => (it.unit === 'kg' ? 0.25 : 1);
const fmtQ = (q, it) => (it.unit === 'kg' ? (q < 1 ? `${Math.round(q * 1000)} g` : `${+q.toFixed(3)} kg`) : `${q}`);
const lineP = (it, q) => Math.round(paise(it.price) * q);
const unitLine = (it) => (it.unit === 'kg' ? '1 kg' : '1 pc');
const fmtDate = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
// product names as typed in the shop's list ("carrot .", "Cabbage...") shown neatly
const nice = (n) => { const t = String(n || '').replace(/[\s.]+$/, '').replace(/\s+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
// a real saving only: below the printed MRP, or an offer below the shop's normal price
function saving(it) {
  const p = Number(it.price);
  const was = Math.max(Number(it.regular) || 0, Number(it.mrp) || 0);
  return was > p ? { was, pct: Math.round((1 - p / was) * 100), off: paise(was) - paise(p) } : null;
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = ''; }, 2400); }

// ------------------------------------------------------------------ pictures: the shop's photo, a real produce photo, else a 3D picture from the name
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
const SEC_ART = { veg: 'leafy-green', fruits: 'red-apple', exotics: 'avocado', dairy: 'glass-of-milk', staples: 'cooked-rice', masala: 'hot-pepper',
  breakfast: 'bowl-with-spoon', packaged: 'steaming-bowl', tea: 'hot-beverage', icecream: 'soft-ice-cream', drinks: 'cup-with-straw', juicebar: 'cup-with-straw',
  munchies: 'popcorn', biscuits: 'cookie', sweets: 'chocolate-bar', bath: 'soap', hair: 'lotion-bottle', skin: 'lotion-bottle', oral: 'toothbrush',
  fragrance: 'lotion-bottle', shaving: 'razor', baby: 'baby-bottle', pharma: 'pill', cleaning: 'sponge', laundry: 'bubbles', fresheners: 'bubbles',
  pooja: 'diya-lamp', disposables: 'roll-of-paper', kids: 'teddy-bear' };
const has = (kind, key) => !!(S.info && S.info.photos && (S.info.photos[kind] || []).includes(key));
const PV = 1;                                   // picture version: raise it when the pictures in public/photos change
function secImg(key) {
  if (has('s', key)) return `<img class="ph cut" src="/photos/s/${key}.webp?v=${PV}" alt="" loading="lazy" decoding="async" width="224" height="224">`;
  const sec = S.info && S.info.sections.find((x) => x.key === key);
  if (sec && sec.img) return `<img class="ph prod" src="${esc(sec.img)}" alt="" loading="lazy" decoding="async" data-fb="${FE(SEC_ART[key] || 'shopping-bags')}">`;
  return `<img class="art" src="${FE(SEC_ART[key] || 'shopping-bags')}" alt="" loading="lazy">`;
}
function pic(it, cls = '') {
  const art = artFor(it.name, it.cat);
  if (it.image) return `<img class="ph ${cls}" src="${esc(it.image)}" alt="" loading="lazy" decoding="async" data-fb="${FE(art)}">`;
  if (has('p', art)) return `<img class="ph real ${cls}" src="/photos/p/${art}.webp" alt="" loading="lazy">`;
  return `<img class="art ${cls}" src="${FE(art)}" alt="" loading="lazy">`;
}
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
  $$(`.pc[data-pid="${it.id}"]`).forEach((el) => { const a = $('.act', el); a.innerHTML = actHtml(it); a.classList.toggle('q', !!S.cart[it.id]); });
}
function toggleFav(id) {
  if (S.fav.has(id)) { S.fav.delete(id); toast('Removed from your wishlist'); } else { S.fav.add(id); toast('Added to your wishlist'); }
  LS.set('mpc_fav', [...S.fav]);
  $$(`[data-fav="${id}"]`).forEach((b) => b.classList.toggle('on', S.fav.has(id)));
}

// ------------------------------------------------------------------ product card: picture with heart and add button, price, real saving, name, size
function actHtml(it) {
  if (!it.in_stock) return '<span class="so">Sold out</span>';
  const q = S.cart[it.id] || 0;
  return q ? `<span class="qp"><button data-d="-1" aria-label="Less">${ico('minus')}</button><b>${fmtQ(q, it)}</b><button data-d="1" aria-label="More">${ico('plus')}</button></span>`
    : `<button class="add" data-d="1" aria-label="Add ${esc(nice(it.name))}">${ico('plus')}</button>`;
}
// "Only 3 left" from the real stock (never invented): pieces at 5 or fewer, loose items at 2 kg or less
function lowLeft(it) {
  const a = Number(it.available);
  if (!(a > 0)) return '';
  if (it.unit === 'kg') return a <= 2 ? `Only ${fmtQ(a, it)} left` : '';
  return a <= 5 ? `Only ${a} left` : '';
}
function card(it) {
  const sv = saving(it);
  const offer = Number(it.regular) > Number(it.price);
  const low = lowLeft(it);
  return `<div class="pc${it.in_stock ? '' : ' out'}" data-pid="${it.id}">
    <div class="pc-img"><a href="#p=${it.id}" aria-label="${esc(nice(it.name))}">${pic(it)}</a>
      ${offer ? `<span class="tagx">${sv.pct}% OFF</span>` : ''}${low ? `<span class="lowx">${esc(low)}</span>` : ''}
      <button class="fav ${S.fav.has(it.id) ? 'on' : ''}" data-fav="${it.id}" aria-label="Wishlist">${ico('heart')}</button>
      <div class="act${S.cart[it.id] ? ' q' : ''}">${actHtml(it)}</div></div>
    <a class="pc-t" href="#p=${it.id}"><div class="pc-pr"><span class="pill-p">${rs(paise(it.price))}${it.unit === 'kg' ? '<small>/kg</small>' : ''}</span>${sv ? `<s>${rs(paise(sv.was))}</s>` : ''}</div>
      ${sv && sv.off >= 100 ? `<div class="pc-off">${rs(sv.off)} OFF</div>` : '<div class="pc-off none"></div>'}
      <div class="pc-n">${esc(nice(it.name))}</div><div class="pc-u">${unitLine(it)}</div></a></div>`;
}

// ------------------------------------------------------------------ header bits, bottom bars
const avatar = () => `<span class="av">${S.me ? esc(S.me.name.trim().slice(0, 1).toUpperCase()) : '<img src="/img/shop-icon-192.png?v=3" alt="">'}</span>`;
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
  const bar = $('#cartbar');
  bar.hidden = !c.n || !['home', 'cats', 'list', 'search'].includes(S.page);
  if (S.page === 'welcome') bar.hidden = true;
  if (S.info && c.n) {
    const free = paise(S.info.shop.online_free_delivery_above);
    const need = free - c.total;
    $('#cbLine').innerHTML = S.mode === 'delivery' && free ? (need > 0 ? `Shop for <b>${rs(need)}</b> more ${ico('right')} <b>FREE delivery</b>` : '<b>FREE delivery unlocked</b>')
      : `<b>${c.n} item${c.n === 1 ? '' : 's'}</b> · ${rs(c.total)}`;
    $('#cbBar').style.width = `${S.mode === 'delivery' && free ? Math.min(100, Math.round(c.total * 100 / free)) : 100}%`;
    $('#cbN').textContent = c.n;
  }
  const nav = { home: 'home', cats: 'cats', list: 'cats', search: 'search', orders: 'orders', track: 'orders', account: 'account', auth: 'account', help: 'account',
    refer: 'account', addresses: 'account' }[S.page];
  $$('.bnav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
  document.body.dataset.page = S.page;
  if (!S.info) return;
  const acct = $('#pcAcct');
  acct.className = `pc-acct${S.me ? '' : ' login'}`;
  acct.innerHTML = S.me ? `${avatar()}<span>${esc(S.me.name.split(' ')[0])}</span>` : 'Log in';
  $('#pcLoc').innerHTML = `${ico(S.mode === 'delivery' ? 'scooter' : 'bag')}<span>${esc(locText())}</span>${ico('down')}`;
}
// The earliest time the customer can get the order: "Today, 7–8 am"
const istDay = (ms = Date.now()) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
function shortTime(l) {
  const [a, b] = String(l || '').replace(/:00/g, '').split('–');
  if (!b) return a || '';
  const sa = (a.match(/\s?[ap]m$/i) || [''])[0];
  const sb = (b.match(/\s?[ap]m$/i) || [''])[0];
  return sa && sa.trim() === sb.trim() ? `${a.slice(0, -sa.length)}–${b}` : `${a}–${b}`;
}
const dayName = (d) => (d.date === istDay() ? 'Today' : d.date === istDay(Date.now() + 86400000) ? 'Tomorrow' : d.label);
function slotText(v) {
  for (const d of S.info.slots || []) for (const x of d.slots) if (x.v === v) return `${dayName(d)}, ${shortTime(x.l)}`;
  return '';
}
function nextSlot() {
  const d = (S.info.slots || [])[0];
  return d && d.slots.length ? { day: dayName(d), time: shortTime(d.slots[0].l), v: d.slots[0].v } : null;
}
function addrShort() {
  const s = S.info.shop;
  if (S.mode !== 'delivery') return `Takeaway · ${s.address || s.name}`;
  if (S.me && S.me.address) return S.me.address;
  return S.me ? 'Add your delivery address' : `Home delivery${s.online_area ? ` · ${s.online_area}` : ''}`;
}
const shortSec = (n) => String(n).replace(/^Fresh /, '').replace(/ & .*$/, '').replace(/,.*$/, '');
const canVoice = () => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
function voiceSearch() {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { toast('Voice search works in Chrome. Please type the name.'); return; }
  const r = new R();
  r.lang = 'en-IN';
  r.interimResults = false;
  r.maxAlternatives = 1;
  toast('Listening… say a product name');
  r.onresult = (e) => { const t = e.results[0][0].transcript; if (t) location.hash = `#q=${encodeURIComponent(t)}`; };
  r.onerror = () => toast('Could not hear that. Please type it.');
  try { r.start(); } catch (_) { toast('Voice search is busy. Try again.'); }
}
// the open order, on top of the home page
function drawLive() {
  const el = $('#liveOrd');
  if (!el) return;
  const o = S.liveOrd;
  if (!o) { el.innerHTML = ''; return; }
  const st = { new: 'Order placed', accepted: 'Order accepted', packing: 'Billed and packed', ready: 'Ready for pickup', out: 'Out for delivery' }[o.status] || 'In progress';
  el.innerHTML = `<a class="live-ord" href="#o=${esc(o.token)}"><span class="lo-i">${ico(o.status === 'out' ? 'scooter' : 'bag')}</span>
    <span class="lo-t"><b>${esc(st)}</b><span>Order ${esc(o.number)} · ${esc(o.slot_label)}</span></span><span class="lo-go">Track${ico('right')}</span></a>`;
}
function catStrip() {
  const secs = (S.info.sections || []).filter((x) => x.count > 0).slice(0, 11);
  if (!secs.length) return '';
  return `<nav class="cat-strip" aria-label="Categories">${secs.map((x) => `<a href="#sec=${x.key}"><span class="cs-i">${secImg(x.key)}</span><span class="cs-n">${esc(shortSec(x.name))}</span></a>`).join('')}
    <a href="#cats"><span class="cs-i cs-all">${ico('grid')}</span><span class="cs-n">All</span></a></nav>`;
}

const view = () => $('#view');
const appbar = (title, right = '') => `<div class="appbar"><button class="ab-back" data-back aria-label="Back">${ico('left')}</button><h1>${esc(title)}</h1><div class="ab-r">${right}</div></div>`;
const closedNote = () => (S.info.shop.online_enabled === '1' ? '' : `<div class="notice">We are not taking online orders right now. Please call the shop${
  S.info.shop.phone ? `: <a href="tel:${esc(S.info.shop.phone)}"><b>${esc(S.info.shop.phone)}</b></a>` : ''}.</div>`);
const emptyState = (art, title, text, btn = '') => `<div class="empty-state"><img src="${FE(art)}" alt=""><h2>${esc(title)}</h2><p>${esc(text)}</p>${btn}</div>`;
const seeAll = (href, label = 'See All') => `<a class="see-all" href="${href}">${esc(label)} ${ico('right')}</a>`;
const secH = (title, href = '') => `<div class="sec-h"><h2>${esc(title)}</h2><i class="dash"></i>${href ? `<a href="${href}">See all</a>` : ''}</div>`;
const needLogin = () => { S.after = location.hash; location.hash = '#login'; };

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
function setMode(m, quiet = false) {
  const s = S.info.shop;
  if (m === 'delivery' && s.online_delivery !== '1') m = 'pickup';
  if (m === 'pickup' && s.online_pickup !== '1') m = 'delivery';
  S.mode = m;
  localStorage.setItem('mpc_mode', m);
  $$('.loc span').forEach((el) => { el.textContent = locText(); });
  if (quiet) return;
  if (S.page === 'cart') cartView();
  if (S.page === 'home') homeView();
  drawBars();
}

const SORTS = { popular: 'Popular', price_asc: 'Price: low to high', price_desc: 'Price: high to low', offers: 'Biggest saving', name: 'Name A to Z' };
function sortSheet(onDone, { offersFixed = false } = {}) {
  const c = sheet(`<h2>Sort and filter</h2>
    ${Object.entries(SORTS).map(([k, l]) => `<button class="opt ${S.sort === k ? 'on' : ''}" data-s="${k}"><span><b>${l}</b></span><i class="rad"></i></button>`).join('')}
    <h2 style="margin-top:16px">Show</h2>
    ${offersFixed ? '' : `<button class="opt ${S.only === 'offers' ? 'on' : ''}" data-t="only"><span><b>Only offers</b><span>Below MRP or on offer</span></span><i class="rad"></i></button>`}
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
  const f = e.target.closest('[data-fav]');
  if (f) { e.preventDefault(); e.stopPropagation(); toggleFav(Number(f.dataset.fav)); return; }
  if (e.target.closest('[data-back]')) { e.preventDefault(); goBack(); return; }
  if (e.target.closest('[data-loc]')) { e.preventDefault(); modeSheet(); return; }
  if (e.target.closest('[data-ask]')) { e.preventDefault(); askSheet(); return; }
  if (e.target.closest('[data-mic]')) { e.preventDefault(); voiceSearch(); return; }
  const a = e.target.closest('[data-after]');
  if (a) S.after = a.dataset.after;
});
function goBack() { if (S.hist.length > 1) history.back(); else location.hash = '#'; }

// ------------------------------------------------------------------ product grids that load more by themselves near the end
const skelCards = (n) => Array.from({ length: n }, () => '<div class="pc sk-pc" aria-hidden="true"><div class="sk sk-img"></div><div class="sk sk-t"></div><div class="sk sk-t short"></div></div>').join('');
async function results(el, params, { auto = true, limit = 30, seed = null } = {}) {
  const tok = ++S.rtok;                   // a newer grid (other filters, another page) replaces this one
  let offset = 0;
  let count = 0;
  let busy = false;
  let done = false;
  el.innerHTML = `<div class="grid">${seed ? '' : skelCards(window.innerWidth > 760 ? 8 : 6)}</div><div class="more"></div>`;
  const show = (items) => {
    remember(items);
    if (!count) $('.grid', el).innerHTML = '';
    offset += items.length; count += items.length;
    $('.grid', el).insertAdjacentHTML('beforeend', items.map(card).join(''));
  };
  const load = async () => {
    if (busy || done || tok !== S.rtok) return [];
    busy = true;
    const more = $('.more', el);
    if (count) more.innerHTML = '<div class="sk-more" aria-label="Loading more"><i></i><i></i><i></i></div>';
    try {
      const q = new URLSearchParams({ ...params, sort: params.sort || S.sort, limit, offset });
      if (S.only && !params.only) q.set('only', S.only);
      if (S.instock) q.set('instock', '1');
      const { items } = await get(`/items?${q}`);
      if (tok !== S.rtok) return [];
      show(items);
      done = items.length < limit;
      if (!count) $('.grid', el).outerHTML = emptyState('shopping-cart', 'Nothing here yet', 'Try another word, or look in the categories.', '<a class="btn-o" href="#cats">See categories</a>');
      more.innerHTML = done ? (count > 8 ? '<div class="end-note">That\'s all for now</div>' : '') : '<button class="more-btn">Show more</button>';
      const b = $('button', more);
      if (b) b.addEventListener('click', () => load());
      $$('[data-count]').forEach((c) => { c.textContent = `${count}${done ? '' : '+'} item${count === 1 ? '' : 's'}`; });
      return items;
    } catch (err) { more.innerHTML = `<div class="err">${esc(err.message)}</div>`; return []; } finally { busy = false; }
  };
  let first;
  if (seed) {
    show(seed);
    done = seed.length < limit;
    const more = $('.more', el);
    more.innerHTML = done ? '' : '<button class="more-btn">Show more</button>';
    const b = $('button', more);
    if (b) b.addEventListener('click', () => load());
    first = seed;
  } else first = await load();
  if (auto && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((ents) => {
      if (!document.body.contains(el) || tok !== S.rtok || done) { io.disconnect(); return; }
      if (ents.some((x) => x.isIntersecting)) load();
    }, { rootMargin: '600px 0px' });
    io.observe($('.more', el));
  }
  return first;
}

// ------------------------------------------------------------------ home
// The shop's own slides (public/photos/b/slide-N.webp). The second one is about home delivery: shown only while delivery is on.
const SLIDES = [
  { k: 'slide-1', go: '#trending', alt: 'Good food. Smart shop. Your weekly grocery essentials. Shop essentials' },
  { k: 'slide-2', go: '#cats', alt: 'Groceries to your door. Shop Madhuram home delivery. Order groceries', delivery: true },
  { k: 'slide-3', go: 'veg', alt: 'Fresh by nature. Fruit and veg for every meal. Shop produce' },
  { k: 'slide-4', go: 'staples', alt: 'Stock the good stuff. Rice, dals and spices for everyday cooking. Shop pantry' },
];
function banners() {
  const s = S.info.shop;
  const f = S.info.festival || {};
  const o = S.info.offers || {};
  const ph = (k) => (has('b', k) ? `/photos/b/${k}.webp` : null);
  const slides = SLIDES.filter((x) => has('b', x.k) && (!x.delivery || s.online_delivery === '1'));
  if (slides.length) {
    const count = (k) => (S.info.sections.find((x) => x.key === k) || {}).count || 0;
    const list = slides.map((x) => ({ art: true, photo: `/photos/b/${x.k}.webp?v=${PV}`, small: has('b', `${x.k}-640`) ? `/photos/b/${x.k}-640.webp?v=${PV}` : '',
      alt: x.alt, href: x.go.startsWith('#') ? x.go : count(x.go) ? `#sec=${x.go}` : '#cats' }));
    // then the owner's banner photos (Settings) and, while offers run, the festival offers
    for (const b of S.info.banners || []) list.push({ theme: 'owner', photo: b.img, tone: 'light', k: b.kicker, b: b.title, d: b.sub, href: b.link ? `#${b.link}` : '', go: b.link ? 'Shop Now' : '' });
    if (o.count) {
      list.push({ fest: true, theme: 'fest', deco: 'gift', photo: f.photo || ph(`fest_${f.style}`) || ph('fest_generic'), pics: 'offers',
        badge: `Up to ${o.pct}% OFF`, b: f.name, d: f.line || (f.to ? `Till ${fmtDate(f.to)}` : ''), href: '#offers', go: 'Shop Now' });
    }
    return list.slice(0, 8);
  }
  const first = S.info.slots[0] && S.info.slots[0].slots[0];
  const from = first ? first.l.split('–')[0] : '';
  const count = (k) => (S.info.sections.find((x) => x.key === k) || {}).count || 0;
  const per = Number(s.loyalty_points_per_100) || 0;
  const list = [];
  list.push({ fest: true, theme: 'fest', deco: 'gift', photo: f.photo || ph(`fest_${f.style}`) || ph('fest_generic'), pics: 'offers',
    badge: o.count ? `Up to ${o.pct}% OFF` : 'Festival offers', b: f.name, d: f.line || (f.to ? `Till ${fmtDate(f.to)}` : ''), href: '#offers', go: 'Shop Now' });
  for (const b of S.info.banners || []) list.push({ theme: 'owner', photo: b.img, tone: 'light', k: b.kicker, b: b.title, d: b.sub, href: b.link ? `#${b.link}` : '', go: b.link ? 'Shop Now' : '' });
  if (count('veg')) list.push({ theme: 'veg', deco: 'veg', photo: ph('veg'), pics: 'veg', k: 'Picked fresh every morning', b: 'Farm Fresh Vegetables', d: from ? `${S.mode === 'delivery' ? 'Delivered' : 'Ready'} from ${from}` : '', href: '#sec=veg', go: 'Order Now' });
  if (count('fruits')) list.push({ theme: 'fruits', deco: 'fruit', photo: ph('fruits'), pics: 'fruits', k: 'Sweet and juicy', b: 'Fresh Fruits', d: 'Bananas, mangoes, apples and more', href: '#sec=fruits', go: 'Shop Fruits' });
  if (s.online_delivery === '1' && paise(s.online_free_delivery_above)) {
    list.push({ theme: 'delivery', deco: 'scooter', photo: ph('delivery'), k: s.online_area ? `Home delivery ${s.online_area}` : 'Home delivery', b: 'FREE Delivery', d: `On orders above ${rs(paise(s.online_free_delivery_above))}`, href: '#cats', go: 'Start Shopping' });
  }
  if (count('exotics')) list.push({ theme: 'exotic', deco: 'star', photo: ph('exotics'), pics: 'exotics', k: 'Try something new', b: 'Exotic Picks', d: 'Kiwi, avocado, dragon fruit', href: '#sec=exotics', go: 'Explore' });
  if (count('staples')) list.push({ theme: 'grocery', deco: 'staples', photo: ph('grocery'), pics: 'staples', k: 'Monthly shopping', b: 'Atta, Rice, Dals & Masala', d: '', href: '#sec=staples', go: 'Shop Now' });
  if (s.loyalty_enabled === '1' && per) {
    list.push({ theme: 'loyalty', deco: 'star', photo: ph('snacks') || ph('dairy'), k: 'Loyalty points', b: `Earn ${per} point${per === 1 ? '' : 's'}`, d: 'On every ₹100 you spend', href: S.me ? '#account' : '#signup', go: S.me ? 'My Points' : 'Join Now' });
  }
  return list.slice(0, 7);
}
// a banner on a photo, or a colour design that gets real product photos once they load, or one of the shop's slides (picture only)
const bnrHtml = (b, i) => (b.art ? `<a class="bnr art" href="${b.href}" aria-label="${esc(b.alt)}"><img class="bnr-img" src="${esc(b.photo)}"${b.small
  ? ` srcset="${esc(b.small)} 640w, ${esc(b.photo)} 1280w" sizes="(min-width: 1000px) 50vw, 100vw"` : ''} alt="${esc(b.alt)}" width="1280" height="588" decoding="async"${i ? ' loading="lazy"' : ' fetchpriority="high"'}></a>`
  : `<a class="bnr ${b.photo ? `photo ${b.tone === 'light' ? 'light' : 'dark'}` : `type t-${b.theme}`}${b.fest ? ' fest' : ''}" ${b.href ? `href="${b.href}"` : ''} ${b.pics ? `data-pics="${b.pics}"` : ''}>
  ${b.photo ? `<img class="bnr-img" src="${esc(b.photo)}" alt="">` : `<div class="bnr-deco">${ico(b.deco || 'bag')}</div><div class="bnr-pics"></div>`}
  <div class="bnr-t">${b.badge ? `<span class="badge">${esc(b.badge)}</span>` : ''}${b.k ? `<span class="k">${esc(b.k)}</span>` : ''}${b.b ? `<b>${esc(b.b)}</b>` : ''}
    ${b.d ? `<span class="d">${esc(b.d)}</span>` : ''}${b.go ? `<span class="go">${esc(b.go)} ${ico('right')}</span>` : ''}</div></a>`);
// real product photos for a colour banner (packaged goods photographed by the shop or found by barcode)
function bannerPics(key, items) {
  const el = $(`.bnr.type[data-pics="${key}"]`);
  const pics = items.filter((i) => i.image).slice(0, 3);
  if (!el || pics.length < 2) return;
  $('.bnr-pics', el).innerHTML = pics.map((i) => `<img src="${esc(i.image)}" alt="">`).join('');
  el.classList.add('has-pics');
}
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
// "Search "Milk"" — the words change every few seconds
const HINTS = ['Milk', 'Tomato', 'Onion', 'Banana', 'Bread', 'Rice', 'Atta', 'Oil', 'Biscuits', 'Soap', 'Eggs', 'Chips'];
function rotateHint() {
  clearInterval(S.hintTimer);
  let i = 0;
  S.hintTimer = setInterval(() => {
    const el = $('.home-srch .ph-t');
    if (!el) { clearInterval(S.hintTimer); return; }
    i = (i + 1) % HINTS.length;
    el.classList.add('fade');
    setTimeout(() => { el.textContent = `Search "${HINTS[i]}"`; el.classList.remove('fade'); }, 180);
  }, 2600);
}
const tile = (sec, wide) => `<a class="tile${wide ? ' wide' : ''}" href="#sec=${sec.key}"><span class="ti">${secImg(sec.key)}</span><span class="tn">${esc(sec.name)}</span></a>`;
const groupTiles = (g) => {
  const list = S.info.sections.filter((s) => s.group === g.key);
  return list.length ? `<section class="sec grp"><h2 class="grp-h">${esc(g.name)}</h2><div class="tiles">${list.map((s, i) => tile(s, i === 0 && list.length % 4 !== 0)).join('')}</div></section>` : '';
};
const railSec = (id, title, href) => `<section class="sec" id="${id}" hidden>${secH(title)}<div class="rail"></div>${href ? seeAll(href) : ''}</section>`;

async function homeView() {
  S.page = 'home';
  const tok = ++S.tok;
  const live = () => tok === S.tok;
  const s = S.info.shop;
  const f = S.info.festival || {};
  const fphoto = f.photo || (has('b', `fest_${f.style}`) ? `/photos/b/fest_${f.style}.webp` : has('b', 'fest_generic') ? '/photos/b/fest_generic.webp' : '');
  const bl = banners();
  const stores = S.info.stores || [];
  void fphoto;
  const ns = nextSlot();
  view().innerHTML = `
    <div class="qhd"><button class="qhd-when" data-loc type="button" aria-label="Delivery or takeaway, and where">
        <span class="qhd-k">${S.mode === 'delivery' ? 'Home delivery' : 'Takeaway'}</span>
        <b class="qhd-t">${ns ? `${esc(ns.day)}, ${esc(ns.time)}` : 'No time slots open now'}</b>
        <span class="qhd-a">${ico(S.mode === 'delivery' ? 'pin' : 'store')}<span>${esc(addrShort())}</span>${ico('down')}</span></button>
      <div class="hd-btns"><button class="cbtn" type="button" data-ask aria-label="Ask the shop">${ico('chat')}</button>
        <a class="cbtn av-btn" href="#account" aria-label="Profile">${avatar()}</a></div></div>
    <div class="home-srch"><a class="srch" href="#search">${ico('search')}<span class="ph-t">Search "${HINTS[0]}"</span></a>
      ${canVoice() ? `<button class="mic-b" type="button" data-mic aria-label="Search by voice">${ico('mic')}</button>` : ''}</div>
    <div id="liveOrd"></div>
    ${instCard()}
    ${catStrip()}
    ${closedNote()}
    ${bl.length ? `<div class="bnr-wrap"><div class="bnrs${bl.some((b) => b.art) ? ' slides' : ''}" id="bnrs">${bl.map(bnrHtml).join('')}</div>
      ${bl.length > 1 ? `<div class="dots-tab">${bl.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</div>` : ''}
    ${railSec('secVeg', 'Fresh Vegetables', '#sec=veg')}
    ${railSec('secFruits', 'Fresh Fruits', '#sec=fruits')}
    ${railSec('secNew', 'New Launch', '#new')}
    ${railSec('secExotic', 'Exotics & Premium', '#sec=exotics')}
    ${stores.length ? `<section class="sec stores"><div class="st-tabs" role="tablist"><button class="on" data-st="0">${ico('flame')}<b>Trending</b></button>
      ${stores.map((n) => `<button data-st="${n}"><b>₹${n}</b><span>Store</span></button>`).join('')}</div>
      <div class="page"><div class="grid g3" id="stGrid"></div></div><a class="see-all" id="stAll" href="#trending">See All ${ico('right')}</a></section>` : ''}
    ${railSec('secFest', f.name || 'Festival offers', '#offers')}
    ${railSec('secSuggest', 'Suggested for you', '')}
    ${railSec('secAgain', 'Buy again', '')}
    <div class="groups">${(S.info.groups || []).map(groupTiles).join('')}</div>
    <section class="sec">${secH('More for you')}<div class="page"><div id="feed"></div></div></section>`;
  carousel();
  rotateHint();
  drawBars();
  drawLive();
  bindInstall(view());
  const PICS = { secVeg: 'veg', secFruits: 'fruits', secExotic: 'exotics', secFest: 'offers' };
  const fillRail = (id, items) => {
    const sec = live() && $(`#${id}`);
    if (!sec) return;
    sec.hidden = !items.length;
    if (!items.length) return;
    $('.rail', sec).innerHTML = remember(items).map(card).join('');
    if (PICS[id]) bannerPics(PICS[id], items);
  };
  let store = 0;
  const storeGrid = (items) => {
    if (live() && $('#stGrid')) $('#stGrid').innerHTML = remember(items).map(card).join('') || '<p class="mut small">Nothing in this store right now.</p>';
  };
  let feedFirst = true;
  const fill = (d, fresh) => {
    if (!live() || !d || !d.rails) return;
    const r = d.rails;
    fillRail('secVeg', r.veg || []);
    fillRail('secFruits', r.fruits || []);
    fillRail('secNew', r.fresh || []);
    fillRail('secExotic', r.exotics || []);
    fillRail('secFest', r.offers || []);
    if ((r.staples || []).length) bannerPics('staples', remember(r.staples));
    if (fresh) { fillRail('secSuggest', d.suggest || []); fillRail('secAgain', d.again || []); }
    if (stores.length && !store) storeGrid(r.trend || []);
    // the "More for you" grid: started from this first page; a fresher first page replaces it until the customer loads more
    const feed = $('#feed');
    if (feed && r.feed && (feedFirst || $$('.pc', feed).length <= 20)) {
      feedFirst = false;
      results(feed, { sort: 'popular' }, { limit: 20, seed: r.feed });
    }
  };
  if (stores.length) {
    const showStore = async (n) => {
      store = n;
      $$('.st-tabs button').forEach((b) => b.classList.toggle('on', Number(b.dataset.st) === n));
      $('#stAll').href = n ? `#store=${n}` : '#trending';
      $('#stAll').innerHTML = `${n ? `See all in ₹${n} Store` : 'See all trending'} ${ico('right')}`;
      if (!n && S.homeRails) { storeGrid(S.homeRails.trend || []); return; }
      const { items } = await get(`/items?${new URLSearchParams({ sort: 'popular', limit: 6, instock: '1', ...(n ? { max_price: n } : {}) })}`);
      if (store === n) storeGrid(items);
    };
    $$('.st-tabs button').forEach((b) => b.addEventListener('click', () => showStore(Number(b.dataset.st)).catch(() => {})));
  }
  const saved = LS.get(HOME_KEY, null);
  if (saved && saved.rails) { S.homeRails = saved.rails; fill(saved, false); } else {
    // first visit: grey outlines where the products will be
    for (const id of ['secVeg', 'secFruits']) { const sec = $(`#${id}`); if (sec) { sec.hidden = false; $('.rail', sec).innerHTML = skelCards(5); } }
    if ($('#stGrid')) $('#stGrid').innerHTML = skelCards(3);
  }
  try {
    const d = await get('/home');
    if (!live()) return;
    S.homeRails = d.rails;
    try { LS.set(HOME_KEY, { rails: d.rails, at: Date.now() }); } catch (_) { /* storage full */ }
    fill(d, true);
  } catch (_) {
    if (!saved) for (const id of ['secVeg', 'secFruits']) { const sec = $(`#${id}`); if (sec && $('.sk-pc', sec)) sec.hidden = true; }
  }
}

// ------------------------------------------------------------------ categories, sections, price stores, lists, search
function catsView() {
  S.page = 'cats';
  ++S.tok;
  view().innerHTML = `${appbar('All Categories', `<a class="ab-btn" href="#saved" aria-label="Wishlist">${ico('heart')}</a><a class="ab-btn" href="#search" aria-label="Search">${ico('search')}</a>`)}${closedNote()}
    <div class="groups">${(S.info.groups || []).map(groupTiles).join('')}</div>`;
}

function chipsHtml({ sec = '', offersFixed = false, rail = false } = {}) {
  const here = S.info.sections.find((x) => x.key === sec);
  const sibs = rail ? [] : S.info.sections.filter((x) => (here ? x.group === here.group : true) && x.key !== sec).slice(0, 14);
  return `<div class="chips"><button class="chip ic" data-sort aria-label="Sort and filter">${ico('sliders')}</button>
    <button class="chip" data-sort>${ico('sort')}${esc(SORTS[S.sort])}</button>
    ${offersFixed ? '' : `<button class="chip ${S.only === 'offers' ? 'on' : ''}" data-tog="only">${ico('tag')}Offers</button>`}
    ${sibs.map((x) => `<a class="chip" href="#sec=${x.key}">${esc(x.name)}</a>`).join('')}</div>`;
}
function bindChips(rerun, opts = {}) {
  $$('[data-sort]').forEach((b) => b.addEventListener('click', () => sortSheet(rerun, opts)));
  $$('[data-tog]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tog === 'only') S.only = S.only ? '' : 'offers'; else S.instock = !S.instock;
    rerun();
  }));
}
function redrawChips(opts) { const old = $('.chips'); if (old) old.outerHTML = chipsHtml(opts); }

// one page for a section, a price store, offers, new products, trending, the wishlist or an old shop category
async function listView({ sec = '', cat = '', only = '', saved = false, store = 0, fresh = false, trending = false }) {
  S.page = 'list';
  const section = S.info.sections.find((x) => x.key === sec);
  const c = S.info.cats.find((x) => String(x.id) === String(cat));
  const f = S.info.festival || {};
  const title = section ? section.name : c ? c.name : store ? `₹${store} Store` : only ? (f.name || 'Offers') : saved ? 'Your Wishlist' : fresh ? 'New Launch' : trending ? 'Trending' : 'Products';
  const sibs = section ? S.info.sections.filter((x) => x.group === section.group) : [];
  const rail = sibs.length > 1;
  const opts = { sec, offersFixed: !!only, rail };
  const params = { ...(sec ? { sec } : {}), ...(cat ? { cat } : {}), ...(only ? { only, sort: 'offers' } : {}), ...(store ? { max_price: store } : {}),
    ...(fresh ? { fresh: 1, sort: 'new' } : {}) };
  view().innerHTML = `${appbar(title, `<a class="ab-btn" href="#search" aria-label="Search">${ico('search')}</a>`)}${closedNote()}
    ${rail ? `<div class="sec-split"><nav class="sec-rail" aria-label="More in this group">${sibs.map((x) => `<a href="#sec=${x.key}" class="${x.key === sec ? 'on' : ''}"${x.key === sec ? ' aria-current="page"' : ''}>
        <span class="sr-i">${secImg(x.key)}</span><span class="sr-n">${esc(shortSec(x.name))}</span></a>`).join('')}</nav>
      <div class="sec-main">${chipsHtml(opts)}<div class="res-h"><span data-count></span></div><div id="res"></div></div></div>`
    : `<div class="page">${saved ? '' : chipsHtml(opts)}<div class="res-h">${store ? `<span class="mut small">Everything up to ₹${store}</span>` : ''}<span data-count></span></div><div id="res"></div></div>`}`;
  drawBars();
  if (saved) {
    const ids = [...S.fav].slice(0, 60);
    if (!ids.length) { $('#res').innerHTML = emptyState('red-heart', 'Your wishlist is empty', 'Tap the heart on any product to keep it here.', '<a class="btn-o" href="#">Start shopping</a>'); return; }
    await results($('#res'), { ids: ids.join(',') }, { auto: false, limit: 60 });
    return;
  }
  const rerun = () => { redrawChips(opts); bindChips(rerun, opts); results($('#res'), params).catch((e) => toast(e.message)); };
  bindChips(rerun, opts);
  await results($('#res'), params);
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
      ${canVoice() ? `<button type="button" class="srch-f" data-mic aria-label="Search by voice">${ico('mic')}</button>` : ''}
      ${'BarcodeDetector' in window ? `<button type="button" class="srch-f" id="scanB" aria-label="Scan a barcode">${ico('scan')}</button>` : ''}</label></div>
    <div class="appbar pc-only"><h1 id="sTitle">Search</h1></div>${closedNote()}
    <div class="page">${chipsHtml()}<button class="ask-row" type="button" data-ask>${ico('chat')}<span><b>Can't find it? Ask the shop</b>
      <span>Tamil or English · answers from today's stock</span></span>${ico('right')}</button><div id="sres"></div></div>`;
  drawBars();
  const run = async (v) => {
    v = String(v || '').trim();
    const box = $('#sres');
    if (!box) return;
    if ($('#sTitle')) $('#sTitle').textContent = code ? 'Scanned product' : v ? `Results for “${v}”` : 'Search';
    if (!v && !code) {
      box.innerHTML = `${S.recent.length ? `<div class="res-h"><h2>Recent searches</h2><button class="small mut" id="clr" type="button">Clear</button></div>
        <div class="recent">${S.recent.map((r) => `<a href="#q=${encodeURIComponent(r)}">${ico('clock')}${esc(r)}</a>`).join('')}</div>` : ''}
        <div class="res-h"><h2>Popular categories</h2></div><div class="circ-row">${S.info.sections.slice(0, 12).map((x) => `<a class="circ" href="#sec=${x.key}"><span class="circ-i">${secImg(x.key)}</span><span class="circ-n">${esc(x.name)}</span></a>`).join('')}</div>
        <div class="res-h"><h2>Trending now</h2><span data-count></span></div><div id="sgrid"></div>`;
      if ($('#clr')) $('#clr').addEventListener('click', () => { S.recent = []; LS.set('mpc_recent', []); run(''); });
      await results($('#sgrid'), { sort: 'popular' });
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
  if (!it) {
    view().innerHTML = `${appbar('Details')}<div class="page">${emptyState('package', 'Sold out right now', 'This product is not available at the moment. Please check again later.', '<a class="btn-g" href="#" style="display:inline-flex;max-width:260px">Continue shopping</a>')}</div>`;
    return;
  }
  if (tok !== S.tok) return;
  const s = S.info.shop;
  const sv = saving(it);
  let q = S.cart[it.id] || step(it);
  const attrs = [
    it.cat ? ['Category', esc(it.cat)] : null,
    it.unit === 'kg' ? null : ['Sold by', 'Piece'],
    it.mrp && Number(it.mrp) > Number(it.price) ? ['MRP', rs(paise(it.mrp))] : null,
    sv ? ['You save', `${rs(sv.off)} (${sv.pct}%)`] : null,
    it.offer_to ? ['Offer price till', fmtDate(it.offer_to)] : null,
  ].filter(Boolean);
  const low = lowLeft(it);
  const ns = nextSlot();
  const free = paise(s.online_free_delivery_above);
  const dc = paise(s.online_delivery_charge);
  const W = it.unit === 'kg' ? [0.25, 0.5, 1, 2].filter((w) => w <= Number(it.available)) : [];
  view().innerHTML = `<div class="det">${appbar('Details', `<button class="ab-btn" id="shareB" aria-label="Share">${ico('share')}</button>
      <button class="ab-btn ab-fav ${S.fav.has(it.id) ? 'on' : ''}" data-fav="${it.id}" aria-label="Wishlist">${ico('heart')}</button>`)}
    <div class="det-cols"><div class="det-img">${pic(it)}</div>
    <div class="det-sheet">
      <div class="det-top"><div class="det-name"><h2>${esc(nice(it.name))}</h2>${it.name_ta ? `<div class="ta">${esc(it.name_ta)}</div>` : ''}</div>
        <div class="det-pr"><b>${rs(paise(it.price))}${it.unit === 'kg' ? '<small>/kg</small>' : ''}</b>${sv ? `<s>${rs(paise(sv.was))}</s>` : ''}
          <span class="${it.in_stock ? (low ? 'lowt' : '') : 'bad'}">${it.in_stock ? (low || 'In stock') : 'Sold out'}</span></div></div>
      ${sv && sv.off >= 100 ? `<div class="det-off">${rs(sv.off)} OFF · ${sv.pct}% saving</div>` : ''}
      ${W.length > 1 ? `<div class="wchips" role="group" aria-label="Choose the weight">${W.map((w) => `<button type="button" data-w="${w}" class="${q === w ? 'on' : ''}" aria-pressed="${q === w}">
        <b>${fmtQ(w, it)}</b><span>${rs(lineP(it, w))}</span></button>`).join('')}</div>` : ''}
      <div class="det-dl">${ico('clock')}<span><b>${S.mode === 'delivery' ? 'Delivery' : 'Pickup'} ${ns ? `${esc(ns.day.toLowerCase())}, ${esc(ns.time)}` : 'when the shop opens'}</b>
        <small>${S.mode === 'delivery' ? (dc ? (free ? `Free delivery above ${rs(free)}` : `Delivery ${rs(dc)}`) : 'Free delivery') : `Collect at the counter${s.address ? ` · ${esc(s.address)}` : ''}`}</small></span></div>
      <p class="det-desc">${esc(detailText(it))}</p>
      <dl class="det-attr">${attrs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <div class="det-bar" id="detBar"></div>
      <section class="sec">${secH('People also ordered', it.cat_id ? `#cat=${it.cat_id}` : '')}<div class="rail" id="similar"><span class="mut small">Loading…</span></div></section>
    </div></div></div>`;
  drawBars();
  $$('[data-w]').forEach((b) => b.addEventListener('click', () => { q = Number(b.dataset.w); S.detBar(); }));
  S.detBar = () => {
    const bar = $('#detBar');
    if (!bar) return;
    $$('[data-w]').forEach((b) => { const on = Number(b.dataset.w) === q; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
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

// ------------------------------------------------------------------ addresses (used by the basket and the profile)
const addrLine = (a) => [a.address, a.landmark && `Landmark: ${a.landmark}`, a.pincode].filter(Boolean).join(', ');
const addrIcon = (l) => (l === 'Work' ? 'briefcase' : l === 'Other' ? 'pin' : 'home');
async function loadAddresses(force = false) {
  if (!S.me) { S.addresses = []; return []; }
  if (!S.addresses || force) S.addresses = (await get('/account/addresses')).addresses;
  return S.addresses;
}
function addressSheet(a = {}, onSaved = () => {}) {
  const c = sheet(`<h2>${a.id ? 'Edit address' : 'Add a new address'}</h2><form>
    <div class="seg3">${['Home', 'Work', 'Other'].map((l) => `<label class="${(a.label || 'Home') === l ? 'on' : ''}"><input type="radio" name="label" value="${l}" ${(a.label || 'Home') === l ? 'checked' : ''}>${ico(addrIcon(l))}${l}</label>`).join('')}</div>
    <div class="field"><label>House / flat number, street and area</label><textarea name="address" rows="2" required>${esc(a.address || '')}</textarea></div>
    <div class="field"><label>Landmark (optional)</label><input name="landmark" value="${esc(a.landmark || '')}" placeholder="Near the temple, opposite the school…"></div>
    <div class="field"><label>PIN code (optional)</label><input name="pincode" inputmode="numeric" maxlength="6" value="${esc(a.pincode || '')}"></div>
    <label class="show"><input type="checkbox" name="make_default" ${a.is_default || !(S.addresses || []).length ? 'checked' : ''}> Use as my default address</label>
    <div class="perr"></div><button class="btn-g wide" style="margin-top:12px">Save address</button></form>`);
  $$('.seg3 input', c).forEach((r) => r.addEventListener('change', () => $$('.seg3 label', c).forEach((l) => l.classList.toggle('on', $('input', l).checked))));
  $('form', c).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await post('/account/addresses', { id: a.id, label: f.label.value, address: f.address.value, landmark: f.landmark.value, pincode: f.pincode.value, make_default: f.make_default.checked });
      S.addresses = r.addresses;
      const acct = await get('/account'); S.me = acct.me;
      closeSheet(); toast('Address saved'); onSaved(r.id);
    } catch (ex) { $('.perr', c).innerHTML = `<div class="err">${esc(ex.message)}</div>`; }
  });
}

// ------------------------------------------------------------------ basket and checkout
// Prices and availability of the basket always come from the shop. Products that sold out meanwhile leave the basket.
async function refreshCart() {
  const ids = Object.keys(S.cart);
  if (!ids.length) return [];
  let gone = [];
  try {
    const { items } = await get(`/items?ids=${ids.join(',')}`);
    for (const id of ids) S.items.delete(Number(id));
    remember(items);
    gone = ids.filter((id) => !S.items.has(Number(id)));
    for (const id of gone) delete S.cart[id];
    for (const it of items) if (S.cart[it.id] > Number(it.available)) S.cart[it.id] = Number(it.available);
    saveCart();
    if (gone.length) toast(`${gone.length} item${gone.length === 1 ? ' is' : 's are'} sold out and left your basket`);
  } catch (_) { /* shown later */ }
  return gone;
}
const SUBS = { call: 'Call me', replace: 'Replace with similar', remove: 'Remove it' };
const DROPS = ['Call when you arrive', 'Leave at the gate', 'Leave with security', 'Do not ring the bell'];
function timeSheet() {
  const days = S.info.slots || [];
  if (!days.length) return;
  let di = Math.max(0, days.findIndex((d) => d.slots.some((x) => x.v === S.slot)));
  const draw = () => {
    const c = sheet(`<h2>Choose a ${S.mode === 'delivery' ? 'delivery' : 'pickup'} time</h2>
      <div class="days">${days.map((d, i) => `<button type="button" data-day="${i}" class="${i === di ? 'on' : ''}">${esc(dayName(d))}</button>`).join('')}</div>
      <div class="slots">${days[di].slots.map((x) => `<button type="button" data-slot="${x.v}" class="${x.v === S.slot ? 'on' : ''}">${esc(x.l)}</button>`).join('')}</div>`);
    $$('[data-day]', c).forEach((b) => b.addEventListener('click', () => { di = Number(b.dataset.day); draw(); }));
    $$('[data-slot]', c).forEach((b) => b.addEventListener('click', () => { S.slot = b.dataset.slot; closeSheet(); cartView(); }));
  };
  draw();
}
function addrPicker() {
  const addrs = S.addresses || [];
  const c = sheet(`<h2>Deliver to</h2>${addrs.map((a) => `<label class="addr ${a.id === S.addrId ? 'on' : ''}"><input type="radio" name="addrPick" value="${a.id}" ${a.id === S.addrId ? 'checked' : ''}>
      <span class="ai">${ico(addrIcon(a.label))}</span><span class="at"><b>${esc(a.label)}${a.is_default ? ' <span class="pill">Default</span>' : ''}</b><span>${esc(addrLine(a))}</span></span></label>`).join('')}
    <button type="button" class="add-more" id="newAddr2" style="width:100%">${ico('plus')}Add a new address</button>`);
  $$('[name=addrPick]', c).forEach((r) => r.addEventListener('change', () => { S.addrId = Number(r.value); closeSheet(); cartView(); }));
  $('#newAddr2', c).addEventListener('click', () => addressSheet({}, (id) => { S.addrId = id; cartView(); }));
}
async function cartView() {
  S.page = 'cart';
  if (!S.cartChecked || Date.now() - S.cartChecked > 15000) { S.cartChecked = Date.now(); await refreshCart(); if (S.page !== 'cart') return; }
  const s = S.info.shop;
  const lines = Object.entries(S.cart).map(([id, q]) => [S.items.get(Number(id)), q]).filter(([it]) => it);
  if (!lines.length) {
    view().innerHTML = `${appbar('My Basket')}<div class="page">${emptyState('shopping-cart', 'Your basket is empty', 'Add fruits, vegetables and daily needs.', '<a class="btn-g" href="#" style="display:inline-flex;max-width:260px">Start shopping</a>')}</div>`;
    drawBars();
    return;
  }
  if (S.me && S.addresses === null) { try { await loadAddresses(); } catch (_) { S.addresses = []; } if (S.page !== 'cart') return; }
  const addrs = S.addresses || [];
  if (!addrs.some((a) => a.id === S.addrId)) S.addrId = (addrs.find((a) => a.is_default) || addrs[0] || {}).id || 0;
  const sel = addrs.find((a) => a.id === S.addrId);
  const c = cartSums();
  const dc = deliveryCharge(c.total);
  const minOrder = paise(s.online_min_order);
  const days = S.info.slots || [];
  const all = days.flatMap((d) => d.slots.map((x) => x.v));
  if (!all.includes(S.slot)) S.slot = all[0] || '';          // the earliest time is chosen; the customer can change it
  const per = Number(s.loyalty_points_per_100) || 0;
  const earn = s.loyalty_enabled === '1' ? Math.floor(Math.floor(c.total / 10000) * per) : 0;
  const short = S.me && S.mode === 'delivery' && c.total < minOrder ? minOrder - c.total : 0;   // below the delivery minimum
  const placeLabel = !S.me ? 'Log in to order' : short ? `Add ${rs(short)} more for delivery` : 'Place Order';
  const closed = s.online_enabled !== '1' || !!short || !S.slot;
  const free = paise(s.online_free_delivery_above);
  const both = s.online_delivery === '1' && s.online_pickup === '1';
  const where = S.mode === 'delivery'
    ? (!S.me ? '<p class="small mut" style="margin:0 0 8px">Log in to choose your delivery address.</p>'
      : sel ? `<div class="row-line">${ico(addrIcon(sel.label))}<span class="rl-t"><b>${esc(sel.label)}</b><small>${esc(addrLine(sel))}</small></span>
          <button type="button" class="link" id="chAddr">Change</button></div>`
        : `<div class="field"><label for="addrText">Delivery address with landmark</label><textarea id="addrText" rows="2">${esc(S.me.address || '')}</textarea></div>`)
    : `<div class="row-line">${ico('store')}<span class="rl-t"><b>Collect at the counter</b><small>${esc(s.address || s.name)}</small></span></div>`;
  view().innerHTML = `${appbar('My Basket', `<button class="ab-btn" id="clearB" aria-label="Empty the basket">${ico('trash')}</button>`)}${closedNote()}
    <div class="page"><div class="cart-cols"><div class="main-col">
    ${both ? `<div class="seg2" role="group" aria-label="Delivery or takeaway">
      <button type="button" data-mode="delivery" class="${S.mode === 'delivery' ? 'on' : ''}" aria-pressed="${S.mode === 'delivery'}">${ico('scooter')}Home delivery</button>
      <button type="button" data-mode="pickup" class="${S.mode === 'pickup' ? 'on' : ''}" aria-pressed="${S.mode === 'pickup'}">${ico('bag')}Takeaway</button></div>` : ''}
    ${S.mode === 'delivery' && free ? `<div class="free-bar"><div>${c.total >= free ? '<b>Yay! FREE delivery on this order</b>' : `Add <b>${rs(free - c.total)}</b> more for <b>FREE delivery</b>`}</div>
      <i><u style="width:${Math.min(100, Math.round(c.total * 100 / free))}%"></u></i></div>` : ''}
    <div class="box"><h3>${c.n} item${c.n === 1 ? '' : 's'} in your basket</h3>
      ${lines.map(([it, q]) => `<div class="cl" data-pid="${it.id}"><a class="ce" href="#p=${it.id}">${pic(it)}</a>
        <div class="cm"><b>${esc(nice(it.name))}</b><span>${rs(paise(it.price))}${it.unit === 'kg' ? '/kg · weighed when packed' : ' each'}</span><span class="lt">${rs(lineP(it, q))}</span></div>
        <div class="qpill"><button data-d="-1" class="${q <= step(it) ? 'del' : ''}" aria-label="${q <= step(it) ? 'Remove' : 'Less'}">${ico(q <= step(it) ? 'trash' : 'minus')}</button>
          <b>${fmtQ(q, it)}</b><button data-d="1" aria-label="More">${ico('plus')}</button></div></div>`).join('')}
      <a class="add-more" href="#">${ico('plus')}Add more items</a></div>
    <div class="box"><h3>${S.mode === 'delivery' ? 'Delivery' : 'Takeaway'}</h3>${where}
      <div class="row-line">${ico('clock')}<span class="rl-t"><b>${S.slot ? esc(slotText(S.slot)) : 'No time slots open now'}</b>
        <small>${S.mode === 'delivery' ? 'Delivery time' : 'Pickup time'}</small></span>${days.length ? '<button type="button" class="link" id="chTime">Change</button>' : ''}</div></div>
    <div class="box"><h3>If an item is not available</h3>
      <div class="pref" role="radiogroup" aria-label="If an item is not available">${Object.entries(SUBS).map(([k, l]) => `<label class="${S.sub === k ? 'on' : ''}">
        <input type="radio" name="sub" value="${k}" ${S.sub === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <p class="small mut" style="margin:10px 0 0">The shop does this while packing. You never pay for an item you did not get.</p></div>
    ${S.mode === 'delivery' ? `<div class="box"><h3>Notes for the delivery person</h3><div class="drop">${DROPS.map((d) => `<button type="button" data-drop="${esc(d)}"
      class="${S.drop.includes(d) ? 'on' : ''}" aria-pressed="${S.drop.includes(d)}">${esc(d)}</button>`).join('')}</div></div>` : ''}
    <div class="box"><h3>How will you pay?</h3>
      <div class="paych" role="radiogroup" aria-label="Payment">
      <label class="pch pch-cash ${S.pay === 'cash' ? 'on' : ''}"><input type="radio" name="pay" value="cash" ${S.pay === 'cash' ? 'checked' : ''}><span class="pci">${ico('cash')}</span>
        <b>${S.mode === 'delivery' ? 'Cash on delivery' : 'Pay at pickup'}</b><span>Cash or UPI when you ${S.mode === 'delivery' ? 'receive the order' : 'collect it'}</span><i class="pck">${ico('check')}</i></label>
      <label class="pch pch-upi ${S.pay === 'upi' ? 'on' : ''}"><input type="radio" name="pay" value="upi" ${S.pay === 'upi' ? 'checked' : ''}><span class="pci">${ico('qr')}</span>
        <b>Pay now by UPI</b><span>GPay, PhonePe, Paytm${s.upi_id ? ` · ${esc(s.upi_id)}` : ''}: scan the QR after placing the order</span><i class="pck">${ico('check')}</i></label></div></div>
    <div class="box"><div class="field" style="margin:0"><label for="noteF">Note for the shop (optional)</label>
      <input id="noteF" placeholder="e.g. ripe bananas, small tomatoes" value="${esc(S.note)}" maxlength="300"></div>
      <input id="hpF" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true"><div id="oerr"></div></div>
    ${S.me ? '' : `<div class="box"><h3>Log in to place your order</h3><p class="small mut" style="margin-top:-6px">Your mobile number is your login. New here? Sign up in a minute.</p>
      <div style="display:flex;gap:10px"><a class="btn-g" href="#login" data-after="#cart">Log in</a><a class="btn-o" href="#signup" data-after="#cart" style="flex:1">Sign up</a></div></div>`}
    </div><div class="side">
    <div class="box"><h3>Bill details</h3>
      <div class="bill-row"><span>Items total</span><span>${rs(c.total)}</span></div>
      ${S.mode === 'delivery' ? `<div class="bill-row"><span>Delivery charge</span><span>${dc ? rs(dc) : '<b class="okc">FREE</b>'}</span></div>` : ''}
      <div class="bill-row total"><span>To pay (approx.)</span><span>${rs(c.total + dc)}</span></div>
      ${c.saved > 0 ? `<div class="save-strip">You save ${rs(c.saved)} on this order</div>` : ''}
      ${earn > 0 ? `<p class="small okc" style="margin:10px 0 0">You earn about ${earn} loyalty point${earn === 1 ? '' : 's'}${S.me && Number(S.me.points) ? ` (you have ${Number(S.me.points)})` : ''}.</p>` : ''}
      ${S.mode === 'delivery' && c.total < minOrder ? `<div class="err">Minimum order for delivery is ${rs(minOrder)}. Add ${rs(minOrder - c.total)} more, or choose takeaway.</div>` : ''}
      <p class="small mut" style="margin:10px 0 0">Weighed items are billed at the exact weight. The shop confirms on WhatsApp.</p>
      <div class="place" style="margin-top:14px"><button class="btn-g wide" data-place ${closed ? 'disabled' : ''}>${short ? placeLabel : `${placeLabel} - ${rs(c.total + dc)}`}</button></div></div>
    </div></div></div>
    <div class="cart-bar"><div class="tot"><span>To pay</span><b>${rs(c.total + dc)}</b></div><button class="btn-g" data-place ${closed ? 'disabled' : ''}>${placeLabel}</button></div>`;
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  if ($('#chTime')) $('#chTime').addEventListener('click', timeSheet);
  if ($('#chAddr')) $('#chAddr').addEventListener('click', addrPicker);
  $$('[name=sub]').forEach((r) => r.addEventListener('change', () => { S.sub = r.value; LS.set('mpc_sub', S.sub); $$('.pref label').forEach((l) => l.classList.toggle('on', $('input', l).checked)); }));
  $$('[data-drop]').forEach((b) => b.addEventListener('click', () => {
    const d = b.dataset.drop;
    S.drop = S.drop.includes(d) ? S.drop.filter((x) => x !== d) : [...S.drop, d];
    LS.set('mpc_drop', S.drop);
    b.classList.toggle('on'); b.setAttribute('aria-pressed', String(S.drop.includes(d)));
  }));
  $('#noteF').addEventListener('input', (e) => { S.note = e.target.value; });
  $$('[name=pay]').forEach((r) => r.addEventListener('change', () => { S.pay = r.value; LS.set('mpc_pay', S.pay); $$('label.pch').forEach((l) => l.classList.toggle('on', $('input', l).checked)); }));
  $$('[data-place]').forEach((b) => b.addEventListener('click', placeOrder));
  $('#clearB').addEventListener('click', () => { if (confirm('Remove everything from the basket?')) { S.cart = {}; saveCart(); cartView(); } });
  drawBars();
}

async function placeOrder() {
  if (!S.me) { S.after = '#cart'; location.hash = '#login'; return; }
  const err = $('#oerr');
  if (err) err.innerHTML = '';
  const fail = (m) => { if (err) { err.innerHTML = `<div class="err">${esc(m)}</div>`; err.scrollIntoView({ behavior: 'smooth', block: 'center' }); } else toast(m); };
  if (!S.slot) { fail(`No ${S.mode === 'delivery' ? 'delivery' : 'pickup'} times are open now. Please try again later.`); return; }
  const typed = $('#addrText') ? $('#addrText').value.replace(/\s+/g, ' ').trim() : '';
  if (S.mode === 'delivery' && !S.addrId && typed.length < 10) { fail('Please enter the full delivery address with a landmark.'); return; }
  const lines = Object.entries(S.cart).map(([id, q]) => ({ id: Number(id), qty: String(q) }));
  const body = { mode: S.mode, slot: S.slot, name: S.me.name, address: typed, address_id: S.mode === 'delivery' ? S.addrId || 0 : 0,
    notes: S.note, pay: S.pay, website: ($('#hpF') || {}).value || '', lines, sub_pref: S.sub, drop_note: S.mode === 'delivery' ? S.drop.join('; ') : '' };
  const btns = $$('[data-place]');
  btns.forEach((b) => { b.disabled = true; b.textContent = 'Placing order…'; });
  try {
    const r = await fetch('/api/shop/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json();
    if (r.status === 401) { S.me = null; S.after = '#cart'; location.hash = '#login'; return; }
    if (r.status === 409) {                         // something sold out a moment ago: show the basket as it is now
      toast(d.error);
      S.cartChecked = 0;
      await cartView();
      if ($('#oerr')) $('#oerr').innerHTML = `<div class="err">${esc(d.error)}</div>`;
      return;
    }
    if (!d.ok) throw new Error(d.error);
    if (typed && !body.address_id) {               // the first address typed here is kept for next time
      try { S.addresses = (await post('/account/addresses', { address: typed, make_default: true })).addresses; } catch (_) { /* kept on the order anyway */ }
    }
    const mine = LS.get('mpc_orders', []);
    mine.unshift({ n: d.number, t: d.token, at: new Date().toISOString() });
    LS.set('mpc_orders', mine.slice(0, 15));
    S.cart = {}; S.slot = ''; S.note = ''; S.active += 1; saveCart();
    location.hash = `#o=${d.token}`;
    loadActive();
  } catch (e) {
    fail(e.message || 'Please try again.');
    btns.forEach((b) => { b.disabled = false; b.textContent = 'Place Order'; });
  }
}

// ------------------------------------------------------------------ your orders and tracking
const OPEN = ['new', 'accepted', 'packing', 'ready', 'out'];
const ORDER_ART = { new: 'package', accepted: 'shopping-bags', packing: 'shopping-bags', ready: 'shopping-bags', out: 'motor-scooter', done: 'party-popper', cancelled: 'package' };
const statusPill = (st) => `<span class="pill ${st === 'cancelled' ? 'red' : st === 'done' ? 'grey' : ''}">${st === 'done' ? 'Delivered / collected' : st === 'cancelled' ? 'Cancelled' : 'In progress'}</span>`;
const orderCard = (o) => `<div class="box ocard"><a class="oc-top" href="#o=${o.token}"><img src="${FE(ORDER_ART[o.status] || 'package')}" alt="">
    <span class="oc-t"><b>Order ${esc(o.number)}</b>${statusPill(o.status)}<span class="or-s">${o.mode === 'delivery' ? 'Home delivery' : 'Takeaway'} · ${esc(o.slot_label)}</span></span>
    <span class="oc-a">${rs(paise(o.bill_total || o.est_total))}${ico('right')}</span></a>
  ${o.items && o.items.length ? `<div class="oc-items">${o.items.map((l) => `<span class="ce">${pic(l)}</span>`).join('')}${o.count > o.items.length ? `<span class="oc-more">+${o.count - o.items.length}</span>` : ''}</div>` : ''}
  ${o.token ? `<div class="oc-btns"><a class="btn-o sm" href="#o=${o.token}">Details</a><button class="btn-g sm" data-reorder="${o.token}">${ico('undo')}Order again</button></div>` : ''}</div>`;
async function reorder(token) {
  const { order: o } = await get(`/track/${token}`);
  const ids = o.lines.map((l) => l.id).filter(Boolean);
  if (!ids.length) { toast('These items are not available now'); return; }
  const { items } = await get(`/items?ids=${ids.join(',')}`);
  remember(items);
  let added = 0;
  for (const l of o.lines) {
    const it = S.items.get(l.id);
    if (!it || !it.in_stock) continue;
    S.cart[it.id] = Math.min(Number(l.ordered || l.qty) || step(it), Number(it.available));
    added += 1;
  }
  saveCart();
  toast(added ? `${added} item${added === 1 ? '' : 's'} added to the basket` : 'These items are not available now');
  if (added) location.hash = '#cart';
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-reorder]'); if (b) { e.preventDefault(); reorder(b.dataset.reorder).catch((x) => toast(x.message)); } });

let olTimer;
async function ordersView(quiet = false) {
  if (quiet && (S.page !== 'orders' || !$('#olist'))) return;
  if (!quiet) {
    S.page = 'orders';
    view().innerHTML = `${appbar('Your Orders')}<div class="page narrow" id="olist"><div class="loading">Loading…</div></div>`;
    drawBars();
  }
  let orders;
  if (S.me) orders = (await get('/account/orders')).orders;
  else {
    const mine = LS.get('mpc_orders', []);
    orders = (await Promise.all(mine.map((m) => get(`/track/${m.t}`).then((r) => ({ ...r.order, token: m.t, items: r.order.lines.slice(0, 5), count: r.order.lines.length }))
      .catch(() => null)))).filter(Boolean);
  }
  if (S.page !== 'orders' || !$('#olist')) return;
  S.active = orders.filter((o) => OPEN.includes(o.status)).length;
  drawBars();
  const html = (orders.map(orderCard).join('') || emptyState('package', 'No orders yet', 'Your orders and their status show here.', '<a class="btn-g" href="#" style="display:inline-flex;max-width:260px">Start shopping</a>'))
    + (S.me ? '' : '<p class="small mut" style="text-align:center">Log in to see orders placed on other phones. <a class="okc" href="#login">Log in</a></p>');
  if (!quiet || S.olHtml !== html) { $('#olist').innerHTML = html; S.olHtml = html; }
  clearTimeout(olTimer);
  if (S.active) olTimer = setTimeout(() => { if (document.visibilityState === 'visible') ordersView(true).catch(() => {}); }, 15000);
}

let trackTimer;
const when = (v) => (v ? new Date(`${String(v).replace(' ', 'T')}+05:30`).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
async function trackView(token, quiet = false) {
  if (!quiet) S.page = 'track';
  const { order: o } = await get(`/track/${token}`);
  const again = () => {
    clearTimeout(trackTimer);
    if (OPEN.includes(o.status)) {
      trackTimer = setTimeout(() => {
        if (location.hash === `#o=${token}` && document.visibilityState === 'visible' && !(document.activeElement && document.activeElement.name === 'ref')) trackView(token, true).catch(() => {});
      }, 10000);
    }
  };
  if (quiet && (S.page !== 'track' || location.hash !== `#o=${token}`)) return;
  const sig = `${token}|${JSON.stringify([o.status, o.status_label, o.steps, o.agent, o.bill_no, o.bill_total, o.pay_ref, o.cod_due, o.can_cancel, o.invoice,
    o.lines.map((l) => [l.qty, l.note])])}`;
  if (quiet && S.trackSig === sig) { again(); return; }
  if (quiet && S.trackStatus && S.trackStatus !== `${token}|${o.status}`) { toast(`Order ${o.number}: ${o.status_label}`); if (!OPEN.includes(o.status)) loadActive(); }
  S.trackSig = sig;
  S.trackStatus = `${token}|${o.status}`;
  S.page = 'track';
  const s = S.info.shop;
  const amount = paise(o.bill_total || o.est_total);
  const upi = s.upi_id ? `upi://pay?${new URLSearchParams({ pa: s.upi_id, pn: s.name, am: (amount / 100).toFixed(2), cu: 'INR', tn: `Order ${o.number}` })}` : '';
  const payBox = o.mine && o.pay_pref === 'upi' && !['cancelled', 'done'].includes(o.status) ? `<div class="box paybox"><h3>${ico('qr')} Pay ${rs(amount)} by UPI</h3>
      ${S.info.upi_qr ? `<img class="qr" src="${esc(S.info.upi_qr)}" alt="Shop UPI QR code">` : ''}
      ${s.upi_id ? `<div class="upi-id">UPI ID: <b>${esc(s.upi_id)}</b> <button class="link" id="copyUpi" type="button">${ico('copy')}Copy</button></div>` : ''}
      ${upi ? `<a class="btn-g wide" href="${esc(upi)}">Pay in a UPI app</a>` : ''}
      ${!S.info.upi_qr && !s.upi_id ? '<p class="small mut">Please pay the shop by UPI when the order arrives.</p>' : ''}
      ${o.pay_ref ? `<p class="okc"><b>Payment number received: ${esc(o.pay_ref)}</b>. The shop checks it before packing.</p>`
    : `<form id="refF" class="field"><label>After paying, type the UPI transaction number (UTR) from your app</label>
        <div style="display:flex;gap:8px"><input name="ref" inputmode="text" placeholder="e.g. 431256789012" required><button class="btn-g sm">Send</button></div></form>`}
      <p class="small mut">Weighed items are billed at the exact weight; the shop settles any small difference.</p></div>` : '';
  const steps = (o.steps || []).map((st) => `<li class="${st.done ? 'done' : ''} ${st.current ? 'now' : ''}"><b>${esc(st.label)}</b>${st.at && st.done ? `<span>${esc(when(st.at))}</span>` : st.current ? '<span>In progress</span>' : ''}</li>`).join('');
  const agent = o.agent && o.status === 'out' ? `<div class="box agent"><span class="ag-i">${ico('scooter')}</span><div class="ag-t"><small>Your delivery person</small>
      <b>${esc(o.agent.name)}</b>${o.agent.at ? `<span class="small mut">Left the shop ${esc(when(o.agent.at))}</span>` : ''}
      ${o.agent.tracking ? `<span class="small">${o.agent.tracking_url ? `<a class="okc" href="${esc(o.agent.tracking_url)}" target="_blank" rel="noopener">Track the delivery</a>` : `Tracking: ${esc(o.agent.tracking)}`}</span>` : ''}</div>
      ${o.agent.phone ? `<a class="btn-o sm" href="tel:${esc(o.agent.phone)}">${ico('phone')}Call</a>` : ''}</div>` : '';
  const cod = o.cod_due && Number(o.cod_due) ? `<div class="notice">Cash on delivery: please keep <b>${rs(paise(o.cod_due))}</b> ready (cash or UPI).</div>` : '';
  const choices = o.mine && o.sub_label ? `<div class="box small choices"><div><b>If an item is not available:</b> ${esc(o.sub_label)}</div>
    ${o.drop_note ? `<div><b>Notes for the delivery person:</b> ${esc(o.drop_note)}</div>` : ''}${o.notes ? `<div><b>Note for the shop:</b> ${esc(o.notes)}</div>` : ''}</div>` : '';
  const cancel = o.can_cancel ? `<button class="btn-o wide cancel-o" id="cancelO" type="button">Cancel this order</button>
    <p class="small mut" style="text-align:center;margin:6px 0 14px">You can cancel until the shop bills your order.</p>` : '';
  const invoice = o.invoice ? `<a class="btn-g wide" href="/api/shop/account/orders/${encodeURIComponent(o.number)}/invoice" target="_blank" rel="noopener">${ico('down')}Download GST invoice</a>`
    : o.status === 'done' && !o.mine ? '<p class="small mut" style="text-align:center"><a class="okc" href="#login">Log in</a> to download the invoice.</p>' : '';
  view().innerHTML = `${appbar(`Order ${o.number}`)}<div class="page narrow">
    <div class="status-card ${o.status === 'cancelled' ? 'cancel' : ''}"><img src="${FE(ORDER_ART[o.status] || 'package')}" alt="">
      <div><div class="small">${o.mode === 'delivery' ? 'Home delivery' : 'Takeaway'} · ${esc(o.slot_label)}</div><div class="st">${esc(o.status_label)}</div>
      ${o.status === 'cancelled' && o.note ? `<div class="small">Reason: ${esc(o.note)}</div>` : ''}</div></div>
    ${payBox}${agent}${cod}
    ${o.status !== 'cancelled' && steps ? `<div class="box"><ol class="steps">${steps}</ol></div>` : ''}
    ${invoice}${choices}
    ${o.lines.some((l) => l.note) ? '<div class="notice">Some items were not available. They are not charged, and anything already paid for them is refunded.</div>' : ''}
    <div class="box"><h3>Items</h3>${o.lines.map((l) => `<div class="cl" ${l.note && !Number(l.qty) ? 'style="opacity:.55"' : ''}><span class="ce">${pic({ ...l })}</span>
      <div class="cm"><b>${esc(nice(l.name))}</b><span>${esc(l.qty)} ${l.unit === 'kg' ? 'kg' : 'pc'} × ${rs(paise(l.price))}</span>
      ${l.note ? `<span class="bad">${esc(l.note)}${l.ordered ? ` (you ordered ${esc(l.ordered)})` : ''}</span>` : ''}</div>
      <b>${rs(Math.round(paise(l.price) * Number(l.qty)))}</b></div>`).join('')}
      ${Number(o.delivery_charge) ? `<div class="bill-row"><span>Delivery charge</span><span>${rs(paise(o.delivery_charge))}</span></div>` : ''}
      <div class="bill-row total"><span>${o.bill_no ? `Bill ${esc(o.bill_no)}` : 'Approx. total'}</span><span>${rs(amount)}</span></div>
      ${o.address ? `<p class="small mut">${ico('pin')} ${esc(o.address)}</p>` : ''}
      ${!o.mine ? '<p class="small mut">Log in with the mobile number of this order to see the address and payment details.</p>' : ''}</div>
    <div class="box small">Questions? ${o.shop.phone ? `Call <a href="tel:${esc(o.shop.phone)}" class="okc"><b>${esc(o.shop.phone)}</b></a>` : 'Call the shop'} or see <a class="okc" href="#help">Help & support</a>.</div>
    <button class="btn-g wide" data-reorder="${esc(token)}">${ico('undo')}Order these items again</button>${cancel}</div>`;
  drawBars();
  if ($('#cancelO')) {
    $('#cancelO').addEventListener('click', async () => {
      if (!confirm(`Cancel order ${o.number}?`)) return;
      try { await post(`/track/${token}/cancel`, {}); toast('Your order is cancelled'); loadActive(); trackView(token); } catch (ex) { toast(ex.message); }
    });
  }
  if ($('#copyUpi')) $('#copyUpi').addEventListener('click', async () => { try { await navigator.clipboard.writeText(s.upi_id); toast('UPI ID copied'); } catch (_) { /* ignore */ } });
  if ($('#refF')) {
    $('#refF').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await post(`/track/${token}/payref`, { ref: e.target.ref.value }); toast('Thank you! The shop will check the payment.'); trackView(token); } catch (ex) { toast(ex.message); }
    });
  }
  again();
}
// back on the page (phone unlocked, tab opened again): the latest status at once
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const h = location.hash;
  if (h.startsWith('#o=') && S.page === 'track' && !(document.activeElement && document.activeElement.name === 'ref')) trackView(h.slice(3), true).catch(() => {});
  else if (S.page === 'orders') ordersView(true).catch(() => {});
});

// ------------------------------------------------------------------ "Ask the shop": answers from what is in stock now and your own orders
function askSheet(prefill = '') {
  const ai = !!(S.info && S.info.assistant && S.info.assistant.ai);
  const c = sheet(`<div class="ask-h"><h2>Ask the shop</h2><span class="ai-badge ${ai ? '' : 'off'}" title="Answers come from the shop's stock list and your orders">${ai ? 'AI helper' : 'Shop search'}</span></div>
    <p class="small mut">Ask about products, prices, offers or your orders. Only items in stock right now are suggested.</p>
    <div id="askLog" class="ask-log"></div>
    <form id="askF" class="ask-f"><input name="q" maxlength="300" placeholder="e.g. Do you have ripe bananas?" autocomplete="off" value="${esc(prefill)}" required>
      <button class="btn-g sm" aria-label="Ask">${ico('right')}</button></form>
    <div class="ask-chips">${['Fresh fruits today', 'Offers on rice', 'Where is my order?'].map((x) => `<button type="button" class="chip" data-askq="${esc(x)}">${esc(x)}</button>`).join('')}</div>`);
  const log = $('#askLog', c);
  const f = $('#askF', c);
  const ask = async (q) => {
    log.insertAdjacentHTML('beforeend', `<div class="ask-q">${esc(q)}</div><div class="ask-a wait">…</div>`);
    log.scrollTop = log.scrollHeight;
    const box = log.lastElementChild;
    try {
      const r = await post('/assistant', { q });
      remember(r.products);
      const badge = r.source === 'ai' ? '<span class="ai-badge sm">AI</span>' : '<span class="ai-badge sm off">Shop search</span>';
      const sup = r.support || {};
      box.className = 'ask-a';
      box.innerHTML = `${badge}<p>${esc(r.answer)}</p>
        ${r.products.length ? `<div class="rail ask-rail">${r.products.map(card).join('')}</div><p class="ask-src">From the shop's stock list: ${r.products.map((p) => esc(nice(p.name))).slice(0, 4).join(', ')}</p>` : ''}
        ${r.orders.length ? r.orders.map((o) => `<a class="btn-o sm" href="#o=${esc(o.token)}">Order ${esc(o.number)} · ${esc(o.status)}</a>`).join(' ') : ''}
        ${r.handoff ? `<div class="ask-human"><b>Talk to the shop</b>${sup.phone ? `<a class="btn-o sm" href="tel:${esc(sup.phone)}">${ico('phone')}Call</a>` : ''}
          ${sup.whatsapp ? `<a class="btn-g sm" target="_blank" rel="noopener" href="https://wa.me/91${esc(String(sup.whatsapp).replace(/\D/g, '').slice(-10))}?text=${encodeURIComponent(`Hello, ${q}`)}">${ico('chat')}WhatsApp</a>` : ''}</div>` : ''}`;
    } catch (e) {
      box.className = 'ask-a';
      box.innerHTML = `<p class="bad">${esc(e.message)}</p>`;
    }
    log.scrollTop = log.scrollHeight;
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); const q = f.q.value.trim(); if (q) { f.q.value = ''; ask(q); } });
  $$('[data-askq]', c).forEach((b) => b.addEventListener('click', () => ask(b.dataset.askq)));
  if (prefill) ask(prefill);
  setTimeout(() => f.q.focus(), 50);
}

// ------------------------------------------------------------------ account: log in, sign up (SMS code), forgot password
function authView(kind) {
  S.page = 'auth';
  const ref = LS.get('mpc_ref', '');
  const tabs = `<div class="auth-tabs"><a href="#login" class="${kind === 'login' ? 'on' : ''}">Log in</a><a href="#signup" class="${kind === 'signup' ? 'on' : ''}">Sign up</a></div>`;
  const forms = {
    login: `<form id="af"><div class="field"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="tel" required placeholder="10-digit mobile number"></div>
      <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
      <label class="show"><input type="checkbox" id="showpw"> Show password</label><div id="aerr"></div>
      <button class="btn-g">Log in</button><p class="small" style="text-align:center;margin-top:16px"><a href="#forgot" class="okc">Forgot password?</a></p></form>`,
    signup: `<form id="af"><div class="field"><label>Your name</label><input name="name" autocomplete="name" required></div>
      <div class="field"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="tel" required placeholder="10-digit mobile number"></div>
      <div class="field"><label>Create a password (at least 6 letters or numbers)</label><input name="password" type="password" autocomplete="new-password" required minlength="6"></div>
      <div class="field"><label>Referral code from a friend (optional)</label><input name="ref" value="${esc(ref)}" maxlength="12" autocapitalize="characters"></div>
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
    <div class="auth-head"><img src="/img/shop-icon-192.png?v=3" alt=""><h1>${kind === 'forgot' ? 'Forgot password' : kind === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
    <p>${esc(S.info.shop.name)}</p></div>${kind === 'forgot' ? '' : tabs}${forms[kind]}</div></div>`;
  drawBars();
  const f = $('#af');
  if (!f) return;
  const err = (m) => { $('#aerr').innerHTML = m ? `<div class="err">${esc(m)}</div>` : ''; };
  if ($('#showpw')) $('#showpw').addEventListener('change', (e) => { $$('[type=password],[data-pw]', f).forEach((i) => { i.dataset.pw = 1; i.type = e.target.checked ? 'text' : 'password'; }); });
  const done = async (me, msg) => {
    S.me = me; S.addresses = null; toast(msg);
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
        const r = await post('/account/signup', { name: f.name.value, phone: f.phone.value, password: f.password.value, code: f.code ? f.code.value : '', ref: f.ref.value });
        localStorage.removeItem('mpc_ref');
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

// ------------------------------------------------------------------ profile, help, referral, address book
function accountView() {
  S.page = 'account';
  const m = S.me;
  const s = S.info.shop;
  const per = Number(s.loyalty_points_per_100) || 0;
  const row = (attr, icon, title, sub = '', cls = '') => `<${attr.startsWith('href') ? 'a' : 'button type="button"'} ${attr} class="${cls}"><span class="mi">${ico(icon)}</span>
    <span class="mt">${title}${sub ? `<small>${sub}</small>` : ''}</span>${cls ? '' : ico('right', 'chev')}</${attr.startsWith('href') ? 'a' : 'button'}>`;
  view().innerHTML = `${appbar('Profile')}<div class="page narrow">
    <div class="box prof">${avatar()}<div class="pf-t"><h2>${esc(m.name)}${m.verified ? VF : ''}</h2><div class="mut">${esc(m.phone)}</div>${m.email ? `<div class="mut small">${esc(m.email)}</div>` : ''}</div>
      <button class="pf-edit" data-edit type="button">${ico('edit')}Edit</button></div>
    <div class="quick"><a href="#orders"><span>${ico('activity')}</span>Your orders</a><a href="#help"><span>${ico('chat')}</span>Help & support</a>
      <a href="#saved"><span>${ico('heart')}</span>Your wishlist</a></div>
    ${s.loyalty_enabled === '1' ? `<div class="box pts"><img src="${FE('coin')}" alt=""><div><div class="small mut">Loyalty points</div><div class="pts-n">${Number(m.points || 0)}</div>
      <div class="small mut">Earn ${per} point${per === 1 ? '' : 's'} for every ₹100, in the shop and online. 1 point = ${rs(Math.round(Number(s.loyalty_point_value) * 100))} off a later bill${
        Number(s.loyalty_min_redeem) ? ` (from ${Number(s.loyalty_min_redeem)} points)` : ''}. Ask the cashier to use them.</div></div></div>` : ''}
    <h3 class="menu-h">Your information</h3>
    <div class="box menu">
      ${row('href="#addresses"', 'pin', 'Address book', m.address ? esc(m.address) : 'Add your delivery addresses')}
      ${row('href="#refer"', 'gift', 'Refer a friend', s.loyalty_enabled === '1' && Number(s.referral_points) ? `Get ${Number(s.referral_points)} points when your friend shops` : 'Share the shop with friends')}
      ${row('data-edit', 'user', 'Edit profile', 'Name, mobile number and email')}
      ${row('data-pw', 'lock', 'Change password')}
      ${row('href="#help"', 'help', 'Help & support', 'Call or WhatsApp the shop')}
      ${row('data-install hidden', 'download', 'Install the app', 'Order faster, right from your home screen')}
      ${row('data-out', 'logout', 'Log out', '', 'red')}
    </div><div class="appver" id="shopver"></div></div>`;
  drawBars();
  shopCheckUpdate();
  $$('[data-edit]').forEach((b) => b.addEventListener('click', editProfile));
  $$('[data-install]').forEach((b) => b.addEventListener('click', install));
  drawInstall();
  $('[data-pw]').addEventListener('click', () => {
    const c = sheet(`<h2>Change password</h2><form><div class="field"><label>Current password</label><input name="password" type="password" autocomplete="current-password" required></div>
      <div class="field"><label>New password (at least 6 letters or numbers)</label><input name="new_password" type="password" autocomplete="new-password" minlength="6" required></div>
      <div class="perr"></div><button class="btn-g wide" style="margin-top:16px">Change password</button></form>`);
    $('form', c).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await post('/account/update', { name: m.name, password: e.target.password.value, new_password: e.target.new_password.value }); S.me = r.me; closeSheet(); toast('Password changed'); } catch (ex) { $('.perr', c).innerHTML = `<div class="err">${esc(ex.message)}</div>`; }
    });
  });
  $('[data-out]').addEventListener('click', async () => {
    await post('/account/logout'); S.me = null; S.active = 0; S.addresses = null; toast('Logged out'); location.hash = '#';
  });
}
function editProfile() {
  const m = S.me;
  const c = sheet(`<h2>Edit profile</h2><form>
    <div class="field"><label>Name</label><input name="name" value="${esc(m.name)}" required autocomplete="name"></div>
    <div class="field"><label>Mobile number</label><input name="phone" value="${esc(m.phone)}" inputmode="tel" autocomplete="tel"></div>
    <div class="field" id="pwRow" hidden><label>Your password (needed to change the number)</label><input name="password" type="password" autocomplete="current-password"></div>
    ${S.sms ? '<div class="field" id="codeRow" hidden><label>6-digit code sent to the new number</label><div style="display:flex;gap:8px"><input name="code" inputmode="numeric" maxlength="6"><button type="button" class="btn-o sm" id="sendC">Send code</button></div></div>' : ''}
    <div class="field"><label>Email (optional, for bills and offers)</label><input name="email" type="email" value="${esc(m.email || '')}" autocomplete="email"></div>
    <div class="perr"></div><button class="btn-g wide" style="margin-top:16px">Save</button></form>`);
  const f = $('form', c);
  f.phone.addEventListener('input', () => {
    const changed = f.phone.value.replace(/\D/g, '').slice(-10) !== m.phone;
    $('#pwRow', c).hidden = !changed;
    if ($('#codeRow', c)) $('#codeRow', c).hidden = !changed;
  });
  if ($('#sendC', c)) $('#sendC', c).addEventListener('click', async () => { try { await post('/account/otp', { phone: f.phone.value, purpose: 'change' }); toast('Code sent by SMS'); } catch (ex) { toast(ex.message); } });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await post('/account/update', { name: f.name.value, email: f.email.value, phone: f.phone.value, password: f.password.value, code: f.code ? f.code.value : '' });
      S.me = r.me; closeSheet(); toast('Profile saved'); accountView();
    } catch (ex) { $('.perr', c).innerHTML = `<div class="err">${esc(ex.message)}</div>`; }
  });
}

function helpView() {
  S.page = 'help';
  const s = S.info.shop;
  const wa = (s.support_whatsapp || s.phone || '').replace(/\D/g, '');
  const waNum = wa.length === 10 ? `91${wa}` : wa;
  const faq = [
    ['When will my order come?', `You choose the time when you order. Slots run from ${s.online_open || '8:00'} to ${s.online_close || '21:00'}. Your order page (Orders) shows each step as the shop does it: accepted, packed, ready or on the way, delivered.`],
    ['What does delivery cost?', paise(s.online_delivery_charge) ? `${rs(paise(s.online_delivery_charge))} per order${paise(s.online_free_delivery_above) ? `, FREE above ${rs(paise(s.online_free_delivery_above))}` : ''}. Minimum order for delivery: ${rs(paise(s.online_min_order))}.` : 'Delivery is free.'],
    ['How do I pay?', `Pay on delivery (cash or UPI), or pay online by UPI after placing the order${s.upi_id ? ` (UPI ID ${s.upi_id})` : ''}.`],
    ['Fruits and vegetables are sold by weight. What will I pay?', 'They are weighed when your order is packed. The bill shows the exact weight and price; it can be a little more or less than the basket.'],
    ['Something is missing or not fresh', 'Call or WhatsApp the shop. Items not available are not charged; anything already paid for them is refunded.'],
  ];
  view().innerHTML = `${appbar('Help & Support')}<div class="page narrow">
    <div class="help-cards">
      ${s.phone ? `<a class="box hc" href="tel:${esc(s.phone)}"><span class="mi">${ico('phone')}</span><b>Call the shop</b><span>${esc(s.phone)}</span></a>` : ''}
      ${waNum ? `<a class="box hc wa" target="_blank" rel="noopener" href="https://wa.me/${esc(waNum)}?text=${encodeURIComponent(`Hello ${s.name}, I need help with my order.`)}"><span class="mi">${ico('chat')}</span><b>WhatsApp us</b><span>${esc(s.support_whatsapp || s.phone)}</span></a>` : ''}
    </div>
    <div class="box"><h3>${ico('store')} ${esc(s.name)}</h3>${s.address ? `<p class="mut" style="margin:0 0 6px">${esc(s.address)}</p>` : ''}
      <p class="mut small" style="margin:0">Online orders: ${esc(s.online_open || '')} to ${esc(s.online_close || '')}${s.online_area ? ` · Delivery ${esc(s.online_area)}` : ''}</p></div>
    <h3 class="menu-h">Common questions</h3>
    <div class="box faq">${faq.map(([q, a]) => `<details><summary>${esc(q)}${ico('down')}</summary><p>${esc(a)}</p></details>`).join('')}</div>
    <p class="credit">Some product photos: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (CC BY-SA).</p>
    <div class="appver" id="shopver"></div></div>`;
  drawBars();
  shopCheckUpdate();
}

async function referView() {
  S.page = 'refer';
  const s = S.info.shop;
  view().innerHTML = `${appbar('Refer a Friend')}<div class="page narrow"><div class="loading">Loading…</div></div>`;
  drawBars();
  const r = await get('/account/refer');
  if (S.page !== 'refer') return;
  const link = `${location.origin}/shop/?ref=${r.code}#signup`;
  const pts = s.loyalty_enabled === '1' ? Number(s.referral_points) || 0 : 0;
  const msg = `I order fruits, vegetables and groceries from ${s.name}. Join with my code ${r.code}: ${link}`;
  view().innerHTML = `${appbar('Refer a Friend')}<div class="page narrow">
    <div class="box refer"><img src="${FE('wrapped-gift')}" alt=""><h2>${pts ? `Get ${pts} points for every friend` : 'Share the shop with friends'}</h2>
      <p class="mut">${pts ? `Your friend signs up with your code. When they make their first purchase, ${pts} loyalty points are added to your account.` : 'Your friend signs up with your code and starts ordering.'}</p>
      <div class="code-box"><span>Your code</span><b>${esc(r.code)}</b><button class="link" id="copyC" type="button">${ico('copy')}Copy</button></div>
      <a class="btn-g wide" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">${ico('chat')}Share on WhatsApp</a>
      <button class="btn-o wide" id="shareL" type="button" style="margin-top:10px">${ico('share')}Share link</button>
      <div class="ref-stats"><div><b>${r.joined}</b><span>Friends joined</span></div><div><b>${r.bought}</b><span>Made a purchase</span></div></div></div></div>`;
  $('#copyC').addEventListener('click', async () => { try { await navigator.clipboard.writeText(r.code); toast('Code copied'); } catch (_) { /* ignore */ } });
  $('#shareL').addEventListener('click', async () => {
    try { if (navigator.share) await navigator.share({ title: s.name, text: msg, url: link }); else { await navigator.clipboard.writeText(msg); toast('Message copied'); } } catch (_) { /* closed */ }
  });
}

async function addressesView() {
  S.page = 'addresses';
  view().innerHTML = `${appbar('Address Book')}<div class="page narrow" id="abox"><div class="loading">Loading…</div></div>`;
  drawBars();
  const list = await loadAddresses(true);
  if (S.page !== 'addresses') return;
  $('#abox').innerHTML = `${list.map((a) => `<div class="box adr"><span class="ai">${ico(addrIcon(a.label))}</span><div class="at"><b>${esc(a.label)}${a.is_default ? ' <span class="pill">Default</span>' : ''}</b>
      <span>${esc(addrLine(a))}</span><div class="adr-btns">${a.is_default ? '' : `<button class="link" data-def="${a.id}" type="button">Make default</button>`}
      <button class="link" data-ed="${a.id}" type="button">${ico('edit')}Edit</button><button class="link bad" data-del="${a.id}" type="button">${ico('trash')}Delete</button></div></div></div>`).join('')
    || emptyState('package', 'No saved addresses', 'Add your home or work address for faster checkout.')}
    <button class="btn-g wide" id="newA" type="button">${ico('plus')}Add a new address</button>`;
  $('#newA').addEventListener('click', () => addressSheet({}, () => addressesView()));
  $$('[data-ed]').forEach((b) => b.addEventListener('click', () => addressSheet(list.find((a) => a.id === Number(b.dataset.ed)), () => addressesView())));
  $$('[data-def]').forEach((b) => b.addEventListener('click', async () => { S.addresses = (await post(`/account/addresses/${b.dataset.def}/default`)).addresses; S.me = (await get('/account')).me; toast('Default address changed'); addressesView(); }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this address?')) return;
    S.addresses = (await post(`/account/addresses/${b.dataset.del}/delete`)).addresses; S.me = (await get('/account')).me; toast('Address deleted'); addressesView();
  }));
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
    S.liveOrd = orders.find((o) => OPEN.includes(o.status)) || null;
  } catch (_) { /* later */ }
  drawBars();
  drawLive();
}
// ------------------------------------------------------------------ first visit: log in with one tap, or look around as a guest
// Nobody has to log in to look around; logging in is asked only when the order is placed.
const WELCOME_SKIP = /^#(o=|p=|cart|login|signup|forgot|q=|code=|sec=|cat=|offers|store=|help|orders|new|trending|saved|search)/;
function welcomeFirst() {
  if (S.me || LS.get('mpc_guest', 0) || WELCOME_SKIP.test(location.hash)) return;
  history.replaceState(null, '', '#welcome');
}
function leaveWelcome(to = '') {
  S.hist = [];
  history.replaceState(null, '', to || location.pathname + location.search);
  route();
}
function welcomeView() {
  S.page = 'welcome';
  ++S.tok;
  const s = S.info.shop;
  view().innerHTML = `<div class="wel">
    <div class="wel-hd"><img class="wel-logo" src="/img/shop-logo.webp?v=3" alt="Madhuram Super Market">
      <h2 class="wel-name">${esc(s.name)}</h2>
      <p>${esc(String(s.tagline || 'Fresh fruits, vegetables and daily needs').replace(/^Supermarket\s*·\s*/i, ''))}</p></div>
    <div class="wel-card">
      <h1>Welcome</h1>
      <p class="mut small">Log in with your mobile number, or look around first. You only need to log in when you place an order.</p>
      <form id="wf" class="wel-form">
        <div class="field"><label>Mobile number</label><input name="phone" inputmode="tel" autocomplete="tel" required placeholder="10-digit mobile number"></div>
        <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
        <div id="werr"></div>
        <button class="btn-g wide">Log in</button>
      </form>
      <div class="wel-or"><span>or</span></div>
      <button class="btn-o wide wel-guest" type="button" id="wguest">${ico('user')}Continue as guest</button>
      <p class="wel-new small">New here? <a href="#signup" class="okc" id="wsign">Create an account</a> · <a href="#forgot" class="okc" id="wforgot">Forgot password?</a></p>
    </div></div>`;
  drawBars();
  const f = $('#wf');
  $('#wguest').addEventListener('click', () => { LS.set('mpc_guest', Date.now()); leaveWelcome(); });
  $('#wsign').addEventListener('click', () => { LS.set('mpc_guest', Date.now()); S.after = '#'; });
  $('#wforgot').addEventListener('click', () => { LS.set('mpc_guest', Date.now()); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', f); btn.disabled = true;
    $('#werr').innerHTML = '';
    try {
      const r = await post('/account/login', { phone: f.phone.value, password: f.password.value });
      S.me = r.me; S.addresses = null;
      toast(`Welcome, ${r.me.name}!`);
      leaveWelcome();
      loadActive();
    } catch (ex) { $('#werr').innerHTML = `<div class="err">${esc(ex.message)}</div>`; } finally { btn.disabled = false; }
  });
}

// ------------------------------------------------------------------ updates: the installed app and open pages load a new version
// by themselves. They ask the server which version it has (every 5 minutes and when the customer comes back to the app). The new
// version loads while the customer is away from the app, when they come back, or when they move to another page; never in the
// middle of the basket, signing in, an address or an open sheet. The basket is kept on the phone, so nothing is lost.
const SHOP_V = (document.currentScript && new URL(document.currentScript.src, location.href).searchParams.get('v')) || '';
const UPD = { ready: '', state: '' };
function updQuiet() {
  const a = document.activeElement;
  return !['cart', 'auth', 'welcome', 'addresses', 'account'].includes(S.page) && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))
    && !(document.getElementById('sheet') && !document.getElementById('sheet').hidden);
}
async function shopUpdateNow() {
  sessionStorage.setItem('mpc_updated_to', UPD.ready);           // once per version: never a reload loop on a slow line
  try { await fetch('/', { cache: 'no-store' }); } catch (_) { /* load it anyway */ }
  location.reload();
}
async function shopCheckUpdate() {
  if (!SHOP_V || UPD.ready) { drawShopVer(); return; }
  try {
    const r = await fetch('/api/shop/version', { cache: 'no-store' });
    if (r.ok) {
      const { v } = await r.json();
      UPD.state = v && v !== SHOP_V ? 'old' : 'ok';
      if (UPD.state === 'old') {
        UPD.ready = v;
        if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then((g) => g && g.update()).catch(() => {});
      }
    } else if (!UPD.state) UPD.state = 'off';
  } catch (_) { UPD.state = 'off'; }             // no internet: try again later
  drawShopVer();
}
// the up-to-date check (Profile and Help pages): green = this app has the newest version, red = not up to date (tap to update)
function drawShopVer() {
  const el = document.getElementById('shopver');
  if (!el) return;
  const st = UPD.ready ? 'old' : UPD.state;
  el.innerHTML = `<span>App version ${esc(SHOP_V || '-')}</span>${st === 'old' ? `<button type="button" class="vchip old" data-upd>${ico('alert')}Not up to date · Tap to update</button>`
    : st === 'ok' ? `<span class="vchip ok">${ico('check')}Up to date</span>` : `<span class="vchip">${st === 'off' ? 'Cannot check (no internet)' : 'Checking…'}</span>`}`;
  const b = el.querySelector('[data-upd]');
  if (b) b.addEventListener('click', shopUpdateNow);
}
function shopMaybeUpdate() {
  if (UPD.ready && sessionStorage.getItem('mpc_updated_to') !== UPD.ready && updQuiet()) shopUpdateNow();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') shopMaybeUpdate();
  else shopCheckUpdate().then(shopMaybeUpdate);
});
window.addEventListener('hashchange', shopMaybeUpdate);
setTimeout(shopCheckUpdate, 10000);
setInterval(() => { if (document.visibilityState === 'visible') shopCheckUpdate(); }, 300000);

// ------------------------------------------------------------------ the shop as an app on the phone or PC ("Get the app")
const INST = { ev: null };
const standalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const canInstall = () => !standalone() && !!(INST.ev || isIOS());
function installSetup() {
  if ('serviceWorker' in navigator && location.pathname === '/' && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/shop-sw.js').catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); INST.ev = e; drawInstall(); });
  window.addEventListener('appinstalled', () => { INST.ev = null; drawInstall(); toast('Installed. Open Madhuram from your home screen.'); });
}
async function install() {
  if (INST.ev) {
    const ev = INST.ev;
    INST.ev = null;
    ev.prompt();
    await ev.userChoice.catch(() => null);
    drawInstall();
    return;
  }
  if (isIOS()) {
    sheet(`<h2>Add Madhuram to your iPhone</h2><ol class="ios-steps">
      <li>Tap the <b>Share</b> button <span class="ios-i">${ico('share')}</span> at the bottom of Safari.</li>
      <li>Scroll and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Madhuram opens like an app from your home screen.</li></ol>
      <button class="btn-g wide" data-close>OK</button>`);
    return;
  }
  toast('Open this page in Chrome or Edge to install the app.');
}
function drawInstall() {
  const on = canInstall();
  const pc = $('#pcInst');
  if (pc) pc.hidden = !on;
  const c = $('#instCard');
  if (c) c.hidden = !on || Date.now() - Number(LS.get('mpc_inst_x', 0)) < 14 * 86400000;
  $$('[data-install]').forEach((b) => { b.hidden = !on; });
}
const instCard = () => `<div class="inst-card" id="instCard" hidden><img src="/img/shop-icon-192.png?v=3" alt="" width="44" height="44">
  <div class="ic-t"><b>Get the Madhuram app</b><span>Order faster, right from your home screen</span></div>
  <button class="ic-go" type="button" data-install-go>Install</button><button class="ic-x" type="button" aria-label="Not now" data-install-x>${ico('x')}</button></div>`;
function bindInstall(root = document) {
  $$('[data-install-go]', root).forEach((b) => b.addEventListener('click', install));
  $$('[data-install-x]', root).forEach((b) => b.addEventListener('click', () => { LS.set('mpc_inst_x', Date.now()); drawInstall(); }));
  drawInstall();
}

const NEEDS_LOGIN = ['#refer', '#addresses'];
async function route() {
  const h = decodeURIComponent(location.hash);
  if (S.hist.length > 1 && S.hist[S.hist.length - 2] === location.hash) S.hist.pop();
  else if (S.hist[S.hist.length - 1] !== location.hash) S.hist.push(location.hash);
  if (!$('#sheet').hidden) closeSheet();
  ++S.tok; ++S.rtok;
  clearInterval(S.bnrTimer);
  clearInterval(S.hintTimer);
  S.detBar = null;
  window.scrollTo(0, 0);
  if (!h.startsWith('#q=') && document.activeElement !== $('#pcq')) $('#pcq').value = '';
  try {
    if (NEEDS_LOGIN.includes(h) && !S.me) { needLogin(); return; }
    if (h === '#welcome') { if (S.me) leaveWelcome(); else welcomeView(); return; }
    if (h.startsWith('#o=')) await trackView(h.slice(3));
    else if (h === '#orders') await ordersView();
    else if (h === '#account') (S.me ? accountView() : authView('login'));
    else if (h === '#login' || h === '#signup' || h === '#forgot') (S.me && h !== '#forgot' ? accountView() : authView(h.slice(1)));
    else if (h === '#help') helpView();
    else if (h === '#refer') await referView();
    else if (h === '#addresses') await addressesView();
    else if (h === '#cart') await cartView();
    else if (h === '#cats') catsView();
    else if (h === '#offers') await listView({ only: 'offers' });
    else if (h === '#saved') await listView({ saved: true });
    else if (h === '#new') await listView({ fresh: true });
    else if (h === '#trending') await listView({ trending: true });
    else if (h.startsWith('#store=')) await listView({ store: Number(h.slice(7)) || 0 });
    else if (h.startsWith('#sec=')) await listView({ sec: h.slice(5) });
    else if (h.startsWith('#cat=')) await listView({ cat: h.slice(5) });
    else if (h.startsWith('#p=')) await detailView(Number(h.slice(3)));
    else if (h === '#search') await searchView('');
    else if (h.startsWith('#q=')) await searchView(h.slice(3));
    else if (h.startsWith('#code=')) await searchView('', h.slice(6));
    else await homeView();
  } catch (e) {
    if (e.status === 401) { S.me = null; needLogin(); return; }
    view().innerHTML = `${appbar('')}<div class="page">${emptyState('package', 'Something went wrong', e.message, '<a class="btn-o" href="#">Go to home</a>')}</div>`;
  }
  drawBars();
}

// ------------------------------------------------------------------ start
// The shop opens at once from what this phone saw last time; the shop's newest details replace it a moment later (usually
// while the opening screen is still showing). A first visit waits for the shop's answer: everything is asked at the same time.
function applyInfo() {
  const s = S.info.shop;
  document.title = `${s.name} | Order online`;
  $('#pcName').textContent = s.name;
}
let begun = false;
async function begin() {
  applyInfo();
  fillIcons();
  if (!S.mode) S.mode = S.info.shop.online_delivery === '1' ? 'delivery' : 'pickup';
  setMode(S.mode, true);
  if (!begun) { begun = true; listen(); }
  welcomeFirst();
  await route();
  drawInstall();
  if (window.Splash) Splash.done();
}
(async () => {
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref && /^[A-Za-z0-9]{4,12}$/.test(ref)) LS.set('mpc_ref', ref.toUpperCase());
  installSetup();
  const saved = LS.get(INFO_KEY, null);
  const infoP = get('/info');
  const acctP = get('/account').catch(() => null);
  // prices in the basket always come from the shop, never from what was saved on the phone
  const cartP = refreshCart();
  if (saved && saved.shop && saved.sections) {
    S.info = saved;
    try { meNow = LS.get(ME_KEY, null); } catch (_) { meNow = null; }
    await begin();
    const [fresh, acct] = await Promise.all([infoP.catch(() => null), acctP]);
    let redo = false;
    if (fresh) {
      try { LS.set(INFO_KEY, fresh); } catch (_) { /* storage full */ }
      if (JSON.stringify(fresh) !== JSON.stringify(saved)) { S.info = fresh; applyInfo(); redo = true; }
    }
    if (acct) {
      if (JSON.stringify(acct.me || null) !== JSON.stringify(S.me)) redo = true;
      S.me = acct.me; S.sms = acct.sms;
    }
    if (redo && ['home', 'cats', 'account', 'welcome'].includes(S.page)) route(); else drawBars();
  } else {
    try {
      const [fresh, acct] = await Promise.all([infoP, acctP]);
      S.info = fresh;
      try { LS.set(INFO_KEY, fresh); } catch (_) { /* storage full */ }
      if (acct) { S.me = acct.me; S.sms = acct.sms; }
    } catch (e) {
      view().innerHTML = `<div class="page">${emptyState('package', 'Could not open the shop', e.message, '<a class="btn-o" href="/">Try again</a>')}</div>`;
      if (window.Splash) Splash.done();
      return;
    }
    await begin();
  }
  await cartP;
  if (S.page === 'cart') cartView(); else drawBars();
  loadActive();
})();
function listen() {
  $('#pcLoc').addEventListener('click', modeSheet);
  $('#pcInst').addEventListener('click', install);
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
  // a photo that cannot be loaded (missing on the server) shows the product's picture instead of a broken image
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (!t || t.tagName !== 'IMG' || !t.dataset.fb || t.dataset.fbDone) return;
    t.dataset.fbDone = '1';
    t.classList.remove('ph', 'prod', 'real');
    t.classList.add('art');
    t.src = t.dataset.fb;
  }, true);
}
