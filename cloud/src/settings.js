'use strict';
const db = require('./db');

// Store settings, kept as key/value rows. Anything not saved yet uses these defaults.
const DEFAULTS = {
  name: 'Madhuram Pazhamudhir Solai',
  name_ta: 'மதுரம் பழமுதிர் சோலை',
  tagline: 'Supermarket · Fresh fruits, vegetables & daily needs',
  address: 'NO.1,ARCOT PETTAI,METTU COLONY\nManapakkam,Chennai-600125',   // one line per printed line of the bill
  phone: '9841123414',
  gstin: '33BCDPA6967J1ZJ',
  fssai: '',
  invoice_prefix: 'MPC',           // bill numbers: PREFIX/MMYY/T<counter>/<number>, e.g. MU/1126/T2/107
  bill_footer: 'THANK U VISIT AGAIN',
  shop_url: 'https://mpccustomer.zeravista.com',   // the customers' site, for the QR poster and WhatsApp tracking links
  receipt_width: '80',
  print_copies: '1',               // 2 = customer copy + shop copy
  loyalty_enabled: '0',            // 1 = customers earn points on store and online bills
  loyalty_points_per_100: '1',     // points for every ₹100 spent
  loyalty_point_value: '1',        // ₹ one point is worth when spent
  loyalty_min_redeem: '50',        // points needed before they can be spent
  require_tax_setup: '0',
  counters: 'Counter 1,Counter 2,Counter 3',
  owner_whatsapp: '',               // daily summary goes to this number
  scale_enabled: '0',
  scale_prefixes: '20,21,22,23,24,25,26,27,28,29',
  scale_item_start: '2',
  scale_item_length: '5',
  scale_value_start: '7',
  scale_value_length: '5',
  scale_value_type: 'weight',
  scale_value_decimals: '3',
  scale_check_digit: '1',
  allow_negative_stock: '0',      // 1 = bill items even when their stock was not entered yet (settled at the next stock in)
  credit_note_prefix: 'MCN',
  near_expiry_days: '7',
  whatsapp_open: 'app',            // app = WhatsApp program on this PC/phone, web = WhatsApp Web in the browser
  whatsapp_bill: '1',              // offer "WhatsApp bill" after each sale (the paper bill always prints)
  upi_id: '',
  online_enabled: '0',
  online_pickup: '1',
  online_delivery: '1',
  online_open: '08:00',
  online_close: '21:00',
  online_slot_minutes: '60',
  online_lead_minutes: '60',
  online_days_ahead: '2',
  online_min_order: '200',
  online_delivery_charge: '30',
  online_free_delivery_above: '500',
  online_area: '',
  shop_banners: '[]',
  support_whatsapp: '',            // WhatsApp number customers write to for help (the shop phone when empty)
  upi_qr: '',                      // photo of the shop's UPI QR code (GPay / PhonePe), shown when a customer pays online
  festival_name: '',               // e.g. "Pongal Specials"; empty = the next festival from the calendar
  festival_line: '',
  festival_from: '',
  festival_to: '',
  festival_banner: '',             // photo for the festival banner (else a stock photo)
  referral_points: '50',           // loyalty points for a customer whose friend joins and buys (0 = no reward)
  price_stores: '9,19,29,49,99,119',              // banner photos at the top of the online shop: [{img, kicker, title, sub, link}]
  // AI helpers (only work when the hosting has ANTHROPIC_API_KEY; without it the shop's own search answers)
  ai_shop_enabled: '1',            // "Ask the shop" on the customers' site uses the AI
  ai_billing_enabled: '1',         // the billing site's "Checks & AI" page writes an AI summary
  ai_daily_tokens: '300000',       // the whole shop's daily AI budget (tokens)
  ai_customer_daily: '25',         // questions one customer may ask per day
};
const SHOP_PUBLIC = ['name', 'name_ta', 'tagline', 'address', 'phone', 'upi_id', 'online_enabled', 'online_pickup', 'online_delivery', 'online_open',
  'online_close', 'online_min_order', 'online_delivery_charge', 'online_free_delivery_above', 'online_area',
  'loyalty_enabled', 'loyalty_points_per_100', 'loyalty_point_value', 'loyalty_min_redeem', 'support_whatsapp', 'referral_points', 'price_stores'];
const PHOTO_NAME = /^b_[0-9a-f]{8}\.(jpg|png|webp)$/;
const photoUrl = (name) => (PHOTO_NAME.test(name || '') ? `/img/p/${name}` : null);
// Festivals on fixed dates; the owner sets others (Diwali, Vinayagar Chathurthi…) with a name and dates.
const FESTIVALS = [
  ['01-01', 'New Year Specials', 'Start the year with fresh savings', 'newyear'],
  ['01-14', 'Pongal Specials', 'Sugarcane, turmeric, jaggery and more', 'pongal'],
  ['04-14', 'Tamil New Year Specials', 'Fruits and sweets for Puthandu', 'fruits'],
  ['08-15', 'Independence Day Sale', 'Celebrate with your favourites', 'generic'],
  ['12-25', 'Christmas Specials', 'Cakes, chocolates and more', 'christmas'],
];
function festival(cfg, today) {
  const style = (name) => (/diwali|deepavali/i.test(name) ? 'diwali' : /pongal|sankranti/i.test(name) ? 'pongal'
    : /christmas|xmas/i.test(name) ? 'christmas' : /new ?year/i.test(name) ? 'newyear' : 'generic');
  if (cfg.festival_name && (!cfg.festival_to || cfg.festival_to >= today)) {
    return { name: cfg.festival_name.slice(0, 40), line: cfg.festival_line.slice(0, 60), from: cfg.festival_from || null, to: cfg.festival_to || null,
      photo: photoUrl(cfg.festival_banner), style: style(cfg.festival_name) };
  }
  const t = new Date(`${today}T00:00:00Z`).getTime();
  for (let y = Number(today.slice(0, 4)); y <= Number(today.slice(0, 4)) + 1; y++) {
    for (const [md, name, line, st] of FESTIVALS) {
      const d = new Date(`${y}-${md}T00:00:00Z`).getTime();
      const days = (d - t) / 86400000;
      if (days >= -2 && days <= 30) {
        return { name, line, from: null, to: new Date(d + 2 * 86400000).toISOString().slice(0, 10), photo: photoUrl(cfg.festival_banner), style: st };
      }
    }
  }
  return { name: 'Season Specials', line: 'Best prices on your daily needs', from: null, to: null, photo: photoUrl(cfg.festival_banner), style: 'generic' };
}
// banners the owner saved, checked again before the shop shows them
function shopBanners(cfg) {
  let list = [];
  try { list = JSON.parse(cfg.shop_banners || '[]'); } catch (_) { list = []; }
  if (!Array.isArray(list)) return [];
  return list.filter((b) => b && /^b_[0-9a-f]{8}\.(jpg|png|webp)$/.test(b.img || '')).slice(0, 4).map((b) => ({
    img: `/img/p/${b.img}`, kicker: String(b.kicker || '').slice(0, 40), title: String(b.title || '').slice(0, 40),
    sub: String(b.sub || '').slice(0, 60), link: /^(offers|cat=\d+|)$/.test(b.link || '') ? b.link || '' : '' }));
}
const PUBLIC = Object.keys(DEFAULTS);       // safe to send to every logged-in screen

let cache = null;
let cachedAt = 0;

async function load() {
  if (cache && Date.now() - cachedAt < 10000) return cache;
  const rows = await db.query('SELECT k, v FROM settings');
  const s = { ...DEFAULTS };
  for (const r of rows) s[r.k] = r.v;
  cache = s;
  cachedAt = Date.now();
  return s;
}

async function save(values) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULTS)) continue;
    await db.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k, String(v ?? '').slice(0, 2000)]);
  }
  cache = null;
}

// Once: the shop's own details from its printed bill (November 2026). Fills details that are still empty and replaces the
// old default spellings; anything the owner typed in Settings is kept.
const UPGRADE_KEY = '_shop_details_2026_11';
const OLD_DEFAULTS = { name: 'Madhuram Pazhamudhir Cholai', bill_footer: 'Thank you! Visit again. நன்றி, மீண்டும் வருக!' };
async function upgrade() {
  if (await db.one('SELECT v FROM settings WHERE k=?', [UPGRADE_KEY])) return;
  const saved = Object.fromEntries((await db.query('SELECT k, v FROM settings')).map((r) => [r.k, r.v]));
  const set = {};
  for (const [k, old] of Object.entries(OLD_DEFAULTS)) if (saved[k] === old) set[k] = DEFAULTS[k];
  for (const k of ['address', 'phone', 'gstin']) if (k in saved && !String(saved[k]).trim()) set[k] = DEFAULTS[k];
  await save(set);
  await db.query('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v=v', [UPGRADE_KEY, '1']);
}

// the settings last read (for code that cannot wait for the database)
const cached = () => cache || DEFAULTS;

async function publicSettings() {
  const s = await load();
  return Object.fromEntries(PUBLIC.map((k) => [k, s[k]]));
}

const counters = (s) => s.counters.split(',').map((c) => c.trim()).filter(Boolean);

async function shopSettings() {
  const s = await load();
  const out = Object.fromEntries(SHOP_PUBLIC.map((k) => [k, s[k]]));
  out.address = oneLine(out.address);
  return out;
}
// "NO.1,ARCOT PETTAI\nManapakkam" → "NO.1,ARCOT PETTAI, Manapakkam" for places that show the address on one line
const oneLine = (a) => String(a || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(', ');

module.exports = { festival, photoUrl, shopBanners, shopSettings, DEFAULTS, load, save, publicSettings, counters, upgrade, oneLine, cached, reset: () => { cache = null; } };
