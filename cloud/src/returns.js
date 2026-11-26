'use strict';
// Customer returns against a bill: money back in cash / UPI / off the customer's credit, stock back on the shelf (or not, if damaged).
const db = require('./db');
const settings = require('./settings');
const catalog = require('./catalog');
const billing = require('./billing');
const { approvedBy, audit } = require('./auth');
const { paise, milli, rs, qtyDb, qtyStr, divRound, financialYear, nowIST, UserError } = require('./money');

async function findSale(text) {
  text = String(text || '').trim();
  if (!text) throw new UserError('Enter or scan the bill number.');
  const s = await db.one('SELECT id FROM sales WHERE bill_no=? OR bill_no LIKE ? ORDER BY id DESC LIMIT 1', [text, `%/${text.padStart(5, '0')}`]);
  if (!s) throw new UserError(`Bill ${text} not found.`, 404);
  return billing.receipt(s.id);
}

async function createReturn(user, body) {
  const reason = String(body.reason || '').trim();
  if (reason.length < 3) throw new UserError('Write the reason for the return.');
  const method = String(body.method || '');
  if (!['cash', 'upi', 'credit'].includes(method)) throw new UserError('Choose how the money goes back.');
  const approver = await approvedBy(user, 'refund', body.approval);
  if (!approver) throw new UserError('A manager must approve the return.', 403);
  const counter = method === 'cash' ? billing.cleanCounter(body.counter) : String(body.counter || '').slice(0, 20);
  const cfg = await settings.load();
  return db.tx(async (q) => {
    const sale = await q.one('SELECT * FROM sales WHERE id=? FOR UPDATE', [body.sale_id]);
    if (!sale) throw new UserError('Bill not found.', 404);
    if (method === 'credit' && !sale.customer_id) throw new UserError('This bill has no customer: give the money back in cash or UPI.');
    let shiftId = null;
    if (method === 'cash') {
      const shift = await q.one('SELECT id FROM shifts WHERE open_key=? FOR UPDATE', [counter]);
      if (!shift) throw new UserError(`No shift is open on ${counter}: cash cannot be paid out.`);
      shiftId = shift.id;
    }
    const now = nowIST();
    const fy = financialYear(now.slice(0, 10));
    const prefix = cfg.credit_note_prefix || 'MCN';
    await q('INSERT INTO sequences (k, last) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE last=LAST_INSERT_ID(last+1)', [`return:${prefix}:${fy}`]);
    const no = `${prefix}/${fy}/${String((await q.one('SELECT LAST_INSERT_ID() n')).n).padStart(5, '0')}`;
    const r = await q(`INSERT INTO sale_returns (return_no, sale_id, business_date, created_at, user_id, approver_id, shift_id, counter, total, method, reason)
      VALUES (?,?,?,?,?,?,?,?,0,?,?)`, [no, sale.id, now.slice(0, 10), now, user.id, approver, shiftId, counter, method, reason.slice(0, 200)]);
    let total = 0;
    let count = 0;
    for (const row of Array.isArray(body.lines) ? body.lines : []) {
      const qty = milli(row.qty || '0') || 0;
      if (qty <= 0) continue;
      const l = await q.one('SELECT * FROM sale_lines WHERE id=? AND sale_id=? FOR UPDATE', [row.line_id, sale.id]);
      if (!l) throw new UserError('A line is not on this bill.');
      const sold = milli(l.qty);
      const left = sold - milli(l.returned_qty);
      if (qty > left) throw new UserError(`${l.name}: only ${qtyStr(left)} ${l.unit} can still be returned.`);
      if (l.unit === 'pcs' && qty % 1000) throw new UserError(`${l.name}: use whole pieces.`);
      // share of the line: the last return of a line takes whatever is left, so the paise always add up
      const prev = await q.one(`SELECT COALESCE(SUM(amount),0) amount, COALESCE(SUM(taxable),0) taxable, COALESCE(SUM(cgst),0) cgst,
        COALESCE(SUM(sgst),0) sgst, COALESCE(SUM(cost),0) cost FROM return_lines WHERE sale_line_id=?`, [l.id]);
      const lineCol = { amount: 'net', taxable: 'taxable', cgst: 'cgst', sgst: 'sgst', cost: 'cost' };
      const part = (k) => (qty === left ? paise(l[lineCol[k]]) - paise(prev[k]) : divRound(paise(l[lineCol[k]]) * qty, sold));
      const amount = part('amount');
      const taxable = part('taxable');
      const cgst = part('cgst');
      const sgst = part('sgst');
      const cost = part('cost');
      const restock = row.restock !== false && l.sku !== billing.DELIVERY_SKU;
      await q(`INSERT INTO return_lines (return_id, sale_line_id, qty, amount, taxable, cgst, sgst, cost, restock) VALUES (?,?,?,?,?,?,?,?,?)`,
        [r.insertId, l.id, qtyDb(qty), rs(amount), rs(taxable), rs(cgst), rs(sgst), rs(cost), restock ? 1 : 0]);
      await q('UPDATE sale_lines SET returned_qty = returned_qty + ? WHERE id=?', [qtyDb(qty), l.id]);
      if (restock) {
        await catalog.receiveIn(q, { item_id: l.item_id, qty, unit_cost: divRound(paise(l.cost) * 1000, sold), ref: no, user, kind: 'return' });
      }
      total += amount;
      count += 1;
    }
    if (!count) throw new UserError('Enter the quantity to return.');
    if (method === 'credit') {
      const owed = paise((await q.one('SELECT COALESCE(SUM(amount),0) b FROM customer_ledger WHERE customer_id=?', [sale.customer_id])).b);
      if (total > owed) throw new UserError(`The customer owes only ₹${rs(owed)}: give the rest in cash or UPI.`);
      await q('INSERT INTO customer_ledger (customer_id, at, kind, amount, ref, user_id) VALUES (?,?,?,?,?,?)',
        [sale.customer_id, now, 'return', rs(-total), no, user.id]);
    }
    if (method === 'cash') {
      await q('INSERT INTO cash_moves (shift_id, kind, amount, reason, user_id, at) VALUES (?,?,?,?,?,?)',
        [shiftId, 'refund', rs(total), `Return ${no} on ${sale.bill_no}`, user.id, now]);
    }
    await q('UPDATE sale_returns SET total=? WHERE id=?', [rs(total), r.insertId]);
    if (sale.customer_id && Number(sale.points_earned) > 0 && paise(sale.total) > 0) {
      const back = Math.min(Number(sale.points_earned), Math.ceil(Number(sale.points_earned) * total / paise(sale.total)));
      await require('./loyalty').post(q, { customerId: sale.customer_id, kind: 'return', points: -back, ref: no, saleId: sale.id, userId: user.id, at: now });
    }
    await audit({ user_id: user.id, approver_id: approver, action: 'refund', value: rs(total),
      summary: `${no}: ₹${rs(total)} back by ${method} on ${sale.bill_no} – ${reason}` }, q);
    return { id: r.insertId, return_no: no, total: rs(total), method, bill_no: sale.bill_no };
  });
}

async function listReturns({ date } = {}) {
  return db.query(`SELECT r.*, x.bill_no, u.name who, a.name approver FROM sale_returns r JOIN sales x ON x.id=r.sale_id
    JOIN users u ON u.id=r.user_id LEFT JOIN users a ON a.id=r.approver_id ${date ? 'WHERE r.business_date=?' : ''} ORDER BY r.id DESC LIMIT 100`,
  date ? [date] : []);
}

module.exports = { findSale, createReturn, listReturns };
