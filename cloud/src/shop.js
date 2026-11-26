'use strict';
// Online shop: customers see what is available, order for takeaway or home delivery in a time slot, and track the order.
//
// STRICT VISIBILITY: a product is shown, found, suggested or orderable only while available = physical − reserved > 0
// (see stock.js). Ordered quantities are reserved under row locks the moment the order is placed, and stay reserved
// until the shop completes the order ("Process completed") or cancels it.
const crypto = require('crypto');
const db = require('./db');
const settings = require('./settings');
const { audit } = require('./auth');
const sections = require('./sections');
const stock = require('./stock');
const events = require('./events');
const cache = require('./cache');
const search = require('./search');
const { PRICE_NOW, paise, milli, rs, qtyDb, qtyStr, lineAmount, nowIST, UserError } = require('./money');

const { OPEN, AVAILABLE, DELIVERY_SKU } = stock;
const STATUS = { new: 'New', accepted: 'Accepted', packing: 'Billed & packed', ready: 'Ready for pickup', out: 'Out for delivery',
  done: 'Completed', cancelled: 'Cancelled' };
// what the customer sees on the tracking page
const CUSTOMER_STATUS = { new: 'Order placed – waiting for the shop', accepted: 'Accepted – the shop is getting your items',
  packing: 'Billed and packed', ready: 'Ready – please collect from the counter', out: 'Out for delivery – the delivery person is on the way',
  done: 'Completed – thank you!', cancelled: 'Cancelled' };

// Products for the customers' shop (only what is available now).
// sort: popular (best sellers first), offers (biggest saving), price_asc, price_desc, name, new.
// only=offers: products on offer or below MRP.
const CAT_KEYS = ['q', 'cat', 'code', 'ids', 'sort', 'limit', 'exclude', 'only', 'offset', 'sec', 'max_price', 'min_price', 'fresh'];
async function catalogue(params = {}) {
  const p = {};
  for (const k of CAT_KEYS) if (params[k] !== undefined && params[k] !== '') p[k] = String(params[k]).slice(0, 400);
  return (await cache.cached(`cat:${JSON.stringify(p)}`, () => loadCatalogue(p))).slice();   // a copy: callers may sort it
}
async function loadCatalogue({ q = '', cat = '', code = '', ids = '', sort = '', limit = 150, exclude = '', only = '', offset = 0,
  sec = '', max_price: maxPrice = '', min_price: minPrice = '', fresh = '' }) {
  const P = PRICE_NOW(nowIST().slice(0, 10));
  const where = ['i.active=1', 'i.price IS NOT NULL', 'i.price > 0', `i.sku <> '${DELIVERY_SKU}'`, `${AVAILABLE} > 0`];
  const args = [];
  if (sec) {                                   // a shop section (vegetables, munchies…)
    const list = await sections.idsOf(String(sec));
    if (!list.length) return [];
    where.push('i.id IN (?)'); args.push(list);
  }
  if (Number(maxPrice) > 0) { where.push(`${P} <= ?`); args.push(Number(maxPrice)); }
  if (Number(minPrice) > 0) { where.push(`${P} >= ?`); args.push(Number(minPrice)); }
  if (String(fresh) === '1') {                 // new in the shop: added in the last 45 days, not the first big import
    const first = await db.one('SELECT MIN(created_at) m FROM items');
    if (!first || !first.m) return [];
    where.push('i.created_at > ? AND i.created_at > DATE_ADD(?, INTERVAL 1 DAY)');
    args.push(nowIST(Date.now() - 45 * 86400000), first.m);
  }
  code = String(code).trim().slice(0, 32);
  q = String(q).trim().slice(0, 60);
  const idList = String(ids).split(',').map(Number).filter((n) => n > 0).slice(0, 60);
  if (idList.length) { where.push('i.id IN (?)'); args.push(idList); } else if (code) {
    where.push('(i.id IN (SELECT item_id FROM barcodes WHERE code=?) OR i.sku=? OR i.plu=?)'); args.push(code, code, code);
  } else if (q) {
    const found = await search.find(q);                 // word index first; "contains" search when it has no answer
    if (found && !found.length) return [];
    if (found) { where.push('i.id IN (?)'); args.push(found.slice(0, 5000)); } else {
      for (const w of q.split(/\s+/).slice(0, 5)) { where.push('(i.name LIKE ? OR i.name_ta LIKE ?)'); args.push(`%${w}%`, `%${w}%`); }
    }
  }
  if (cat) { where.push('i.category_id=?'); args.push(Number(cat) || 0); }
  if (Number(exclude)) { where.push('i.id <> ?'); args.push(Number(exclude)); }
  if (sort === 'offers' || only === 'offers') where.push(`(${P} < i.price OR i.mrp > ${P})`);
  const saving = `GREATEST(1 - ${P} / i.price, IFNULL(1 - ${P} / NULLIF(i.mrp, 0), 0))`;
  const order = {
    popular: 'sold DESC, i.name',
    offers: `${saving} DESC, i.name`,
    price_asc: `${P} ASC, i.name`,
    new: 'i.created_at DESC, i.id DESC',
    price_desc: `${P} DESC, i.name`,
    name: 'i.name',
  }[sort] || 'sold DESC, i.name';
  const rows = await db.query(`SELECT i.id, i.name, i.name_ta, i.unit, ${P} price, i.price regular, i.offer_to, i.mrp, ${AVAILABLE} avail, i.category_id, c.name cat, i.image,
      COALESCE(s.sold_30d, 0) sold
    FROM items i LEFT JOIN categories c ON c.id=i.category_id LEFT JOIN item_stats s ON s.item_id=i.id WHERE ${where.join(' AND ')}
    ORDER BY ${order} LIMIT ?, ?`, [...args, Math.min(Math.max(Math.trunc(Number(offset)) || 0, 0), 100000), Math.min(Math.max(Number(limit) || 150, 1), 150)]);
  return rows.map((r) => {
    const avail = Math.max(0, milli(r.avail));
    const onOffer = Number(r.price) < Number(r.regular);
    return { id: r.id, name: r.name, name_ta: r.name_ta, unit: r.unit, price: r.price, mrp: r.mrp, cat: r.cat || '', cat_id: r.category_id,
      regular: onOffer ? r.regular : null, offer_to: onOffer ? r.offer_to : null,
      available: qtyStr(avail), in_stock: avail > 0, popular: Number(r.sold) > 0, image: r.image ? `/img/p/${r.image}` : null };
  });
}

// "Suggested for you": popular products from the sections this customer buys from, that they have not bought yet.
async function suggest(customerId) {
  const popular = () => catalogue({ sort: 'popular', limit: 16 });
  if (!customerId) return popular();
  const bought = await db.query(`SELECT DISTINCT item_id FROM (
      SELECT l.item_id FROM online_order_lines l JOIN online_orders o ON o.id=l.order_id WHERE o.customer_id=?
      UNION ALL SELECT l.item_id FROM sale_lines l JOIN sales x ON x.id=l.sale_id WHERE x.customer_id=?) t`, [customerId, customerId]);
  const have = new Set(bought.map((r) => r.item_id));
  if (!have.size) return popular();
  const m = await sections.map();
  const count = new Map();
  for (const id of have) { const s = m.of.get(id); if (s) count.set(s, (count.get(s) || 0) + 1); }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s);
  const lists = await Promise.all(top.map((s) => catalogue({ sec: s, sort: 'popular', limit: 24 })));
  const out = [];
  for (let i = 0; i < 24 && out.length < 16; i++) for (const l of lists) { const it = l.filter((x) => !have.has(x.id))[i]; if (it && out.length < 16) out.push(it); }
  return out.length ? out : popular();
}

// What this customer bought before (online orders and bills at the counter), most often first.
async function buyAgain(customerId) {
  const rows = await db.query(`SELECT item_id, COUNT(*) n FROM (
      SELECT l.item_id FROM online_order_lines l JOIN online_orders o ON o.id=l.order_id WHERE o.customer_id=? AND o.status <> 'cancelled'
      UNION ALL SELECT l.item_id FROM sale_lines l JOIN sales x ON x.id=l.sale_id WHERE x.customer_id=?) t
    GROUP BY item_id ORDER BY n DESC LIMIT 20`, [customerId, customerId]);
  if (!rows.length) return [];
  const rank = new Map(rows.map((r, i) => [r.item_id, i]));
  const items = await catalogue({ ids: rows.map((r) => r.item_id).join(',') });
  return items.sort((a, b) => rank.get(a.id) - rank.get(b.id));
}

// Categories that have something available: the ones bought most in the last 30 days first.
async function categories() {
  return cache.cached('cats', () => db.query(`SELECT c.id, c.name, COUNT(*) items, COUNT(*) in_stock, COALESCE(SUM(s.sold_30d), 0) sold
    FROM categories c JOIN items i ON i.category_id=c.id LEFT JOIN item_stats s ON s.item_id=i.id
    WHERE i.active=1 AND i.price IS NOT NULL AND i.price > 0 AND i.sku <> '${DELIVERY_SKU}' AND ${AVAILABLE} > 0
    GROUP BY c.id, c.name ORDER BY sold DESC, items DESC, c.name`));
}

// Offers running today on available products, for the shop's banner: how many, the biggest saving and the last day.
async function offerSummary() {
  return cache.cached('offers', async () => {
    const P = PRICE_NOW(nowIST().slice(0, 10));
    const r = await db.one(`SELECT COUNT(*) n, MAX(ROUND((1 - ${P} / i.price) * 100)) pct, MAX(i.offer_to) till, SUM(i.offer_to IS NULL) open_ended
      FROM items i WHERE i.active=1 AND i.price > 0 AND ${P} < i.price AND ${AVAILABLE} > 0`);
    return { count: Number(r.n), pct: Number(r.pct || 0), till: Number(r.open_ended) ? null : r.till };
  });
}

// ------------------------------------------------------------------ time slots (India time, as 'YYYY-MM-DDTHH:MM')
const toMin = (hhmm) => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
function slots(cfg, nowMs = Date.now()) {
  const step = Math.max(15, Number(cfg.online_slot_minutes) || 60);
  const earliest = new Date(nowMs + 330 * 60000 + (Number(cfg.online_lead_minutes) || 60) * 60000).toISOString().slice(0, 16);
  const open = toMin(cfg.online_open);
  const close = toMin(cfg.online_close);
  const out = [];
  for (let d = 0; d <= Math.max(1, Number(cfg.online_days_ahead) || 1); d++) {
    const day = new Date(nowMs + 330 * 60000 + d * 86400000).toISOString().slice(0, 10);
    const list = [];
    for (let t = open; t + step <= close; t += step) {
      const v = `${day}T${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      if (v >= earliest) list.push(v);
    }
    if (list.length) out.push({ date: day, slots: list });
  }
  return out;
}
// "9:00 am–10:00 am" for a slot
function slotTime(v, cfg) {
  const step = Math.max(15, Number(cfg.online_slot_minutes) || 60);
  const d = new Date(`${v.replace(' ', 'T').slice(0, 16)}:00Z`);
  const e = new Date(d.getTime() + step * 60000);
  const t = (x) => x.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return `${t(d)}–${t(e)}`;
}
function slotLabel(v, cfg) {
  const d = new Date(`${v.replace(' ', 'T').slice(0, 16)}:00Z`);
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${slotTime(v, cfg)}`;
}

function phone10(v) {
  const d = String(v || '').replace(/\D/g, '');
  const p = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  if (!/^[6-9]\d{9}$/.test(p)) throw new UserError('Please enter a 10-digit mobile number.');
  return p;
}

async function placeOrder(data, ip, customer) {
  const cfg = await settings.load();
  if (cfg.online_enabled !== '1') throw new UserError('Online orders are closed at the moment. Please call the shop.');
  if (data.website) throw new UserError('Please try again.');
  if (!customer) throw new UserError('Please log in (or sign up) to place the order.', 401);
  const name = String(data.name || customer.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (name.length < 2) throw new UserError('Please enter your name.');
  const phone = customer.phone;
  const mode = data.mode;
  if (!((mode === 'pickup' && cfg.online_pickup === '1') || (mode === 'delivery' && cfg.online_delivery === '1'))) {
    throw new UserError('Choose takeaway or home delivery.');
  }
  let address = String(data.address || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (mode === 'delivery' && Number(data.address_id)) {     // one of the customer's saved addresses
    const a = await db.one('SELECT * FROM customer_addresses WHERE id=? AND customer_id=?', [Number(data.address_id), customer.id]);
    if (!a) throw new UserError('Please choose the delivery address again.');
    address = [a.address, a.landmark && `Landmark: ${a.landmark}`, a.pincode].filter(Boolean).join(', ').slice(0, 300);
  }
  if (mode === 'delivery' && address.length < 10) throw new UserError('Please enter the full delivery address with a landmark.');
  const slot = String(data.slot || '').slice(0, 16);
  if (!slots(cfg).some((d) => d.slots.includes(slot))) throw new UserError('That time slot is no longer available. Please choose another.');
  const raw = Array.isArray(data.lines) ? data.lines : [];
  if (!raw.length) throw new UserError('Your cart is empty.');
  if (raw.length > 60) throw new UserError('At most 60 different products in one order.');

  return db.tx(async (q) => {
    const hourAgo = nowIST(Date.now() - 3600000);
    if (ip && Number((await q.one('SELECT COUNT(*) n FROM online_orders WHERE ip=? AND created_at > ?', [ip, hourAgo])).n) >= 5) {
      throw new UserError('Too many orders from this connection. Please call the shop.');
    }
    if (Number((await q.one('SELECT COUNT(*) n FROM online_orders WHERE phone=? AND status IN (?)', [phone, OPEN])).n) >= 3) {
      throw new UserError('You already have 3 open orders. Please wait until one is completed, or call the shop.');
    }
    // Lock the products (ascending id): a second customer buying the last piece waits here, then sees it is gone.
    const ids = [...new Set(raw.map((r) => Number(r.id)).filter(Boolean))];
    const locked = await stock.lockItems(q, ids, `, ${PRICE_NOW(nowIST().slice(0, 10))} price_now`);
    const items = new Map([...locked].filter(([, i]) => i.active && i.price !== null && Number(i.price) > 0 && i.sku !== DELIVERY_SKU)
      .map(([id, i]) => [id, { ...i, price: i.price_now }]));
    const lines = [];
    let total = 0;
    const seen = new Set();
    for (const r of raw) {
      const it = items.get(Number(r.id));
      if (!it) throw new UserError('A product in your cart is no longer sold online. Please refresh the page.');
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      let qty;
      try { qty = milli(r.qty); } catch (_) { qty = null; }
      if (!qty || qty <= 0 || qty > 1000000) throw new UserError(`Check the quantity of ${it.name}.`);
      if (it.unit === 'pcs' && qty % 1000) throw new UserError('Packed items are ordered in whole pieces.');
      const avail = milli(it.on_hand) - milli(it.reserved);
      if (avail <= 0) throw new UserError(`${it.name} has just sold out. Please remove it from your basket.`, 409);
      if (qty > avail) throw new UserError(`Only ${qtyStr(Math.max(0, avail))} ${it.unit} of ${it.name} available now. Please change the quantity.`, 409);
      lines.push([it, qty]);
      total += lineAmount(paise(it.price), qty);
    }
    if (mode === 'delivery' && total < (paise(cfg.online_min_order) || 0)) {
      throw new UserError(`Minimum order for home delivery is ₹${cfg.online_min_order}. Add more, or choose takeaway.`);
    }
    let charge = 0;
    if (mode === 'delivery') {
      charge = paise(cfg.online_delivery_charge) || 0;
      const free = paise(cfg.online_free_delivery_above) || 0;
      if (free && total >= free) charge = 0;
    }
    await q("INSERT INTO sequences (k, last) VALUES ('online', LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE last=LAST_INSERT_ID(last+1)");
    const number = `ON-${String((await q.one('SELECT LAST_INSERT_ID() n')).n).padStart(5, '0')}`;
    const token = crypto.randomBytes(16).toString('hex');
    const now = nowIST();
    if (mode === 'delivery' && address) await q('UPDATE customers SET address=? WHERE id=?', [address, customer.id]);
    const o = await q(`INSERT INTO online_orders (customer_id, number, token, name, phone, mode, address, notes, slot, pay_pref, est_items, delivery_charge, ip,
      created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [customer.id, number, token, name, phone, mode, mode === 'delivery' ? address : '',
      String(data.notes || '').replace(/\s+/g, ' ').trim().slice(0, 300), `${slot.replace('T', ' ')}:00`, data.pay === 'upi' ? 'upi' : 'cash',
      rs(total), rs(charge), String(ip || '').slice(0, 45), now, now]);
    for (const [it, qty] of lines) {
      await q('INSERT INTO online_order_lines (order_id, item_id, name, name_ta, unit, qty, price) VALUES (?,?,?,?,?,?,?)',
        [o.insertId, it.id, it.name, it.name_ta, it.unit, qtyDb(qty), it.price]);
      await stock.hold(q, it.id, qty);                     // reserved until "Process completed" or cancel
    }
    await audit({ action: 'online_order', value: rs(total + charge), summary: `Online order ${number} from ${name} (${mode}, ${lines.length} items, about ₹${rs(total + charge)})` }, q);
    await events.emit(q, 'NEW_ONLINE_ORDER', { order_id: o.insertId, number, mode, slot: `${slot.replace('T', ' ')}:00`, items: lines.length,
      total: rs(total + charge), pay: data.pay === 'upi' ? 'upi' : 'cash' });
    return { number, token };
  });
}

async function order(where, args) {
  const o = await db.one(`SELECT o.*, x.bill_no, x.total bill_total, x.stock_pending, c.verified phone_verified FROM online_orders o
    LEFT JOIN sales x ON x.id=o.sale_id LEFT JOIN customers c ON c.id=o.customer_id WHERE ${where}`, args);
  if (!o) throw new UserError('Order not found.', 404);
  const cfg = await settings.load();
  o.lines = (await db.query(`SELECT l.*, i.image, c.name cat FROM online_order_lines l LEFT JOIN items i ON i.id=l.item_id
    LEFT JOIN categories c ON c.id=i.category_id WHERE l.order_id=? ORDER BY l.id`, [o.id])).map((l) => ({ ...l, qty: qtyStr(milli(l.qty)) }));
  o.slot_label = slotLabel(o.slot, cfg);
  o.status_label = STATUS[o.status];
  o.est_total = rs(paise(o.est_items) + paise(o.delivery_charge));
  if (o.sale_id) {
    o.payments = await db.query('SELECT method, amount, reference FROM payments WHERE sale_id=? ORDER BY id', [o.sale_id]);
    o.cod_due = rs(o.payments.filter((p) => p.method === 'cod').reduce((t, p) => t + paise(p.amount), 0));
  }
  return o;
}

// The four steps the customer sees: placed → billed & packed → agent assigned (or ready for pickup) → completed.
function steps(o) {
  const third = o.mode === 'delivery' ? ['out', 'Delivery agent assigned', o.dispatched_at] : ['ready', 'Ready for pickup', o.ready_at];
  const legacyDone = o.status === 'done';
  const list = [
    ['new', 'Order placed', o.created_at, true],
    ['packing', 'Billed & packed', o.packed_at, !!o.packed_at || legacyDone || ['ready', 'out'].includes(o.status)],
    [third[0], third[1], third[2], !!third[2] || legacyDone],
    ['done', 'Process completed', o.completed_at, legacyDone],
  ];
  const cur = list.findIndex((x) => !x[3]);
  return list.map(([key, label, at, done], i) => ({ key, label, at: at || null, done: o.status !== 'cancelled' && done,
    current: o.status !== 'cancelled' && i === cur }));
}

// Tracking page. The full order (name, address, payment, invoice) only for the logged-in customer who placed it;
// anyone else holding the tracking link (it is sent on WhatsApp) sees just the progress, items and totals.
const publicOrder = async (token, viewer = null) => {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new UserError('Order not found.', 404);
  const o = await order('o.token=?', [token]);
  const cfg = await settings.load();
  const mine = !!viewer && viewer.id === o.customer_id;
  const agent = o.status === 'out' || (o.status === 'done' && o.agent_name) ? { name: o.agent_name, phone: o.agent_phone,
    tracking: o.tracking, tracking_url: /^https:\/\/[^\s"'<>]+$/.test(o.tracking) ? o.tracking : null, at: o.dispatched_at } : null;
  const out = { mine, number: o.number, mode: o.mode, status: o.status, status_label: CUSTOMER_STATUS[o.status], note: o.status_note,
    slot_label: o.slot_label, steps: steps(o), agent, created_at: o.created_at,
    lines: o.lines.map((l) => ({ id: l.item_id, image: l.image ? `/img/p/${l.image}` : null, cat: l.cat || '', name: l.name, name_ta: l.name_ta, unit: l.unit,
      qty: l.qty, price: l.price, ordered: l.ordered_qty === null ? null : qtyStr(milli(l.ordered_qty)), note: l.note })),
    est_items: o.est_items, delivery_charge: o.delivery_charge, est_total: o.est_total, bill_no: o.bill_no, bill_total: o.bill_total,
    cod_due: o.status === 'done' ? null : o.cod_due || null, invoice: mine && o.status === 'done' && !!o.sale_id,
    shop: { name: cfg.name, phone: cfg.phone, upi_id: cfg.upi_id } };
  if (mine) Object.assign(out, { name: o.name, address: o.address, pay_pref: o.pay_pref, pay_ref: o.pay_ref || '' });
  else Object.assign(out, { name: String(o.name || '').split(' ')[0], pay_pref: o.pay_pref, pay_ref: '' });
  return out;
};

// The customer types the UPI transaction number after paying by scanning the shop's QR code (their own order only).
async function setPayRef(token, ref, customer) {
  if (!customer) throw new UserError('Please log in.', 401);
  if (!/^[0-9a-f]{32}$/.test(token || '')) throw new UserError('Order not found.', 404);
  const clean = String(ref || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 40);
  if (clean.length < 6) throw new UserError('Please type the UPI transaction number (UTR) from your payment app.');
  const r = await db.query("UPDATE online_orders SET pay_ref=?, pay_pref='upi' WHERE token=? AND customer_id=? AND status NOT IN ('cancelled','done')",
    [clean, token, customer.id]);
  if (!r.affectedRows) throw new UserError('Order not found.', 404);
}

async function staffList(tab = 'open') {
  const where = { open: "o.status IN ('new','accepted','packing','ready','out') ORDER BY o.status='new' DESC, o.slot",
    done: "o.status='done' ORDER BY o.updated_at DESC LIMIT 100",
    cancelled: "o.status='cancelled' ORDER BY o.updated_at DESC LIMIT 50" }[tab] || "1=1 ORDER BY o.id DESC LIMIT 100";
  const cfg = await settings.load();
  const rows = await db.query(`SELECT o.id, o.number, o.name, o.phone, o.mode, o.slot, o.status, o.est_items, o.delivery_charge, o.created_at, o.sale_id,
    o.agent_name, o.pay_pref, o.pay_ref, x.bill_no, x.total bill_total,
    (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.sale_id=o.sale_id AND p.method='cod') cod,
    (SELECT COUNT(*) FROM online_order_lines WHERE order_id=o.id) items FROM online_orders o LEFT JOIN sales x ON x.id=o.sale_id WHERE ${where}`);
  return rows.map((r) => ({ ...r, slot_label: slotLabel(r.slot, cfg), status_label: STATUS[r.status] }));
}

// Online performance for a period.
async function stats(from, to) {
  const R = [from, to];
  const o = await db.one(`SELECT COUNT(*) n, SUM(status='done') done, SUM(status='cancelled') cancelled, SUM(status IN ('new','accepted','packing','ready','out')) open,
    SUM(mode='delivery') delivery, SUM(mode='pickup') pickup,
    AVG(IF(accepted_at IS NULL, NULL, TIMESTAMPDIFF(MINUTE, created_at, accepted_at))) accept_min
    FROM online_orders WHERE DATE(created_at) BETWEEN ? AND ?`, R);
  const billed = await db.one('SELECT COUNT(*) n, COALESCE(SUM(x.total),0) t FROM sales x WHERE x.order_id IS NOT NULL AND x.business_date BETWEEN ? AND ?', R);
  const removed = await db.one(`SELECT COUNT(*) n, COALESCE(SUM((l.ordered_qty - l.qty) * l.price),0) v FROM online_order_lines l
    JOIN online_orders o ON o.id=l.order_id WHERE l.ordered_qty IS NOT NULL AND DATE(o.created_at) BETWEEN ? AND ?`, R);
  const top = await db.query(`SELECT l.name, l.unit, SUM(l.qty) qty, COUNT(*) orders FROM online_order_lines l JOIN online_orders o ON o.id=l.order_id
    WHERE o.status <> 'cancelled' AND DATE(o.created_at) BETWEEN ? AND ? GROUP BY l.item_id, l.name, l.unit ORDER BY orders DESC LIMIT 10`, R);
  const reasons = await db.query(`SELECT status_note reason, COUNT(*) n FROM online_orders WHERE status='cancelled' AND DATE(created_at) BETWEEN ? AND ?
    GROUP BY status_note ORDER BY n DESC LIMIT 5`, R);
  return { from, to, orders: Number(o.n), done: Number(o.done || 0), cancelled: Number(o.cancelled || 0), open: Number(o.open || 0),
    delivery: Number(o.delivery || 0), pickup: Number(o.pickup || 0), accept_minutes: o.accept_min === null ? null : Math.round(Number(o.accept_min)),
    billed: Number(billed.n), sales: billed.t, removed_items: Number(removed.n), removed_value: rs(Math.round(Number(removed.v) * 100)),
    top: top.map((x) => ({ ...x, qty: qtyStr(milli(x.qty)) })), cancel_reasons: reasons };
}

// A customer's own orders (newest first) for "My orders".
async function customerOrders(customerId) {
  const cfg = await settings.load();
  const rows = await db.query(`SELECT o.id, o.number, o.token, o.mode, o.slot, o.status, o.est_items, o.delivery_charge, o.pay_pref, x.total bill_total,
      o.created_at FROM online_orders o LEFT JOIN sales x ON x.id=o.sale_id WHERE o.customer_id=? ORDER BY o.id DESC LIMIT 30`, [customerId]);
  const lines = rows.length ? await db.query(`SELECT l.order_id, l.item_id, l.name, i.image, c.name cat FROM online_order_lines l
    LEFT JOIN items i ON i.id=l.item_id LEFT JOIN categories c ON c.id=i.category_id WHERE l.order_id IN (?) ORDER BY l.id`, [rows.map((r) => r.id)]) : [];
  return rows.map(({ id, ...r }) => {
    const mine = lines.filter((l) => l.order_id === id);
    return { ...r, slot_label: slotLabel(r.slot, cfg), status_label: CUSTOMER_STATUS[r.status], est_total: rs(paise(r.est_items) + paise(r.delivery_charge)),
      count: mine.length, items: mine.slice(0, 5).map((l) => ({ id: l.item_id, name: l.name, cat: l.cat || '', image: l.image ? `/img/p/${l.image}` : null })) };
  });
}

async function badge() {
  const r = await db.one("SELECT SUM(status='new') n, SUM(status IN ('accepted','packing','ready','out')) busy FROM online_orders WHERE status IN (?)", [OPEN]);
  const last = await db.one('SELECT MAX(id) m FROM online_orders');
  return { new: Number(r.n || 0), open: Number(r.n || 0) + Number(r.busy || 0), last: last.m || 0 };
}

module.exports = { suggest, setPayRef, buyAgain, offerSummary, slotTime, customerOrders, stats, CUSTOMER_STATUS, catalogue, categories, slots, slotLabel,
  placeOrder, publicOrder, order, staffList, badge, steps,
  phone10, STATUS, OPEN };
