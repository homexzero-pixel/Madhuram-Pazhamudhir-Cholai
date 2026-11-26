'use strict';
// Online shop: customers see what is in stock, order for takeaway or home delivery in a time slot, and track the order.
// Ordered quantities are held (shown as less available) until the order is billed at a counter or cancelled.
const crypto = require('crypto');
const db = require('./db');
const settings = require('./settings');
const { audit } = require('./auth');
const { paise, milli, rs, qtyDb, qtyStr, lineAmount, nowIST, UserError } = require('./money');

const OPEN = ['new', 'accepted', 'ready', 'out'];
const STATUS = { new: 'New', accepted: 'Accepted – packing', ready: 'Ready for pickup', out: 'Out for delivery', done: 'Completed', cancelled: 'Cancelled' };
// what the customer sees on the tracking page
const CUSTOMER_STATUS = { new: 'Order received – waiting for the shop to accept', accepted: 'Processing – the shop is packing your order',
  ready: 'Ready – please collect from the counter', out: 'The delivery person is on the way', done: 'Completed – thank you!', cancelled: 'Cancelled' };
const DELIVERY_SKU = 'DELIVERY';

async function held(ids) {
  if (ids && !ids.length) return new Map();
  const rows = await db.query(`SELECT l.item_id, SUM(l.qty) q FROM online_order_lines l JOIN online_orders o ON o.id=l.order_id
    WHERE o.status IN (?) AND o.sale_id IS NULL ${ids ? 'AND l.item_id IN (?)' : ''} GROUP BY l.item_id`, ids ? [OPEN, ids] : [OPEN]);
  return new Map(rows.map((r) => [r.item_id, milli(r.q)]));
}

async function catalogue({ q = '', cat = '', code = '', ids = '' }) {
  const where = ["i.active=1", 'i.price IS NOT NULL', `i.sku <> '${DELIVERY_SKU}'`];
  const args = [];
  code = String(code).trim().slice(0, 32);
  q = String(q).trim().slice(0, 60);
  const idList = String(ids).split(',').map(Number).filter((n) => n > 0).slice(0, 60);
  if (idList.length) { where.push('i.id IN (?)'); args.push(idList); } else if (code) { where.push('(i.id IN (SELECT item_id FROM barcodes WHERE code=?) OR i.sku=? OR i.plu=?)'); args.push(code, code, code); }
  else if (q) for (const w of q.split(/\s+/).slice(0, 5)) { where.push('(i.name LIKE ? OR i.name_ta LIKE ?)'); args.push(`%${w}%`, `%${w}%`); }
  if (cat) { where.push('i.category_id=?'); args.push(Number(cat) || 0); }
  const rows = await db.query(`SELECT i.id, i.name, i.name_ta, i.unit, i.price, i.mrp, i.on_hand, c.name cat FROM items i
    LEFT JOIN categories c ON c.id=i.category_id WHERE ${where.join(' AND ')}
    ORDER BY ${q || code || cat ? 'i.name' : 'i.on_hand > 0 DESC, i.name'} LIMIT 150`, args);
  const h = await held(rows.map((r) => r.id));
  return rows.map((r) => {
    const avail = Math.max(0, milli(r.on_hand) - (h.get(r.id) || 0));
    return { id: r.id, name: r.name, name_ta: r.name_ta, unit: r.unit, price: r.price, mrp: r.mrp, cat: r.cat || '', available: qtyStr(avail), in_stock: avail > 0 };
  });
}

async function categories() {
  return db.query(`SELECT DISTINCT c.id, c.name FROM categories c JOIN items i ON i.category_id=c.id
    WHERE i.active=1 AND i.price IS NOT NULL AND i.sku <> '${DELIVERY_SKU}' ORDER BY c.name`);
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
function slotLabel(v, cfg) {
  const step = Math.max(15, Number(cfg.online_slot_minutes) || 60);
  const d = new Date(`${v.replace(' ', 'T').slice(0, 16)}:00Z`);
  const e = new Date(d.getTime() + step * 60000);
  const t = (x) => x.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${t(d)}–${t(e)}`;
}

function phone10(v) {
  const d = String(v || '').replace(/\D/g, '');
  const p = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  if (!/^[6-9]\d{9}$/.test(p)) throw new UserError('Please enter a 10-digit mobile number.');
  return p;
}

async function placeOrder(data, ip) {
  const cfg = await settings.load();
  if (cfg.online_enabled !== '1') throw new UserError('Online orders are closed at the moment. Please call the shop.');
  if (data.website) throw new UserError('Please try again.');
  const name = String(data.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (name.length < 2) throw new UserError('Please enter your name.');
  const phone = phone10(data.phone);
  const mode = data.mode;
  if (!((mode === 'pickup' && cfg.online_pickup === '1') || (mode === 'delivery' && cfg.online_delivery === '1'))) {
    throw new UserError('Choose takeaway or home delivery.');
  }
  const address = String(data.address || '').replace(/\s+/g, ' ').trim().slice(0, 300);
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
    const ids = [...new Set(raw.map((r) => Number(r.id)).filter(Boolean))];
    const items = new Map((await q(`SELECT * FROM items WHERE id IN (?) AND active=1 AND price IS NOT NULL AND sku <> ? FOR UPDATE`,
      [ids.length ? ids : [0], DELIVERY_SKU])).map((i) => [i.id, i]));
    const h = await held(ids);
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
      const avail = milli(it.on_hand) - (h.get(it.id) || 0);
      if (qty > avail) throw new UserError(`Only ${qtyStr(Math.max(0, avail))} ${it.unit} of ${it.name} available now. Please change the quantity.`);
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
    const o = await q(`INSERT INTO online_orders (number, token, name, phone, mode, address, notes, slot, pay_pref, est_items, delivery_charge, ip,
      created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [number, token, name, phone, mode, mode === 'delivery' ? address : '',
      String(data.notes || '').replace(/\s+/g, ' ').trim().slice(0, 300), `${slot.replace('T', ' ')}:00`, data.pay === 'upi' ? 'upi' : 'cash',
      rs(total), rs(charge), String(ip || '').slice(0, 45), now, now]);
    for (const [it, qty] of lines) {
      await q('INSERT INTO online_order_lines (order_id, item_id, name, name_ta, unit, qty, price) VALUES (?,?,?,?,?,?,?)',
        [o.insertId, it.id, it.name, it.name_ta, it.unit, qtyDb(qty), it.price]);
    }
    await audit({ action: 'online_order', value: rs(total + charge), summary: `Online order ${number} from ${name} (${mode}, ${lines.length} items, about ₹${rs(total + charge)})` }, q);
    return { number, token };
  });
}

async function order(where, args) {
  const o = await db.one(`SELECT o.*, x.bill_no, x.total bill_total FROM online_orders o LEFT JOIN sales x ON x.id=o.sale_id WHERE ${where}`, args);
  if (!o) throw new UserError('Order not found.', 404);
  const cfg = await settings.load();
  o.lines = (await db.query('SELECT * FROM online_order_lines WHERE order_id=? ORDER BY id', [o.id])).map((l) => ({ ...l, qty: qtyStr(milli(l.qty)) }));
  o.slot_label = slotLabel(o.slot, cfg);
  o.status_label = STATUS[o.status];
  o.est_total = rs(paise(o.est_items) + paise(o.delivery_charge));
  return o;
}
const publicOrder = async (token) => {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new UserError('Order not found.', 404);
  const o = await order('o.token=?', [token]);
  const cfg = await settings.load();
  return { number: o.number, name: o.name, mode: o.mode, status: o.status, status_label: CUSTOMER_STATUS[o.status], note: o.status_note,
    slot_label: o.slot_label, address: o.address, lines: o.lines.map((l) => ({ name: l.name, name_ta: l.name_ta, unit: l.unit, qty: l.qty, price: l.price,
      ordered: l.ordered_qty === null ? null : qtyStr(milli(l.ordered_qty)), note: l.note })),
    est_items: o.est_items, delivery_charge: o.delivery_charge, est_total: o.est_total, bill_no: o.bill_no, bill_total: o.bill_total,
    shop: { name: cfg.name, phone: cfg.phone, upi_id: cfg.upi_id } };
};

async function staffList(tab = 'open') {
  const where = { open: "o.status IN ('new','accepted','ready','out') ORDER BY o.slot", done: "o.status='done' ORDER BY o.updated_at DESC LIMIT 100",
    cancelled: "o.status='cancelled' ORDER BY o.updated_at DESC LIMIT 50" }[tab] || "1=1 ORDER BY o.id DESC LIMIT 100";
  const cfg = await settings.load();
  const rows = await db.query(`SELECT o.id, o.number, o.name, o.phone, o.mode, o.slot, o.status, o.est_items, o.delivery_charge, o.created_at,
    (SELECT COUNT(*) FROM online_order_lines WHERE order_id=o.id) items FROM online_orders o WHERE ${where}`);
  return rows.map((r) => ({ ...r, slot_label: slotLabel(r.slot, cfg), status_label: STATUS[r.status] }));
}

async function setStatus(id, status, user, note = '') {
  const allowed = { accepted: ['new'], ready: ['new', 'accepted'], out: ['new', 'accepted', 'ready'], cancelled: OPEN };
  return db.tx(async (q) => {
    const o = await q.one('SELECT * FROM online_orders WHERE id=? FOR UPDATE', [id]);
    if (!o) throw new UserError('Order not found.', 404);
    if (!(allowed[status] || []).includes(o.status)) throw new UserError(`Order ${o.number} is ${STATUS[o.status].toLowerCase()}; it cannot be changed to that.`);
    if (status === 'cancelled') {
      if (String(note).trim().length < 3) throw new UserError('Enter why the order is cancelled (the customer will see it).');
      if (o.sale_id) throw new UserError('This order is already billed; use a return instead.');
    }
    await q(`UPDATE online_orders SET status=?, status_note=IF(?="", status_note, ?), updated_at=?,
      accepted_at=IF(accepted_at IS NULL AND ? IN ('accepted','ready','out'), ?, accepted_at) WHERE id=?`,
    [status, String(note).trim(), String(note).trim().slice(0, 200), nowIST(), status, nowIST(), id]);
    await audit({ user_id: user.id, action: 'online_order', summary: `Online order ${o.number}: ${STATUS[status]}${note ? ` – ${note}` : ''}` }, q);
  });
}

// The order as bill lines for the counter. Delivery charge becomes a "Home delivery charge" line (a service, no stock).
async function forCounter(id) {
  const o = await order('o.id=?', [id]);
  if (o.sale_id) throw new UserError(`${o.number} is already billed (${o.bill_no}).`);
  if (!OPEN.includes(o.status)) throw new UserError(`${o.number} is ${STATUS[o.status].toLowerCase()}.`);
  const lines = o.lines.filter((l) => milli(l.qty) > 0).map((l) => ({ id: l.item_id, qty: l.qty }));
  if (!lines.length) throw new UserError('Every item was removed from this order. Cancel it instead.');
  let delivery = null;
  if (paise(o.delivery_charge) > 0) {
    await db.query(`INSERT IGNORE INTO items (sku, name, name_ta, unit, price, active, tax_class, updated_at)
      VALUES (?, 'Home delivery charge', 'வீட்டு டெலிவரி கட்டணம்', 'pcs', 0, 0, 'unset', ?)`, [DELIVERY_SKU, nowIST()]);
    delivery = { id: (await db.one('SELECT id FROM items WHERE sku=?', [DELIVERY_SKU])).id, qty: '1', rate: o.delivery_charge, name: 'Home delivery charge' };
  }
  if (o.status === 'new') await setStatus(o.id, 'accepted', { id: null });
  return { order_id: o.id, number: o.number, customer: { phone: o.phone, name: o.name }, lines, delivery };
}

async function statusMessage(id, baseUrl) {
  const o = await order('o.id=?', [id]);
  const cfg = await settings.load();
  const when = o.slot_label;
  const body = {
    new: `We have received your order. We will confirm it shortly.\n${when}`,
    accepted: `Your order is accepted and being packed. ${o.mode === 'pickup' ? 'Pickup' : 'Delivery'}: ${when}.`,
    ready: `Your order is ready for pickup at the counter. Approx. ₹${o.est_total}.`,
    out: `Our delivery person is on the way with your order. Approx. ₹${o.est_total} – please keep cash/UPI ready.`,
    done: `Thank you! Your order is complete.${o.bill_no ? ` Bill ${o.bill_no}, ₹${o.bill_total}.` : ''}`,
    cancelled: `Sorry, your order was cancelled: ${o.status_note}`,
  }[o.status];
  const changed = o.lines.filter((l) => l.ordered_qty !== null);
  const changes = changed.length ? `\n\nChanges (not available):\n${changed.map((l) => `• ${l.name}: ${milli(l.qty) ? `${l.qty} ${l.unit} instead of ${qtyStr(milli(l.ordered_qty))}` : 'removed'}`).join('\n')}` +
    `\nYou are not charged for these. If you already paid for them, we will refund the difference.` : '';
  const link = OPEN.includes(o.status) ? `\nTrack: ${baseUrl}/shop/#o=${o.token}` : '';
  return { phone: `91${o.phone}`, text: `*${cfg.name}* – order *${o.number}*\n${body}${changes}${link}\nநன்றி 🙏` };
}

// Staff: an item is not available (or less of it). Quantity 0 removes it; the customer is not charged for it.
async function changeLine(orderId, lineId, qtyText, user) {
  return db.tx(async (q) => {
    const o = await q.one('SELECT * FROM online_orders WHERE id=? FOR UPDATE', [orderId]);
    if (!o) throw new UserError('Order not found.', 404);
    if (o.sale_id || !OPEN.includes(o.status)) throw new UserError('This order can no longer be changed.');
    const l = await q.one('SELECT * FROM online_order_lines WHERE id=? AND order_id=? FOR UPDATE', [lineId, orderId]);
    if (!l) throw new UserError('Line not found.');
    const qty = milli(qtyText === '' || qtyText === undefined ? '0' : qtyText, 'quantity');
    const was = milli(l.ordered_qty ?? l.qty);
    if (qty === null || qty < 0 || qty > was) throw new UserError(`Enter 0 to remove, or less than the ordered ${qtyStr(was)}.`);
    if (l.unit === 'pcs' && qty % 1000) throw new UserError('Use whole pieces.');
    await q('UPDATE online_order_lines SET qty=?, ordered_qty=?, note=? WHERE id=?',
      [qtyDb(qty), qty === was ? null : qtyDb(was), qty === was ? '' : qty ? 'Less available' : 'Not available – removed', l.id]);
    const lines = await q('SELECT qty, price FROM online_order_lines WHERE order_id=?', [orderId]);
    const items = lines.reduce((s, x) => s + lineAmount(paise(x.price), milli(x.qty)), 0);
    await q('UPDATE online_orders SET est_items=?, updated_at=? WHERE id=?', [rs(items), nowIST(), orderId]);
    await audit({ user_id: user.id, action: 'online_order', value: rs(lineAmount(paise(l.price), was - qty)),
      summary: `Online order ${o.number}: ${l.name} ${qtyStr(was)} → ${qtyStr(qty)} ${l.unit} (${qty ? 'less available' : 'not available'})` }, q);
  });
}

// Online performance for a period.
async function stats(from, to) {
  const R = [from, to];
  const o = await db.one(`SELECT COUNT(*) n, SUM(status='done') done, SUM(status='cancelled') cancelled, SUM(status IN ('new','accepted','ready','out')) open,
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

async function badge() {
  const r = await db.one("SELECT COUNT(*) n, MAX(id) last FROM online_orders WHERE status='new'");
  const last = await db.one('SELECT MAX(id) m FROM online_orders');
  return { new: Number(r.n), last: last.m || 0 };
}

module.exports = { changeLine, stats, CUSTOMER_STATUS, catalogue, categories, slots, slotLabel, placeOrder, publicOrder, order, staffList, setStatus, forCounter, statusMessage, badge,
  phone10, STATUS, OPEN };
