'use strict';
// Shop expenses. Cash paid from a counter drawer is recorded in that counter's shift, so cash closing stays right.
const db = require('./db');
const billing = require('./billing');
const { audit } = require('./auth');
const { paise, rs, nowIST, todayIST, UserError } = require('./money');

const CATEGORIES = ['Tea & snacks', 'Electricity', 'Rent', 'Salary & wages', 'Transport', 'Packing material', 'Repairs', 'Cleaning', 'Phone & internet', 'Other'];

async function add(data, user) {
  const amount = paise(data.amount, 'amount');
  if (!amount || amount <= 0) throw new UserError('Enter the amount.');
  const category = CATEGORIES.includes(data.category) ? data.category : 'Other';
  const method = ['cash', 'upi', 'bank'].includes(data.method) ? data.method : 'cash';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : todayIST();
  if (date > todayIST()) throw new UserError('The date is in the future.');
  const note = String(data.note || '').trim().slice(0, 200);
  if (category === 'Other' && note.length < 3) throw new UserError('Write what the expense was for.');
  return db.tx(async (q) => {
    let shiftId = null;
    if (method === 'cash' && data.counter) {
      const sh = await q.one('SELECT id FROM shifts WHERE open_key=? FOR UPDATE', [billing.cleanCounter(data.counter)]);
      if (sh) {
        shiftId = sh.id;
        await q('INSERT INTO cash_moves (shift_id, kind, amount, reason, user_id, at) VALUES (?,?,?,?,?,?)',
          [shiftId, 'expense', rs(amount), `${category}${note ? `: ${note}` : ''}`.slice(0, 200), user.id, nowIST()]);
      }
    }
    const r = await q('INSERT INTO expenses (business_date, at, category, amount, method, note, user_id, shift_id) VALUES (?,?,?,?,?,?,?,?)',
      [date, nowIST(), category, rs(amount), method, note, user.id, shiftId]);
    await audit({ user_id: user.id, action: 'expense', value: rs(amount), summary: `Expense ${category} ₹${rs(amount)} (${method})${note ? ` ${note}` : ''}` }, q);
    return { id: r.insertId, from_drawer: !!shiftId };
  });
}

async function list(from, to) {
  const rows = await db.query(`SELECT e.*, u.name who FROM expenses e JOIN users u ON u.id=e.user_id WHERE e.business_date BETWEEN ? AND ? ORDER BY e.id DESC LIMIT 500`, [from, to]);
  const byCat = await db.query('SELECT category, SUM(amount) total FROM expenses WHERE business_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC', [from, to]);
  const total = byCat.reduce((a, r) => a + paise(r.total), 0);
  return { rows, by_category: byCat, total: rs(total) };
}

async function remove(id, user) {
  const e = await db.one('SELECT * FROM expenses WHERE id=?', [id]);
  if (!e) throw new UserError('Not found.', 404);
  if (e.shift_id) {
    const sh = await db.one('SELECT status FROM shifts WHERE id=?', [e.shift_id]);
    if (sh && sh.status !== 'open') throw new UserError('This cash expense belongs to a closed shift and cannot be deleted.');
    await db.query("DELETE FROM cash_moves WHERE shift_id=? AND kind='expense' AND amount=? ORDER BY id DESC LIMIT 1", [e.shift_id, e.amount]);
  }
  await db.query('DELETE FROM expenses WHERE id=?', [id]);
  await audit({ user_id: user.id, action: 'expense', value: e.amount, summary: `Expense deleted: ${e.category} ₹${e.amount}` });
}

const total = async (from, to) => paise((await db.one('SELECT SUM(amount) s FROM expenses WHERE business_date BETWEEN ? AND ?', [from, to])).s || '0');

module.exports = { CATEGORIES, add, list, remove, total };
