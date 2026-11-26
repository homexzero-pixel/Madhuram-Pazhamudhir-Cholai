'use strict';
// Stock held for online orders ("reserved") and what the customers' site may show.
//
//   physical  = items.on_hand   (what is in the shop, including bags packed for online orders)
//   reserved  = items.reserved  (held for open online orders: placed, invoiced, packed, out for delivery)
//   available = physical − reserved   → the customers' site shows a product only while this is above 0
//
// Every change to `reserved` happens inside a transaction that first locks the product rows with
// SELECT … FOR UPDATE in product-id order, so two customers can never both get the last piece, and two
// transactions never wait for each other in a circle. `reconcile()` checks the stored numbers against the open
// orders (at start-up and from the owner's anomaly screen) and corrects any difference under the same locks.
const db = require('./db');
const { milli, qtyDb, qtyStr, nowIST } = require('./money');

const OPEN = ['new', 'accepted', 'packing', 'ready', 'out'];
const DELIVERY_SKU = 'DELIVERY';
const AVAILABLE = '(i.on_hand - i.reserved)';

// Lock product rows (ascending id) and return them by id.
async function lockItems(q, ids, extra = '') {
  const list = [...new Set(ids.map(Number).filter((n) => n > 0))].sort((a, b) => a - b);
  if (!list.length) return new Map();
  const rows = await q(`SELECT i.*${extra} FROM items i WHERE i.id IN (?) ORDER BY i.id FOR UPDATE`, [list]);
  return new Map(rows.map((r) => [r.id, r]));
}

// Hold (qty > 0) or release (qty < 0) stock for an order. The product row must already be locked by this transaction.
async function hold(q, itemId, qtyMilli) {
  if (!qtyMilli) return;
  await q('UPDATE items SET reserved = GREATEST(reserved + ?, 0) WHERE id=?', [qtyDb(qtyMilli), itemId]);
}

// What every product should have reserved, worked out from the open orders:
// orders not invoiced yet hold their order lines; invoiced orders (packing / ready / out) hold their bill lines,
// so a weighed item that came out a little heavier, or an item added at the counter, is held too.
const EXPECTED = `SELECT item_id, SUM(q) q FROM (
    SELECT l.item_id, l.qty q FROM online_order_lines l JOIN online_orders o ON o.id=l.order_id
      WHERE o.status IN (?) AND o.sale_id IS NULL
    UNION ALL
    SELECT sl.item_id, sl.qty q FROM sale_lines sl JOIN online_orders o ON o.sale_id=sl.sale_id JOIN sales x ON x.id=sl.sale_id
      WHERE o.status IN (?) AND x.stock_pending=1 AND sl.sku <> '${DELIVERY_SKU}'
  ) t GROUP BY item_id`;

async function expectedFor(q, itemId) {
  const r = await q(`SELECT COALESCE(SUM(q), 0) q FROM (${EXPECTED}) e WHERE item_id=?`, [OPEN, OPEN, itemId]);
  return milli(r[0].q);
}

// Compare and correct. Returns the products that were wrong (normally none).
async function reconcile({ fix = true } = {}) {
  const drift = await db.query(`SELECT i.id, i.name, i.reserved, COALESCE(e.q, 0) expected FROM items i LEFT JOIN (${EXPECTED}) e ON e.item_id=i.id
    WHERE i.reserved <> COALESCE(e.q, 0)`, [OPEN, OPEN]);
  const out = [];
  for (const d of drift) {
    if (!fix) { out.push({ id: d.id, name: d.name, was: qtyStr(milli(d.reserved)), now: qtyStr(milli(d.expected)) }); continue; }
    // locked and counted again: an order placed a moment ago is either already counted or waits for this to finish
    const r = await db.tx(async (q) => {
      const it = (await q('SELECT id, name, reserved FROM items WHERE id=? FOR UPDATE', [d.id]))[0];
      const want = await expectedFor(q, d.id);
      if (milli(it.reserved) === want) return null;
      await q('UPDATE items SET reserved=? WHERE id=?', [qtyDb(want), d.id]);
      await q('INSERT INTO audit (at, action, summary, value) VALUES (?,?,?,0)',
        [nowIST(), 'stock_reserved', `${it.name}: held for online orders corrected ${qtyStr(milli(it.reserved))} → ${qtyStr(want)}`.slice(0, 300)]);
      return { id: d.id, name: it.name, was: qtyStr(milli(it.reserved)), now: qtyStr(want) };
    });
    if (r) out.push(r);
  }
  return out;
}

// "Popular" for the shop: bills in the last 30 days per product, refreshed every few minutes by the billing site.
async function refreshStats() {
  const now = nowIST();
  await db.tx(async (q) => {
    await q('DELETE FROM item_stats');
    await q(`INSERT INTO item_stats (item_id, sold_30d, updated_at)
      SELECT l.item_id, COUNT(*), ? FROM sale_lines l JOIN sales x ON x.id=l.sale_id
      WHERE x.business_date > DATE_SUB(CURDATE(), INTERVAL 30 DAY) GROUP BY l.item_id`, [now]);
  });
}

// Things the owner should look at: more held than in stock, orders waiting too long, money not collected, wrong holds.
async function anomalies() {
  const now = nowIST();
  const over = await db.query(`SELECT i.id, i.name, i.unit, i.on_hand, i.reserved FROM items i WHERE i.reserved > i.on_hand ORDER BY i.reserved - i.on_hand DESC LIMIT 30`);
  const stale = await db.query(`SELECT o.id, o.number, o.status, o.slot, o.created_at FROM online_orders o
    WHERE o.status IN (?) AND o.slot < DATE_SUB(?, INTERVAL 6 HOUR) ORDER BY o.slot LIMIT 30`, [OPEN, now]);
  const cod = await db.query(`SELECT o.id, o.number, o.agent_name, o.dispatched_at, p.amount FROM online_orders o
    JOIN payments p ON p.sale_id=o.sale_id AND p.method='cod' WHERE o.status='out' AND o.dispatched_at < DATE_SUB(?, INTERVAL 3 HOUR)
    ORDER BY o.dispatched_at LIMIT 30`, [now]);
  const drift = await reconcile({ fix: false });
  const items = [];
  for (const r of over) {
    items.push({ kind: 'oversold', level: 'high', ref: r.name, item_id: r.id,
      text: `${r.name}: ${qtyStr(milli(r.reserved))} ${r.unit} held for online orders but only ${qtyStr(milli(r.on_hand))} in stock. Check the shelf; the shop hides it until stock comes in.` });
  }
  for (const o of stale) {
    items.push({ kind: 'stale_order', level: 'medium', ref: o.number, order_id: o.id,
      text: `${o.number} (${o.status}) was due ${o.slot.slice(0, 16)} and is still open: it is holding stock.` });
  }
  for (const o of cod) {
    items.push({ kind: 'cod_pending', level: 'medium', ref: o.number, order_id: o.id,
      text: `${o.number}: ₹${o.amount} cash on delivery with ${o.agent_name || 'the delivery person'} since ${String(o.dispatched_at).slice(11, 16)} – not completed yet.` });
  }
  for (const d of drift) {
    items.push({ kind: 'reserved_drift', level: 'high', ref: d.name, item_id: d.id, text: `${d.name}: held ${d.was}, open orders need ${d.now}. Press "Correct held stock".` });
  }
  return items;
}

module.exports = { OPEN, AVAILABLE, DELIVERY_SKU, lockItems, hold, reconcile, refreshStats, anomalies, expectedFor };
