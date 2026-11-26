'use strict';
const db = require('./db');

// Store settings, kept as key/value rows. Anything not saved yet uses these defaults.
const DEFAULTS = {
  name: 'Madhuram Pazhamudhir Cholai',
  name_ta: 'மதுரம் பழமுதிர் சோலை',
  tagline: 'Supermarket · Fresh fruits, vegetables & daily needs',
  address: '',
  phone: '',
  gstin: '',
  fssai: '',
  invoice_prefix: 'MPC',
  bill_footer: 'Thank you! Visit again. நன்றி, மீண்டும் வருக!',
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
};
const SHOP_PUBLIC = ['name', 'name_ta', 'tagline', 'address', 'phone', 'upi_id', 'online_enabled', 'online_pickup', 'online_delivery', 'online_open',
  'online_close', 'online_min_order', 'online_delivery_charge', 'online_free_delivery_above', 'online_area',
  'loyalty_enabled', 'loyalty_points_per_100', 'loyalty_point_value', 'loyalty_min_redeem'];
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

async function publicSettings() {
  const s = await load();
  return Object.fromEntries(PUBLIC.map((k) => [k, s[k]]));
}

const counters = (s) => s.counters.split(',').map((c) => c.trim()).filter(Boolean);

async function shopSettings() {
  const s = await load();
  return Object.fromEntries(SHOP_PUBLIC.map((k) => [k, s[k]]));
}

module.exports = { shopSettings, DEFAULTS, load, save, publicSettings, counters, reset: () => { cache = null; } };
