'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');
const config = require('./config');
const { nowIST, UserError } = require('./money');

const scrypt = promisify(crypto.scrypt);

const PERMISSIONS = ['bill', 'price_override', 'discount_approve', 'cancel_bill', 'stock_view', 'products', 'receive',
  'cash', 'reopen_shift', 'reports', 'settings', 'users', 'backup', 'customers', 'refund', 'credit_sale', 'purchase', 'supplier_pay',
  'orders'];
const ROLE_PERMS = {
  owner: new Set(PERMISSIONS),
  manager: new Set(PERMISSIONS.filter((p) => !['settings', 'users'].includes(p))),
  cashier: new Set(['bill', 'cancel_bill', 'cash', 'stock_view', 'customers', 'orders']),
  purchaser: new Set(['stock_view', 'products', 'receive', 'purchase']),
  auditor: new Set(['stock_view', 'reports']),
};
const ROLES = Object.keys(ROLE_PERMS);
const can = (user, perm) => !!user && !!ROLE_PERMS[user.role] && ROLE_PERMS[user.role].has(perm);
const permsOf = (user) => [...(ROLE_PERMS[user.role] || [])];

async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(secret), salt, 32, { N: 16384, r: 8, p: 1 });
  return ['scrypt', 16384, 8, 1, salt.toString('base64'), key.toString('base64')].join('$');
}
async function checkSecret(secret, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length === 4 && parts[0] === 'pbkdf2_sha256') {      // passwords brought over from the shop PC software keep working
    const want = Buffer.from(parts[3], 'base64');
    const got = await promisify(crypto.pbkdf2)(String(secret), parts[2], Number(parts[1]), want.length, 'sha256');
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  }
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(String(secret), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(want, got);
}

// ---------------------------------------------------------------- lockout: 5 wrong tries in 15 minutes locks that name
async function lockedOut(ident) {
  const r = await db.one('SELECT COUNT(*) n FROM failures WHERE ident=? AND at > ?', [ident, nowIST(Date.now() - 15 * 60000)]);
  return Number(r.n) >= 5;
}
async function fail(ident) {
  await db.query('INSERT INTO failures (ident, at) VALUES (?, ?)', [ident, nowIST()]);
  await db.query('DELETE FROM failures WHERE at < ?', [nowIST(Date.now() - 24 * 3600000)]);
}
async function clearFailures(ident) {
  await db.query('DELETE FROM failures WHERE ident=?', [ident]);
}

// ---------------------------------------------------------------- sessions (stored in MySQL, survive app restarts)
const COOKIE = 'mpc_sid';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function login(username, password) {
  const name = String(username || '').trim().toLowerCase();
  if (!name || !password) throw new UserError('Enter your login name and password.');
  if (await lockedOut(`login:${name}`)) throw new UserError('Too many wrong passwords. Wait 15 minutes, or ask the owner.', 429);
  const user = await db.one('SELECT * FROM users WHERE LOWER(username)=? AND active=1', [name]);
  if (!user || !(await checkSecret(password, user.pass_hash))) {
    await fail(`login:${name}`);
    throw new UserError('Login name or password is wrong.', 401);
  }
  await clearFailures(`login:${name}`);
  if (!user.pass_hash.startsWith('scrypt')) {        // brought over from the PC software: store it the faster cloud way
    await db.query('UPDATE users SET pass_hash=? WHERE id=?', [await hashSecret(password), user.id]);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    [sha(token), user.id, nowIST(), nowIST(Date.now() + config.sessionHours * 3600000)]);
  await db.query('DELETE FROM sessions WHERE expires_at < ?', [nowIST()]);
  await audit({ user_id: user.id, action: 'login', summary: `${user.username} logged in` });
  return { token, user };
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setCookie(res, req, token, maxAgeSec) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`);
}

const istMs = (s) => Date.parse(`${s.replace(' ', 'T')}+05:30`);

async function sessionUser(req) {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const row = await db.one(
    `SELECT u.id, u.username, u.name, u.role, s.id sid, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.id=? AND s.expires_at > ? AND u.active=1`, [sha(token), nowIST()]);
  if (!row) return null;
  // sliding expiry, refreshed at most once an hour
  const fresh = Date.now() + config.sessionHours * 3600000;
  if (fresh - istMs(row.expires_at) > 3600000) {
    await db.query('UPDATE sessions SET expires_at=? WHERE id=?', [nowIST(fresh), row.sid]);
  }
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}

async function logout(req) {
  const token = readCookie(req, COOKIE);
  if (token) await db.query('DELETE FROM sessions WHERE id=?', [sha(token)]);
}

// ---------------------------------------------------------------- manager approval at the counter (PIN)
// A manager types their login name + PIN on the cashier's screen; the server answers with a short-lived signed
// approval that checkout checks again. The PIN itself is only sent in that one request.
let SECRET = null;
async function secret() {
  if (SECRET) return SECRET;
  await db.query("INSERT IGNORE INTO settings (k, v) VALUES ('_secret', ?)", [crypto.randomBytes(32).toString('hex')]);
  return (SECRET = (await db.one("SELECT v FROM settings WHERE k='_secret'")).v);
}
const sign = async (payload) => crypto.createHmac('sha256', await secret()).update(payload).digest('base64url');

async function approve(username, pin, perm) {
  const name = String(username || '').trim().toLowerCase();
  if (!PERMISSIONS.includes(perm)) throw new UserError('Unknown approval.');
  if (await lockedOut(`pin:${name}`)) throw new UserError('Too many wrong PINs. Wait 15 minutes.', 429);
  const u = await db.one('SELECT * FROM users WHERE LOWER(username)=? AND active=1', [name]);
  if (!u || !u.pin_hash || !(await checkSecret(pin, u.pin_hash))) {
    await fail(`pin:${name}`);
    throw new UserError('Name or PIN is wrong.', 401);
  }
  if (!can(u, perm)) throw new UserError(`${u.name} is not allowed to approve this.`, 403);
  await clearFailures(`pin:${name}`);
  const exp = Date.now() + 10 * 60000;
  const payload = `${u.id}.${perm}.${exp}`;
  return { token: `${payload}.${await sign(payload)}`, approver: { id: u.id, name: u.name } };
}

// The approver's id when `token` approves `perm`; the user's own id when they hold `perm` themselves; otherwise null.
async function approvedBy(user, perm, token) {
  if (can(user, perm)) return user.id;
  const parts = String(token || '').split('.');
  if (parts.length === 4 && parts[1] === perm && Number(parts[2]) > Date.now()) {
    const expect = await sign(parts.slice(0, 3).join('.'));
    if (expect.length === parts[3].length && crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(parts[3]))) return Number(parts[0]);
  }
  return null;
}

async function audit({ user_id = null, approver_id = null, action, summary, value = '0' }, q = db.query) {
  await q('INSERT INTO audit (at, user_id, approver_id, action, summary, value) VALUES (?,?,?,?,?,?)',
    [nowIST(), user_id, approver_id, action, String(summary).slice(0, 300), value]);
}

module.exports = { PERMISSIONS, ROLES, ROLE_PERMS, can, permsOf, hashSecret, checkSecret, login, logout, sessionUser, setCookie, COOKIE,
  approve, approvedBy, audit };
