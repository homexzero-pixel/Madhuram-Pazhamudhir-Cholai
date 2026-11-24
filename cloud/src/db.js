'use strict';
const fs = require('fs');
const path = require('path');
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

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await query(stmt);
  }
}

async function end() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { getPool, query, one, tx, migrate, end };
