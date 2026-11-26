'use strict';
// Customer accounts for the online shop: mobile number + password. When an SMS service is set up, the mobile number is
// verified with a one-time code (OTP) at sign-up, and "forgot password" works by OTP. Separate from staff logins.
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const { hashSecret, checkSecret, audit } = require('./auth');
const { nowIST, UserError } = require('./money');

const COOKIE = 'mpc_cust';
const DAYS = 60;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ------------------------------------------------------------------ SMS (one-time codes)
// SMS_PROVIDER=fast2sms + SMS_API_KEY=… (Fast2SMS "OTP" route, India). Without it, phone numbers are not verified by SMS.
const provider = () => (config.test && process.env.SMS_PROVIDER === 'test' ? 'test' : process.env.SMS_PROVIDER && process.env.SMS_API_KEY ? process.env.SMS_PROVIDER : '');
const smsEnabled = () => !!provider();
const sentForTests = new Map();

async function sendSms(phone, code) {
  const p = provider();
  if (p === 'test') { sentForTests.set(phone, code); return; }
  if (p === 'fast2sms') {
    const url = `https://www.fast2sms.com/dev/bulkV2?${new URLSearchParams({ authorization: process.env.SMS_API_KEY, route: 'otp', variables_values: code, numbers: phone })}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.return === false) throw new UserError('Could not send the SMS right now. Please try again in a minute.');
    return;
  }
  throw new UserError('SMS is not set up.');
}

function phone10(v) {
  const d = String(v || '').replace(/\D/g, '');
  const p = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  if (!/^[6-9]\d{9}$/.test(p)) throw new UserError('Please enter a valid 10-digit mobile number.');
  return p;
}
function checkPassword(pw) {
  pw = String(pw || '');
  if (pw.length < 6) throw new UserError('Password must have at least 6 letters or digits.');
  if (pw.length > 100) throw new UserError('Password is too long.');
  return pw;
}

// 3 codes per number per 15 minutes, 10 per connection per hour; 5 wrong tries per code
async function sendOtp(phoneRaw, purpose, ip) {
  if (!smsEnabled()) throw new UserError('SMS verification is not available. Please call the shop.');
  const phone = phone10(phoneRaw);
  if (!['signup', 'reset'].includes(purpose)) throw new UserError('Bad request.');
  const recent = await db.one('SELECT COUNT(*) n FROM otps WHERE phone=? AND created_at > ?', [phone, nowIST(Date.now() - 15 * 60000)]);
  if (Number(recent.n) >= 3) throw new UserError('Too many codes sent. Please wait 15 minutes.', 429);
  const byIp = await db.one('SELECT COUNT(*) n FROM otps WHERE ip=? AND created_at > ?', [String(ip || '').slice(0, 45), nowIST(Date.now() - 3600000)]);
  if (ip && Number(byIp.n) >= 10) throw new UserError('Too many codes from this connection. Please try later.', 429);
  const c = await db.one('SELECT id, pass_hash FROM customers WHERE phone=?', [phone]);
  if (purpose === 'reset' && !(c && c.pass_hash)) throw new UserError('No account with this mobile number. Please sign up.');
  if (purpose === 'signup' && c && c.pass_hash) throw new UserError('This mobile number already has an account. Please log in.');
  const code = String(crypto.randomInt(100000, 1000000));
  await db.query('INSERT INTO otps (phone, purpose, code_hash, created_at, expires_at, tries, ip) VALUES (?,?,?,?,?,0,?)',
    [phone, purpose, sha(`${phone}:${code}`), nowIST(), nowIST(Date.now() + 10 * 60000), String(ip || '').slice(0, 45)]);
  await sendSms(phone, code);
  return { phone, sent: true };
}

async function useOtp(phone, purpose, code) {
  const o = await db.one('SELECT * FROM otps WHERE phone=? AND purpose=? AND used=0 AND expires_at > ? ORDER BY id DESC LIMIT 1', [phone, purpose, nowIST()]);
  if (!o) throw new UserError('The code has expired. Please send a new code.');
  if (o.tries >= 5) throw new UserError('Too many wrong codes. Please send a new code.', 429);
  if (sha(`${phone}:${String(code || '').trim()}`) !== o.code_hash) {
    await db.query('UPDATE otps SET tries=tries+1 WHERE id=?', [o.id]);
    throw new UserError('The code is not correct.');
  }
  await db.query('UPDATE otps SET used=1 WHERE id=?', [o.id]);
}

// ------------------------------------------------------------------ sign up, log in, sessions
async function newSession(customerId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query('INSERT INTO customer_sessions (id, customer_id, created_at, expires_at) VALUES (?,?,?,?)',
    [sha(token), customerId, nowIST(), nowIST(Date.now() + DAYS * 86400000)]);
  await db.query('DELETE FROM customer_sessions WHERE expires_at < ?', [nowIST()]);
  return token;
}
function setCookie(res, req, token, maxAge = DAYS * 86400) {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`);
}

async function register({ name, phone, password, code }) {
  name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (name.length < 2) throw new UserError('Please enter your name.');
  phone = phone10(phone);
  const pw = checkPassword(password);
  const existing = await db.one('SELECT id, pass_hash FROM customers WHERE phone=?', [phone]);
  if (existing && existing.pass_hash) throw new UserError('This mobile number already has an account. Please log in.');
  const verified = smsEnabled();
  if (verified) await useOtp(phone, 'signup', code);
  const hash = await hashSecret(pw);
  let id;
  if (existing) {
    await db.query('UPDATE customers SET pass_hash=?, verified=?, name=IF(name="" OR name="Customer", ?, name), online_since=? WHERE id=?',
      [hash, verified ? 1 : 0, name, nowIST(), existing.id]);
    id = existing.id;
  } else {
    id = (await db.query('INSERT INTO customers (name, phone, pass_hash, verified, online_since, created_at) VALUES (?,?,?,?,?,?)',
      [name, phone, hash, verified ? 1 : 0, nowIST(), nowIST()])).insertId;
  }
  await audit({ action: 'customer_signup', summary: `Online account: ${name} ${phone}${verified ? ' (verified by SMS)' : ''}` });
  return id;
}

async function login(phoneRaw, password) {
  const phone = phone10(phoneRaw);
  const r = await db.one("SELECT COUNT(*) n FROM failures WHERE ident=? AND at > ?", [`cust:${phone}`, nowIST(Date.now() - 15 * 60000)]);
  if (Number(r.n) >= 5) throw new UserError('Too many wrong passwords. Please wait 15 minutes.', 429);
  const c = await db.one('SELECT * FROM customers WHERE phone=?', [phone]);
  if (!c || !c.pass_hash || !(await checkSecret(password, c.pass_hash))) {
    await db.query('INSERT INTO failures (ident, at) VALUES (?, ?)', [`cust:${phone}`, nowIST()]);
    throw new UserError('Mobile number or password is wrong.', 401);
  }
  await db.query('DELETE FROM failures WHERE ident=?', [`cust:${phone}`]);
  return c.id;
}

async function resetPassword({ phone, code, password }) {
  phone = phone10(phone);
  const pw = checkPassword(password);
  const c = await db.one('SELECT id FROM customers WHERE phone=? AND pass_hash <> ""', [phone]);
  if (!c) throw new UserError('No account with this mobile number.');
  await useOtp(phone, 'reset', code);
  await db.query('UPDATE customers SET pass_hash=?, verified=1 WHERE id=?', [await hashSecret(pw), c.id]);
  await db.query('DELETE FROM customer_sessions WHERE customer_id=?', [c.id]);
  return c.id;
}

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
async function current(req) {
  const token = readCookie(req);
  if (!token) return null;
  return db.one(`SELECT c.id, c.name, c.phone, c.address, c.verified, c.points FROM customer_sessions s JOIN customers c ON c.id=s.customer_id
    WHERE s.id=? AND s.expires_at > ? AND c.pass_hash <> ''`, [sha(token), nowIST()]);
}
async function logout(req) {
  const token = readCookie(req);
  if (token) await db.query('DELETE FROM customer_sessions WHERE id=?', [sha(token)]);
}

async function update(c, { name, address, password, new_password: newPw }) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (n.length < 2) throw new UserError('Please enter your name.');
  await db.query('UPDATE customers SET name=?, address=? WHERE id=?', [n, String(address || '').replace(/\s+/g, ' ').trim().slice(0, 250), c.id]);
  if (newPw) {
    const row = await db.one('SELECT pass_hash FROM customers WHERE id=?', [c.id]);
    if (!(await checkSecret(password, row.pass_hash))) throw new UserError('Your current password is wrong.');
    await db.query('UPDATE customers SET pass_hash=? WHERE id=?', [await hashSecret(checkPassword(newPw)), c.id]);
  }
}

// Staff: set a new online password for a customer who calls the shop (when SMS is not set up).
async function staffSetPassword(customerId, password, user) {
  const c = await db.one('SELECT id, name, phone FROM customers WHERE id=?', [customerId]);
  if (!c || !c.phone) throw new UserError('This customer has no mobile number.');
  await db.query('UPDATE customers SET pass_hash=?, online_since=COALESCE(online_since, ?) WHERE id=?', [await hashSecret(checkPassword(password)), nowIST(), c.id]);
  await db.query('DELETE FROM customer_sessions WHERE customer_id=?', [c.id]);
  await audit({ user_id: user.id, action: 'customer_password', summary: `Online password set for ${c.name} ${c.phone}` });
}

module.exports = { smsEnabled, sendOtp, register, login, resetPassword, current, logout, newSession, setCookie, update, staffSetPassword,
  phone10, sentForTests, COOKIE };
