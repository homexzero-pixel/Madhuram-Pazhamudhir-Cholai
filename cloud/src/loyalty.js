'use strict';
const db = require('./db');
const { rs, paise } = require('./money');

// Loyalty points. Settings: loyalty_enabled, loyalty_points_per_100 (points for every ₹100 spent),
// loyalty_point_value (₹ one point is worth when spent), loyalty_min_redeem (points needed before they can be spent).
function rules(cfg) {
  return {
    on: cfg.loyalty_enabled === '1',
    per100: Math.max(0, Number(cfg.loyalty_points_per_100) || 0),
    value: Math.max(0, Number(cfg.loyalty_point_value) || 0),
    min: Math.max(0, Math.floor(Number(cfg.loyalty_min_redeem) || 0)),
  };
}

// Points for every full ₹100 of the bill: ₹350 at 2 points per ₹100 = 6 points.
const pointsFor = (amountPaise, r) => (r.on && r.per100 > 0 && amountPaise > 0 ? Math.floor(Math.floor(amountPaise / 10000) * r.per100 + 1e-9) : 0);

// Points needed to pay an amount (paise), or null when it does not divide evenly.
function pointsToPay(amountPaise, r) {
  if (!r.value) return null;
  const pts = amountPaise / (r.value * 100);
  return Math.abs(pts - Math.round(pts)) < 1e-6 ? Math.round(pts) : null;
}

// Change a customer's points and keep a line in the ledger (inside a transaction).
async function post(q, { customerId, kind, points, ref, saleId = null, userId = null, at }) {
  if (!points) return;
  await q('UPDATE customers SET points = GREATEST(0, points + ?) WHERE id=?', [points, customerId]);
  await q('INSERT INTO loyalty_ledger (customer_id, at, kind, points, ref, sale_id, user_id) VALUES (?,?,?,?,?,?,?)',
    [customerId, at, kind, points, String(ref || '').slice(0, 40), saleId, userId]);
}

async function history(customerId) {
  return db.query('SELECT at, kind, points, ref FROM loyalty_ledger WHERE customer_id=? ORDER BY id DESC LIMIT 200', [customerId]);
}

const worth = (points, r) => rs(Math.round(Number(points) * r.value * 100));

module.exports = { rules, pointsFor, pointsToPay, post, history, worth, paise };
