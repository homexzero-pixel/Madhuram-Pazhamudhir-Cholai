'use strict';
const zlib = require('zlib');
const db = require('./db');
const settings = require('./settings');
const catalog = require('./catalog');
const { hashSecret, audit, ROLES } = require('./auth');
const { paise, milli, rs, qtyDb, qtyStr, nowIST, todayIST, UserError } = require('./money');

// ------------------------------------------------------------------ first run: create the owner
async function needsSetup() {
  return Number((await db.one('SELECT COUNT(*) n FROM users')).n) === 0;
}

async function firstSetup(data) {
  if (!(await needsSetup())) throw new UserError('This store is already set up. Log in instead.', 409);
  const shop = String(data.shop_name || '').trim();
  if (shop) await settings.save({ name: shop.slice(0, 100) });
  const id = await saveUser({ username: data.username || 'owner', name: data.name || 'Owner', role: 'owner', password: data.password,
    pin: data.pin, active: true }, null);
  await audit({ user_id: id, action: 'setup', summary: 'Store set up on the cloud' });
  return id;
}

// ------------------------------------------------------------------ staff logins
async function listUsers() {
  return db.query("SELECT id, username, name, role, active, pin_hash <> '' has_pin, created_at FROM users ORDER BY active DESC, name");
}

async function saveUser(data, actor) {
  const username = String(data.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new UserError('Login name: 3–40 letters or digits, no spaces.');
  const name = String(data.name || '').trim().slice(0, 80) || username;
  const role = ROLES.includes(data.role) ? data.role : 'cashier';
  const id = Number(data.id) || 0;
  const password = String(data.password || '');
  if ((!id || password) && password.length < 6) throw new UserError('Password must have at least 6 characters.');
  const pin = String(data.pin || '');
  if (pin && !/^\d{4,6}$/.test(pin)) throw new UserError('PIN must be 4 to 6 digits.');
  if (id) {
    const old = await db.one('SELECT * FROM users WHERE id=?', [id]);
    if (!old) throw new UserError('Login not found.', 404);
    if (old.role === 'owner' && (role !== 'owner' || !data.active)) {
      const owners = await db.one("SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1 AND id<>?", [id]);
      if (Number(owners.n) === 0) throw new UserError('Keep at least one active owner login.');
    }
    await db.query('UPDATE users SET name=?, role=?, active=? WHERE id=?', [name, role, data.active ? 1 : 0, id]);
    if (password) await db.query('UPDATE users SET pass_hash=? WHERE id=?', [await hashSecret(password), id]);
    if (pin) await db.query('UPDATE users SET pin_hash=? WHERE id=?', [await hashSecret(pin), id]);
    if ((!data.active || password) && !(actor && actor.id === id)) await db.query('DELETE FROM sessions WHERE user_id=?', [id]);
    await audit({ user_id: actor && actor.id, action: 'user_change', summary: `Login ${username}: ${role}${data.active ? '' : ' (disabled)'}${password ? ', new password' : ''}` });
    return id;
  }
  try {
    const r = await db.query('INSERT INTO users (username, name, role, pass_hash, pin_hash, active) VALUES (?,?,?,?,?,1)',
      [username, name, role, await hashSecret(password), pin ? await hashSecret(pin) : '']);
    if (actor) await audit({ user_id: actor.id, action: 'user_add', summary: `New login ${username} (${role})` });
    return r.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new UserError(`Login name ${username} is already used.`);
    throw err;
  }
}

// ------------------------------------------------------------------ owner dashboard
async function dashboard(date) {
  date = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : todayIST();
  const t = await db.one('SELECT COUNT(*) n, SUM(total) total, SUM(discount) disc FROM sales WHERE business_date=?', [date]);
  const profit = await db.one('SELECT SUM(l.net - l.cost) p FROM sale_lines l JOIN sales x ON x.id=l.sale_id WHERE x.business_date=?', [date]);
  const methods = await db.query(`SELECT p.method, SUM(p.amount) amount FROM payments p JOIN sales x ON x.id=p.sale_id
    WHERE x.business_date=? GROUP BY p.method`, [date]);
  const counters = await db.query(`SELECT counter, COUNT(*) bills, SUM(total) total FROM sales WHERE business_date=? GROUP BY counter ORDER BY counter`, [date]);
  const top = await db.query(`SELECT l.name, l.unit, SUM(l.qty) qty, SUM(l.net) amount FROM sale_lines l JOIN sales x ON x.id=l.sale_id
    WHERE x.business_date=? GROUP BY l.item_id, l.name, l.unit ORDER BY amount DESC LIMIT 10`, [date]);
  const week = await db.query(`SELECT business_date d, COUNT(*) bills, SUM(total) total FROM sales WHERE business_date > DATE_SUB(?, INTERVAL 7 DAY)
    AND business_date <= ? GROUP BY business_date ORDER BY business_date`, [date, date]);
  const shifts = await db.query(`SELECT s.id, s.counter, s.status, s.opened_at, s.variance, u.name cashier FROM shifts s JOIN users u ON u.id=s.cashier_id
    WHERE s.status='open' OR s.business_date=? ORDER BY s.status DESC, s.counter`, [date]);
  const low = await db.one('SELECT COUNT(*) n FROM items WHERE active=1 AND on_hand <= reorder_level');
  const risky = await db.query(`SELECT a.at, a.action, a.summary, a.value, u.name who, ap.name approver FROM audit a LEFT JOIN users u ON u.id=a.user_id
    LEFT JOIN users ap ON ap.id=a.approver_id WHERE a.at >= ? AND a.at < DATE_ADD(?, INTERVAL 1 DAY)
    AND a.action IN ('price_override','discount','reprint','shift_close','write_off','cash_out','price_change') ORDER BY a.id DESC LIMIT 30`, [date, date]);
  return {
    date, bills: Number(t.n), total: t.total || '0.00', discount: t.disc || '0.00', profit: profit.p || '0.00',
    average: t.n ? rs(Math.round(paise(t.total) / Number(t.n))) : '0.00',
    methods, counters, top: top.map((r) => ({ ...r, qty: qtyStr(milli(r.qty)) })), week, shifts, low_stock: Number(low.n), risky,
  };
}

async function auditLog({ limit = 200 }) {
  return db.query(`SELECT a.at, a.action, a.summary, a.value, u.name who, ap.name approver FROM audit a LEFT JOIN users u ON u.id=a.user_id
    LEFT JOIN users ap ON ap.id=a.approver_id ORDER BY a.id DESC LIMIT ?`, [Math.min(Number(limit) || 200, 1000)]);
}

// ------------------------------------------------------------------ backup: the whole database as one .sql.gz file
// It can be loaded back with Hostinger's phpMyAdmin (Import) into an empty database.
const TABLES = ['settings', 'users', 'categories', 'items', 'barcodes', 'lots', 'stock_moves', 'customers', 'shifts', 'cash_moves',
  'sequences', 'sales', 'sale_lines', 'sale_lot_allocs', 'payments', 'audit'];

async function backup(res, user) {
  const pool = db.getPool();
  const name = `madhuram_cloud_${nowIST().replace(/\D/g, '').slice(0, 12)}.sql.gz`;
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  const gz = zlib.createGzip();
  gz.pipe(res);
  const write = (s) => new Promise((ok) => (gz.write(s) ? ok() : gz.once('drain', ok)));
  await write(`-- Madhuram cloud backup ${nowIST()} (India time)\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n`);
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    for (const t of TABLES) {
      const [[create]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
      await write(`\nDROP TABLE IF EXISTS \`${t}\`;\n${create['Create Table']};\n`);
      const key = { settings: 'k', sequences: 'k', barcodes: 'code' }[t] || 'id';
      for (let after = key === 'id' ? 0 : ''; ;) {
        const [rows] = await conn.query(`SELECT * FROM \`${t}\` WHERE \`${key}\` > ? ORDER BY \`${key}\` LIMIT 2000`, [after]);
        if (!rows.length) break;
        const cols = Object.keys(rows[0]).map((c) => `\`${c}\``).join(',');
        const values = rows.map((r) => `(${Object.values(r).map((v) => conn.escape(v)).join(',')})`).join(',\n');
        await write(`INSERT INTO \`${t}\` (${cols}) VALUES\n${values};\n`);
        after = rows[rows.length - 1][key];
        if (rows.length < 2000) break;
      }
    }
    await conn.query('COMMIT');
  } finally {
    conn.release();
  }
  await write('SET FOREIGN_KEY_CHECKS=1;\n');
  gz.end();
  await audit({ user_id: user.id, action: 'backup', summary: `Backup downloaded: ${name}` });
}

// ------------------------------------------------------------------ bring the shop PC's products, stock, customers and staff to the cloud
// File made on the shop PC by Export_For_Cloud.bat (madhuram_cloud_export.json.gz). Only allowed before the first cloud bill.
async function importFromShop(buffer, user) {
  let data;
  try {
    const text = (buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer) : buffer).toString('utf8');
    data = JSON.parse(text);
  } catch (_) {
    throw new UserError('This is not a Madhuram export file. Use the file made by Export_For_Cloud.bat.');
  }
  if (!data || data.format !== 'madhuram-cloud-export' || !Array.isArray(data.items)) {
    throw new UserError('This is not a Madhuram export file. Use the file made by Export_For_Cloud.bat.');
  }
  if (Number((await db.one('SELECT COUNT(*) n FROM sales')).n) > 0) {
    throw new UserError('Bills have already been made on the cloud. The shop PC data can only be brought in before the first cloud bill.', 409);
  }
  const counts = { items: 0, barcodes: 0, lots: 0, customers: 0, users: 0 };
  await db.tx(async (q) => {
    for (const t of ['sale_lot_allocs', 'stock_moves', 'lots', 'barcodes', 'items', 'categories']) await q(`DELETE FROM ${t}`);
    const now = nowIST();
    const cats = new Map();
    for (const it of data.items) {
      const c = String(it.cat || '').slice(0, 60);
      if (c && !cats.has(c)) cats.set(c, await catalog.categoryId(q, c));
    }
    const rows = data.items.map((it) => [String(it.sku).slice(0, 20), it.plu || null, String(it.name).slice(0, 160),
      String(it.name_ta || '').slice(0, 160), cats.get(String(it.cat || '').slice(0, 60)) || null, it.unit === 'kg' ? 'kg' : 'pcs',
      it.price ?? null, it.mrp ?? null, it.cost || 0, it.gst_rate || 0, it.tax_class || 'unset', String(it.hsn || '').slice(0, 8),
      it.reorder_level || 0, it.active ? 1 : 0, now]);
    for (let i = 0; i < rows.length; i += 500) {
      await q(`INSERT INTO items (sku, plu, name, name_ta, category_id, unit, price, mrp, cost, gst_rate, tax_class, hsn, reorder_level, active,
        updated_at) VALUES ?`, [rows.slice(i, i + 500)]);
    }
    counts.items = rows.length;
    const ids = new Map((await q('SELECT id, sku FROM items')).map((r) => [r.sku, r.id]));
    const codes = [];
    for (const it of data.items) {
      for (const [code, per] of it.barcodes || []) codes.push([String(code).slice(0, 32), ids.get(String(it.sku)), per || 1]);
    }
    for (let i = 0; i < codes.length; i += 1000) await q('INSERT IGNORE INTO barcodes (code, item_id, per) VALUES ?', [codes.slice(i, i + 1000)]);
    counts.barcodes = codes.length;
    for (const it of data.items) {
      for (const lot of it.lots || []) {
        const qty = milli(lot.qty);
        if (!qty || qty <= 0) continue;
        await catalog.receiveIn(q, { item_id: ids.get(String(it.sku)), qty, unit_cost: paise(lot.unit_cost) || 0, expiry: lot.expiry || null,
          batch: String(lot.batch || '').slice(0, 40), ref: 'From shop PC', user, kind: 'opening' });
        counts.lots += 1;
      }
    }
    for (const c of data.customers || []) {
      const phone = String(c.phone || '').replace(/\D/g, '').slice(-10) || null;
      await q(`INSERT INTO customers (name, phone, points, created_at) VALUES (?,?,?,?)
        ON DUPLICATE KEY UPDATE name=VALUES(name), points=VALUES(points)`, [String(c.name || 'Customer').slice(0, 100), phone, c.points || 0, now]);
      counts.customers += 1;
    }
    for (const u of data.users || []) {
      const username = String(u.username || '').toLowerCase().slice(0, 40);
      if (!username || !u.password_hash) continue;
      const r = await q(`INSERT IGNORE INTO users (username, name, role, pass_hash, pin_hash, active) VALUES (?,?,?,?,?,?)`,
        [username, String(u.name || username).slice(0, 80), ROLES.includes(u.role) ? u.role : 'cashier', u.password_hash, u.pin_hash || '',
          u.active ? 1 : 0]);
      counts.users += r.affectedRows;
    }
    const keep = ['name', 'name_ta', 'tagline', 'address', 'phone', 'gstin', 'fssai', 'invoice_prefix', 'bill_footer', 'counters'];
    for (const k of keep) {
      if (data.settings && data.settings[k]) {
        await q('INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v=VALUES(v)', [k, String(data.settings[k]).slice(0, 2000)]);
      }
    }
    await audit({ user_id: user.id, action: 'import', summary: `Shop PC data brought in: ${counts.items} products, ${counts.lots} stock lots, ` +
      `${counts.customers} customers, ${counts.users} staff logins` }, q);
  });
  settings.reset();
  return counts;
}

module.exports = { needsSetup, firstSetup, listUsers, saveUser, dashboard, auditLog, backup, importFromShop, TABLES };
