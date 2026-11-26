'use strict';
// Stage 2 API: purchases, returns, customers & credit, reports, owner tools, online orders, backups.
const express = require('express');
const auth = require('../auth');
const db = require('../db');
const settings = require('../settings');
const purchasing = require('../purchasing');
const returns = require('../returns');
const customers = require('../customers');
const reports = require('../reports');
const owner = require('../owner');
const shop = require('../shop');
const backups = require('../backups');
const { UserError, nowIST } = require('../money');

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ok = (res, data = {}) => res.json({ ok: true, ...data });
const need = (perm) => (req, res, next) => {
  if (!req.user) return next(new UserError('Please log in again.', 401));
  if (perm && !auth.can(req.user, perm)) return next(new UserError('Your login is not allowed to do this. Ask the owner.', 403));
  return next();
};
const baseUrl = (req) => `${req.protocol}://${req.headers.host}`;
const clientIp = (req) => req.ip || '';

// ------------------------------------------------------------------ counter events that matter for loss watch
r.post('/pos/event', need('bill'), wrap(async (req, res) => {
  const action = req.body.action;
  if (!['bill_cancel', 'line_remove', 'unknown_barcode'].includes(action)) throw new UserError('Unknown event.');
  await auth.audit({ user_id: req.user.id, action, value: String(Number(req.body.value) || 0),
    summary: `${String(req.body.counter || '').slice(0, 20)}: ${String(req.body.summary || action).slice(0, 250)}` });
  ok(res);
}));

// ------------------------------------------------------------------ suppliers and purchases
r.get('/suppliers', need('stock_view'), wrap(async (req, res) => ok(res, { suppliers: await purchasing.suppliers({ all: req.query.all === '1' }) })));
r.get('/suppliers/:id', need('purchase'), wrap(async (req, res) => ok(res, await purchasing.supplierLedger(req.params.id))));
r.post('/suppliers', need('purchase'), wrap(async (req, res) => ok(res, { id: await purchasing.saveSupplier(req.body, req.user) })));
r.post('/suppliers/pay', need('supplier_pay'), wrap(async (req, res) => { await purchasing.paySupplier(req.body, req.user); ok(res); }));
r.get('/purchases', need('purchase'), wrap(async (req, res) => ok(res, { purchases: await purchasing.purchases(req.query) })));
r.get('/purchases/:id', need('purchase'), wrap(async (req, res) => ok(res, { purchase: await purchasing.purchase(req.params.id) })));
r.post('/purchases', need('purchase'), wrap(async (req, res) => ok(res, await purchasing.receivePurchase(req.body, req.user))));

// ------------------------------------------------------------------ returns
r.get('/returns/find', need('bill'), wrap(async (req, res) => ok(res, { bill: await returns.findSale(req.query.bill) })));
r.post('/returns', need('bill'), wrap(async (req, res) => ok(res, { result: await returns.createReturn(req.user, req.body) })));
r.get('/returns', need('bill'), wrap(async (req, res) => ok(res, { returns: await returns.listReturns(req.query) })));

// ------------------------------------------------------------------ customers and credit (udhaar)
r.get('/customers/list', need('customers'), wrap(async (req, res) => ok(res, { customers: await customers.list({ q: req.query.q, owing: req.query.owing === '1' }) })));
r.get('/customers/:id', need('customers'), wrap(async (req, res) => ok(res, { customer: await customers.get(req.params.id) })));
r.post('/customers', need('customers'), wrap(async (req, res) => ok(res, { id: await customers.save(req.body, req.user) })));
r.post('/customers/pay', need('cash'), wrap(async (req, res) => ok(res, { balance: await customers.receivePayment(req.body, req.user) })));

// ------------------------------------------------------------------ reports
r.get('/reports', need('reports'), wrap(async (req, res) => {
  const [from, to] = reports.range(req.query);
  ok(res, { list: reports.list(), summary: await reports.summary(from, to) });
}));
r.get('/reports/:name', need('reports'), wrap(async (req, res) => {
  const out = await reports.run(req.params.name, req.query);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.name}_${out.from}_to_${out.to}.csv"`);
    return res.send(reports.csv(out.rows));
  }
  return ok(res, out);
}));

// ------------------------------------------------------------------ owner tools
r.get('/owner/prices', need('daily'), wrap(async (req, res) => ok(res, await owner.priceList(req.query))));
r.post('/owner/prices', need('products'), wrap(async (req, res) => ok(res, { changed: await owner.savePrices(req.body.changes, req.user) })));
r.get('/owner/buylist', need('daily'), wrap(async (req, res) => {
  const out = await owner.buyList(req.query);
  for (const g of out.groups) g.message = await owner.orderMessage(g);
  ok(res, out);
}));
r.get('/owner/losswatch', need('reports'), wrap(async (req, res) => ok(res, await owner.lossWatch(req.query))));
r.get('/owner/day', need('daily'), wrap(async (req, res) => ok(res, { text: await owner.dayText(req.query), owner_whatsapp: (await settings.load()).owner_whatsapp })));

// ------------------------------------------------------------------ online orders: staff side
r.get('/orders', need('orders'), wrap(async (req, res) => ok(res, { orders: await shop.staffList(req.query.tab) })));
r.get('/orders/badge', need(), wrap(async (req, res) => ok(res, auth.can(req.user, 'orders') ? await shop.badge() : { new: 0, last: 0 })));
r.get('/orders/:id', need('orders'), wrap(async (req, res) => {
  ok(res, { order: await shop.order('o.id=?', [req.params.id]), whatsapp: await shop.statusMessage(req.params.id, baseUrl(req)) });
}));
r.post('/orders/:id/status', need('orders'), wrap(async (req, res) => {
  await shop.setStatus(req.params.id, req.body.status, req.user, req.body.note || '');
  ok(res, { whatsapp: await shop.statusMessage(req.params.id, baseUrl(req)) });
}));
r.post('/orders/:id/line', need('orders'), wrap(async (req, res) => {
  await shop.changeLine(req.params.id, req.body.line_id, req.body.qty, req.user);
  ok(res, { order: await shop.order('o.id=?', [req.params.id]), whatsapp: await shop.statusMessage(req.params.id, baseUrl(req)) });
}));
r.get('/orders-stats', need('orders'), wrap(async (req, res) => {
  const [from, to] = reports.range(req.query.period || req.query.from ? req.query : { period: 'month' });
  ok(res, await shop.stats(from, to));
}));
r.post('/orders/:id/bill', need('bill'), wrap(async (req, res) => ok(res, { bill: await shop.forCounter(req.params.id) })));
r.get('/orders-poster.svg', need('orders'), wrap(async (req, res) => {
  const svg = await require('qrcode').toString(`${baseUrl(req)}/shop/`, { type: 'svg', margin: 1, color: { dark: '#14213d' } });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
}));

// ------------------------------------------------------------------ online shop: customers (no login)
r.get('/shop/info', wrap(async (req, res) => {
  const cfg = await settings.load();
  ok(res, { shop: await settings.shopSettings(), cats: await shop.categories(), slots: shop.slots(cfg).map((d) => ({
    date: d.date, label: new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
    slots: d.slots.map((v) => ({ v, l: shop.slotLabel(v, cfg).split(', ')[1] })) })) });
}));
r.get('/shop/items', wrap(async (req, res) => {
  if ((await settings.load()).online_enabled !== '1') return ok(res, { items: [], closed: true });
  return ok(res, { items: await shop.catalogue(req.query) });
}));
r.post('/shop/order', wrap(async (req, res) => ok(res, await shop.placeOrder(req.body || {}, clientIp(req)))));
r.get('/shop/track/:token', wrap(async (req, res) => ok(res, { order: await shop.publicOrder(req.params.token) })));

// ------------------------------------------------------------------ product photos
const images = require('../images');
r.post('/products/:id/image', need('products'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '1mb' }), wrap(async (req, res) => {
  const name = await images.save(Number(req.params.id), req.body, 'upload');
  await auth.audit({ user_id: req.user.id, action: 'product_photo', summary: `Photo added for product ${req.params.id}` });
  ok(res, { image: `/img/p/${name}` });
}));
r.post('/products/image-by-code/:code', need('products'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '1mb' }), wrap(async (req, res) => {
  const it = await images.saveByCode(req.params.code, req.body);
  ok(res, { id: it.id, name: it.name });
}));
r.post('/products/:id/image/remove', need('products'), wrap(async (req, res) => { await images.remove(Number(req.params.id)); ok(res); }));
r.get('/images/fetch', need('products'), wrap(async (req, res) => ok(res, await images.status())));
r.post('/images/fetch', need('settings'), wrap(async (req, res) => {
  const st = req.body.action === 'stop' ? images.stop() : images.start();
  if (req.body.action !== 'stop') await auth.audit({ user_id: req.user.id, action: 'settings', summary: 'Started finding product photos by barcode' });
  ok(res, await st);
}));

// ------------------------------------------------------------------ backups kept on the server
r.get('/backups', need('backup'), wrap(async (req, res) => {
  const key = auth.can(req.user, 'settings') ? await backups.cronKey() : null;
  ok(res, { backups: await backups.list(), status: await backups.status(), cron_url: key ? `${baseUrl(req)}/cron/backup?key=${key}` : null });
}));
r.post('/backups', need('backup'), wrap(async (req, res) => {
  const b = await backups.make('manual');
  await auth.audit({ user_id: req.user.id, action: 'backup', summary: `Backup saved on the server: ${b.name}` });
  ok(res, b);
}));
r.get('/backups/:name', need('backup'), wrap(async (req, res) => {
  res.download(backups.filePath(req.params.name), req.params.name);
}));

// Hostinger hPanel → Advanced → Cron Jobs can call this every evening (the app also does it by itself after 9 pm).
const cron = express.Router();
cron.get('/cron/backup', wrap(async (req, res) => {
  const key = await backups.cronKey();
  const given = Buffer.from(String(req.query.key || ''));
  if (given.length !== Buffer.byteLength(key) || !require('crypto').timingSafeEqual(given, Buffer.from(key))) throw new UserError('Wrong key.', 403);
  const b = await backups.make('auto');
  res.type('text/plain').send(`OK ${b.name} ${b.bytes} bytes at ${nowIST()}\n`);
}));

void db;
module.exports = { router: r, cron };
