'use strict';
const db = require('./db');
const settings = require('./settings');
const catalog = require('./catalog');
const { approvedBy, audit, can } = require('./auth');
const { paise, milli, rateBp, rs, qtyDb, qtyStr, lineAmount, splitTax, financialYear, nowIST, todayIST, UserError } = require('./money');

const METHODS = ['cash', 'upi', 'card', 'credit', 'points'];
const loyalty = require('./loyalty');
const DELIVERY_SKU = 'DELIVERY';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanCounter(name) {
  name = String(name || '').trim().slice(0, 20);
  if (!name) throw new UserError('Choose this PC\'s counter first (top of the billing screen).');
  return name;
}

// ------------------------------------------------------------------ shifts: one open shift per counter
async function openShift(counter) {
  return db.one(`SELECT s.*, u.name cashier FROM shifts s JOIN users u ON u.id=s.cashier_id WHERE s.open_key=?`, [counter]);
}

async function lastClosed(counter) {
  return db.one(`SELECT s.id, s.counted, s.closed_at, u.name closed_by FROM shifts s LEFT JOIN users u ON u.id=s.closed_by
    WHERE s.counter=? AND s.status='closed' ORDER BY s.closed_at DESC LIMIT 1`, [counter]);
}

async function startShift(user, counter, float) {
  if (!can(user, 'cash')) throw new UserError('Your role cannot open a cashier shift.', 403);
  counter = cleanCounter(counter);
  const amount = paise(float, 'opening cash') ?? 0;
  if (amount < 0) throw new UserError('Opening cash cannot be negative.');
  const last = await lastClosed(counter);
  try {
    const r = await db.query(`INSERT INTO shifts (counter, open_key, cashier_id, business_date, opened_at, opening_float)
      VALUES (?,?,?,?,?,?)`, [counter, counter, user.id, todayIST(), nowIST(), rs(amount)]);
    await audit({ user_id: user.id, action: 'shift_open', summary: `Shift ${r.insertId} opened on ${counter} with ₹${rs(amount)}`, value: rs(amount) });
    if (last && last.counted !== null && paise(last.counted) !== amount) {
      await audit({ user_id: user.id, action: 'float_mismatch', value: rs(amount - paise(last.counted)),
        summary: `${counter}: opened with ₹${rs(amount)} but last closing was ₹${last.counted} (${last.closed_at.slice(0, 16)})` });
    }
    return r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new UserError(`A shift is already open on ${counter}. Close it first.`);
    throw err;
  }
}

async function cashSummary(shiftId, q = db.query) {
  const one = async (sql, args) => paise((await q(sql, args))[0].s || '0');
  const shift = (await q('SELECT * FROM shifts WHERE id=?', [shiftId]))[0];
  const cashSales = await one(`SELECT SUM(p.amount) s FROM payments p JOIN sales x ON x.id=p.sale_id WHERE x.shift_id=? AND p.method='cash'`, [shiftId]);
  const upi = await one(`SELECT SUM(p.amount) s FROM payments p JOIN sales x ON x.id=p.sale_id WHERE x.shift_id=? AND p.method='upi'`, [shiftId]);
  const card = await one(`SELECT SUM(p.amount) s FROM payments p JOIN sales x ON x.id=p.sale_id WHERE x.shift_id=? AND p.method='card'`, [shiftId]);
  const credit = await one(`SELECT SUM(p.amount) s FROM payments p JOIN sales x ON x.id=p.sale_id WHERE x.shift_id=? AND p.method='credit'`, [shiftId]);
  const pointsPaid = await one(`SELECT SUM(p.amount) s FROM payments p JOIN sales x ON x.id=p.sale_id WHERE x.shift_id=? AND p.method='points'`, [shiftId]);
  const cashIn = await one(`SELECT SUM(amount) s FROM cash_moves WHERE shift_id=? AND kind IN ('in','udhaar')`, [shiftId]);
  const udhaar = await one(`SELECT SUM(amount) s FROM cash_moves WHERE shift_id=? AND kind='udhaar'`, [shiftId]);
  const refunds = await one(`SELECT SUM(amount) s FROM cash_moves WHERE shift_id=? AND kind='refund'`, [shiftId]);
  const supplier = await one(`SELECT SUM(amount) s FROM cash_moves WHERE shift_id=? AND kind='supplier'`, [shiftId]);
  const cashOut = await one(`SELECT SUM(amount) s FROM cash_moves WHERE shift_id=? AND kind IN ('out','deposit','refund','supplier','expense')`, [shiftId]);
  const expenses = await one(`SELECT SUM(amount) s FROM cash_moves WHERE shift_id=? AND kind='expense'`, [shiftId]);
  const bills = (await q('SELECT COUNT(*) n, SUM(total) t FROM sales WHERE shift_id=?', [shiftId]))[0];
  const float = paise(shift.opening_float);
  const expected = float + cashSales + cashIn - cashOut;
  return { float: rs(float), cash_sales: rs(cashSales), upi: rs(upi), card: rs(card), cash_in: rs(cashIn), cash_out: rs(cashOut),
    credit: rs(credit), points: rs(pointsPaid), udhaar_received: rs(udhaar), refunds: rs(refunds), supplier_paid: rs(supplier), expenses: rs(expenses),
    expected: rs(expected), bills: Number(bills.n), sales_total: rs(paise(bills.t || '0')) };
}

async function cashMove(user, counter, kind, amount, reason) {
  if (!can(user, 'cash')) throw new UserError('Your role cannot move cash.', 403);
  if (!['in', 'out', 'deposit'].includes(kind)) throw new UserError('Choose cash in or cash out.');
  const a = paise(amount, 'amount');
  if (!a || a <= 0) throw new UserError('Enter the amount.');
  if (String(reason || '').trim().length < 3) throw new UserError('Write the reason.');
  const shift = await openShift(cleanCounter(counter));
  if (!shift) throw new UserError('No shift is open on this counter.');
  await db.query('INSERT INTO cash_moves (shift_id, kind, amount, reason, user_id, at) VALUES (?,?,?,?,?,?)',
    [shift.id, kind, rs(a), String(reason).trim().slice(0, 200), user.id, nowIST()]);
  await audit({ user_id: user.id, action: `cash_${kind}`, summary: `${counter}: cash ${kind} ₹${rs(a)} – ${reason}`, value: rs(a) });
}

async function closeShift(user, shiftId, counted, retained, note) {
  return db.tx(async (q) => {
    const shift = await q.one('SELECT * FROM shifts WHERE id=? FOR UPDATE', [shiftId]);
    if (!shift || shift.status !== 'open') throw new UserError('This shift is already closed.');
    if (shift.cashier_id !== user.id && !can(user, 'reopen_shift')) throw new UserError('Only the shift\'s cashier or a manager can close it.', 403);
    const c = paise(counted, 'counted cash');
    if (c === null || c < 0) throw new UserError('Enter the cash counted in the drawer.');
    const keep = c;                     // the counted cash is the next opening balance of this counter
    void retained;
    const sum = await cashSummary(shiftId, q);
    const variance = c - paise(sum.expected);
    await q(`UPDATE shifts SET status='closed', open_key=NULL, closed_at=?, closed_by=?, counted=?, expected=?, variance=?, retained=?, note=?
      WHERE id=?`, [nowIST(), user.id, rs(c), sum.expected, rs(variance), rs(keep), String(note || '').slice(0, 200), shiftId]);
    await audit({ user_id: user.id, action: 'shift_close', value: rs(variance),
      summary: `Shift ${shiftId} (${shift.counter}) closed: expected ₹${sum.expected}, counted ₹${rs(c)}, difference ₹${rs(variance)}` }, q);
    return { ...sum, counted: rs(c), variance: rs(variance), retained: rs(keep) };
  });
}

// ------------------------------------------------------------------ checkout
// The browser sends the bill once: items, quantities, any approved price change / discount, and the payment.
// Prices, GST and stock are worked out again here from the database; the browser's numbers are only shown on screen.
// The same bill (client uuid) sent twice – e.g. after a network drop – is saved once and the first result is returned.
async function checkout(user, body) {
  if (!can(user, 'bill')) throw new UserError('Your role cannot bill.', 403);
  const uuid = String(body.uuid || '');
  if (!UUID.test(uuid)) throw new UserError('Bad bill id. Reload the page.');
  const counter = cleanCounter(body.counter);
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) throw new UserError('The bill is empty.');
  if (lines.length > 300) throw new UserError('Too many lines on one bill.');
  const cfg = await settings.load();

  const done = await db.one('SELECT id FROM sales WHERE client_uuid=?', [uuid]);
  if (done) return receipt(done.id);

  // approvals are checked before the transaction (they may need a database read of their own)
  const prepared = [];
  for (const l of lines) {
    const qty = milli(l.qty, 'quantity');
    if (!qty || qty <= 0) throw new UserError('Quantity must be more than zero.');
    if (qty > 100000000) throw new UserError('Quantity is too large.');
    const p = { item_id: Number(l.id), qty, rate: null, disc: 0, note: String(l.note || '').slice(0, 160), approver: null };
    if (l.rate !== undefined && l.rate !== null && l.rate !== '') {
      p.rate = paise(l.rate, 'price');
      if (p.rate < 0) throw new UserError('Price cannot be negative.');
      if (l.delivery) { p.delivery = true; prepared.push(p); continue; }   // delivery charge of an online order: checked below
      p.approver = await approvedBy(user, 'price_override', l.approval_price || l.approval);
      if (!p.approver) throw new UserError('A manager must approve the price change.', 403);
    }
    if (l.disc) {
      p.disc = paise(l.disc, 'discount');
      if (p.disc < 0) throw new UserError('Discount cannot be negative.');
      const a = await approvedBy(user, 'discount_approve', l.approval_disc || l.approval);
      if (!a) throw new UserError('A manager must approve the discount.', 403);
      p.approver = p.approver || a;
    }
    prepared.push(p);
  }

  const wantsCredit = (body.payments || []).some((x) => x && x.method === 'credit' && paise(x.amount));
  let creditBy = null;
  if (wantsCredit) {
    creditBy = await approvedBy(user, 'credit_sale', body.approval_credit);
    if (!creditBy) throw new UserError('A manager must approve selling on credit (udhaar).', 403);
  }

  let saleId;
  try {
    saleId = await db.tx(async (q) => {
      const shift = await q.one('SELECT * FROM shifts WHERE open_key=? FOR UPDATE', [counter]);
      if (!shift) throw new UserError(`No shift is open on ${counter}. Open the shift (Cash) first.`);
      const now = nowIST();
      const bdate = now.slice(0, 10);

      // customer: chosen by id, or found / added by mobile number
      let customerId = null;
      const cu = body.customer || null;
      if (cu && cu.id) {
        customerId = (await q.one('SELECT id FROM customers WHERE id=?', [cu.id]))?.id || null;
      } else if (cu && cu.phone) {
        const phone = String(cu.phone).replace(/\D/g, '').slice(-10);
        if (phone.length !== 10) throw new UserError('Customer mobile number must have 10 digits.');
        const found = await q.one('SELECT id FROM customers WHERE phone=?', [phone]);
        customerId = found ? found.id : (await q('INSERT INTO customers (name, phone, created_at) VALUES (?,?,?)',
          [String(cu.name || 'Customer').trim().slice(0, 100) || 'Customer', phone, now])).insertId;
      }

      // an online order being billed: it must still be open and not billed yet
      let order = null;
      if (body.order_id) {
        order = await q.one('SELECT * FROM online_orders WHERE id=? FOR UPDATE', [body.order_id]);
        if (!order) throw new UserError('Online order not found.');
        if (order.sale_id) throw new UserError(`Online order ${order.number} is already billed.`);
        if (order.status === 'cancelled') throw new UserError(`Online order ${order.number} was cancelled.`);
        if (!customerId) {                                 // the online customer gets the points for their order
          customerId = order.customer_id || (await q.one('SELECT id FROM customers WHERE phone=?', [String(order.phone).slice(-10)]))?.id || null;
        }
      }

      const calc = [];
      let gross = 0;
      let discount = 0;
      for (const p of prepared) {
        const item = await q.one('SELECT * FROM items WHERE id=?', [p.item_id]);
        if (!item) throw new UserError('A product on the bill no longer exists. Remove it and scan again.');
        if (!item.active && !p.delivery) throw new UserError(`${item.name} is not active for sale.`);
        if (p.delivery && (item.sku !== DELIVERY_SKU || !order || paise(order.delivery_charge) !== p.rate || p.qty !== 1000)) {
          throw new UserError('The delivery charge must match the online order.');
        }
        if (item.unit === 'pcs' && p.qty % 1000) throw new UserError(`${item.name} is sold by the piece: use a whole number.`);
        if (cfg.require_tax_setup === '1' && item.tax_class === 'unset') throw new UserError(`${item.name}: GST treatment not set.`);
        const list = paise(item.offer_price !== null && bdate >= (item.offer_from || '2000-01-01') && bdate <= (item.offer_to || '2999-12-31') ? item.offer_price : item.price);
        if (list === null && p.rate === null) throw new UserError(`${item.name} has no selling price.`);
        const rate = p.rate ?? list;
        const g = lineAmount(rate, p.qty);
        if (p.disc > g) throw new UserError(`Discount on ${item.name} is more than its amount.`);
        const net = g - p.disc;
        const bp = item.tax_class === 'taxable' ? rateBp(item.gst_rate) : 0;
        calc.push({ item, p, list: p.delivery ? rate : list ?? rate, rate, gross: g, net, bp, tax: splitTax(net, bp) });
        gross += g;
        discount += p.disc;
      }
      const total = gross - discount;

      // payments: cash / UPI / card, together exactly the bill total
      const pays = (Array.isArray(body.payments) ? body.payments : []).map((x) => ({
        method: String(x.method || ''), amount: paise(x.amount, 'payment') || 0,
        tendered: x.tendered === undefined || x.tendered === '' ? null : paise(x.tendered, 'cash given'),
        reference: String(x.reference || '').slice(0, 60),
      })).filter((x) => x.amount);
      if (!pays.length) throw new UserError('Take the payment first.');
      for (const x of pays) {
        if (!METHODS.includes(x.method)) throw new UserError('Unknown payment method.');
        if (x.amount < 0) throw new UserError('Payment cannot be negative.');
        if (x.method === 'cash' && x.tendered !== null && x.tendered < x.amount) throw new UserError('Cash given is less than the cash amount.');
        if (x.method === 'credit' && !customerId) throw new UserError('Choose the customer (F7) to sell on credit.');
      }
      const paid = pays.reduce((s, x) => s + x.amount, 0);
      if (paid !== total) throw new UserError(`Payment ₹${rs(paid)} does not match the bill total ₹${rs(total)}.`);

      // loyalty points: spent as a payment, earned on the rest of the bill
      const lr = loyalty.rules(cfg);
      const byPoints = pays.filter((x) => x.method === 'points').reduce((s, x) => s + x.amount, 0);
      let pointsUsed = 0;
      if (byPoints) {
        if (!lr.on) throw new UserError('Loyalty points are switched off in Settings.');
        if (!customerId) throw new UserError('Choose the customer (F7) to pay with points.');
        pointsUsed = loyalty.pointsToPay(byPoints, lr);
        if (pointsUsed === null) throw new UserError(`Points pay in steps of ₹${lr.value}.`);
        const have = Number((await q.one('SELECT points FROM customers WHERE id=? FOR UPDATE', [customerId])).points);
        if (have < lr.min) throw new UserError(`Points can be used from ${lr.min} points. The customer has ${have}.`);
        if (pointsUsed > have) throw new UserError(`The customer has only ${have} points (₹${loyalty.worth(have, lr)}).`);
      }
      const pointsEarned = customerId ? loyalty.pointsFor(total - byPoints, lr) : 0;

      const prefix = cfg.invoice_prefix;
      const fy = financialYear(bdate);
      await q('INSERT INTO sequences (k, last) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE last=LAST_INSERT_ID(last+1)', [`bill:${prefix}:${fy}`]);
      const seq = (await q.one('SELECT LAST_INSERT_ID() n')).n;
      const billNo = `${prefix}/${fy}/${String(seq).padStart(5, '0')}`;
      if (billNo.length > 20) throw new UserError('Invoice prefix too long.');

      const sale = await q(`INSERT INTO sales (bill_no, client_uuid, business_date, created_at, shift_id, counter, cashier_id, customer_id,
        gross, discount, total, order_id, points_earned, points_used) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [billNo, uuid, bdate, now, shift.id, counter, user.id, customerId, rs(gross), rs(discount), rs(total), order ? order.id : null,
          pointsEarned, pointsUsed]);
      const id = sale.insertId;
      if (pointsUsed) await loyalty.post(q, { customerId, kind: 'redeem', points: -pointsUsed, ref: billNo, saleId: id, userId: user.id, at: now });
      if (pointsEarned) await loyalty.post(q, { customerId, kind: 'earn', points: pointsEarned, ref: billNo, saleId: id, userId: user.id, at: now });
      const refPts = Math.max(0, Math.floor(Number(cfg.referral_points) || 0));
      if (customerId && lr.on && refPts) {
        const cu = await q.one('SELECT referred_by, ref_rewarded FROM customers WHERE id=? FOR UPDATE', [customerId]);
        if (cu && cu.referred_by && !cu.ref_rewarded) {
          await q('UPDATE customers SET ref_rewarded=1 WHERE id=?', [customerId]);
          await loyalty.post(q, { customerId: cu.referred_by, kind: 'refer', points: refPts, ref: billNo, saleId: id, userId: user.id, at: now });
        }
      }

      for (const c of calc) {
        const taken = c.item.sku === DELIVERY_SKU ? [] : await catalog.issue(q, c.item, c.p.qty, { kind: 'sale', ref: billNo, user });
        const cost = taken.reduce((s, t) => s + Math.round(Number(t.unit_cost) * t.qty / 10), 0);   // paise
        const line = await q(`INSERT INTO sale_lines (sale_id, item_id, sku, name, name_ta, unit, qty, list_price, rate, mrp, gross, discount,
          discount_note, net, gst_rate, taxable, cgst, sgst, cost, approved_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, c.item.id, c.item.sku, c.item.name, c.item.name_ta, c.item.unit, qtyDb(c.p.qty), rs(c.list), rs(c.rate), c.item.mrp,
          rs(c.gross), rs(c.p.disc), c.p.note, rs(c.net), rs(c.bp), rs(c.tax.taxable), rs(c.tax.cgst), rs(c.tax.sgst), rs(cost),
          c.p.approver]);
        for (const t of taken) {
          await q('INSERT INTO sale_lot_allocs (line_id, lot_id, qty, unit_cost) VALUES (?,?,?,?)', [line.insertId, t.lot_id, qtyDb(t.qty), t.unit_cost]);
        }
        if (c.rate !== c.list) {
          await audit({ user_id: user.id, approver_id: c.p.approver, action: 'price_override', value: rs(lineAmount(c.list - c.rate, c.p.qty)),
            summary: `${billNo}: ${c.item.name} ₹${rs(c.list)} → ₹${rs(c.rate)}` }, q);
        }
        if (c.p.disc) {
          await audit({ user_id: user.id, approver_id: c.p.approver, action: 'discount', value: rs(c.p.disc),
            summary: `${billNo}: ${c.item.name} discount ₹${rs(c.p.disc)} ${c.p.note}` }, q);
        }
      }
      for (const x of pays) {
        const change = x.method === 'cash' && x.tendered !== null ? x.tendered - x.amount : 0;
        await q('INSERT INTO payments (sale_id, method, amount, tendered, change_amt, reference) VALUES (?,?,?,?,?,?)',
          [id, x.method, rs(x.amount), x.tendered === null ? null : rs(x.tendered), rs(change), x.reference]);
        if (x.method === 'credit') {
          await q('INSERT INTO customer_ledger (customer_id, at, kind, amount, ref, user_id, shift_id) VALUES (?,?,?,?,?,?,?)',
            [customerId, now, 'sale', rs(x.amount), billNo, user.id, shift.id]);
          await audit({ user_id: user.id, approver_id: creditBy, action: 'credit_sale', value: rs(x.amount), summary: `${billNo}: ₹${rs(x.amount)} on credit` }, q);
        }
      }
      if (order) {
        await q("UPDATE online_orders SET sale_id=?, status='done', updated_at=? WHERE id=?", [id, now, order.id]);
      }
      return id;
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' && /client_uuid/.test(err.message)) {     // the same bill raced in twice: return the saved one
      const again = await db.one('SELECT id FROM sales WHERE client_uuid=?', [uuid]);
      if (again) return receipt(again.id);
    }
    throw err;
  }
  return receipt(saleId);
}

async function receipt(saleId) {
  const s = await db.one(`SELECT x.*, u.name cashier, c.name customer_name, c.phone customer_phone, c.points customer_points FROM sales x
    JOIN users u ON u.id=x.cashier_id LEFT JOIN customers c ON c.id=x.customer_id WHERE x.id=?`, [saleId]);
  if (!s) throw new UserError('Bill not found.', 404);
  const lines = await db.query('SELECT * FROM sale_lines WHERE sale_id=? ORDER BY id', [saleId]);
  const pays = await db.query('SELECT method, amount, tendered, change_amt, reference FROM payments WHERE sale_id=? ORDER BY id', [saleId]);
  const gst = {};
  for (const l of lines) {
    if (Number(l.gst_rate) <= 0) continue;
    const g = (gst[l.gst_rate] ||= { rate: l.gst_rate, taxable: 0, cgst: 0, sgst: 0 });
    g.taxable += paise(l.taxable); g.cgst += paise(l.cgst); g.sgst += paise(l.sgst);
  }
  return {
    id: s.id, bill_no: s.bill_no, uuid: s.client_uuid, at: s.created_at, counter: s.counter, cashier: s.cashier,
    customer: s.customer_id ? { name: s.customer_name, phone: s.customer_phone, points: s.customer_points } : null,
    points_earned: s.points_earned, points_used: s.points_used,
    gross: s.gross, discount: s.discount, total: s.total, print_count: s.print_count, order_id: s.order_id,
    returned: (await db.one('SELECT SUM(total) t FROM sale_returns WHERE sale_id=?', [saleId])).t || null,
    lines: lines.map((l) => ({ id: l.id, returned_qty: qtyStr(milli(l.returned_qty)), name: l.name, name_ta: l.name_ta, unit: l.unit, qty: qtyStr(milli(l.qty)), rate: l.rate, mrp: l.mrp,
      gross: l.gross, discount: l.discount, net: l.net, gst_rate: l.gst_rate })),
    payments: pays,
    gst: Object.values(gst).map((g) => ({ rate: g.rate, taxable: rs(g.taxable), cgst: rs(g.cgst), sgst: rs(g.sgst) })),
    items_count: lines.length,
  };
}

async function markPrinted(saleId, user, reprint) {
  const s = await db.one('SELECT id, bill_no, print_count FROM sales WHERE id=?', [saleId]);
  if (!s) throw new UserError('Bill not found.', 404);
  await db.query('UPDATE sales SET print_count=print_count+1 WHERE id=?', [saleId]);
  if (reprint && s.print_count > 0) await audit({ user_id: user.id, action: 'reprint', summary: `${s.bill_no} printed again` });
}

async function recentBills({ q = '', date = '', counter = '', from = '', to = '' }) {
  const where = [];
  const args = [];
  if (q) { where.push('(x.bill_no LIKE ? OR c.phone LIKE ? OR c.name LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (date) { where.push('x.business_date=?'); args.push(date); }
  if (from && to) { where.push('x.business_date BETWEEN ? AND ?'); args.push(from, to); }
  if (counter) { where.push('x.counter=?'); args.push(counter); }
  return db.query(`SELECT x.id, x.bill_no, x.created_at, x.counter, x.total, u.name cashier, c.name customer,
    (SELECT GROUP_CONCAT(DISTINCT method) FROM payments WHERE sale_id=x.id) methods
    FROM sales x JOIN users u ON u.id=x.cashier_id LEFT JOIN customers c ON c.id=x.customer_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY x.id DESC LIMIT 500`, args);
}

async function findCustomers(text) {
  text = String(text || '').trim().slice(0, 40);
  if (!text) return [];
  const digits = text.replace(/\D/g, '');
  return db.query(`SELECT id, name, phone, points, credit_limit, (SELECT COALESCE(SUM(amount),0) FROM customer_ledger WHERE customer_id=customers.id) balance
    FROM customers WHERE name LIKE ? ${digits.length >= 3 ? 'OR phone LIKE ?' : ''}
    ORDER BY name LIMIT 15`, digits.length >= 3 ? [`%${text}%`, `%${digits}%`] : [`%${text}%`]);
}

module.exports = { lastClosed, checkout, receipt, markPrinted, recentBills, openShift, startShift, closeShift, cashSummary, cashMove, findCustomers,
  cleanCounter, METHODS, DELIVERY_SKU };
