'use strict';
// Customers, their bills, and credit (udhaar): what they owe, payments received, reminders.
const db = require('./db');
const billing = require('./billing');
const { audit } = require('./auth');
const { paise, rs, nowIST, UserError } = require('./money');

const BAL = '(SELECT COALESCE(SUM(amount),0) FROM customer_ledger WHERE customer_id=c.id)';

async function list({ q = '', owing = false } = {}) {
  q = String(q).trim().slice(0, 40);
  const where = [];
  const args = [];
  if (q) { where.push('(c.name LIKE ? OR c.phone LIKE ?)'); args.push(`%${q}%`, `%${q.replace(/\D/g, '') || q}%`); }
  if (owing) where.push(`${BAL} > 0`);
  return db.query(`SELECT c.id, c.name, c.phone, c.address, c.credit_limit, ${BAL} balance,
    (SELECT COUNT(*) FROM sales WHERE customer_id=c.id) bills, (SELECT SUM(total) FROM sales WHERE customer_id=c.id) spent,
    (SELECT MAX(created_at) FROM sales WHERE customer_id=c.id) last_visit,
    (SELECT MAX(at) FROM customer_ledger WHERE customer_id=c.id AND kind='payment') last_paid
    FROM customers c ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${owing ? 'balance DESC' : 'c.name'} LIMIT 200`, args);
}

async function get(id) {
  const c = await db.one(`SELECT c.*, ${BAL} balance, c.pass_hash <> '' online FROM customers c WHERE c.id=?`, [id]);
  delete c.pass_hash;
  if (!c) throw new UserError('Customer not found.', 404);
  c.bills = await db.query('SELECT id, bill_no, created_at, total FROM sales WHERE customer_id=? ORDER BY id DESC LIMIT 50', [id]);
  c.ledger = await db.query(`SELECT l.at, l.kind, l.amount, l.ref, l.method, u.name who FROM customer_ledger l LEFT JOIN users u ON u.id=l.user_id
    WHERE l.customer_id=? ORDER BY l.id DESC LIMIT 100`, [id]);
  return c;
}

async function save(data, user) {
  const name = String(data.name || '').trim().slice(0, 100);
  if (name.length < 2) throw new UserError('Enter the name.');
  const phone = String(data.phone || '').replace(/\D/g, '').slice(-10) || null;
  if (phone && phone.length !== 10) throw new UserError('Mobile number must have 10 digits.');
  const limit = paise(data.credit_limit || '0') || 0;
  if (limit < 0) throw new UserError('Credit limit cannot be negative.');
  const values = [name, phone, String(data.address || '').trim().slice(0, 250), rs(limit)];
  try {
    if (data.id) {
      await db.query('UPDATE customers SET name=?, phone=?, address=?, credit_limit=? WHERE id=?', [...values, data.id]);
      return Number(data.id);
    }
    const r = await db.query('INSERT INTO customers (name, phone, address, credit_limit, created_at) VALUES (?,?,?,?,?)', [...values, nowIST()]);
    await audit({ user_id: user.id, action: 'customer_add', summary: `Customer ${name} ${phone || ''}` });
    return r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new UserError(`Mobile ${phone} already belongs to another customer.`);
    throw err;
  }
}

// Money received against credit. Cash goes into this counter's drawer (shift).
async function receivePayment(data, user) {
  const amount = paise(data.amount, 'amount');
  if (!amount || amount <= 0) throw new UserError('Enter the amount received.');
  const method = ['cash', 'upi', 'card'].includes(data.method) ? data.method : null;
  if (!method) throw new UserError('Choose cash, UPI or card.');
  return db.tx(async (q) => {
    const c = await q.one('SELECT * FROM customers WHERE id=? FOR UPDATE', [data.customer_id]);
    if (!c) throw new UserError('Customer not found.');
    const owed = paise((await q.one('SELECT COALESCE(SUM(amount),0) b FROM customer_ledger WHERE customer_id=?', [c.id])).b);
    if (amount > owed) throw new UserError(`${c.name} owes only ₹${rs(owed)}.`);
    let shiftId = null;
    const counter = String(data.counter || '').slice(0, 20);
    if (counter) {
      const shift = await q.one('SELECT id FROM shifts WHERE open_key=? FOR UPDATE', [billing.cleanCounter(counter)]);
      if (!shift && method === 'cash') throw new UserError(`Open the shift on ${counter} first: the cash goes into its drawer.`);
      shiftId = shift ? shift.id : null;
    } else if (method === 'cash') throw new UserError('Choose this PC\'s counter first: the cash goes into its drawer.');
    const now = nowIST();
    if (method === 'cash') {
      await q('INSERT INTO cash_moves (shift_id, kind, amount, reason, user_id, at) VALUES (?,?,?,?,?,?)',
        [shiftId, 'udhaar', rs(amount), `Credit paid: ${c.name}`.slice(0, 200), user.id, now]);
    }
    await q('INSERT INTO customer_ledger (customer_id, at, kind, amount, ref, method, user_id, shift_id) VALUES (?,?,?,?,?,?,?,?)',
      [c.id, now, 'payment', rs(-amount), String(data.reference || '').slice(0, 60), method, user.id, shiftId]);
    await audit({ user_id: user.id, action: 'credit_paid', value: rs(amount), summary: `${c.name} paid ₹${rs(amount)} by ${method}` }, q);
    return rs(owed - amount);
  });
}

module.exports = { list, get, save, receivePayment };
