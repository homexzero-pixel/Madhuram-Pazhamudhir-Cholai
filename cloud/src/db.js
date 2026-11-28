'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const config = require('./config');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...config.db,
      waitForConnections: true,
      connectionLimit: 8,
      dateStrings: true,          // dates stay as 'YYYY-MM-DD HH:MM:SS' shop time; no time-zone surprises
      decimalNumbers: false,      // DECIMAL arrives as exact strings
      supportBigNumbers: true,
      charset: 'utf8mb4',
      timezone: '+05:30',
    });
  }
  return pool;
}

async function query(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}
async function one(sql, params) {
  return (await query(sql, params))[0] || null;
}

// Run fn(conn) inside one InnoDB transaction. Deadlocks are retried, everything else rolls back and is rethrown.
async function tx(fn) {
  for (let attempt = 1; ; attempt++) {
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      const q = async (sql, params) => (await conn.query(sql, params))[0];
      q.one = async (sql, params) => (await q(sql, params))[0] || null;
      const result = await fn(q);
      await conn.commit();
      verCache.at = 0;
      bump().catch(() => {});
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* connection lost */ }
      if ((err.code === 'ER_LOCK_DEADLOCK' || err.code === 'ER_LOCK_WAIT_TIMEOUT') && attempt < 3) continue;
      throw err;
    } finally {
      conn.release();
    }
  }
}

// Columns added after a table first existed (MySQL 8 has no "ADD COLUMN IF NOT EXISTS", so check first).
const COLUMNS = [
  ['items', 'supplier_id', 'INT NULL'],
  ['customers', 'address', "VARCHAR(250) NOT NULL DEFAULT ''"],
  ['customers', 'credit_limit', 'DECIMAL(12,2) NOT NULL DEFAULT 0'],
  ['sale_lines', 'returned_qty', 'DECIMAL(12,3) NOT NULL DEFAULT 0'],
  ['sales', 'order_id', 'INT NULL'],
  ['online_order_lines', 'ordered_qty', 'DECIMAL(12,3) NULL'],
  ['online_order_lines', 'note', "VARCHAR(120) NOT NULL DEFAULT ''"],
  ['online_orders', 'accepted_at', 'DATETIME NULL'],
  ['items', 'image', 'VARCHAR(80) NULL'],
  ['customers', 'pass_hash', "VARCHAR(200) NOT NULL DEFAULT ''"],
  ['items', 'offer_price', 'DECIMAL(10,2) NULL'],
  ['items', 'offer_from', 'DATE NULL'],
  ['items', 'offer_to', 'DATE NULL'],
  ['customers', 'verified', 'TINYINT NOT NULL DEFAULT 0'],
  ['customers', 'online_since', 'DATETIME NULL'],
  ['online_orders', 'customer_id', 'INT NULL'],
  ['sales', 'points_earned', 'DECIMAL(10,2) NOT NULL DEFAULT 0'],
  ['sales', 'points_used', 'DECIMAL(10,2) NOT NULL DEFAULT 0'],
  ['items', 'shop_section', 'VARCHAR(20) NULL'],
  ['items', 'created_at', 'DATETIME NULL'],
  ['customers', 'email', "VARCHAR(120) NOT NULL DEFAULT ''"],
  ['customers', 'ref_code', 'VARCHAR(12) NULL'],
  ['customers', 'referred_by', 'INT NULL'],
  ['customers', 'ref_rewarded', 'TINYINT NOT NULL DEFAULT 0'],
  ['online_orders', 'pay_ref', "VARCHAR(40) NOT NULL DEFAULT ''"],
  ['items', 'image_source', 'VARCHAR(20) NULL'],
  // online orders: stock held for open orders, invoice at packing, delivery agent, "Process completed"
  ['items', 'reserved', 'DECIMAL(12,3) NOT NULL DEFAULT 0'],
  ['sales', 'stock_pending', 'TINYINT NOT NULL DEFAULT 0'],
  ['online_orders', 'packed_at', 'DATETIME NULL'],
  ['online_orders', 'ready_at', 'DATETIME NULL'],
  ['online_orders', 'dispatched_at', 'DATETIME NULL'],
  ['online_orders', 'agent_name', "VARCHAR(60) NOT NULL DEFAULT ''"],
  ['online_orders', 'agent_phone', "VARCHAR(15) NOT NULL DEFAULT ''"],
  ['online_orders', 'tracking', "VARCHAR(200) NOT NULL DEFAULT ''"],
  ['online_orders', 'completed_at', 'DATETIME NULL'],
  ['online_orders', 'completed_by', 'INT NULL'],
  ['online_orders', 'settle_method', "VARCHAR(6) NOT NULL DEFAULT ''"],
  ['online_orders', 'settle_ref', "VARCHAR(40) NOT NULL DEFAULT ''"],
  ['online_orders', 'settle_shift_id', 'INT NULL'],
  ['online_orders', 'cancelled_at', 'DATETIME NULL'],
  ['online_orders', 'void_return_id', 'INT NULL'],
  // the customer's choices at checkout: what to do when an item is not available, notes for the delivery person
  ['online_orders', 'sub_pref', "VARCHAR(8) NOT NULL DEFAULT 'call'"],
  ['online_orders', 'drop_note', "VARCHAR(200) NOT NULL DEFAULT ''"],
];

// The tables and columns. Checked only when they changed since the last start (a fingerprint is kept in settings), so a
// restart after an update takes one query instead of about eighty (slow on a shared hosting database).
async function migrate() {
  const raw = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const mark = crypto.createHash('sha1').update(raw).update(JSON.stringify(COLUMNS)).digest('hex').slice(0, 20);
  const seen = await query("SELECT v FROM settings WHERE k='_schema'").then((r) => (r[0] ? r[0].v : ''), () => '');
  if (seen === mark) return false;
  const sql = raw.replace(/--[^\n]*/g, '');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await query(stmt);
  }
  const have = new Set((await query('SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()'))
    .map((r) => `${r.t}.${r.c}`.toLowerCase()));
  for (const [table, col, ddl] of COLUMNS) {
    if (have.has(`${table}.${col}`.toLowerCase())) continue;
    // two copies of the app (billing site and shop site) may start together: the other one may have just added it
    await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${ddl}`).catch((e) => { if (e.code !== 'ER_DUP_FIELDNAME') throw e; });
  }
  await query("INSERT INTO settings (k, v) VALUES ('_schema', ?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [mark]);
  return true;
}

// ---------------------------------------------------------------- "something changed" counter for the shop's caches
// Bumped after every committed transaction and after the few direct product changes (offers, photos). Both sites read
// it (one primary-key row), so a sale at a counter clears the customer site's cached product lists at once.
let localVersion = 0;
const changed = [];
async function bump() {
  localVersion += 1;
  try {
    await query("INSERT INTO sequences (k, last) VALUES ('_changes', 1) ON DUPLICATE KEY UPDATE last=last+1");
  } catch (_) { /* the local counter still moved */ }
  for (const fn of changed) fn();
}
let verCache = { at: 0, v: '' };
async function changeVersion() {
  if (Date.now() - verCache.at < 300) return verCache.v;      // many page parts at once share one read
  const r = await one("SELECT last FROM sequences WHERE k='_changes'");
  verCache = { at: Date.now(), v: `${r ? r.last : 0}.${localVersion}` };
  return verCache.v;
}
const onChange = (fn) => changed.push(fn);

async function end() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { getPool, query, one, tx, migrate, end, bump, changeVersion, onChange };
