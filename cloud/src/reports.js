'use strict';
// Reports for the owner and the accountant. Every report takes a date range (shop dates) and can be downloaded as CSV.
const db = require('./db');
const { paise, milli, rs, qtyStr, todayIST, UserError } = require('./money');

function range(q) {
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const to = ok(q.to) ? q.to : todayIST();
  const from = ok(q.from) ? q.from : `${to.slice(0, 8)}01`;
  if (from > to) throw new UserError('"From" date is after "To" date.');
  return [from, to];
}
const sum = async (sql, args) => paise((await db.one(sql, args)).s || '0');

async function summary(from, to) {
  const s = await db.one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) total, COALESCE(SUM(discount),0) disc FROM sales WHERE business_date BETWEEN ? AND ?`, [from, to]);
  const cost = await sum('SELECT SUM(l.cost) s FROM sale_lines l JOIN sales x ON x.id=l.sale_id WHERE x.business_date BETWEEN ? AND ?', [from, to]);
  const ret = await db.one(`SELECT COALESCE(SUM(rl.amount),0) amount, COALESCE(SUM(rl.cost),0) cost FROM return_lines rl
    JOIN sale_returns r ON r.id=rl.return_id WHERE r.business_date BETWEEN ? AND ?`, [from, to]);
  const tend = {};
  for (const r of await db.query(`SELECT p.method, SUM(p.amount) a FROM payments p JOIN sales x ON x.id=p.sale_id
    WHERE x.business_date BETWEEN ? AND ? GROUP BY p.method`, [from, to])) tend[r.method] = r.a;
  const purchases = await sum('SELECT SUM(total) s FROM purchases WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)', [from, to]);
  const waste = await sum(`SELECT -SUM(qty*unit_cost) s FROM stock_moves WHERE kind='write_off' AND at >= ? AND at < DATE_ADD(?, INTERVAL 1 DAY)`, [from, to]);
  const sales = paise(s.total);
  const returns = paise(ret.amount);
  const net = sales - returns;
  const margin = net - (cost - paise(ret.cost));
  return {
    from, to, bills: Number(s.n), sales: rs(sales), discount: s.disc, returns: rs(returns), net: rs(net), cost: rs(cost - paise(ret.cost)),
    margin: rs(margin), margin_pct: net ? (margin * 100 / net).toFixed(1) : '0.0', avg_bill: s.n ? rs(Math.round(sales / Number(s.n))) : '0.00',
    cash: tend.cash || '0.00', upi: tend.upi || '0.00', card: tend.card || '0.00', credit: tend.credit || '0.00',
    purchases: rs(purchases), wastage: rs(Math.round(waste)),
  };
}

const REPORTS = {
  // name: [title, async (from, to) => rows]
  daily: ['Sales by day', (from, to) => db.query(`SELECT x.business_date date, COUNT(*) bills, SUM(x.total) sales,
      COALESCE((SELECT SUM(total) FROM sale_returns WHERE business_date=x.business_date),0) returns,
      SUM(x.total) - COALESCE((SELECT SUM(total) FROM sale_returns WHERE business_date=x.business_date),0) net,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN sales y ON y.id=p.sale_id WHERE y.business_date=x.business_date AND p.method='cash') cash,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN sales y ON y.id=p.sale_id WHERE y.business_date=x.business_date AND p.method='upi') upi,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN sales y ON y.id=p.sale_id WHERE y.business_date=x.business_date AND p.method='card') card,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN sales y ON y.id=p.sale_id WHERE y.business_date=x.business_date AND p.method='credit') credit
      FROM sales x WHERE x.business_date BETWEEN ? AND ? GROUP BY x.business_date ORDER BY x.business_date`, [from, to])],
  items: ['Sales by product', (from, to) => db.query(`SELECT l.sku, l.name, l.unit, SUM(l.qty - l.returned_qty) qty,
      SUM(l.net) sales, SUM(l.net - l.cost) margin, COUNT(DISTINCT l.sale_id) bills
      FROM sale_lines l JOIN sales x ON x.id=l.sale_id WHERE x.business_date BETWEEN ? AND ?
      GROUP BY l.item_id, l.sku, l.name, l.unit ORDER BY sales DESC LIMIT 500`, [from, to])],
  categories: ['Sales by category', (from, to) => db.query(`SELECT COALESCE(c.name,'(none)') category, COUNT(DISTINCT l.item_id) products,
      SUM(l.net) sales, SUM(l.net - l.cost) margin FROM sale_lines l JOIN sales x ON x.id=l.sale_id JOIN items i ON i.id=l.item_id
      LEFT JOIN categories c ON c.id=i.category_id WHERE x.business_date BETWEEN ? AND ? GROUP BY c.name ORDER BY sales DESC`, [from, to])],
  hours: ['Busy hours', (from, to) => db.query(`SELECT LPAD(HOUR(created_at),2,'0') hour, COUNT(*) bills, SUM(total) sales
      FROM sales WHERE business_date BETWEEN ? AND ? GROUP BY HOUR(created_at) ORDER BY hour`, [from, to])],
  staff: ['Sales by cashier and counter', (from, to) => db.query(`SELECT u.name cashier, x.counter, COUNT(*) bills, SUM(x.total) sales,
      SUM(x.discount) discounts FROM sales x JOIN users u ON u.id=x.cashier_id WHERE x.business_date BETWEEN ? AND ?
      GROUP BY u.name, x.counter ORDER BY sales DESC`, [from, to])],
  gst: ['GST summary (for the accountant)', async (from, to) => {
    const sales = await db.query(`SELECT l.gst_rate rate, SUM(l.taxable) taxable, SUM(l.cgst) cgst, SUM(l.sgst) sgst, SUM(l.net) total
      FROM sale_lines l JOIN sales x ON x.id=l.sale_id WHERE x.business_date BETWEEN ? AND ? GROUP BY l.gst_rate ORDER BY l.gst_rate`, [from, to]);
    const rets = await db.query(`SELECT l.gst_rate rate, SUM(rl.taxable) taxable, SUM(rl.cgst) cgst, SUM(rl.sgst) sgst, SUM(rl.amount) total
      FROM return_lines rl JOIN sale_lines l ON l.id=rl.sale_line_id JOIN sale_returns r ON r.id=rl.return_id
      WHERE r.business_date BETWEEN ? AND ? GROUP BY l.gst_rate`, [from, to]);
    const back = Object.fromEntries(rets.map((r) => [r.rate, r]));
    return sales.map((s) => {
      const r = back[s.rate] || {};
      const k = (f) => rs(paise(s[f]) - paise(r[f] || '0'));
      return { gst_rate: s.rate, taxable: k('taxable'), cgst: k('cgst'), sgst: k('sgst'), total: k('total'), returns_included: r.total || '0.00' };
    });
  }],
  hsn: ['HSN summary (for GSTR-1)', (from, to) => db.query(`SELECT COALESCE(NULLIF(i.hsn,''),'(no HSN)') hsn, l.gst_rate rate,
      SUM(l.qty) qty, SUM(l.taxable) taxable, SUM(l.cgst) cgst, SUM(l.sgst) sgst, SUM(l.net) total
      FROM sale_lines l JOIN sales x ON x.id=l.sale_id JOIN items i ON i.id=l.item_id WHERE x.business_date BETWEEN ? AND ?
      GROUP BY hsn, l.gst_rate ORDER BY hsn`, [from, to])],
  bills: ['Bill register', (from, to) => db.query(`SELECT x.bill_no, x.created_at, x.counter, u.name cashier, COALESCE(c.name,'') customer,
      x.gross, x.discount, x.total, (SELECT GROUP_CONCAT(CONCAT(method,' ',amount)) FROM payments WHERE sale_id=x.id) paid
      FROM sales x JOIN users u ON u.id=x.cashier_id LEFT JOIN customers c ON c.id=x.customer_id
      WHERE x.business_date BETWEEN ? AND ? ORDER BY x.id LIMIT 5000`, [from, to])],
  returns: ['Returns', (from, to) => db.query(`SELECT r.return_no, r.created_at, x.bill_no, r.total, r.method, r.reason, u.name who, a.name approver
      FROM sale_returns r JOIN sales x ON x.id=r.sale_id JOIN users u ON u.id=r.user_id LEFT JOIN users a ON a.id=r.approver_id
      WHERE r.business_date BETWEEN ? AND ? ORDER BY r.id`, [from, to])],
  purchases: ['Purchase register', (from, to) => db.query(`SELECT p.grn_no, p.created_at, s.name supplier, s.gstin, p.bill_ref, p.bill_date, p.total
      FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.created_at >= ? AND p.created_at < DATE_ADD(?, INTERVAL 1 DAY)
      ORDER BY p.id`, [from, to])],
  wastage: ['Write-offs (damaged / expired)', (from, to) => db.query(`SELECT m.at, i.name, -m.qty qty, i.unit, ROUND(-m.qty*m.unit_cost,2) value,
      m.reason, u.name who FROM stock_moves m JOIN items i ON i.id=m.item_id LEFT JOIN users u ON u.id=m.user_id
      WHERE m.kind='write_off' AND m.at >= ? AND m.at < DATE_ADD(?, INTERVAL 1 DAY) ORDER BY m.id`, [from, to])],
  shifts: ['Cash closing', (from, to) => db.query(`SELECT s.business_date date, s.counter, u.name cashier, s.opening_float, s.expected, s.counted,
      s.variance, s.status FROM shifts s JOIN users u ON u.id=s.cashier_id WHERE s.business_date BETWEEN ? AND ? ORDER BY s.id`, [from, to])],
  stock: ['Stock value now', () => db.query(`SELECT COALESCE(c.name,'(none)') category, COUNT(DISTINCT i.id) products,
      ROUND(SUM(l.qty*l.unit_cost),2) cost_value, ROUND(SUM(l.qty*COALESCE(i.price,0)),2) selling_value
      FROM lots l JOIN items i ON i.id=l.item_id LEFT JOIN categories c ON c.id=i.category_id
      WHERE l.qty > 0 AND l.status='sellable' GROUP BY c.name ORDER BY cost_value DESC`)],
  expiry: ['Expiring in the next 30 days', () => db.query(`SELECT l.expiry, i.name, l.qty, i.unit, l.batch, ROUND(l.qty*l.unit_cost,2) cost_value
      FROM lots l JOIN items i ON i.id=l.item_id WHERE l.qty > 0 AND l.status='sellable' AND l.expiry IS NOT NULL
      AND l.expiry <= DATE_ADD(?, INTERVAL 30 DAY) ORDER BY l.expiry`, [todayIST()])],
  deadstock: ['Not sold in 30 days (money stuck)', () => db.query(`SELECT i.name, i.on_hand qty, i.unit, ROUND(i.on_hand*i.cost,2) cost_value,
      (SELECT MAX(x.business_date) FROM sale_lines l JOIN sales x ON x.id=l.sale_id WHERE l.item_id=i.id) last_sold
      FROM items i WHERE i.on_hand > 0 AND i.sku <> 'DELIVERY' AND NOT EXISTS (SELECT 1 FROM sale_lines l JOIN sales x ON x.id=l.sale_id
      WHERE l.item_id=i.id AND x.business_date > DATE_SUB(?, INTERVAL 30 DAY)) ORDER BY cost_value DESC LIMIT 300`, [todayIST()])],
  credit: ['Customer credit (udhaar) outstanding', () => db.query(`SELECT c.name, c.phone, SUM(l.amount) balance, MAX(l.at) last_entry
      FROM customer_ledger l JOIN customers c ON c.id=l.customer_id GROUP BY c.id, c.name, c.phone HAVING balance > 0 ORDER BY balance DESC`)],
  suppliers: ['Supplier balances', () => db.query(`SELECT s.name, s.phone,
      COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id=s.id),0) bills,
      COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id=s.id),0) paid,
      COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id=s.id),0) - COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id=s.id),0) balance
      FROM suppliers s ORDER BY balance DESC`)],
};

async function run(name, query) {
  const r = REPORTS[name];
  if (!r) throw new UserError('Unknown report.', 404);
  const [from, to] = range(query);
  let rows = await r[1](from, to);
  rows = rows.map((row) => {
    const o = {};
    for (const [k, v] of Object.entries(row)) o[k] = /^(qty|on_hand)$/.test(k) && v !== null ? qtyStr(milli(v)) : v;
    return o;
  });
  return { name, title: r[0], from, to, rows };
}

function csv(rows) {
  if (!rows.length) return '﻿(no rows)\r\n';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;          // stop spreadsheet formulas
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${cols.join(',')}\r\n${rows.map((r) => cols.map((c) => cell(r[c])).join(',')).join('\r\n')}\r\n`;
}

const list = () => Object.entries(REPORTS).map(([k, v]) => ({ name: k, title: v[0] }));

module.exports = { summary, run, csv, list, range };
