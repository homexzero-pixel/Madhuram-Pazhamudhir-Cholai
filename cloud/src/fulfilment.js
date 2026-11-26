'use strict';
// Online orders on the billing side.
//
//   new ──Accept──▶ accepted ──"Bill & pack" at a counter (GST invoice; stock stays reserved)──▶ packing
//   packing ──Dispatch (delivery person's name, phone, tracking)──▶ out ──Process completed──▶ done     (home delivery)
//   packing ──Ready for pickup──▶ ready ──Process completed──▶ done                                     (takeaway)
//   any open state ──Cancel──▶ cancelled   (an invoiced order gets a full credit note; reserved stock is released)
//
// "Process completed" takes the goods off the shelf (first expiry first), releases the reservation, puts cash on delivery
// into the counter's cash drawer (or records the UPI transaction number), closes the order and lets the customer
// download the GST invoice. Every step is one transaction with row locks (shift → order → bill → products → lots),
// writes an audit line and an event for the billing screens.
const db = require('./db');
const settings = require('./settings');
const catalog = require('./catalog');
const stock = require('./stock');
const events = require('./events');
const loyalty = require('./loyalty');
const shop = require('./shop');
const { audit, approvedBy } = require('./auth');
const { paise, milli, rs, qtyDb, qtyStr, lineAmount, financialYear, nowIST, UserError } = require('./money');

const { OPEN, DELIVERY_SKU } = stock;
const STATUS = shop.STATUS;
const cleanRef = (v) => String(v || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 40);
const cleanCounter = (v) => String(v || '').trim().slice(0, 20);

async function lockOrder(q, id) {
  const o = await q.one('SELECT * FROM online_orders WHERE id=? FOR UPDATE', [id]);
  if (!o) throw new UserError('Order not found.', 404);
  return o;
}
async function lockShift(q, counter) {
  if (!counter) return null;
  return q.one('SELECT * FROM shifts WHERE open_key=? FOR UPDATE', [counter]);
}
const said = (o, s) => `Order ${o.number} is ${STATUS[o.status].toLowerCase()}; ${s}`;

// ---------------------------------------------------------------- accept / ready / dispatch
async function accept(id, user) {
  return db.tx(async (q) => {
    const o = await lockOrder(q, id);
    if (o.status !== 'new') throw new UserError(said(o, 'only a new order can be accepted.'));
    const now = nowIST();
    await q("UPDATE online_orders SET status='accepted', accepted_at=COALESCE(accepted_at, ?), updated_at=? WHERE id=?", [now, now, id]);
    await audit({ user_id: user.id, action: 'online_order', summary: `Online order ${o.number}: accepted` }, q);
    await events.emit(q, 'ORDER_ACCEPTED', { order_id: o.id, number: o.number });
  });
}

async function markReady(id, user) {
  return db.tx(async (q) => {
    const o = await lockOrder(q, id);
    if (o.mode !== 'pickup') throw new UserError('This is a home delivery: use "Out for delivery".');
    if (!o.sale_id) throw new UserError('Bill & pack this order at the counter first (the invoice goes in the bag).');
    if (o.status !== 'packing') throw new UserError(said(o, 'it cannot be marked ready.'));
    const now = nowIST();
    await q("UPDATE online_orders SET status='ready', ready_at=?, updated_at=? WHERE id=?", [now, now, id]);
    await audit({ user_id: user.id, action: 'online_order', summary: `Online order ${o.number}: ready for pickup` }, q);
    await events.emit(q, 'ORDER_READY', { order_id: o.id, number: o.number });
  });
}

async function dispatch(id, data, user) {
  const name = String(data.agent_name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (name.length < 2) throw new UserError('Enter the delivery person\'s name.');
  const phone = shop.phone10(data.agent_phone);
  const tracking = String(data.tracking || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (/^[a-z]+:/i.test(tracking) && !/^https:\/\/[^\s"'<>]+$/.test(tracking)) throw new UserError('A tracking link must start with https://');
  return db.tx(async (q) => {
    const o = await lockOrder(q, id);
    if (o.mode !== 'delivery') throw new UserError('This is a takeaway order: use "Ready for pickup".');
    if (!o.sale_id) throw new UserError('Bill & pack this order at the counter first (the invoice goes with the delivery).');
    if (!['packing', 'out'].includes(o.status)) throw new UserError(said(o, 'it cannot be sent out.'));
    const now = nowIST();
    await q(`UPDATE online_orders SET status='out', dispatched_at=?, agent_name=?, agent_phone=?, tracking=?, updated_at=? WHERE id=?`,
      [now, name, phone, tracking, now, id]);
    await audit({ user_id: user.id, action: 'online_order', summary: `Online order ${o.number}: out for delivery with ${name} (${phone})` }, q);
    await events.emit(q, 'ORDER_DISPATCHED', { order_id: o.id, number: o.number, agent: name, at: now });
  });
}

// ---------------------------------------------------------------- Process completed
// What the staff confirm before completing: bill, items leaving the shelf, money to collect.
async function completePreview(id) {
  const o = await shop.order('o.id=?', [id]);
  if (!o.sale_id) throw new UserError('Bill & pack this order at the counter first.');
  const lines = await db.query(`SELECT l.name, l.unit, l.qty, l.net, l.sku, i.on_hand FROM sale_lines l JOIN items i ON i.id=l.item_id
    WHERE l.sale_id=? ORDER BY l.id`, [o.sale_id]);
  return { id: o.id, number: o.number, mode: o.mode, status: o.status, bill_no: o.bill_no, total: o.bill_total, cod: o.cod_due || '0.00',
    payments: o.payments, agent: o.agent_name ? { name: o.agent_name, phone: o.agent_phone } : null, stock_pending: !!o.stock_pending,
    pay_ref: o.pay_ref || '',
    lines: lines.filter((l) => l.sku !== DELIVERY_SKU).map((l) => ({ name: l.name, unit: l.unit, qty: qtyStr(milli(l.qty)), amount: l.net,
      on_hand: qtyStr(milli(l.on_hand)) })) };
}

async function complete(id, data, user) {
  const counter = cleanCounter(data.counter);
  const how = String(data.method || '');
  return db.tx(async (q) => {
    const shift = how === 'cash' ? await lockShift(q, counter) : null;      // shift first, like every bill
    const o = await lockOrder(q, id);
    if (o.status === 'done') throw new UserError(`${o.number} is already completed.`);
    if (!o.sale_id) throw new UserError('Bill & pack this order at the counter first.');
    if (o.mode === 'delivery' && o.status !== 'out') throw new UserError('Send it out first: enter the delivery person (Out for delivery).');
    if (o.mode === 'pickup' && !['packing', 'ready'].includes(o.status)) throw new UserError(said(o, 'it cannot be completed.'));
    const sale = await q.one('SELECT * FROM sales WHERE id=? FOR UPDATE', [o.sale_id]);
    const lines = await q('SELECT * FROM sale_lines WHERE sale_id=? ORDER BY id', [sale.id]);
    const pays = await q('SELECT method, amount FROM payments WHERE sale_id=?', [sale.id]);
    const cod = pays.filter((p) => p.method === 'cod').reduce((t, p) => t + paise(p.amount), 0);
    const now = nowIST();

    // the money: cash on delivery goes into this counter's drawer, or the customer paid the delivery person by UPI
    let settle = 'paid';
    let ref = '';
    let shiftId = null;
    if (cod > 0) {
      if (how === 'cash') {
        if (!shift) throw new UserError(`No shift is open on ${counter || 'this counter'}: open it (Cash closing) to take the ₹${rs(cod)} cash.`);
        await q('INSERT INTO cash_moves (shift_id, kind, amount, reason, user_id, at) VALUES (?,?,?,?,?,?)',
          [shift.id, 'cod', rs(cod), `Cash on delivery ${o.number} (${sale.bill_no})`, user.id, now]);
        shiftId = shift.id;
      } else if (how === 'upi') {
        ref = cleanRef(data.ref);
        if (ref.length < 6) throw new UserError('Type the UPI transaction number (UTR) from the payment.');
        shiftId = counter ? ((await q.one('SELECT id FROM shifts WHERE open_key=?', [counter])) || {}).id || null : null;
      } else {
        throw new UserError(`Choose how the ₹${rs(cod)} was received: cash or UPI.`);
      }
      settle = how;
    }

    // the goods leave the shop now: stock out (first expiry first), reservation released
    if (sale.stock_pending) {
      const items = await stock.lockItems(q, lines.map((l) => l.item_id));
      for (const l of lines) {
        if (l.sku === DELIVERY_SKU) continue;
        const it = items.get(l.item_id);
        const qty = milli(l.qty);
        const taken = await catalog.issue(q, it, qty, { kind: 'sale', ref: sale.bill_no, user });
        const cost = taken.reduce((s, t) => s + Math.round(Number(t.unit_cost) * t.qty / 10), 0);
        await q('UPDATE sale_lines SET cost=? WHERE id=?', [rs(cost), l.id]);
        for (const t of taken) {
          await q('INSERT INTO sale_lot_allocs (line_id, lot_id, qty, unit_cost) VALUES (?,?,?,?)', [l.id, t.lot_id, qtyDb(t.qty), t.unit_cost]);
        }
        await stock.hold(q, l.item_id, -qty);
      }
      await q('UPDATE sales SET stock_pending=0 WHERE id=?', [sale.id]);
    }
    await q(`UPDATE online_orders SET status='done', completed_at=?, completed_by=?, settle_method=?, settle_ref=?, settle_shift_id=?, updated_at=? WHERE id=?`,
      [now, user.id, settle, ref, shiftId, now, o.id]);
    await audit({ user_id: user.id, action: 'online_order', value: rs(cod),
      summary: `Online order ${o.number}: process completed (${sale.bill_no}, ₹${sale.total}${cod ? `, cash on delivery ₹${rs(cod)} by ${settle}${ref ? ` ${ref}` : ''}` : ''})` }, q);
    await events.emit(q, 'ORDER_COMPLETED', { order_id: o.id, number: o.number, bill_no: sale.bill_no, total: sale.total, cod: rs(cod), settle });
    return { number: o.number, bill_no: sale.bill_no, total: sale.total, cod: rs(cod), settle };
  });
}

// ---------------------------------------------------------------- cancel (and the credit note for an invoiced order)
async function voidInvoice(q, { sale, o, user, approver, shift, counter, note }) {
  const cfg = await settings.load();
  const now = nowIST();
  const fy = financialYear(now.slice(0, 10));
  const prefix = cfg.credit_note_prefix || 'MCN';
  const pays = await q('SELECT method, amount FROM payments WHERE sale_id=?', [sale.id]);
  const by = (m) => pays.filter((p) => p.method === m).reduce((t, p) => t + paise(p.amount), 0);
  const methods = [...new Set(pays.filter((p) => p.method !== 'cod' && paise(p.amount)).map((p) => p.method))];
  const method = !methods.length ? 'cod' : methods.length === 1 ? methods[0] : 'mixed';
  if (by('cash') && !shift) throw new UserError(`₹${rs(by('cash'))} was paid in cash: open the shift on this counter to give it back.`);
  await q('INSERT INTO sequences (k, last) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE last=LAST_INSERT_ID(last+1)', [`return:${prefix}:${fy}`]);
  const no = `${prefix}/${fy}/${String((await q.one('SELECT LAST_INSERT_ID() n')).n).padStart(5, '0')}`;
  const r = await q(`INSERT INTO sale_returns (return_no, sale_id, business_date, created_at, user_id, approver_id, shift_id, counter, total, method, reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [no, sale.id, now.slice(0, 10), now, user.id, approver, shift ? shift.id : null, counter, sale.total, method,
    `Order ${o.number} cancelled: ${note}`.slice(0, 200)]);
  for (const l of await q('SELECT * FROM sale_lines WHERE sale_id=? FOR UPDATE', [sale.id])) {
    await q(`INSERT INTO return_lines (return_id, sale_line_id, qty, amount, taxable, cgst, sgst, cost, restock) VALUES (?,?,?,?,?,?,?,0,0)`,
      [r.insertId, l.id, l.qty, l.net, l.taxable, l.cgst, l.sgst]);
    await q('UPDATE sale_lines SET returned_qty=qty WHERE id=?', [l.id]);
  }
  if (by('cash')) {
    await q('INSERT INTO cash_moves (shift_id, kind, amount, reason, user_id, at) VALUES (?,?,?,?,?,?)',
      [shift.id, 'refund', rs(by('cash')), `Cancelled order ${o.number}: ${no}`, user.id, now]);
  }
  if (by('credit') && sale.customer_id) {
    await q('INSERT INTO customer_ledger (customer_id, at, kind, amount, ref, user_id) VALUES (?,?,?,?,?,?)',
      [sale.customer_id, now, 'return', rs(-by('credit')), no, user.id]);
  }
  if (sale.customer_id && Number(sale.points_used) > 0) {
    await loyalty.post(q, { customerId: sale.customer_id, kind: 'return', points: Number(sale.points_used), ref: no, saleId: sale.id, userId: user.id, at: now });
  }
  if (sale.customer_id && Number(sale.points_earned) > 0) {
    await loyalty.post(q, { customerId: sale.customer_id, kind: 'return', points: -Number(sale.points_earned), ref: no, saleId: sale.id, userId: user.id, at: now });
  }
  await q('UPDATE sales SET stock_pending=0 WHERE id=?', [sale.id]);
  return { id: r.insertId, no, method, total: sale.total, refund_upi: rs(by('upi') + by('card')), refund_cash: rs(by('cash')) };
}

async function cancel(id, data, user) {
  const note = String(data.note || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (note.length < 3) throw new UserError('Enter why the order is cancelled (the customer will see it).');
  const counter = cleanCounter(data.counter);
  const peek = await db.one('SELECT sale_id, status, number FROM online_orders WHERE id=?', [id]);
  if (!peek) throw new UserError('Order not found.', 404);
  const closed = (o) => new UserError(o.status === 'done' ? `${o.number} is completed: use Returns for its bill.` : `${o.number} is already cancelled.`);
  if (!OPEN.includes(peek.status)) throw closed(peek);
  let approver = null;
  if (peek.sale_id) {          // a GST invoice exists: a credit note is made, like a return
    approver = await approvedBy(user, 'refund', data.approval);
    if (!approver) throw new UserError('This order is already billed: a manager must approve cancelling it (a credit note is made).', 403);
  }
  return db.tx(async (q) => {
    const shift = await lockShift(q, counter);
    const o = await lockOrder(q, id);
    if (!OPEN.includes(o.status)) throw closed(o);
    if (o.sale_id && !approver) throw new UserError('This order was billed a moment ago: cancel again (a manager must approve).', 409);
    let credit = null;
    if (!o.sale_id) {
      const lines = await q('SELECT item_id, qty FROM online_order_lines WHERE order_id=?', [o.id]);
      await stock.lockItems(q, lines.map((l) => l.item_id));
      for (const l of lines) await stock.hold(q, l.item_id, -milli(l.qty));
    } else {
      const sale = await q.one('SELECT * FROM sales WHERE id=? FOR UPDATE', [o.sale_id]);
      if (!sale.stock_pending) throw new UserError('The goods of this bill already left the shop: use Returns.');
      const lines = await q('SELECT item_id, qty, sku FROM sale_lines WHERE sale_id=?', [sale.id]);
      await stock.lockItems(q, lines.map((l) => l.item_id));
      for (const l of lines) if (l.sku !== DELIVERY_SKU) await stock.hold(q, l.item_id, -milli(l.qty));
      credit = await voidInvoice(q, { sale, o, user, approver, shift, counter, note });
    }
    const now = nowIST();
    await q(`UPDATE online_orders SET status='cancelled', status_note=?, cancelled_at=?, void_return_id=?, updated_at=? WHERE id=?`,
      [note, now, credit ? credit.id : null, now, o.id]);
    await audit({ user_id: user.id, approver_id: approver, action: 'online_order', value: credit ? credit.total : '0',
      summary: `Online order ${o.number}: cancelled – ${note}${credit ? ` (credit note ${credit.no})` : ''}` }, q);
    await events.emit(q, 'ORDER_CANCELLED', { order_id: o.id, number: o.number, credit_note: credit ? credit.no : null });
    return { credit };
  });
}

// ---------------------------------------------------------------- before the invoice: an item is not available (or less)
async function changeLine(orderId, lineId, qtyText, user) {
  return db.tx(async (q) => {
    const o = await lockOrder(q, orderId);
    if (o.sale_id || !OPEN.includes(o.status)) throw new UserError('This order can no longer be changed.');
    const l = await q.one('SELECT * FROM online_order_lines WHERE id=? AND order_id=? FOR UPDATE', [lineId, orderId]);
    if (!l) throw new UserError('Line not found.');
    const qty = milli(qtyText === '' || qtyText === undefined ? '0' : qtyText, 'quantity');
    const was = milli(l.ordered_qty ?? l.qty);
    if (qty === null || qty < 0 || qty > was) throw new UserError(`Enter 0 to remove, or less than the ordered ${qtyStr(was)}.`);
    if (l.unit === 'pcs' && qty % 1000) throw new UserError('Use whole pieces.');
    const it = (await stock.lockItems(q, [l.item_id])).get(l.item_id);
    const delta = qty - milli(l.qty);
    if (delta > 0 && it && milli(it.on_hand) - milli(it.reserved) < delta) {
      throw new UserError(`Only ${qtyStr(Math.max(0, milli(it.on_hand) - milli(it.reserved)))} more ${l.unit} of ${l.name} is free.`);
    }
    await stock.hold(q, l.item_id, delta);
    await q('UPDATE online_order_lines SET qty=?, ordered_qty=?, note=? WHERE id=?',
      [qtyDb(qty), qty === was ? null : qtyDb(was), qty === was ? '' : qty ? 'Less available' : 'Not available – removed', l.id]);
    const lines = await q('SELECT qty, price FROM online_order_lines WHERE order_id=?', [orderId]);
    const items = lines.reduce((s, x) => s + lineAmount(paise(x.price), milli(x.qty)), 0);
    await q('UPDATE online_orders SET est_items=?, updated_at=? WHERE id=?', [rs(items), nowIST(), orderId]);
    await audit({ user_id: user.id, action: 'online_order', value: rs(lineAmount(paise(l.price), was - qty)),
      summary: `Online order ${o.number}: ${l.name} ${qtyStr(was)} → ${qtyStr(qty)} ${l.unit} (${qty ? 'less available' : 'not available'})` }, q);
    await events.emit(q, 'ORDER_CHANGED', { order_id: o.id, number: o.number });
  });
}

// ---------------------------------------------------------------- the order as bill lines for the counter ("Bill & pack")
async function forCounter(id, user) {
  const o = await shop.order('o.id=?', [id]);
  if (o.sale_id) throw new UserError(`${o.number} is already billed (${o.bill_no}).`);
  if (!['new', 'accepted', 'ready', 'out'].includes(o.status)) throw new UserError(`${o.number} is ${STATUS[o.status].toLowerCase()}.`);
  const lines = o.lines.filter((l) => milli(l.qty) > 0).map((l) => ({ id: l.item_id, qty: l.qty }));
  if (!lines.length) throw new UserError('Every item was removed from this order. Cancel it instead.');
  let delivery = null;
  if (paise(o.delivery_charge) > 0) {
    await db.query(`INSERT IGNORE INTO items (sku, name, name_ta, unit, price, active, tax_class, updated_at)
      VALUES (?, 'Home delivery charge', 'வீட்டு டெலிவரி கட்டணம்', 'pcs', 0, 0, 'unset', ?)`, [DELIVERY_SKU, nowIST()]);
    delivery = { id: (await db.one('SELECT id FROM items WHERE sku=?', [DELIVERY_SKU])).id, qty: '1', rate: o.delivery_charge, name: 'Home delivery charge' };
  }
  if (o.status === 'new') await accept(o.id, user || { id: null });
  return { order_id: o.id, number: o.number, customer: { phone: o.phone, name: o.name }, lines, delivery, pay_pref: o.pay_pref, pay_ref: o.pay_ref || '',
    mode: o.mode, est_total: o.est_total };
}

// ---------------------------------------------------------------- the customer's WhatsApp message for the current state
async function statusMessage(id, shopUrl) {
  const o = await shop.order('o.id=?', [id]);
  const cfg = await settings.load();
  const when = o.slot_label;
  const bill = o.bill_no ? ` Bill ${o.bill_no}, ₹${o.bill_total}.` : '';
  const cod = o.cod_due && paise(o.cod_due) ? ` Please keep ₹${o.cod_due} ready (cash or UPI).` : '';
  const body = {
    new: `We have received your order. We will confirm it shortly.\n${when}`,
    accepted: `Your order is accepted and we are getting your items. ${o.mode === 'pickup' ? 'Pickup' : 'Delivery'}: ${when}.`,
    packing: `Your order is billed and packed.${bill} ${o.mode === 'pickup' ? 'We will tell you when it is ready at the counter.' : 'It leaves with our delivery person soon.'}`,
    ready: `Your order is ready for pickup at the counter.${bill}${cod}`,
    out: `Our delivery person ${o.agent_name} (${o.agent_phone}) is on the way with your order.${bill}${cod}${o.tracking ? `\nTracking: ${o.tracking}` : ''}`,
    done: `Thank you! Your order is complete.${bill} Your GST invoice is in My orders.`,
    cancelled: `Sorry, your order was cancelled: ${o.status_note}`,
  }[o.status];
  const changed = o.lines.filter((l) => l.ordered_qty !== null);
  const changes = changed.length ? `\n\nChanges (not available):\n${changed.map((l) => `• ${l.name}: ${milli(l.qty) ? `${l.qty} ${l.unit} instead of ${qtyStr(milli(l.ordered_qty))}` : 'removed'}`).join('\n')}` +
    '\nYou are not charged for these. If you already paid for them, we will refund the difference.' : '';
  const link = o.status !== 'cancelled' ? `\nTrack: ${shopUrl}#o=${o.token}` : '';
  return { phone: `91${o.phone}`, text: `*${cfg.name}* – order *${o.number}*\n${body}${changes}${link}\nநன்றி 🙏` };
}

// Older screens send a status name; each goes to its own step.
async function setStatus(id, status, user, note = '') {
  if (status === 'accepted') return accept(id, user);
  if (status === 'ready') return markReady(id, user);
  if (status === 'cancelled') return cancel(id, { note }, user);
  if (status === 'out') throw new UserError('Use "Out for delivery" and enter the delivery person\'s name and phone.');
  throw new UserError('Unknown step.');
}

// Cash on delivery still with delivery people, for the orders screen.
async function codPending() {
  const r = await db.one(`SELECT COUNT(*) n, COALESCE(SUM(p.amount), 0) amount FROM online_orders o JOIN payments p ON p.sale_id=o.sale_id AND p.method='cod'
    WHERE o.status IN ('packing','ready','out')`);
  return { orders: Number(r.n), amount: r.amount };
}

module.exports = { accept, markReady, dispatch, completePreview, complete, cancel, changeLine, forCounter, statusMessage, setStatus, codPending };
