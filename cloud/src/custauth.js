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
  if (!['signup', 'reset', 'change'].includes(purpose)) throw new UserError('Bad request.');
  const recent = await db.one('SELECT COUNT(*) n FROM otps WHERE phone=? AND created_at > ?', [phone, nowIST(Date.now() - 15 * 60000)]);
  if (Number(recent.n) >= 3) throw new UserError('Too many codes sent. Please wait 15 minutes.', 429);
  const byIp = await db.one('SELECT COUNT(*) n FROM otps WHERE ip=? AND created_at > ?', [String(ip || '').slice(0, 45), nowIST(Date.now() - 3600000)]);
  if (ip && Number(byIp.n) >= 10) throw new UserError('Too many codes from this connection. Please try later.', 429);
  const c = await db.one('SELECT id, pass_hash FROM customers WHERE phone=?', [phone]);
  if (purpose === 'reset' && !(c && c.pass_hash)) throw new UserError('No account with this mobile number. Please sign up.');
  if ((purpose === 'signup' || purpose === 'change') && c && c.pass_hash) throw new UserError('This mobile number already has an account.');
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

async function register({ name, phone, password, code, ref }) {
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
  const by = String(ref || '').trim().toUpperCase();
  if (/^[A-Z0-9]{4,12}$/.test(by)) {           // joined with a friend's referral code
    const friend = await db.one('SELECT id FROM customers WHERE ref_code=? AND id<>?', [by, id]);
    if (friend) await db.query('UPDATE customers SET referred_by=? WHERE id=? AND referred_by IS NULL', [friend.id, id]);
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
  return db.one(`SELECT c.id, c.name, c.phone, c.address, c.verified, c.points, c.email, c.ref_code FROM customer_sessions s JOIN customers c ON c.id=s.customer_id
    WHERE s.id=? AND s.expires_at > ? AND c.pass_hash <> ''`, [sha(token), nowIST()]);
}
async function logout(req) {
  const token = readCookie(req);
  if (token) await db.query('DELETE FROM customer_sessions WHERE id=?', [sha(token)]);
}

async function update(c, { name, address, email, phone, code, password, new_password: newPw }) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (n.length < 2) throw new UserError('Please enter your name.');
  const mail = email === undefined ? c.email || '' : String(email || '').trim().toLowerCase().slice(0, 120);
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new UserError('Please check the email address.');
  await db.query('UPDATE customers SET name=?, address=?, email=? WHERE id=?',
    [n, String(address === undefined ? c.address || '' : address || '').replace(/\s+/g, ' ').trim().slice(0, 250), mail, c.id]);
  if (phone !== undefined && phone !== '' && phone10(phone) !== c.phone) {        // a new mobile number: the password (and an SMS code) confirm it
    const p = phone10(phone);
    const row = await db.one('SELECT pass_hash FROM customers WHERE id=?', [c.id]);
    if (!(await checkSecret(password, row.pass_hash))) throw new UserError('Type your password to change the mobile number.');
    if (await db.one("SELECT id FROM customers WHERE phone=? AND id<>?", [p, c.id])) throw new UserError('This mobile number is already used by another customer.');
    if (smsEnabled()) await useOtp(p, 'change', code);
    await db.query('UPDATE customers SET phone=?, verified=? WHERE id=?', [p, smsEnabled() ? 1 : 0, c.id]);
    await audit({ action: 'customer_phone', summary: `Customer ${c.id} changed mobile ${c.phone} → ${p}` });
  }
  if (newPw) {
    const row = await db.one('SELECT pass_hash FROM customers WHERE id=?', [c.id]);
    if (!(await checkSecret(password, row.pass_hash))) throw new UserError('Your current password is wrong.');
    await db.query('UPDATE customers SET pass_hash=? WHERE id=?', [await hashSecret(checkPassword(newPw)), c.id]);
  }
}

// ---------------------------------------------------------------- saved addresses
const addrOut = (a) => ({ id: a.id, label: a.label, address: a.address, landmark: a.landmark, pincode: a.pincode, is_default: !!a.is_default });
async function addresses(customerId) {
  return (await db.query('SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC, id DESC', [customerId])).map(addrOut);
}
async function syncDefault(customerId) {
  const d = await db.one('SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC, id DESC LIMIT 1', [customerId]);
  if (d && !d.is_default) await db.query('UPDATE customer_addresses SET is_default=1 WHERE id=?', [d.id]);
  await db.query('UPDATE customers SET address=? WHERE id=?',
    [d ? [d.address, d.landmark && `Landmark: ${d.landmark}`, d.pincode].filter(Boolean).join(', ').slice(0, 250) : '', customerId]);
}
async function saveAddress(customerId, data) {
  const address = String(data.address || '').replace(/\s+/g, ' ').trim().slice(0, 250);
  if (address.length < 10) throw new UserError('Please enter the full address: door number, street and area.');
  const label = ['Home', 'Work', 'Other'].includes(data.label) ? data.label : 'Home';
  const landmark = String(data.landmark || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const pincode = String(data.pincode || '').replace(/\D/g, '').slice(0, 6);
  if (pincode && pincode.length !== 6) throw new UserError('PIN code has 6 digits.');
  let id = Number(data.id) || 0;
  if (id) {
    const r = await db.query('UPDATE customer_addresses SET label=?, address=?, landmark=?, pincode=? WHERE id=? AND customer_id=?',
      [label, address, landmark, pincode, id, customerId]);
    if (!r.affectedRows) throw new UserError('Address not found.', 404);
  } else {
    const n = await db.one('SELECT COUNT(*) n FROM customer_addresses WHERE customer_id=?', [customerId]);
    if (Number(n.n) >= 10) throw new UserError('You can keep up to 10 addresses.');
    id = (await db.query('INSERT INTO customer_addresses (customer_id, label, address, landmark, pincode, is_default, created_at) VALUES (?,?,?,?,?,0,?)',
      [customerId, label, address, landmark, pincode, nowIST()])).insertId;
  }
  if (data.is_default || data.make_default) await setDefaultAddress(customerId, id);
  else await syncDefault(customerId);
  return id;
}
async function setDefaultAddress(customerId, id) {
  const a = await db.one('SELECT id FROM customer_addresses WHERE id=? AND customer_id=?', [id, customerId]);
  if (!a) throw new UserError('Address not found.', 404);
  await db.query('UPDATE customer_addresses SET is_default=(id=?) WHERE customer_id=?', [id, customerId]);
  await syncDefault(customerId);
}
async function removeAddress(customerId, id) {
  await db.query('DELETE FROM customer_addresses WHERE id=? AND customer_id=?', [id, customerId]);
  await syncDefault(customerId);
}

// ---------------------------------------------------------------- referral code: short, easy to read aloud (no 0/O, 1/I)
async function refCode(c) {
  if (c.ref_code) return c.ref_code;
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 20; i++) {
    const code = Array.from({ length: 6 }, () => letters[crypto.randomInt(letters.length)]).join('');
    const r = await db.query('UPDATE customers SET ref_code=? WHERE id=? AND ref_code IS NULL AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM customers WHERE ref_code=?) t)',
      [code, c.id, code]);
    if (r.affectedRows) return code;
    const again = await db.one('SELECT ref_code FROM customers WHERE id=?', [c.id]);
    if (again && again.ref_code) return again.ref_code;
  }
  throw new UserError('Please try again.');
}
async function referrals(customerId) {
  const r = await db.one(`SELECT COUNT(*) joined, SUM(ref_rewarded) bought FROM customers WHERE referred_by=?`, [customerId]);
  return { joined: Number(r.joined || 0), bought: Number(r.bought || 0) };
}

// Staff: set a new online password for a customer who calls the shop (when SMS is not set up).
async function staffSetPassword(customerId, password, user) {
  const c = await db.one('SELECT id, name, phone FROM customers WHERE id=?', [customerId]);
  if (!c || !c.phone) throw new UserError('This customer has no mobile number.');
  await db.query('UPDATE customers SET pass_hash=?, online_since=COALESCE(online_since, ?) WHERE id=?', [await hashSecret(checkPassword(password)), nowIST(), c.id]);
  await db.query('DELETE FROM customer_sessions WHERE customer_id=?', [c.id]);
  await audit({ user_id: user.id, action: 'customer_password', summary: `Online password set for ${c.name} ${c.phone}` });
}

module.exports = { addresses, saveAddress, setDefaultAddress, removeAddress, refCode, referrals, smsEnabled, sendOtp, register, login, resetPassword, current, logout, newSession, setCookie, update, staffSetPassword,
  phone10, sentForTests, COOKIE };
