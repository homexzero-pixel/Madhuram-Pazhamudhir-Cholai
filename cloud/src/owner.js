'use strict';
// Owner tools: today's prices, buy list, loss watch, the day on one WhatsApp message.
const db = require('./db');
const settings = require('./settings');
const reports = require('./reports');
const { audit } = require('./auth');
const { paise, milli, rs, qtyStr, qtyDb, nowIST, todayIST, UserError } = require('./money');

const inr = (p) => {
  const s = rs(Math.abs(p));
  let [w, f] = s.split('.');
  if (w.length > 3) w = `${w.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${w.slice(-3)}`;
  return `${p < 0 ? '-' : ''}₹${w}.${f}`;
};

// ------------------------------------------------------------------ today's prices (fruit & vegetable rates change every morning)
async function priceList({ cat = '', q = '' } = {}) {
  const where = ["i.sku <> 'DELIVERY'"];
  const args = [];
  if (cat) { where.push('c.name=?'); args.push(cat); } else if (!q) where.push("i.unit='kg'");
  if (q) { where.push('(i.name LIKE ? OR i.name_ta LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const items = await db.query(`SELECT i.id, i.name, i.name_ta, i.unit, i.price, i.mrp, i.cost, i.on_hand, i.active, c.name cat
    FROM items i LEFT JOIN categories c ON c.id=i.category_id WHERE ${where.join(' AND ')} ORDER BY c.name, i.name LIMIT 300`, args);
  const cats = await db.query(`SELECT DISTINCT c.name FROM categories c JOIN items i ON i.category_id=c.id WHERE i.active=1 ORDER BY c.name`);
  return { items: items.map((i) => ({ ...i, on_hand: qtyStr(milli(i.on_hand)) })), cats: cats.map((c) => c.name) };
}

async function savePrices(changes, user) {
  if (!Array.isArray(changes) || !changes.length) throw new UserError('No price was changed.');
  let n = 0;
  await db.tx(async (q) => {
    const now = nowIST();
    for (const ch of changes.slice(0, 500)) {
      const price = paise(ch.price, 'price');
      if (price === null || price < 0) throw new UserError('A price is empty or negative.');
      const it = await q.one('SELECT id, name, price, mrp FROM items WHERE id=? FOR UPDATE', [ch.id]);
      if (!it) continue;
      if (it.mrp !== null && price > paise(it.mrp)) throw new UserError(`${it.name}: ₹${rs(price)} is more than MRP ₹${it.mrp}.`);
      if (it.price !== null && paise(it.price) === price) continue;
      await q('UPDATE items SET price=?, active=1, updated_at=? WHERE id=?', [rs(price), now, it.id]);
      await audit({ user_id: user.id, action: 'price_change', summary: `${it.name}: ₹${it.price ?? '-'} → ₹${rs(price)} (today's prices)` }, q);
      n += 1;
    }
  });
  return n;
}

// ------------------------------------------------------------------ buy list: what to order, from what really sold
async function buyList({ days = 7, fresh = 1, other = 7 } = {}) {
  days = Math.min(Math.max(Number(days) || 7, 1), 60);
  const today = todayIST();
  const rows = await db.query(`SELECT i.id, i.name, i.name_ta, i.unit, i.on_hand, i.reorder_level, i.cost, c.name cat,
      s.id supplier_id, s.name supplier, s.phone supplier_phone,
      COALESCE((SELECT SUM(l.qty - l.returned_qty) FROM sale_lines l JOIN sales x ON x.id=l.sale_id
        WHERE l.item_id=i.id AND x.business_date > DATE_SUB(?, INTERVAL ? DAY) AND x.business_date <= ?), 0) sold
    FROM items i LEFT JOIN categories c ON c.id=i.category_id LEFT JOIN suppliers s ON s.id=i.supplier_id
    WHERE i.active=1 AND i.sku <> 'DELIVERY'`, [today, days, today]);
  const groups = new Map();
  for (const r of rows) {
    const sold = milli(r.sold);
    const stock = milli(r.on_hand);
    const reorder = milli(r.reorder_level);
    if (!sold && !(reorder > 0 && stock <= reorder)) continue;
    const isFresh = r.unit === 'kg' || /fruit|vegetable|dairy|milk|bakery|fresh/i.test(r.cat || '');
    const cover = isFresh ? Number(fresh) || 1 : Number(other) || 7;
    const avg = sold / days;                                   // milli per day
    const target = Math.max(avg * cover, reorder);
    const need = target - stock;
    if (need <= 0) continue;
    const qty = r.unit === 'kg' ? Math.ceil(need / 500) * 500 : Math.ceil(need / 1000) * 1000;
    const value = Math.round(qty * Number(r.cost) / 10);       // paise
    const key = r.supplier_id || 0;
    if (!groups.has(key)) groups.set(key, { supplier_id: r.supplier_id, supplier: r.supplier || 'No supplier set', phone: r.supplier_phone || '', rows: [], value: 0 });
    const g = groups.get(key);
    g.rows.push({ id: r.id, name: r.name, name_ta: r.name_ta, unit: r.unit, stock: qtyStr(stock), per_day: qtyStr(Math.round(avg)),
      days_left: avg ? (stock / avg).toFixed(1) : null, qty: qtyStr(qty), value: rs(value), fresh: isFresh });
    g.value += value;
  }
  const out = [...groups.values()].sort((a, b) => (a.supplier_id ? 0 : 1) - (b.supplier_id ? 0 : 1) || a.supplier.localeCompare(b.supplier));
  for (const g of out) {
    g.rows.sort((a, b) => (a.days_left === null ? 9e9 : Number(a.days_left)) - (b.days_left === null ? 9e9 : Number(b.days_left)));
    g.value = rs(g.value);
  }
  return { days, groups: out };
}

async function orderMessage(group) {
  const s = await settings.load();
  const L = [`*Order from ${s.name}*`, todayIST().split('-').reverse().join('-'), ''];
  group.rows.forEach((r, i) => L.push(`${i + 1}. ${r.name} – ${r.qty} ${r.unit}`));
  L.push('', 'Please confirm availability and rate. Thank you.');
  return L.join('\n');
}

// ------------------------------------------------------------------ loss watch: actions that can hide a loss, per cashier
async function lossWatch(query) {
  const [from, to] = reports.range({ from: query.from || query.to || todayIST(), to: query.to || todayIST() });   // default: today
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const users = new Map();
  const row = (id, name) => {
    if (!users.has(id)) users.set(id, { name: name || '—', bills: 0, sales: 0, unprinted: 0, bill_cancel: 0, bill_cancel_value: 0, line_remove: 0,
      overrides: 0, overrides_value: 0, discounts: 0, discounts_value: 0, refunds: 0, refunds_value: 0, cash_refunds: 0, reprint: 0, variance: 0,
      credit: 0, flags: [] });
    return users.get(id);
  };
  for (const r of await db.query(`SELECT x.cashier_id id, u.name, COUNT(*) n, SUM(x.total) t, SUM(x.print_count=0) unprinted FROM sales x
    JOIN users u ON u.id=x.cashier_id WHERE x.business_date BETWEEN ? AND ? GROUP BY x.cashier_id, u.name`, [from, to])) {
    Object.assign(row(r.id, r.name), { bills: Number(r.n), sales: paise(r.t), unprinted: Number(r.unprinted) });
  }
  for (const a of await db.query(`SELECT a.user_id id, u.name, a.action, COUNT(*) n, SUM(a.value) v FROM audit a JOIN users u ON u.id=a.user_id
    WHERE a.at >= ? AND a.at < DATE_ADD(?, INTERVAL 1 DAY) AND a.action IN
    ('bill_cancel','line_remove','price_override','discount','refund','reprint','credit_sale') GROUP BY a.user_id, u.name, a.action`, [from, to])) {
    const r = row(a.id, a.name);
    const n = Number(a.n);
    const v = paise(a.v || '0');
    if (a.action === 'bill_cancel') { r.bill_cancel += n; r.bill_cancel_value += v; }
    if (a.action === 'line_remove') r.line_remove += n;
    if (a.action === 'price_override') { r.overrides += n; r.overrides_value += v; }
    if (a.action === 'discount') { r.discounts += n; r.discounts_value += v; }
    if (a.action === 'refund') { r.refunds += n; r.refunds_value += v; }
    if (a.action === 'reprint') r.reprint += n;
    if (a.action === 'credit_sale') r.credit += v;
  }
  for (const c of await db.query(`SELECT r.user_id id, SUM(r.total) v FROM sale_returns r WHERE r.business_date BETWEEN ? AND ? AND r.method='cash'
    GROUP BY r.user_id`, [from, to])) row(c.id).cash_refunds = paise(c.v);
  for (const s of await db.query(`SELECT s.cashier_id id, u.name, SUM(s.variance) v FROM shifts s JOIN users u ON u.id=s.cashier_id
    WHERE s.business_date BETWEEN ? AND ? AND s.status='closed' GROUP BY s.cashier_id, u.name`, [from, to])) row(s.id, s.name).variance = paise(s.v || '0');
  for (const r of users.values()) {
    const f = r.flags;
    if (r.bill_cancel >= 2 * days || r.bill_cancel_value >= 100000 * days) f.push(`${r.bill_cancel} bills cancelled (${inr(r.bill_cancel_value)}) – check reasons and CCTV time`);
    if (r.line_remove && r.line_remove / Math.max(r.bills, 1) > 0.15) f.push(`items removed ${r.line_remove} times – high for ${r.bills} bills`);
    if (r.overrides >= 3 * days) f.push(`${r.overrides} price changes (${inr(r.overrides_value)} below list)`);
    if (r.discounts_value > Math.max(20000 * days, r.sales * 0.02)) f.push(`manual discounts ${inr(r.discounts_value)}`);
    if (r.cash_refunds >= 50000 * days || r.refunds >= 3 * days) f.push(`${r.refunds} refunds (${inr(r.refunds_value)}, cash ${inr(r.cash_refunds)})`);
    if (r.variance < 0) f.push(`cash short by ${inr(-r.variance)}`);
    if (r.unprinted) f.push(`${r.unprinted} bills never printed`);
    if (r.reprint >= 5 * days) f.push(`${r.reprint} reprints`);
    for (const k of ['sales', 'bill_cancel_value', 'overrides_value', 'discounts_value', 'refunds_value', 'cash_refunds', 'variance', 'credit']) r[k] = rs(r[k]);
  }
  return { from, to, rows: [...users.values()].sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name)) };
}

// ------------------------------------------------------------------ the day on one WhatsApp message
async function dayText(day) {
  day = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? day : todayIST();
  const s = await settings.load();
  const t = await reports.summary(day, day);
  const m = await reports.summary(`${day.slice(0, 8)}01`, day);
  const shifts = await db.query("SELECT counter, variance FROM shifts WHERE business_date=? AND status='closed'", [day]);
  const open = await db.query("SELECT counter FROM shifts WHERE status='open'");
  const top = await db.query(`SELECT l.name, SUM(l.net) v FROM sale_lines l JOIN sales x ON x.id=l.sale_id WHERE x.business_date=? AND l.sku <> 'DELIVERY'
    GROUP BY l.name ORDER BY v DESC LIMIT 5`, [day]);
  const low = Number((await db.one("SELECT COUNT(*) n FROM items WHERE active=1 AND reorder_level > 0 AND on_hand <= reorder_level")).n);
  const exp = Number((await db.one(`SELECT COUNT(*) n FROM lots WHERE qty > 0 AND status='sellable' AND expiry BETWEEN ? AND DATE_ADD(?, INTERVAL ? DAY)`,
    [day, day, Number(s.near_expiry_days) || 7])).n);
  const orders = Number((await db.one("SELECT COUNT(*) n FROM online_orders WHERE status IN ('new','accepted','ready','out')")).n);
  const flags = (await lossWatch({ from: day, to: day })).rows.flatMap((r) => r.flags.map((f) => `${r.name}: ${f}`));
  const variance = shifts.reduce((a, x) => a + paise(x.variance || '0'), 0);
  const date = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const L = [`*${s.name} – ${date}*`, '', `Net sales: *${inr(paise(t.net))}* (${t.bills} bills, avg ${inr(paise(t.avg_bill))})`];
  if (paise(t.returns)) L.push(`Returns: -${inr(paise(t.returns))}`);
  L.push(`Cash ${inr(paise(t.cash))} · UPI ${inr(paise(t.upi))} · Card ${inr(paise(t.card))}${paise(t.credit) ? ` · Credit ${inr(paise(t.credit))}` : ''}`);
  L.push(`Gross margin: ${inr(paise(t.margin))} (${t.margin_pct}%)`);
  if (paise(t.wastage)) L.push(`Damaged / expired written off: ${inr(paise(t.wastage))}`);
  if (paise(t.purchases)) L.push(`Purchases received: ${inr(paise(t.purchases))}`);
  L.push(shifts.length ? `Cash closing: ${shifts.length} counter(s), difference ${inr(variance)} ${variance === 0 ? '✅' : '⚠️'}` : 'Cash closing: no counter closed yet ⚠️');
  if (top.length) L.push('', 'Top sellers:', ...top.map((x) => `• ${x.name} ${inr(paise(x.v))}`));
  L.push('', `This month so far: ${inr(paise(m.net))} net, margin ${inr(paise(m.margin))}`);
  const alerts = [];
  if (open.length && day === todayIST()) alerts.push(`still open: ${open.map((o) => o.counter).join(', ')}`);
  if (low) alerts.push(`${low} products at or below reorder level (see Buy list)`);
  if (exp) alerts.push(`${exp} stock lots expire within ${s.near_expiry_days || 7} days`);
  if (orders) alerts.push(`${orders} online orders not completed`);
  alerts.push(...flags);
  L.push('', ...(alerts.length ? ['*Needs a look:*', ...alerts.map((a) => `⚠️ ${a}`)] : ['Nothing unusual ✅']));
  return L.join('\n');
}

void qtyDb;
module.exports = { priceList, savePrices, buyList, orderMessage, lossWatch, dayText, inr };
