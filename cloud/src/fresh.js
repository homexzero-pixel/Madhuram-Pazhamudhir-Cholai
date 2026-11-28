'use strict';
// "Start fresh": after testing, before the shop starts real billing, the owner removes the test bills, returns, online orders,
// cash drawers and expenses in one go (Settings & backup). A full backup is saved first; if it cannot be saved nothing is removed.
// Kept: products, prices, barcodes, photos, categories, customers and their accounts, staff logins, settings, stock received.
// The stock the test bills took is put back (or, if chosen, every product's stock is set to 0 or left as it is).
// Bill, return and online order numbers start again from 1; points and dues from the test bills are taken off.
const db = require('./db');
const { nowIST, UserError, milli, qtyDb } = require('./money');

// counter and order events that belong to the removed bills (other history, e.g. price and stock changes, stays)
const SALE_ACTIONS = ['online_order', 'price_override', 'discount', 'reprint', 'refund', 'credit_sale', 'credit_paid', 'bill_customer',
  'shift_open', 'shift_close', 'float_mismatch', 'expense', 'bill_cancel', 'line_remove', 'unknown_barcode'];

async function preview() {
  const n = async (sql) => Number((await db.one(sql)).n || 0);
  const s = await db.one('SELECT COUNT(*) n, COALESCE(SUM(total), 0) total, MIN(business_date) first, MAX(business_date) last FROM sales');
  return {
    bills: Number(s.n), bills_total: Number(s.total).toFixed(2), first: s.first, last: s.last,
    returns: await n('SELECT COUNT(*) n FROM sale_returns'),
    orders: await n('SELECT COUNT(*) n FROM online_orders'),
    shifts: await n('SELECT COUNT(*) n FROM shifts'),
    expenses: await n('SELECT COUNT(*) n FROM expenses'),
    with_stock: await n('SELECT COUNT(*) n FROM items WHERE on_hand > 0'),
  };
}

async function run({ stock = 'restore', confirm = '' } = {}, user) {
  if (!user || user.role !== 'owner') throw new UserError('Only the owner can start fresh.', 403);
  if (String(confirm).trim().toUpperCase() !== 'FRESH') throw new UserError('Type FRESH in the box to confirm.');
  if (!['restore', 'zero', 'keep'].includes(stock)) throw new UserError('Choose what happens to the stock.');
  const before = await preview();
  const backup = await require('./backups').make('fresh');      // no backup, nothing removed

  const done = await db.tx(async (q) => {
    const now = nowIST();
    const refs = (await q('SELECT bill_no r FROM sales UNION SELECT return_no r FROM sale_returns')).map((x) => x.r);
    let restored = 0;
    // the stock: what the test bills took goes back on the shelf, what test returns brought in comes off again
    if (refs.length) {
      const moves = await q(`SELECT m.id, m.item_id, m.lot_id, m.qty, l.status FROM stock_moves m LEFT JOIN lots l ON l.id=m.lot_id
        WHERE m.kind IN ('sale','return') AND m.ref IN (?)`, [refs]);
      if (stock === 'restore') {
        const touched = new Set();
        for (const m of moves) {
          if (!m.status || m.status === 'short') continue;            // sold when stock showed 0: nothing came off the shelf
          const back = -milli(m.qty);                                  // a sale took (−), a return added (+)
          await q('UPDATE lots SET qty = GREATEST(qty + ?, 0) WHERE id=?', [qtyDb(back), m.lot_id]);
          await q('UPDATE items SET on_hand = GREATEST(on_hand + ?, 0) WHERE id=?', [qtyDb(back), m.item_id]);
          touched.add(m.item_id);
        }
        restored = touched.size;
      }
      for (let i = 0; i < moves.length; i += 500) await q('DELETE FROM stock_moves WHERE id IN (?)', [moves.slice(i, i + 500).map((m) => m.id)]);
    }
    if (stock === 'zero') {
      await q("UPDATE lots SET qty=0 WHERE status IN ('sellable','short')");
      await q('UPDATE items SET on_hand=0');
    }
    // dues: what the test bills put on credit and what was paid at the counters (dues brought from the shop PC stay)
    if (refs.length) await q('DELETE FROM customer_ledger WHERE ref IN (?)', [refs]);
    await q('DELETE FROM customer_ledger WHERE shift_id IS NOT NULL');
    // points earned or used on the test bills; each customer's points worked out again from what is left
    await q('DELETE FROM loyalty_ledger WHERE sale_id IS NOT NULL');
    await q(`UPDATE customers c LEFT JOIN (SELECT customer_id, SUM(points) p FROM loyalty_ledger GROUP BY customer_id) l ON l.customer_id=c.id
      SET c.points = GREATEST(0, COALESCE(l.p, 0))`);
    await q('UPDATE customers SET ref_rewarded=0');
    for (const t of ['sale_lot_allocs', 'sale_lines', 'payments', 'sales', 'return_lines', 'sale_returns', 'online_order_lines', 'online_orders',
      'cash_moves', 'shifts', 'expenses', 'outbox', 'ai_logs']) {
      await q(`DELETE FROM \`${t}\``);
    }
    await q('UPDATE items SET reserved=0');                            // no open online orders hold anything now
    await q("DELETE FROM sequences WHERE k LIKE 'bill:%' OR k LIKE 'return:%' OR k='online'");
    await q('DELETE FROM audit WHERE action IN (?)', [SALE_ACTIONS]);
    await q('INSERT INTO audit (at, user_id, action, summary, value) VALUES (?,?,?,?,?)', [now, user.id, 'fresh_start',
      `Started fresh: ${before.bills} test bills (₹${before.bills_total}), ${before.returns} returns, ${before.orders} online orders, ` +
      `${before.shifts} cash drawers and ${before.expenses} expenses removed; stock ${stock === 'restore' ? 'put back' : stock === 'zero' ? 'set to 0' : 'left as it was'}. ` +
      `Backup ${backup.name}`.slice(0, 300), before.bills_total]);
    return { restored };
  });
  await require('./stock').refreshStats().catch(() => {});            // best sellers and "sold in 30 days" from the real bills only
  require('./cache').clear();
  return { ...before, backup: backup.name, stock, restored_products: done.restored };
}

module.exports = { preview, run };
