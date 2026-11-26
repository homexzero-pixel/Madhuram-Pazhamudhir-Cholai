'use strict';
// Stage 2: purchases, returns, credit, online orders, reports, owner tools, backups – against a real MySQL/MariaDB test database.
process.env.NODE_ENV = 'test';
process.env.MPC_NO_AUTOSTART = '1';
process.env.BACKUP_DIR = require('path').join(require('os').tmpdir(), `mpc_backup_test_${process.pid}`);
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../src/db');
const { createApp } = require('../server');

let base;
let server;
class Browser {
  constructor() { this.cookie = ''; }
  async call(method, path, body, headers = {}) {
    const res = await fetch(base + path, { method, headers: { Origin: base, Cookie: this.cookie,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
  }
  get(p) { return this.call('GET', p); }
  post(p, b) { return this.call('POST', p, b ?? {}); }
}
const uuid = () => crypto.randomUUID();
const owner = new Browser();
const cashier = new Browser();
const customer = new Browser();
let rice;
let apple;
let supplierId;

test.before(async () => {
  if (!/test/.test(process.env.DB_NAME || '')) throw new Error('DB_NAME must be a test database.');
  for (const t of (await db.query('SHOW TABLES')).map((r) => Object.values(r)[0])) await db.query(`DROP TABLE \`${t}\``);
  await db.migrate();
  require('../src/settings').reset();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await owner.post('/api/setup', { username: 'owner', password: 'owner-pass-1', pin: '4321', name: 'Raja' });
  await owner.post('/api/users', { username: 'priya', name: 'Priya', role: 'cashier', password: 'cash-pass-1' });
  await owner.post('/api/users', { username: 'kumar', name: 'Kumar', role: 'manager', password: 'mgr-pass-1', pin: '2468' });
  await cashier.post('/api/login', { username: 'priya', password: 'cash-pass-1' });
  rice = (await owner.post('/api/products', { name: 'Ponni rice 1 kg', price: '75', mrp: '80', gst_rate: '5', tax_class: 'taxable', barcode: '111', cat: 'Rice' })).data.item;
  apple = (await owner.post('/api/products', { name: 'Apple', unit: 'kg', price: '180', plu: '101', cat: 'Fruits', reorder_level: '2' })).data.item;
  await cashier.post('/api/shift/open', { counter: 'Counter 1', float: '1000' });
});
test.after(async () => { server.close(); await db.end(); });

test('supplier, purchase bill with free goods, supplier payment from the drawer', async () => {
  let r = await owner.post('/api/suppliers', { name: 'Sri Murugan Traders', phone: '9840011111', gstin: '33ABCDE1234F1Z5' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  supplierId = r.data.id;
  r = await owner.post('/api/purchases', { supplier_id: supplierId, bill_ref: 'SMT-551', bill_date: '2026-11-20', lines: [
    { item_id: rice.id, qty: '20', free_qty: '5', amount: '1250', expiry: '2027-03-01' },     // 25 bags for ₹1250 = ₹50 each
    { item_id: apple.id, qty: '10.5', rate: '120', price: '190' },                              // new selling price on the bill
  ] });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(r.data.grn_no, 'GRN/2627/00001');
  assert.equal(r.data.total, '2510.00');
  const p = (await owner.get(`/api/products/${rice.id}`)).data.item;
  assert.deepEqual([p.on_hand, p.cost], ['25', '50.0000']);
  const a = (await owner.get(`/api/products/${apple.id}`)).data.item;
  assert.deepEqual([a.on_hand, a.price], ['10.5', '190.00']);
  assert.match((await owner.post('/api/purchases', { supplier_id: supplierId, lines: [{ item_id: rice.id, qty: '1.5', amount: '10' }] })).data.error, /whole numbers/);

  r = await owner.post('/api/suppliers/pay', { supplier_id: supplierId, amount: '500', method: 'cash', counter: 'Counter 1' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  const sup = (await owner.get(`/api/suppliers/${supplierId}`)).data;
  assert.equal(sup.balance, '2010.00');
  const shift = (await cashier.get('/api/shift?counter=Counter%201')).data.summary;
  assert.equal(shift.supplier_paid, '500.00');
  assert.equal(shift.expected, '500.00');
});

let saleId;
test('credit sale needs approval and a customer; payment received goes into the drawer', async () => {
  const bill = (extra) => ({ uuid: uuid(), counter: 'Counter 1', lines: [{ id: rice.id, qty: 2 }], payments: [{ method: 'credit', amount: '150' }], ...extra });
  assert.equal((await cashier.post('/api/checkout', bill())).status, 403);
  const ap = await cashier.post('/api/approve', { username: 'kumar', pin: '2468', perm: 'credit_sale' });
  assert.match((await cashier.post('/api/checkout', bill({ approval_credit: ap.data.token }))).data.error, /customer/);
  const r = await cashier.post('/api/checkout', bill({ approval_credit: ap.data.token, customer: { phone: '9840012345', name: 'Lakshmi' } }));
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  saleId = r.data.bill.id;
  let c = (await cashier.get('/api/customers?q=Lakshmi')).data.customers[0];
  assert.equal(c.balance, '150.00');
  assert.match((await cashier.post('/api/customers/pay', { customer_id: c.id, amount: '200', method: 'cash', counter: 'Counter 1' })).data.error, /owes only/);
  assert.equal((await cashier.post('/api/customers/pay', { customer_id: c.id, amount: '100', method: 'cash', counter: 'Counter 1' })).data.balance, '50.00');
  const shift = (await cashier.get('/api/shift?counter=Counter%201')).data.summary;
  assert.deepEqual([shift.credit, shift.udhaar_received, shift.expected], ['150.00', '100.00', '600.00']);
  c = (await owner.get(`/api/customers/${c.id}`)).data.customer;
  assert.equal(c.ledger.length, 2);
});

test('returns: partial, approval, refund to credit or cash, stock back, paise add up', async () => {
  // a 3-line bill paid in cash to return from
  const r0 = await cashier.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', lines: [{ id: rice.id, qty: 3 }, { id: apple.id, qty: '0.333' }],
    payments: [{ method: 'cash', amount: '288.27' }] });
  assert.equal(r0.data.ok, true, JSON.stringify(r0.data));
  const sale = (await cashier.get(`/api/returns/find?bill=${encodeURIComponent(r0.data.bill.bill_no)}`)).data.bill;
  const riceLine = sale.lines.find((l) => l.name.startsWith('Ponni'));
  const appleLine = sale.lines.find((l) => l.name === 'Apple');
  const ret = (lines, extra = {}) => cashier.post('/api/returns', { sale_id: sale.id, counter: 'Counter 1', method: 'cash', reason: 'Damaged pack', lines, ...extra });
  assert.equal((await ret([{ line_id: riceLine.id, qty: 1 }])).status, 403);
  const ap = async () => (await cashier.post('/api/approve', { username: 'kumar', pin: '2468', perm: 'refund' })).data.token;
  let r = await ret([{ line_id: riceLine.id, qty: 1 }], { approval: await ap() });
  assert.equal(r.data.result.total, '75.00', JSON.stringify(r.data));
  assert.equal(r.data.result.return_no, 'MCN/2627/00001');
  assert.match((await ret([{ line_id: riceLine.id, qty: 3 }], { approval: await ap() })).data.error, /only 2/);
  // apple 0.333 kg × 190 = 63.27; returned in two parts that must add up exactly
  await ret([{ line_id: appleLine.id, qty: '0.111', restock: false }], { approval: await ap() });
  await ret([{ line_id: appleLine.id, qty: '0.222' }], { approval: await ap() });
  const sums = await db.one('SELECT SUM(amount) a, SUM(taxable) t FROM return_lines WHERE sale_line_id=?', [appleLine.id]);
  assert.equal(sums.a, '63.27');
  const shift = (await cashier.get('/api/shift?counter=Counter%201')).data.summary;
  assert.equal(shift.refunds, '138.27');
  // rice: 25 − 2 − 3 + 1 back = 21; apple 10.5 − 0.333 + 0.222 back (0.111 damaged) = 10.389
  assert.equal((await owner.get(`/api/products/${rice.id}`)).data.item.on_hand, '21');
  assert.equal((await owner.get(`/api/products/${apple.id}`)).data.item.on_hand, '10.389');
  // refund onto credit reduces what the customer owes
  const credSale = (await cashier.get(`/api/bills/${saleId}`)).data.bill;
  r = await cashier.post('/api/returns', { sale_id: saleId, method: 'credit', reason: 'Wrong item', approval: await ap(),
    lines: [{ line_id: credSale.lines[0].id, qty: 1 }] });
  assert.match(r.data.error, /owes only ₹50.00/);
});

let order;
test('online order: closed, place, stock held, staff accept, bill at the counter with delivery charge', async () => {
  const slotsClosed = (await customer.get('/api/shop/items')).data;
  assert.equal(slotsClosed.closed, true);
  await owner.post('/api/settings', { online_enabled: '1', online_open: '00:00', online_close: '23:59', online_lead_minutes: '30',
    online_min_order: '100', online_delivery_charge: '30', online_free_delivery_above: '500' });
  require('../src/settings').reset();
  const info = (await customer.get('/api/shop/info')).data;
  const slot = info.slots[0].slots[0].v;
  // ordering needs an account (no SMS service in tests: mobile + password only)
  assert.equal((await customer.post('/api/shop/order', { name: 'X', mode: 'pickup', slot, lines: [{ id: rice.id, qty: 1 }] })).status, 401);
  assert.equal((await customer.post('/api/shop/account/signup', { name: 'Meena', phone: '+91 98765 43210', password: 'secret-1' })).data.ok, true);
  const items = (await customer.get('/api/shop/items?q=ponni')).data.items;
  assert.equal(items[0].available, '21');
  const place = (o) => customer.post('/api/shop/order', { name: 'Meena', phone: '+91 98765 43210', mode: 'delivery', address: '4, Temple Street, near school',
    slot, lines: [{ id: rice.id, qty: 2 }, { id: apple.id, qty: '0.5' }], ...o });
  assert.match((await place({ lines: [{ id: rice.id, qty: 50 }] })).data.error, /Only 21/);
  assert.match((await place({ slot: '2001-01-01T10:00' })).data.error, /time slot/);
  assert.match((await place({ address: 'x' })).data.error, /address/);
  const r = await place();
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(r.data.number, 'ON-00001');
  const track = (await customer.get(`/api/shop/track/${r.data.token}`)).data.order;
  assert.deepEqual([track.est_items, track.delivery_charge, track.est_total], ['245.00', '30.00', '275.00']);
  assert.equal((await customer.get('/api/shop/items?q=ponni')).data.items[0].available, '19');      // held for the order

  assert.equal((await cashier.get('/api/orders/badge')).data.new, 1);
  const list = (await cashier.get('/api/orders')).data.orders;
  order = list[0];
  let st = await cashier.post(`/api/orders/${order.id}/status`, { status: 'cancelled', note: '' });
  assert.match(st.data.error, /why/);
  st = await cashier.post(`/api/orders/${order.id}/status`, { status: 'accepted' });
  assert.match(st.data.whatsapp.text, /accepted/);
  assert.equal(st.data.whatsapp.phone, '919876543210');

  const b = (await cashier.post(`/api/orders/${order.id}/bill`)).data.bill;
  assert.equal(b.lines.length, 2);
  assert.equal(b.delivery.rate, '30.00');
  // a tampered delivery charge is refused
  const lines = [...b.lines, { id: b.delivery.id, qty: '1', rate: '1.00', delivery: true }];
  assert.match((await cashier.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', order_id: b.order_id, customer: b.customer, lines,
    payments: [{ method: 'upi', amount: '246' }] })).data.error, /delivery charge/);
  lines[2].rate = b.delivery.rate;
  const sale = await cashier.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', order_id: b.order_id, customer: b.customer, lines,
    payments: [{ method: 'upi', amount: '275' }] });
  assert.equal(sale.data.ok, true, JSON.stringify(sale.data));
  const done = (await customer.get(`/api/shop/track/${r.data.token}`)).data.order;
  assert.deepEqual([done.status, done.bill_no], ['done', sale.data.bill.bill_no]);
  assert.equal((await customer.get('/api/shop/items?q=ponni')).data.items[0].available, '19');      // sold now, not held twice
  assert.match((await cashier.post(`/api/orders/${order.id}/bill`)).data.error, /already billed/);
});

test('reports, GST, CSV, owner tools and day summary', async () => {
  const s = (await owner.get('/api/reports')).data.summary;
  assert.equal(s.bills, 3);
  assert.equal(s.sales, '713.27');               // 150 + 288.27 + 275
  assert.equal(s.returns, '138.27');
  assert.equal(s.net, '575.00');
  assert.equal(s.credit, '150.00');
  for (const name of ['daily', 'items', 'categories', 'hours', 'staff', 'gst', 'hsn', 'bills', 'returns', 'purchases', 'wastage', 'shifts', 'stock',
    'expiry', 'deadstock', 'credit', 'suppliers']) {
    const r = await owner.get(`/api/reports/${name}`);
    assert.equal(r.data.ok, true, `${name}: ${JSON.stringify(r.data)}`);
  }
  const gst = (await owner.get('/api/reports/gst')).data.rows;
  const five = gst.find((g) => Number(g.gst_rate) === 5);
  assert.equal(five.total, '450.00');            // rice: 150 + 225 + 150 (online) − 75 returned
  const csv = await owner.get('/api/reports/bills?format=csv');
  assert.match(csv.data, /bill_no,created_at/);
  assert.equal((await cashier.get('/api/reports')).status, 403);

  let p = await owner.get('/api/owner/prices');
  assert.ok(p.data.items.some((i) => i.name === 'Apple'));
  assert.equal((await owner.post('/api/owner/prices', { changes: [{ id: apple.id, price: '170' }, { id: rice.id, price: '75' }] })).data.changed, 1);
  assert.match((await owner.post('/api/owner/prices', { changes: [{ id: rice.id, price: '99' }] })).data.error, /more than MRP/);
  const buy = (await owner.get('/api/owner/buylist?days=1')).data;
  const g = buy.groups.find((x) => x.supplier === 'Sri Murugan Traders');
  assert.ok(g && g.message.includes('Ponni rice'), JSON.stringify(buy));
  const lw = (await owner.get('/api/owner/losswatch')).data.rows;
  assert.ok(lw.find((x) => x.name === 'Priya'));
  await cashier.post('/api/pos/event', { action: 'bill_cancel', value: 450, summary: 'Bill cancelled with 3 items', counter: 'Counter 1' });
  await cashier.post('/api/pos/event', { action: 'bill_cancel', value: 900, summary: 'Bill cancelled with 5 items', counter: 'Counter 1' });
  const lw2 = (await owner.get('/api/owner/losswatch')).data.rows.find((x) => x.name === 'Priya');
  assert.ok(lw2.flags.some((f) => /2 bills cancelled/.test(f)), JSON.stringify(lw2));
  const day = (await owner.get('/api/owner/day')).data.text;
  assert.match(day, /Net sales: \*₹575.00\*/);
  assert.match(day, /Priya: 2 bills cancelled/);
});

test('backups saved on the server, listed, downloaded, and the cron address', async () => {
  const b = await owner.post('/api/backups');
  assert.equal(b.data.ok, true, JSON.stringify(b.data));
  const list = (await owner.get('/api/backups')).data;
  assert.equal(list.backups[0].name, b.data.name);
  assert.equal(list.status.ok, true);
  const file = await fetch(`${base}/api/backups/${b.data.name}`, { headers: { Cookie: owner.cookie } });
  const sql = require('zlib').gunzipSync(Buffer.from(await file.arrayBuffer())).toString();
  assert.match(sql, /INSERT INTO `online_orders`/);
  assert.equal((await fetch(`${base}/api/backups/..%2F..%2Fetc%2Fpasswd`, { headers: { Cookie: owner.cookie } })).status, 404);
  const url = new URL(list.cron_url);
  assert.equal((await fetch(`${base}/cron/backup?key=wrong`)).status, 403);
  assert.match(await (await fetch(`${base}${url.pathname}${url.search}`)).text(), /^OK madhuram_auto_/);
  // retention: old backups are trimmed to 14 days + 12 months
  for (let d = 1; d <= 40; d++) {
    const day = new Date(Date.UTC(2026, 9, 1) - d * 86400000).toISOString().slice(0, 10);
    await db.query('INSERT INTO stored_backups (name, created_at, bytes, kind) VALUES (?,?,1,?)', [`madhuram_auto_${day.replace(/-/g, '')}2100.sql.gz`, `${day} 21:00:00`, 'auto']);
  }
  await require('../src/backups').prune();
  const left = Number((await db.one('SELECT COUNT(*) n FROM stored_backups')).n);
  assert.ok(left >= 14 && left <= 17, `kept ${left}`);
  require('fs').rmSync(process.env.BACKUP_DIR, { recursive: true, force: true });
});

test('product master import with several barcodes, and billing before stock is entered', async () => {
  const csv = 'Product code,Product name,Category,Unit,Barcodes,MRP,Selling price,GST %,Cost,Reorder level,PLU\n' +
    '10002,Indulekha 100ml,Shampoo,pcs,8901030677106|8901030929496,432.00,430.00,12,321.43,0,\n' +
    '901,Butter Beans,Vegetables,kg,,320.00,320.00,0,110.00,0,901\n' +
    '10009,No price item,Food Items,pcs,8900000000017,,,0,,0,\n';
  const res = await fetch(`${base}/api/products/import`, { method: 'POST', headers: { Origin: base, Cookie: owner.cookie, 'Content-Type': 'text/csv' }, body: csv });
  const imp = await res.json();
  assert.deepEqual([imp.created, imp.barcodes, imp.errors], [3, 3, []], JSON.stringify(imp));
  const ind = (await owner.get('/api/products?q=8901030929496')).data.items[0];
  assert.deepEqual([ind.name, ind.sku, ind.price, ind.cost, ind.gst_rate, ind.tax_class, ind.codes.length], ['Indulekha 100ml', '10002', '430.00', '321.4300', '12.00', 'taxable', 2]);
  const beans = (await owner.get('/api/products?q=Butter')).data.items[0];
  assert.deepEqual([beans.unit, beans.plu, beans.active], ['kg', '901', true]);
  assert.equal((await owner.get('/api/products?q=No%20price')).data.items[0].active, false);

  // a product in the customer's hand is always billed; stock never goes below zero
  const sale = () => cashier.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', lines: [{ id: ind.id, qty: 2 }], payments: [{ method: 'cash', amount: '860' }] });
  assert.equal((await sale()).data.ok, true);
  assert.equal((await owner.get(`/api/products/${ind.id}`)).data.item.on_hand, '0');
  await owner.post('/api/stock/receive', { item_id: ind.id, qty: '7', cost: '320' });
  await owner.post('/api/stock/receive', { item_id: ind.id, qty: '3', cost: '320' });
  assert.equal((await owner.get(`/api/products/${ind.id}`)).data.item.on_hand, '10');          // 7 + 3
  assert.equal((await sale()).data.ok, true);
  assert.equal((await owner.get(`/api/products/${ind.id}`)).data.item.on_hand, '8');
  assert.equal((await owner.post('/api/stock/count', { item_id: ind.id, count: '5' })).data.on_hand, '5');
  assert.equal((await owner.get(`/api/products/${ind.id}`)).data.item.on_hand, '5');
  const live = (await cashier.get('/api/stock/now')).data.stock;
  assert.deepEqual(live.find((x) => x[0] === ind.id), [ind.id, '5']);
});

test('counters, opening balance check, dashboard and bills by period, order changes and online performance', async () => {
  // counters: managers add a counter; a counter with an open shift cannot be removed
  assert.match((await owner.post('/api/counters', { counters: ['Counter 2'] })).data.error, /Counter 1 still has an open shift/);
  assert.deepEqual((await owner.post('/api/counters', { counters: ['Counter 1', 'Counter 2', 'Counter 3', 'Counter 4'] })).data.counters.length, 4);
  assert.equal((await cashier.post('/api/counters', { counters: ['X'] })).status, 403);
  // closing → next opening of the same counter is compared with the closing
  const sh = (await cashier.get('/api/shift?counter=Counter%201')).data;
  await cashier.post('/api/shift/close', { shift_id: sh.shift.id, counted: '1234.50' });
  const next = (await cashier.get('/api/shift?counter=Counter%201')).data;
  assert.equal(next.last_closed.counted, '1234.50');
  await cashier.post('/api/shift/open', { counter: 'Counter 1', float: '1200' });
  assert.match((await db.one("SELECT summary FROM audit WHERE action='float_mismatch'")).summary, /last closing was ₹1234.50/);
  // dashboard / bills by period
  const d = (await owner.get('/api/dashboard?period=month')).data;
  assert.ok(d.bills >= 3 && d.channels.some((c) => c.channel === 'online') && d.top.length > 0, JSON.stringify(d.channels));
  assert.ok((await cashier.get('/api/bills?period=week&counter=Counter%201')).data.bills.length >= 1);
  // order: remove an unavailable item before billing; the customer sees it
  await owner.post('/api/settings', { online_enabled: '1', online_open: '00:00', online_close: '23:59', online_lead_minutes: '30' });
  require('../src/settings').reset();
  const info = (await customer.get('/api/shop/info')).data;
  const o = await customer.post('/api/shop/order', { name: 'Ravi', phone: '9876500000', mode: 'pickup', slot: info.slots[0].slots[0].v,
    lines: [{ id: rice.id, qty: 2 }, { id: apple.id, qty: '1' }] });
  assert.equal(o.data.ok, true, JSON.stringify(o.data));
  const id = (await cashier.get('/api/orders')).data.orders.find((x) => x.number === o.data.number).id;
  const full = (await cashier.get(`/api/orders/${id}`)).data.order;
  const appleLine = full.lines.find((l) => l.name === 'Apple');
  const ch = await cashier.post(`/api/orders/${id}/line`, { line_id: appleLine.id, qty: '0' });
  assert.equal(ch.data.ok, true, JSON.stringify(ch.data));
  assert.match(ch.data.whatsapp.text, /Apple: removed/);
  assert.equal(ch.data.order.est_items, '150.00');
  await cashier.post(`/api/orders/${id}/status`, { status: 'accepted' });
  const track = (await customer.get(`/api/shop/track/${o.data.token}`)).data.order;
  assert.match(track.status_label, /Processing/);
  assert.equal(track.lines.find((l) => l.name === 'Apple').note, 'Not available – removed');
  const b = (await cashier.post(`/api/orders/${id}/bill`)).data.bill;
  assert.equal(b.lines.length, 1);
  const st = (await cashier.get('/api/orders-stats?period=month')).data;
  assert.ok(st.orders >= 2 && st.removed_items === 1, JSON.stringify(st));
  const day = (await owner.get('/api/owner/day?period=week')).data.text;
  assert.match(day, /This week/);
});

test('offers with dates, shop barcodes, expenses and net profit', async () => {
  const t = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 330 * 60000 + 86400000).toISOString().slice(0, 10);
  const it = (await owner.post('/api/products', { name: 'Toor dal 1kg', price: '180', mrp: '190', opening_qty: '10' })).data.item;
  assert.match((await owner.post('/api/offers', { item_id: it.id, offer_price: '200' })).data.error, /below the normal price/);
  assert.equal((await owner.post('/api/offers', { item_id: it.id, offer_price: '165', offer_from: t, offer_to: t })).data.ok, true);
  const bill = await cashier.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', lines: [{ id: it.id, qty: 1 }], payments: [{ method: 'upi', amount: '165' }] });
  assert.equal(bill.data.bill.total, '165.00', JSON.stringify(bill.data));
  assert.ok((await customer.get(`/api/shop/items?ids=${it.id}`)).data.items[0].price === '165.00');
  // an offer starting tomorrow does not change today's price
  await owner.post('/api/offers', { item_id: it.id, percent: '10', offer_from: tomorrow });
  assert.equal((await owner.get('/api/offers')).data.offers.find((o) => o.id === it.id).state, 'upcoming');
  assert.equal((await cashier.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', lines: [{ id: it.id, qty: 1 }], payments: [{ method: 'upi', amount: '180' }] })).data.ok, true);
  // shop barcode for a product without one: a valid 13-digit code that scans
  const code = (await owner.post(`/api/products/${it.id}/barcode/internal`)).data.code;
  assert.match(code, /^29\d{11}$/);
  assert.equal((await owner.get(`/api/products?q=${code}`)).data.items[0].id, it.id);
  assert.equal((await owner.post(`/api/products/${it.id}/barcode/internal`)).data.code, code);     // same code again
  // expenses: cash from the drawer lowers the expected cash; net profit on the dashboard
  const before = (await cashier.get('/api/shift?counter=Counter%201')).data.summary.expected;
  assert.match((await owner.post('/api/expenses', { amount: '50', category: 'Other', method: 'cash' })).data.error, /what the expense/);
  const e = await owner.post('/api/expenses', { amount: '120', category: 'Tea & snacks', method: 'cash', counter: 'Counter 1' });
  assert.equal(e.data.from_drawer, true, JSON.stringify(e.data));
  await owner.post('/api/expenses', { amount: '2500', category: 'Electricity', method: 'bank' });
  const after = (await cashier.get('/api/shift?counter=Counter%201')).data.summary;
  assert.equal(Number(before) - Number(after.expected), 120);
  assert.equal(after.expenses, '120.00');
  const list = (await owner.get('/api/expenses?period=today')).data;
  assert.equal(list.total, '2620.00');
  const d = (await owner.get('/api/dashboard?period=today')).data;
  assert.equal(Number(d.net_profit), Number(d.profit) - 2620);
  assert.match((await owner.get('/api/owner/day')).data.text, /Expenses: ₹2,620.00/);
});

test('loyalty points: off by default, earned per ₹100, spent as payment, taken back on return', async () => {
  const it = (await owner.post('/api/products', { name: 'Ghee 500ml', price: '350', opening_qty: '20' })).data.item;
  const cust = { phone: '9876501234', name: 'Lakshmi' };
  const buy = (payments, extra = {}) => cashier.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', lines: [{ id: it.id, qty: 1 }], payments, ...extra });
  let r = await buy([{ method: 'upi', amount: '350' }], { customer: cust });
  assert.equal(r.data.bill.points_earned, '0.00');                       // switched off
  await owner.post('/api/settings', { loyalty_enabled: '1', loyalty_points_per_100: '2', loyalty_point_value: '0.5', loyalty_min_redeem: '10' });
  r = await buy([{ method: 'upi', amount: '350' }], { customer: cust });
  assert.equal(Number(r.data.bill.points_earned), 6);                     // ₹350 → 3 × 2 points
  assert.equal(Number(r.data.bill.customer.points), 6);
  const cid = (await owner.get('/api/customers?q=9876501234')).data.customers[0].id;
  assert.match((await buy([{ method: 'upi', amount: '347' }, { method: 'points', amount: '3' }], { customer: { id: cid } })).data.error, /from 10 points/);
  await buy([{ method: 'cash', amount: '350' }], { customer: { id: cid } });        // 12 points now
  assert.match((await buy([{ method: 'upi', amount: '340' }, { method: 'points', amount: '10' }], { customer: { id: cid } })).data.error, /only 12 points/);
  assert.match((await buy([{ method: 'upi', amount: '349.75' }, { method: 'points', amount: '0.25' }], { customer: { id: cid } })).data.error, /steps of/);
  assert.match((await buy([{ method: 'upi', amount: '345' }, { method: 'points', amount: '5' }])).data.error, /Choose the customer/);
  r = await buy([{ method: 'upi', amount: '345' }, { method: 'points', amount: '5' }], { customer: { id: cid } });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(Number(r.data.bill.points_used), 10);
  assert.equal(Number(r.data.bill.points_earned), 6);                     // earned on the ₹345 paid
  assert.equal(Number(r.data.bill.customer.points), 8);                   // 12 − 10 + 6
  // points are not cash in the drawer
  assert.equal((await cashier.get('/api/shift?counter=Counter%201')).data.summary.points, '5.00');
  // returning the bill takes back the points it earned
  const sale = (await cashier.get(`/api/returns/find?bill=${encodeURIComponent(r.data.bill.bill_no)}`)).data.bill;
  const ap = (await cashier.post('/api/approve', { username: 'kumar', pin: '2468', perm: 'refund' })).data.token;
  const ret = await cashier.post('/api/returns', { sale_id: sale.id, counter: 'Counter 1', method: 'cash', reason: 'Bad smell', approval: ap, lines: [{ line_id: sale.lines[0].id, qty: 1 }] });
  assert.equal(ret.data.ok, true, JSON.stringify(ret.data));
  const c = (await owner.get(`/api/customers/${cid}`)).data.customer;
  assert.equal(Number(c.points), 2);
  assert.deepEqual(c.points_log.map((l) => Number(l.points)), [-6, 6, -10, 6, 6]);
  // owner correction
  assert.equal((await owner.post(`/api/customers/${cid}/points`, { points: '50', reason: 'Old loyalty card' })).data.ok, true);
  assert.equal(Number((await owner.get(`/api/customers/${cid}`)).data.customer.points), 52);
  await owner.post('/api/settings', { loyalty_enabled: '0' });
});

test('online shop: offer prices, sorting, paging, banner photos and buy again', async () => {
  await owner.post('/api/settings', { online_enabled: '1' });
  const t = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const a = (await owner.post('/api/products', { name: 'Shop test mango', unit: 'kg', price: '120', opening_qty: '30', cat: 'Shop fruits' })).data.item;
  const b = (await owner.post('/api/products', { name: 'Shop test guava', unit: 'kg', price: '60', opening_qty: '30', cat: 'Shop fruits' })).data.item;
  const c = (await owner.post('/api/products', { name: 'Shop test papaya', unit: 'kg', price: '45', opening_qty: '30', cat: 'Shop fruits' })).data.item;
  await owner.post('/api/offers', { item_id: a.id, offer_price: '99', offer_from: t, offer_to: t });
  // the offer price is shown against the normal price, with its last day
  const offers = (await customer.get('/api/shop/items?only=offers&sort=offers')).data.items;
  const m = offers.find((x) => x.id === a.id);
  assert.equal(m.price, '99.00'); assert.equal(m.regular, '120.00'); assert.equal(m.offer_to, t);
  assert.ok(!offers.some((x) => x.id === b.id));
  const info = (await customer.get('/api/shop/info')).data;
  assert.ok(info.offers.count >= 1 && info.offers.pct >= 17, JSON.stringify(info.offers));
  assert.deepEqual(info.banners, []);
  const cat = info.cats.find((x) => x.name === 'Shop fruits');
  // sorting and "show more"
  const asc = (await customer.get(`/api/shop/items?cat=${cat.id}&sort=price_asc`)).data.items.map((x) => x.id);
  assert.deepEqual(asc, [c.id, b.id, a.id]);
  assert.deepEqual((await customer.get(`/api/shop/items?cat=${cat.id}&sort=price_desc`)).data.items.map((x) => x.id), [a.id, b.id, c.id]);
  const page2 = (await customer.get(`/api/shop/items?cat=${cat.id}&sort=price_asc&limit=2&offset=2`)).data.items;
  assert.deepEqual(page2.map((x) => x.id), [a.id]);
  // banner photos: only the owner uploads; bad entries are dropped before customers see them
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300)]);
  const upload = (who) => fetch(`${base}/api/shop-banners/image`, { method: 'POST', headers: { Origin: base, Cookie: who.cookie, 'Content-Type': 'image/jpeg' }, body: jpg });
  assert.equal((await upload(cashier)).status, 403);
  const up = await (await upload(owner)).json();
  assert.match(up.name, /^b_[0-9a-f]{8}\.jpg$/);
  await owner.post('/api/settings', { shop_banners: JSON.stringify([{ img: up.name, kicker: 'Pongal offers', title: '30% OFF', sub: 'Till Sunday', link: 'offers' },
    { img: '../../etc/passwd', title: 'bad' }, { img: up.name, title: 'Second', link: 'javascript:alert(1)' }]) });
  const bn = (await customer.get('/api/shop/info')).data.banners;
  assert.equal(bn.length, 2);
  assert.deepEqual(bn[0], { img: `/img/p/${up.name}`, kicker: 'Pongal offers', title: '30% OFF', sub: 'Till Sunday', link: 'offers' });
  assert.equal(bn[1].link, '');
  assert.equal((await fetch(base + bn[0].img)).status, 200);
  // buy again: what this customer bought at the counter shows up in their online account
  const shopper = new Browser();
  assert.deepEqual((await shopper.get('/api/shop/account/again')).data.items, []);
  const su = await shopper.post('/api/shop/account/signup', { name: 'Meena', phone: '9123456780', password: 'secret12' });
  assert.equal(su.data.ok, true, JSON.stringify(su.data));
  const bill = await cashier.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', customer: { phone: '9123456780' }, lines: [{ id: b.id, qty: '2' }],
    payments: [{ method: 'cash', amount: '120' }] });
  assert.equal(bill.data.ok, true, JSON.stringify(bill.data));
  assert.equal((await shopper.get('/api/shop/account/again')).data.items[0].id, b.id);
});
