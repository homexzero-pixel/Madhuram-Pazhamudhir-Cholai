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
const fulfilment = require('../fulfilment');
const site = require('../site');
const events = require('../events');
const stock = require('../stock');
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
const shopUrl = (req) => site.shopUrl(req);
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
r.get('/customers/export', need('reports'), wrap(async (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="customers_${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)}.csv"`);
  res.send(reports.csv(await customers.exportAll()));
}));
r.get('/customers/:id', need('customers'), wrap(async (req, res) => ok(res, { customer: await customers.get(req.params.id) })));
r.post('/customers', need('customers'), wrap(async (req, res) => ok(res, { id: await customers.save(req.body, req.user) })));
r.post('/customers/:id/points', need('settings'), wrap(async (req, res) => {   // owner corrects points (old loyalty card, mistake)
  const pts = Math.trunc(Number(req.body.points));
  const reason = String(req.body.reason || '').trim();
  if (!pts) throw new UserError('Enter the points to add (or minus to take away).');
  if (reason.length < 3) throw new UserError('Write the reason.');
  await db.tx((q) => require('../loyalty').post(q, { customerId: Number(req.params.id), kind: 'adjust', points: pts, ref: reason, userId: req.user.id, at: nowIST() }));
  ok(res);
}));
r.post('/customers/pay', need('cash'), wrap(async (req, res) => ok(res, { balance: await customers.receivePayment(req.body, req.user) })));

// ------------------------------------------------------------------ reports
r.get('/reports', need('reports'), wrap(async (req, res) => {
  const [from, to] = reports.range(req.query);
  ok(res, { list: reports.list(), summary: await reports.summary(from, to) });
}));
r.get('/reports/dashboard', need('reports'), wrap(async (req, res) => {
  const [from, to] = reports.range(req.query);
  ok(res, await reports.dashboard(from, to));
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
r.post('/owner/prices', need('products'), wrap(async (req, res) => ok(res, await owner.savePrices(req.body.changes, req.user))));
r.get('/owner/buylist', need('daily'), wrap(async (req, res) => {
  const out = await owner.buyList(req.query);
  for (const g of out.groups) g.message = await owner.orderMessage(g);
  ok(res, out);
}));
r.get('/owner/losswatch', need('reports'), wrap(async (req, res) => ok(res, await owner.lossWatch(req.query))));
r.get('/owner/day', need('daily'), wrap(async (req, res) => ok(res, { text: await owner.dayText(req.query), owner_whatsapp: (await settings.load()).owner_whatsapp })));

// ------------------------------------------------------------------ online orders: staff side
r.get('/orders', need('orders'), wrap(async (req, res) => ok(res, { orders: await shop.staffList(req.query.tab), cod: await fulfilment.codPending(),
  shop_url: shopUrl(req), online_enabled: (await settings.load()).online_enabled })));
r.get('/orders/badge', need(), wrap(async (req, res) => ok(res, auth.can(req.user, 'orders') ? await shop.badge() : { new: 0, open: 0, last: 0 })));
// live updates for the billing screens (new order, invoiced, dispatched, completed, cancelled)
r.get('/events', need('orders'), (req, res) => { events.subscribe(req, res, req.user).catch(() => res.end()); });
r.get('/orders/:id', need('orders'), wrap(async (req, res) => {
  ok(res, { order: await shop.order('o.id=?', [req.params.id]), whatsapp: await fulfilment.statusMessage(req.params.id, shopUrl(req)) });
}));
const step = (fn) => wrap(async (req, res) => {
  const extra = await fn(req);
  ok(res, { ...(extra || {}), whatsapp: await fulfilment.statusMessage(req.params.id, shopUrl(req)) });
});
r.post('/orders/:id/status', need('orders'), step((req) => fulfilment.setStatus(req.params.id, req.body.status, req.user, req.body.note || '')));
r.post('/orders/:id/accept', need('orders'), step((req) => fulfilment.accept(req.params.id, req.user)));
r.post('/orders/:id/ready', need('orders'), step((req) => fulfilment.markReady(req.params.id, req.user)));
r.post('/orders/:id/dispatch', need('orders'), step((req) => fulfilment.dispatch(req.params.id, req.body || {}, req.user)));
r.get('/orders/:id/complete', need('orders'), wrap(async (req, res) => ok(res, { preview: await fulfilment.completePreview(req.params.id) })));
r.post('/orders/:id/complete', need('orders'), step(async (req) => ({ result: await fulfilment.complete(req.params.id, req.body || {}, req.user) })));
r.post('/orders/:id/cancel', need('orders'), step(async (req) => fulfilment.cancel(req.params.id, req.body || {}, req.user)));
r.post('/orders/:id/line', need('orders'), wrap(async (req, res) => {
  await fulfilment.changeLine(req.params.id, req.body.line_id, req.body.qty, req.user);
  ok(res, { order: await shop.order('o.id=?', [req.params.id]), whatsapp: await fulfilment.statusMessage(req.params.id, shopUrl(req)) });
}));
// stock held for online orders: things to check, and correcting the held numbers from the open orders
r.get('/checks', need('orders'), wrap(async (req, res) => {
  ok(res, await require('../ai/insights').insights(req.user, { ai: req.query.ai === '1' && auth.can(req.user, 'reports') }));
}));
r.post('/stock/reconcile', need('products'), wrap(async (req, res) => {
  const fixed = await stock.reconcile();
  await auth.audit({ user_id: req.user.id, action: 'stock_reserved', summary: `Held stock checked: ${fixed.length} corrected` });
  ok(res, { fixed });
}));
r.get('/ai/logs', need('reports'), wrap(async (req, res) => ok(res, await require('../ai/insights').logs(req.query))));
r.get('/shop-categories', need('stock_view'), wrap(async (req, res) => ok(res, { cats: await db.query(`SELECT c.id, c.name, COUNT(i.id) items
  FROM categories c LEFT JOIN items i ON i.category_id=c.id AND i.active=1 GROUP BY c.id, c.name ORDER BY c.name`) })));
r.get('/orders-stats', need('orders'), wrap(async (req, res) => {
  const [from, to] = reports.range(req.query.period || req.query.from ? req.query : { period: 'month' });
  ok(res, await shop.stats(from, to));
}));
r.post('/orders/:id/bill', need('bill'), wrap(async (req, res) => ok(res, { bill: await fulfilment.forCounter(req.params.id, req.user) })));
r.get('/orders-poster.svg', need('orders'), wrap(async (req, res) => {
  const svg = await require('qrcode').toString(shopUrl(req), { type: 'svg', margin: 1, color: { dark: '#14213d' } });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
}));

// ------------------------------------------------------------------ online shop: customers (no login)
// stock photos shipped with the app (public/photos/b = banners, public/photos/s = shop sections)
const PHOTOS = (() => {
  const fs = require('fs');
  const dir = require('path').join(__dirname, '..', '..', 'public', 'photos');
  const read = (d) => { try { return fs.readdirSync(require('path').join(dir, d)).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)); } catch (_) { return []; } };
  return { b: read('b'), s: read('s'), p: read('p') };
})();
r.get('/shop/info', wrap(async (req, res) => {
  const cfg = await settings.load();
  const secs = await require('../sections').list();
  ok(res, { shop: await settings.shopSettings(), cats: await shop.categories(), banners: settings.shopBanners(cfg), offers: await shop.offerSummary(),
    sections: secs, groups: require('../sections').GROUPS.map(([key, name]) => ({ key, name })).filter((g) => secs.some((x) => x.group === g.key)),
    festival: settings.festival(cfg, nowIST().slice(0, 10)), upi_qr: settings.photoUrl(cfg.upi_qr), photos: PHOTOS,
    assistant: { ai: (await require('../ai/gateway').status('shop')).on },
    stores: String(cfg.price_stores || '').split(',').map(Number).filter((n) => n > 0 && n < 100000).slice(0, 8),
    slots: shop.slots(cfg).map((d) => ({
    date: d.date, label: new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
    slots: d.slots.map((v) => ({ v, l: shop.slotTime(v, cfg) })) })) });
}));
r.get('/shop/items', wrap(async (req, res) => {
  if ((await settings.load()).online_enabled !== '1') return ok(res, { items: [], closed: true });
  return ok(res, { items: await shop.catalogue(req.query) });
}));
r.post('/shop/order', wrap(async (req, res) => ok(res, await shop.placeOrder(req.body || {}, clientIp(req), await cust.current(req)))));

// ------------------------------------------------------------------ customers' accounts (mobile + password, SMS code when set up)
const cust = require('../custauth');
const meOut = (c) => (c ? { id: c.id, name: c.name, phone: c.phone, address: c.address || '', verified: !!c.verified, points: Number(c.points || 0),
  email: c.email || '' } : null);
r.get('/shop/account', wrap(async (req, res) => ok(res, { me: meOut(await cust.current(req)), sms: cust.smsEnabled() })));
const me = async (req) => { const c = await cust.current(req); if (!c) throw new UserError('Please log in.', 401); return c; };
r.get('/shop/account/addresses', wrap(async (req, res) => ok(res, { addresses: await cust.addresses((await me(req)).id) })));
r.post('/shop/account/addresses', wrap(async (req, res) => {
  const c = await me(req);
  const id = await cust.saveAddress(c.id, req.body || {});
  ok(res, { id, addresses: await cust.addresses(c.id) });
}));
r.post('/shop/account/addresses/:id/default', wrap(async (req, res) => {
  const c = await me(req); await cust.setDefaultAddress(c.id, Number(req.params.id)); ok(res, { addresses: await cust.addresses(c.id) });
}));
r.post('/shop/account/addresses/:id/delete', wrap(async (req, res) => {
  const c = await me(req); await cust.removeAddress(c.id, Number(req.params.id)); ok(res, { addresses: await cust.addresses(c.id) });
}));
r.get('/shop/account/refer', wrap(async (req, res) => {
  const c = await me(req);
  ok(res, { code: await cust.refCode(c), ...(await cust.referrals(c.id)) });
}));
r.get('/shop/account/suggest', wrap(async (req, res) => {
  const c = await cust.current(req);
  ok(res, { items: await shop.suggest(c ? c.id : null) });
}));
r.post('/shop/track/:token/payref', wrap(async (req, res) => { await shop.setPayRef(req.params.token, (req.body || {}).ref, await cust.current(req)); ok(res); }));
r.post('/shop/track/:token/cancel', wrap(async (req, res) => {
  await shop.cancelByCustomer(req.params.token, await cust.current(req), (req.body || {}).reason);
  ok(res, { order: await shop.publicOrder(req.params.token, await cust.current(req)) });
}));
// the GST invoice of a completed order: only for the customer who placed it
r.get('/shop/account/orders/:number/invoice', wrap(async (req, res) => {
  const page = await require('../invoice').forCustomer(await cust.current(req), req.params.number);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(page);
}));
// "Ask the shop": answers from products available now and the customer's own orders (AI when switched on)
r.post('/shop/assistant', wrap(async (req, res) => {
  if ((await settings.load()).online_enabled !== '1') throw new UserError('The online shop is closed at the moment.');
  ok(res, await require('../ai/assistant').answer((req.body || {}).q, await cust.current(req), clientIp(req)));
}));
r.get('/shop-sections', need('products'), wrap(async (req, res) => ok(res, { sections: require('../sections').SECTIONS.map(([key, name, group]) => ({ key, name, group })) })));
r.post('/offers/bulk', need('products'), wrap(async (req, res) => ok(res, await catalog.bulkOffer(req.body || {}, req.user))));
r.post('/offers/clear', need('products'), wrap(async (req, res) => ok(res, await catalog.clearOffers(req.body || {}, req.user))));
r.post('/shop/account/otp', wrap(async (req, res) => ok(res, await cust.sendOtp(req.body.phone, req.body.purpose, clientIp(req)))));
r.post('/shop/account/signup', wrap(async (req, res) => {
  const id = await cust.register(req.body || {});
  cust.setCookie(res, req, await cust.newSession(id));
  ok(res, { me: meOut(await db.one('SELECT * FROM customers WHERE id=?', [id])) });
}));
r.post('/shop/account/login', wrap(async (req, res) => {
  const id = await cust.login(req.body.phone, req.body.password);
  cust.setCookie(res, req, await cust.newSession(id));
  ok(res, { me: meOut(await db.one('SELECT * FROM customers WHERE id=?', [id])) });
}));
r.post('/shop/account/reset', wrap(async (req, res) => {
  const id = await cust.resetPassword(req.body || {});
  cust.setCookie(res, req, await cust.newSession(id));
  ok(res, { me: meOut(await db.one('SELECT * FROM customers WHERE id=?', [id])) });
}));
r.post('/shop/account/logout', wrap(async (req, res) => { await cust.logout(req); cust.setCookie(res, req, '', 0); ok(res); }));
r.post('/shop/account/update', wrap(async (req, res) => {
  const c = await cust.current(req);
  if (!c) throw new UserError('Please log in again.', 401);
  await cust.update(c, req.body || {});
  ok(res, { me: meOut(await cust.current(req)) });
}));
r.get('/shop/account/orders', wrap(async (req, res) => {
  const c = await cust.current(req);
  if (!c) throw new UserError('Please log in.', 401);
  ok(res, { orders: await shop.customerOrders(c.id) });
}));
// staff: set a new online password for a customer who calls the shop
r.post('/customers/:id/online-password', need('customers'), wrap(async (req, res) => {
  await cust.staffSetPassword(req.params.id, req.body.password, req.user); ok(res);
}));
r.get('/shop/account/again', wrap(async (req, res) => {
  const c = await cust.current(req);
  ok(res, { items: c ? await shop.buyAgain(c.id) : [] });
}));
r.get('/shop/track/:token', wrap(async (req, res) => ok(res, { order: await shop.publicOrder(req.params.token, await cust.current(req)) })));

// ------------------------------------------------------------------ offers, shop barcodes, expenses
const expenses = require('../expenses');
const catalog = require('../catalog');
r.get('/offers', need('stock_view'), wrap(async (req, res) => ok(res, { offers: await catalog.offers() })));
r.post('/offers', need('products'), wrap(async (req, res) => { await catalog.setOffer(req.body || {}, req.user); ok(res); }));
r.post('/products/:id/barcode/internal', need('products'), wrap(async (req, res) => ok(res, { code: await catalog.internalBarcode(req.params.id, req.user) })));
r.get('/expenses', need('daily'), wrap(async (req, res) => {
  const [from, to] = reports.range(req.query.period || req.query.from ? req.query : { period: 'month' });
  ok(res, { ...(await expenses.list(from, to)), from, to, categories: expenses.CATEGORIES });
}));
r.post('/expenses', need('daily'), wrap(async (req, res) => ok(res, await expenses.add(req.body || {}, req.user))));
r.post('/expenses/:id/delete', need('reports'), wrap(async (req, res) => { await expenses.remove(req.params.id, req.user); ok(res); }));

// ------------------------------------------------------------------ product photos
const images = require('../images');
r.post('/products/:id/image', need('photos'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '1mb' }), wrap(async (req, res) => {
  const name = await images.save(Number(req.params.id), req.body, 'upload');
  await auth.audit({ user_id: req.user.id, action: 'product_photo', summary: `Photo added for product ${req.params.id}` });
  ok(res, { image: `/img/p/${name}` });
}));
r.post('/products/image-by-code/:code', need('photos'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '1mb' }), wrap(async (req, res) => {
  const it = await images.saveByCode(req.params.code, req.body);
  ok(res, { id: it.id, name: it.name });
}));
r.post('/shop-banners/image', need('settings'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '1mb' }), wrap(async (req, res) => {
  ok(res, { name: images.saveBanner(req.body) });
}));
r.post('/products/:id/image/remove', need('photos'), wrap(async (req, res) => { await images.remove(Number(req.params.id)); ok(res); }));
r.get('/images/fetch', need('photos'), wrap(async (req, res) => ok(res, await images.status())));
// photos from a list of web addresses (the owner's spreadsheet, read in the browser: product code / barcode + photo link)
r.post('/images/links', need('photos'), wrap(async (req, res) => {
  const out = await images.addLinks((req.body || {}).rows);
  await auth.audit({ user_id: req.user.id, action: 'product_photo', summary: `Photo links from a list: ${out.queued} to fetch, ${out.not_found} not found, ${out.own_photo} kept` });
  ok(res, { result: out, ...(await images.linksStatus()) });
}));
r.get('/images/links', need('photos'), wrap(async (req, res) => ok(res, await images.linksStatus())));
r.get('/images/links/next', need('photos'), wrap(async (req, res) => ok(res, { items: await images.nextLinks(req.query.n) })));
r.get('/images/links/:id/source', need('photos'), wrap(async (req, res) => {
  const p = await images.linkSource(Number(req.params.id));
  res.setHeader('Content-Type', p.type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', 'attachment');           // never shown as a page of this site
  res.send(p.buf);
}));
r.post('/images/links/:id/photo', need('photos'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '1mb' }), wrap(async (req, res) => {
  ok(res, await images.linkDone(Number(req.params.id), req.body));
}));
r.post('/images/links/:id/failed', need('photos'), wrap(async (req, res) => { await images.linkFailed(Number(req.params.id), (req.body || {}).note); ok(res); }));
r.post('/images/links/again', need('photos'), wrap(async (req, res) => { await images.linksAgain(); ok(res, await images.linksStatus()); }));
r.post('/images/links/clear', need('photos'), wrap(async (req, res) => { await images.linksClear(); ok(res, await images.linksStatus()); }));
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
