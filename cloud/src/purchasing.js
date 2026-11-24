'use strict';
// Suppliers, goods received (purchase bills) and supplier payments.
const db = require('./db');
const catalog = require('./catalog');
const billing = require('./billing');
const { audit } = require('./auth');
const { paise, milli, rs, qtyDb, qtyStr, divRound, financialYear, nowIST, todayIST, UserError } = require('./money');

async function suppliers({ all = false } = {}) {
  return db.query(`SELECT s.*,
      COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id=s.id), 0) -
      COALESCE((SELECT SUM(amount) FROM supplier_payments WHERE supplier_id=s.id), 0) AS balance,
      (SELECT MAX(created_at) FROM purchases WHERE supplier_id=s.id) AS last_purchase
    FROM suppliers s ${all ? '' : 'WHERE s.active=1'} ORDER BY s.name`);
}

async function saveSupplier(data, user) {
  const name = String(data.name || '').trim().slice(0, 100);
  if (name.length < 2) throw new UserError('Enter the supplier name.');
  const phone = String(data.phone || '').replace(/\D/g, '').slice(-10);
  if (phone && phone.length !== 10) throw new UserError('Phone must have 10 digits.');
  const gstin = String(data.gstin || '').trim().toUpperCase();
  if (gstin && !/^\d{2}[A-Z0-9]{13}$/.test(gstin)) throw new UserError('GSTIN should be 15 letters/digits, starting with the state code.');
  const values = [name, phone, gstin, String(data.address || '').trim().slice(0, 250), data.active === false ? 0 : 1];
  try {
    if (data.id) {
      await db.query('UPDATE suppliers SET name=?, phone=?, gstin=?, address=?, active=? WHERE id=?', [...values, data.id]);
      return Number(data.id);
    }
    const r = await db.query('INSERT INTO suppliers (name, phone, gstin, address, active, created_at) VALUES (?,?,?,?,?,?)', [...values, nowIST()]);
    await audit({ user_id: user.id, action: 'supplier_add', summary: `Supplier ${name} added` });
    return r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new UserError(`Supplier ${name} already exists.`);
    throw err;
  }
}

// A supplier's bill: every line becomes a stock lot. Cost per unit = amount ÷ (qty + free qty), so free goods lower the cost.
async function receivePurchase(data, user) {
  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (!lines.length) throw new UserError('Add at least one product.');
  if (lines.length > 200) throw new UserError('At most 200 lines on one bill.');
  const billDate = data.bill_date ? String(data.bill_date).slice(0, 10) : null;
  if (billDate && !/^\d{4}-\d{2}-\d{2}$/.test(billDate)) throw new UserError('Bill date is not valid.');
  return db.tx(async (q) => {
    const sup = await q.one('SELECT * FROM suppliers WHERE id=?', [data.supplier_id]);
    if (!sup) throw new UserError('Choose the supplier.');
    const now = nowIST();
    const fy = financialYear(now.slice(0, 10));
    await q('INSERT INTO sequences (k, last) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE last=LAST_INSERT_ID(last+1)', [`grn:${fy}`]);
    const grn = `GRN/${fy}/${String((await q.one('SELECT LAST_INSERT_ID() n')).n).padStart(5, '0')}`;
    const p = await q(`INSERT INTO purchases (grn_no, supplier_id, bill_ref, bill_date, created_at, user_id, total, note) VALUES (?,?,?,?,?,?,0,?)`,
      [grn, sup.id, String(data.bill_ref || '').slice(0, 40), billDate, now, user.id, String(data.note || '').slice(0, 200)]);
    let total = 0;
    for (const [n, l] of lines.entries()) {
      const item = await q.one('SELECT * FROM items WHERE id=? FOR UPDATE', [l.item_id]);
      if (!item) throw new UserError(`Line ${n + 1}: product not found.`);
      const qty = milli(l.qty, 'quantity');
      const free = milli(l.free_qty || '0') || 0;
      if (!qty || qty <= 0) throw new UserError(`${item.name}: enter the quantity.`);
      if (free < 0) throw new UserError(`${item.name}: free quantity cannot be negative.`);
      if (item.unit === 'pcs' && (qty % 1000 || free % 1000)) throw new UserError(`${item.name} is counted in pieces: use whole numbers.`);
      let amount = paise(l.amount, 'amount');
      const rate = paise(l.rate, 'rate');
      if (amount === null && rate !== null) amount = divRound(rate * qty, 1000);
      if (amount === null || amount < 0) throw new UserError(`${item.name}: enter the rate or the amount.`);
      const expiry = l.expiry ? String(l.expiry).slice(0, 10) : null;
      if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new UserError(`${item.name}: expiry date is not valid.`);
      // cost per unit in paise with 2 extra decimals (stored as rupees with 4 decimals)
      const unitCost4 = divRound(amount * 100 * 1000, qty + free);         // hundredths of a paisa
      const lotId = await catalog.receiveIn(q, { item_id: item.id, qty: qty + free, unit_cost: 0, expiry, batch: String(l.batch || '').slice(0, 40),
        ref: grn, user, kind: 'purchase' });
      const costStr = (unitCost4 / 10000).toFixed(4);
      await q('UPDATE lots SET unit_cost=? WHERE id=?', [costStr, lotId]);
      await q('UPDATE stock_moves SET unit_cost=? WHERE lot_id=?', [costStr, lotId]);
      await q('UPDATE items SET cost=?, supplier_id=? WHERE id=?', [costStr, sup.id, item.id]);
      if (l.price !== undefined && l.price !== '' && l.price !== null) {      // new selling price written on the bill
        const price = paise(l.price, 'selling price');
        if (price !== null && price >= 0 && price !== paise(item.price)) {
          await q('UPDATE items SET price=?, active=1, updated_at=? WHERE id=?', [rs(price), now, item.id]);
          await audit({ user_id: user.id, action: 'price_change', summary: `${item.name}: ₹${item.price ?? '-'} → ₹${rs(price)} (${grn})` }, q);
        }
      }
      await q(`INSERT INTO purchase_lines (purchase_id, item_id, name, unit, qty, free_qty, cost, amount, expiry, batch, lot_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [p.insertId, item.id, item.name, item.unit, qtyDb(qty), qtyDb(free), costStr, rs(amount), expiry,
        String(l.batch || '').slice(0, 40), lotId]);
      total += amount;
    }
    const round = paise(data.round_off || '0') || 0;
    total += round;
    await q('UPDATE purchases SET total=? WHERE id=?', [rs(total), p.insertId]);
    await audit({ user_id: user.id, action: 'purchase', value: rs(total), summary: `${grn}: ${sup.name} bill ${data.bill_ref || '-'} ₹${rs(total)}, ${lines.length} lines` }, q);
    return { id: p.insertId, grn_no: grn, total: rs(total) };
  });
}

async function purchases({ supplier_id, from, to } = {}) {
  const where = [];
  const args = [];
  if (supplier_id) { where.push('p.supplier_id=?'); args.push(supplier_id); }
  if (from) { where.push('p.created_at >= ?'); args.push(from); }
  if (to) { where.push('p.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); args.push(to); }
  return db.query(`SELECT p.id, p.grn_no, p.bill_ref, p.bill_date, p.created_at, p.total, s.name supplier, u.name who,
    (SELECT COUNT(*) FROM purchase_lines WHERE purchase_id=p.id) line_count
    FROM purchases p JOIN suppliers s ON s.id=p.supplier_id JOIN users u ON u.id=p.user_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.id DESC LIMIT 200`, args);
}

async function purchase(id) {
  const p = await db.one(`SELECT p.*, s.name supplier, s.gstin, u.name who FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
    JOIN users u ON u.id=p.user_id WHERE p.id=?`, [id]);
  if (!p) throw new UserError('Purchase not found.', 404);
  p.lines = (await db.query('SELECT * FROM purchase_lines WHERE purchase_id=? ORDER BY id', [id]))
    .map((l) => ({ ...l, qty: qtyStr(milli(l.qty)), free_qty: qtyStr(milli(l.free_qty)) }));
  return p;
}

// Pay a supplier. Cash taken from a counter's drawer is recorded in that counter's shift.
async function paySupplier(data, user) {
  const amount = paise(data.amount, 'amount');
  if (!amount || amount <= 0) throw new UserError('Enter the amount.');
  const method = ['cash', 'upi', 'bank', 'cheque'].includes(data.method) ? data.method : null;
  if (!method) throw new UserError('Choose how it was paid.');
  const sup = await db.one('SELECT * FROM suppliers WHERE id=?', [data.supplier_id]);
  if (!sup) throw new UserError('Supplier not found.');
  return db.tx(async (q) => {
    let shiftId = null;
    if (method === 'cash' && data.counter) {
      const shift = await q.one('SELECT id FROM shifts WHERE open_key=? FOR UPDATE', [billing.cleanCounter(data.counter)]);
      if (!shift) throw new UserError(`No shift is open on ${data.counter}. Pay from the owner's cash, or open the shift.`);
      shiftId = shift.id;
      await q('INSERT INTO cash_moves (shift_id, kind, amount, reason, user_id, at) VALUES (?,?,?,?,?,?)',
        [shiftId, 'supplier', rs(amount), `Paid ${sup.name}`.slice(0, 200), user.id, nowIST()]);
    }
    await q('INSERT INTO supplier_payments (supplier_id, amount, method, reference, at, user_id, shift_id) VALUES (?,?,?,?,?,?,?)',
      [sup.id, rs(amount), method === 'cheque' ? 'bank' : method, String(data.reference || '').slice(0, 60), nowIST(), user.id, shiftId]);
    await audit({ user_id: user.id, action: 'supplier_pay', value: rs(amount), summary: `Paid ${sup.name} ₹${rs(amount)} by ${method}` }, q);
  });
}

async function supplierLedger(id) {
  const sup = await db.one('SELECT * FROM suppliers WHERE id=?', [id]);
  if (!sup) throw new UserError('Supplier not found.', 404);
  const rows = await db.query(`SELECT created_at at, 'bill' kind, grn_no ref, bill_ref note, total amount FROM purchases WHERE supplier_id=?
    UNION ALL SELECT at, 'paid', method, reference, -amount FROM supplier_payments WHERE supplier_id=? ORDER BY at DESC LIMIT 200`, [id, id]);
  const bal = (await suppliers({ all: true })).find((s) => s.id === sup.id);
  return { supplier: sup, balance: bal ? bal.balance : '0.00', rows };
}

void todayIST;
module.exports = { suppliers, saveSupplier, receivePurchase, purchases, purchase, paySupplier, supplierLedger };
