'use strict';
const express = require('express');
const auth = require('../auth');
const db = require('../db');
const settings = require('../settings');
const catalog = require('../catalog');
const billing = require('../billing');
const admin = require('../admin');
const { UserError } = require('../money');
const pkg = require('../../package.json');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data = {}) => res.json({ ok: true, ...data });

function need(perm) {
  return (req, res, next) => {
    if (!req.user) return next(new UserError('Please log in again.', 401));
    if (perm && !auth.can(req.user, perm)) return next(new UserError('Your login is not allowed to do this. Ask the owner.', 403));
    return next();
  };
}

// who is logged in (every /api call)
r.use(wrap(async (req, res, next) => {
  req.user = await auth.sessionUser(req);
  res.setHeader('Cache-Control', 'no-store');
  next();
}));

// ------------------------------------------------------------------ start, setup, login
r.get('/status', wrap(async (req, res) => {
  const s = await settings.load();
  ok(res, { setup_needed: await admin.needsSetup(), name: s.name, name_ta: s.name_ta, version: pkg.version, logged_in: !!req.user });
}));

r.post('/setup', wrap(async (req, res) => {
  await admin.firstSetup(req.body || {});
  const { token } = await auth.login(req.body.username || 'owner', req.body.password);
  auth.setCookie(res, req, token, require('../config').sessionHours * 3600);
  ok(res);
}));

r.post('/login', wrap(async (req, res) => {
  const { token, user } = await auth.login(req.body.username, req.body.password);
  auth.setCookie(res, req, token, require('../config').sessionHours * 3600);
  ok(res, { user: { name: user.name, role: user.role } });
}));

r.post('/logout', wrap(async (req, res) => {
  await auth.logout(req);
  auth.setCookie(res, req, '', 0);
  ok(res);
}));

r.get('/me', need(), wrap(async (req, res) => {
  const s = await settings.load();
  ok(res, { user: req.user, perms: auth.permsOf(req.user), settings: await settings.publicSettings(), counters: settings.counters(s),
    version: pkg.version });
}));

r.post('/approve', need('bill'), wrap(async (req, res) => {
  const a = await auth.approve(req.body.username, req.body.pin, req.body.perm);
  ok(res, a);
}));

// ------------------------------------------------------------------ products and stock
r.get('/catalog', need('bill'), wrap(async (req, res) => {
  const v = await catalog.version();
  const etag = `"cat-${v}"`;
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache');
  return ok(res, await catalog.counterCatalogue());
}));

r.get('/products', need('stock_view'), wrap(async (req, res) => ok(res, await catalog.search(req.query))));
r.get('/products/:id', need('stock_view'), wrap(async (req, res) => {
  ok(res, { item: await catalog.get(req.params.id), moves: await catalog.moves(req.params.id) });
}));

// Products page, and "Quick add" at the counter for an unknown barcode (a cashier needs a manager's PIN for that).
r.post('/products', need(), wrap(async (req, res) => {
  if (!(await auth.approvedBy(req.user, 'products', req.body.approval))) {
    throw new UserError('Adding or changing products needs the owner or a manager (PIN).', 403);
  }
  const id = await catalog.save(req.body, req.user);
  ok(res, { item: await catalog.get(id) });
}));

r.post('/products/import', need('products'), express.text({ type: ['text/csv', 'text/plain'], limit: '25mb' }), wrap(async (req, res) => {
  if (typeof req.body !== 'string' || !req.body) throw new UserError('Choose a CSV file.');
  ok(res, await catalog.importCsv(req.body, req.user));
}));

r.post('/stock/receive', need('receive'), wrap(async (req, res) => ok(res, { on_hand: await catalog.receive(req.body, req.user) })));
r.get('/stock/now', need('bill'), wrap(async (req, res) => ok(res, { stock: await catalog.stockNow() })));
r.post('/stock/count', need('receive'), wrap(async (req, res) => ok(res, { on_hand: await catalog.setCount(req.body, req.user) })));
// add or remove counters (owner / manager)
r.post('/counters', need('reopen_shift'), wrap(async (req, res) => {
  const list = [...new Set((Array.isArray(req.body.counters) ? req.body.counters : []).map((c) => String(c).trim().slice(0, 20)).filter(Boolean))];
  if (!list.length) throw new UserError('Keep at least one counter.');
  if (list.some((c) => c.includes(','))) throw new UserError('A counter name cannot contain a comma.');
  const open = (await db.query("SELECT counter FROM shifts WHERE status='open'")).map((r) => r.counter).filter((c) => !list.includes(c));
  if (open.length) throw new UserError(`${open.join(', ')} still has an open shift. Close it before removing the counter.`);
  await settings.save({ counters: list.join(',') });
  await auth.audit({ user_id: req.user.id, action: 'settings', summary: `Counters: ${list.join(', ')}` });
  ok(res, { counters: list });
}));
r.post('/stock/writeoff', need('products'), wrap(async (req, res) => { await catalog.writeOff(req.body, req.user); ok(res); }));

// ------------------------------------------------------------------ billing
r.get('/customers', need('bill'), wrap(async (req, res) => ok(res, { customers: await billing.findCustomers(req.query.q) })));

r.post('/checkout', need('bill'), wrap(async (req, res) => ok(res, { bill: await billing.checkout(req.user, req.body || {}) })));

r.get('/bills', need('bill'), wrap(async (req, res) => {
  const mine = !auth.can(req.user, 'reports');       // cashiers see only their counter's bills
  const [from, to] = req.query.period ? require('../money').periodRange(req.query.period) : ['', ''];
  ok(res, { bills: await billing.recentBills({ q: String(req.query.q || '').slice(0, 30), date: req.query.period ? '' : req.query.date, from, to,
    counter: mine ? String(req.query.counter || '') || '-' : String(req.query.counter || '') }) });
}));
r.get('/bills/:id', need('bill'), wrap(async (req, res) => ok(res, { bill: await billing.receipt(req.params.id) })));
r.post('/bills/:id/printed', need('bill'), wrap(async (req, res) => {
  await billing.markPrinted(req.params.id, req.user, !!req.body.reprint);
  ok(res);
}));

// ------------------------------------------------------------------ cash / shifts
r.get('/shift', need('bill'), wrap(async (req, res) => {
  const counter = billing.cleanCounter(req.query.counter);
  const shift = await billing.openShift(counter);
  ok(res, { shift, summary: shift ? await billing.cashSummary(shift.id) : null, last_closed: shift ? null : await billing.lastClosed(counter) });
}));
r.post('/shift/open', need('cash'), wrap(async (req, res) => ok(res, { id: await billing.startShift(req.user, req.body.counter, req.body.float) })));
r.post('/shift/close', need('cash'), wrap(async (req, res) => {
  ok(res, { result: await billing.closeShift(req.user, req.body.shift_id, req.body.counted, req.body.retained, req.body.note) });
}));
r.post('/shift/cash', need('cash'), wrap(async (req, res) => {
  await billing.cashMove(req.user, req.body.counter, req.body.kind, req.body.amount, req.body.reason);
  ok(res);
}));
r.get('/shifts', need('reports'), wrap(async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
  ok(res, { shifts: await db.query(`SELECT s.*, u.name cashier, c.name closed_by_name FROM shifts s JOIN users u ON u.id=s.cashier_id
    LEFT JOIN users c ON c.id=s.closed_by ${date ? 'WHERE s.business_date=?' : ''} ORDER BY s.id DESC LIMIT 60`, date ? [date] : []) });
}));

// ------------------------------------------------------------------ owner
r.get('/dashboard', need('reports'), wrap(async (req, res) => {
  const q = req.query.date ? { from: req.query.date, to: req.query.date } : req.query;
  ok(res, await admin.dashboard(q));
}));
r.get('/audit', need('reports'), wrap(async (req, res) => ok(res, { rows: await admin.auditLog(req.query) })));

r.get('/settings', need('settings'), wrap(async (req, res) => ok(res, { settings: await settings.publicSettings() })));
r.post('/settings', need('settings'), wrap(async (req, res) => {
  const v = req.body || {};
  if (v.invoice_prefix !== undefined && !/^[A-Z0-9]{1,6}$/.test(v.invoice_prefix)) throw new UserError('Bill prefix: 1–6 capital letters or digits.');
  await settings.save(v);
  await auth.audit({ user_id: req.user.id, action: 'settings', summary: `Settings changed: ${Object.keys(v).join(', ').slice(0, 250)}` });
  ok(res, { settings: await settings.publicSettings() });
}));

r.get('/users', need('users'), wrap(async (req, res) => ok(res, { users: await admin.listUsers(), roles: auth.ROLES })));
r.post('/users', need('users'), wrap(async (req, res) => ok(res, { id: await admin.saveUser(req.body || {}, req.user) })));

r.get('/backup', need('backup'), wrap(async (req, res) => { await admin.backup(res, req.user); }));
r.post('/import-shop', need('settings'), express.raw({ type: 'application/octet-stream', limit: '60mb' }), wrap(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new UserError('Choose the export file.');
  ok(res, await admin.importFromShop(req.body, req.user));
}));

r.use(require('./more').router);

module.exports = r;
