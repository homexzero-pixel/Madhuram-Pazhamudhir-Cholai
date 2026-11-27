'use strict';
// End-to-end checks against a real MySQL/MariaDB test database.
// Run: DB_HOST=127.0.0.1 DB_PORT=3307 DB_USER=mpc DB_PASSWORD=... DB_NAME=madhuram_test npm test
process.env.NODE_ENV = 'test';
process.env.MPC_NO_AUTOSTART = '1';
// this month in India, as it appears in bill numbers (November 2026 → 1126)
const MMYY = (() => { const d = new Date(Date.now() + 330 * 60000).toISOString(); return d.slice(5, 7) + d.slice(2, 4); })();
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../src/db');
const money = require('../src/money');
const { createApp } = require('../server');

let base;
let server;

class Browser {
  constructor() { this.cookie = ''; }
  async call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { Origin: base, Cookie: this.cookie, ...(body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, data: type.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  }
  get(p) { return this.call('GET', p); }
  post(p, b, h) { return this.call('POST', p, b ?? {}, h); }
}

const uuid = () => crypto.randomUUID();

test.before(async () => {
  if (!process.env.DB_NAME || !/test/.test(process.env.DB_NAME)) throw new Error('Set DB_NAME to a test database (its name must contain "test").');
  for (const t of (await db.query('SHOW TABLES')).map((r) => Object.values(r)[0])) await db.query(`DROP TABLE \`${t}\``);
  await db.migrate();
  require('../src/settings').reset();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.end(); });

test('money arithmetic is exact', () => {
  assert.equal(money.paise('12.345'), 1235);
  assert.equal(money.milli('0.75'), 750);
  assert.equal(money.lineAmount(18000, 750), 13500);                // ₹180/kg × 0.75 kg = ₹135
  assert.deepEqual(money.splitTax(10500, 500), { taxable: 10000, cgst: 250, sgst: 250 });
  assert.deepEqual(money.splitTax(100, 1800), { taxable: 85, cgst: 8, sgst: 7 });
  assert.equal(money.financialYear('2026-11-24'), '2627');
  assert.equal(money.financialYear('2027-03-31'), '2627');
  assert.throws(() => money.paise('12a'));
});

test('first setup, login, roles, lockout and origin check', async () => {
  const owner = new Browser();
  assert.equal((await owner.get('/api/status')).data.setup_needed, true);
  const bad = await owner.post('/api/setup', { username: 'owner', password: '123', name: 'Owner' });
  assert.match(bad.data.error, /6 characters/);
  const s = await owner.post('/api/setup', { shop_name: 'Madhuram Test', username: 'Owner', password: 'owner-pass-1', pin: '4321', name: 'Raja' });
  assert.equal(s.data.ok, true, JSON.stringify(s.data));
  assert.equal((await owner.get('/api/me')).data.user.role, 'owner');
  assert.equal((await owner.post('/api/setup', { username: 'x2', password: 'abcdefg' })).status, 409);

  const add = await owner.post('/api/users', { username: 'priya', name: 'Priya', role: 'cashier', password: 'cash-pass-1' });
  assert.equal(add.data.ok, true, JSON.stringify(add.data));
  await owner.post('/api/users', { username: 'kumar', name: 'Kumar', role: 'manager', password: 'mgr-pass-1', pin: '2468' });

  const cashier = new Browser();
  assert.equal((await cashier.post('/api/login', { username: 'PRIYA', password: 'cash-pass-1' })).data.ok, true);
  assert.equal((await cashier.get('/api/dashboard')).status, 403);
  assert.equal((await cashier.get('/api/users')).status, 403);

  // another web site cannot make changes with the cashier's login
  const forged = await cashier.call('POST', '/api/logout', {}, { Origin: 'https://evil.example' });
  assert.equal(forged.status, 403);

  const thief = new Browser();
  for (let i = 0; i < 5; i++) await thief.post('/api/login', { username: 'priya', password: 'wrong' });
  const locked = await thief.post('/api/login', { username: 'priya', password: 'cash-pass-1' });
  assert.equal(locked.status, 429);
  await db.query('DELETE FROM failures');
});

let owner;
let cashier;
let rice;
let apple;

test('products: add, barcode, opening stock, CSV import, search', async () => {
  owner = new Browser();
  await owner.post('/api/login', { username: 'owner', password: 'owner-pass-1' });
  cashier = new Browser();
  await cashier.post('/api/login', { username: 'priya', password: 'cash-pass-1' });

  let r = await owner.post('/api/products', { name: 'Ponni rice 1 kg', name_ta: 'பொன்னி அரிசி', price: '75', mrp: '80', gst_rate: '5',
    tax_class: 'taxable', barcode: '8901234567890', opening_qty: '10', cost: '60', cat: 'Rice' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  rice = r.data.item;
  assert.equal(rice.on_hand, '10');
  r = await owner.post('/api/products', { name: 'Apple loose', unit: 'kg', price: '180', plu: '101', opening_qty: '5.5', cost: '120', cat: 'Fruits' });
  apple = r.data.item;
  assert.equal(apple.on_hand, '5.5');

  assert.match((await owner.post('/api/products', { name: 'Dup', price: '5', barcode: '8901234567890' })).data.error, /already belongs/);
  assert.match((await owner.post('/api/products', { name: 'X', price: '90', mrp: '80' })).data.error, /more than MRP/);
  // a cashier needs a manager's PIN to add a product at the counter
  assert.equal((await cashier.post('/api/products', { name: 'Biscuit', price: '10', barcode: '555' })).status, 403);
  const wrong = await cashier.post('/api/approve', { username: 'kumar', pin: '0000', perm: 'products' });
  assert.equal(wrong.status, 401);
  const ap = await cashier.post('/api/approve', { username: 'kumar', pin: '2468', perm: 'products' });
  assert.equal(ap.data.ok, true);
  r = await cashier.post('/api/products', { name: 'Biscuit', price: '10', barcode: '555', approval: ap.data.token });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));

  const csv = 'SKU,Department,Category,Product name,Sale unit,Pack barcode,MRP INR,Selling price INR,HSN,GST rate\n' +
    'MPC00001,Fresh,Fruit,"Poovan banana, loose",kg,,,,,\n' +
    'MPC00002,Grocery,Oil,Gold Winner 1 L,pcs,8901111111111,190,175,1512,5\n';
  r = await owner.post('/api/products/import', csv, { 'Content-Type': 'text/csv' });
  assert.deepEqual([r.data.created, r.data.updated], [2, 0], JSON.stringify(r.data));
  r = await owner.post('/api/products/import', csv.replace('175', '170'), { 'Content-Type': 'text/csv' });
  assert.deepEqual([r.data.created, r.data.updated], [0, 2]);
  const found = await owner.get('/api/products?q=8901111111111');
  assert.equal(found.data.items[0].price, '170.00');
  assert.equal(found.data.items[0].active, true);
  assert.equal((await owner.get('/api/products?q=banana')).data.items[0].active, false);     // no price yet: not sellable

  const cat = await cashier.get('/api/catalog');
  assert.equal(cat.data.items.length, 4);
  const etag = cat.headers.get('etag');
  const again = await cashier.call('GET', '/api/catalog', undefined, { 'If-None-Match': etag });
  assert.equal(again.status, 304);
});

test('shift, checkout with FEFO stock, GST, idempotency and receipt', async () => {
  const c = 'Counter 2';
  assert.match((await cashier.post('/api/checkout', { uuid: uuid(), counter: c, lines: [{ id: rice.id, qty: 1 }],
    payments: [{ method: 'cash', amount: '75' }] })).data.error, /No shift is open/);
  assert.equal((await cashier.post('/api/shift/open', { counter: c, float: '500' })).data.ok, true);
  assert.match((await owner.post('/api/shift/open', { counter: c, float: '100' })).data.error, /already open/);

  // second lot of rice with an earlier expiry is sold first
  await owner.post('/api/stock/receive', { item_id: rice.id, qty: '5', cost: '58', expiry: '2026-12-31', ref: 'GRN-1' });

  const id = uuid();
  const bill = { uuid: id, counter: c, customer: { phone: '98400 12345', name: 'Lakshmi' },
    lines: [{ id: rice.id, qty: '2' }, { id: apple.id, qty: '0.75' }],
    payments: [{ method: 'cash', amount: '200', tendered: '500' }, { method: 'upi', amount: '85', reference: 'UPI123' }] };
  let r = await cashier.post('/api/checkout', bill);
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  const b = r.data.bill;
  assert.equal(b.total, '285.00');                         // 2 × 75 + 0.75 × 180
  // numbered like the shop's printed bills: PREFIX/MMYY/T<counter>/<number>
  assert.equal(b.bill_no, `MPC/${MMYY}/T2/1`);
  assert.deepEqual(b.gst_all.map((g) => [g.rate, g.taxable]), [['0.00', '135.00'], ['5.00', '142.86']]);
  assert.equal(b.customer.phone, '9840012345');
  assert.deepEqual(b.gst, [{ rate: '5.00', taxable: '142.86', cgst: '3.57', sgst: '3.57' }]);
  assert.equal(b.payments.find((p) => p.method === 'cash').change_amt, '300.00');

  // the same bill sent again (network drop) is not saved twice
  r = await cashier.post('/api/checkout', bill);
  assert.equal(r.data.bill.bill_no, `MPC/${MMYY}/T2/1`);
  assert.equal((await db.one('SELECT COUNT(*) n FROM sales')).n, 1);

  const lots = await db.query('SELECT qty, expiry FROM lots WHERE item_id=? ORDER BY id', [rice.id]);
  assert.deepEqual(lots.map((l) => l.qty), ['10.000', '3.000']);       // the 2026-12-31 lot went first
  assert.equal((await owner.get(`/api/products/${rice.id}`)).data.item.on_hand, '13');
  assert.equal((await owner.get(`/api/products/${apple.id}`)).data.item.on_hand, '4.75');

  // checks
  const bad = async (lines, payments, extra = {}) => (await cashier.post('/api/checkout', { uuid: uuid(), counter: c, lines, payments, ...extra })).data.error;
  assert.match(await bad([{ id: rice.id, qty: 1.5 }], [{ method: 'cash', amount: '112.5' }]), /whole number/);
  assert.match(await bad([{ id: rice.id, qty: 1 }], [{ method: 'cash', amount: '70' }]), /does not match/);
  assert.match(await bad([{ id: rice.id, qty: 1, rate: '60' }], [{ method: 'cash', amount: '60' }]), /manager must approve/);
  assert.equal((await db.one('SELECT COUNT(*) n FROM sales')).n, 1);   // nothing half-saved

  // a manager approves a price change at the counter
  const ap = await cashier.post('/api/approve', { username: 'kumar', pin: '2468', perm: 'price_override' });
  r = await cashier.post('/api/checkout', { uuid: uuid(), counter: c, lines: [{ id: rice.id, qty: 1, rate: '70', approval: ap.data.token }],
    payments: [{ method: 'upi', amount: '70' }] });
  assert.equal(r.data.bill.total, '70.00', JSON.stringify(r.data));
  const log = await db.one("SELECT * FROM audit WHERE action='price_override'");
  assert.match(log.summary, /₹75.00 → ₹70.00/);

  // two counters billing at the same moment: each counter numbers its own bills (T2, T3), without gaps
  await owner.post('/api/shift/open', { counter: 'Counter 3', float: '0' });
  const many = await Promise.all([...Array(6)].map((_, i) => (i % 2 ? owner : cashier).post('/api/checkout', {
    uuid: uuid(), counter: i % 2 ? 'Counter 3' : c, lines: [{ id: rice.id, qty: 1 }], payments: [{ method: 'cash', amount: '75' }] })));
  assert.ok(many.every((x) => x.data.ok), JSON.stringify(many.map((x) => x.data.error)));
  const nos = (await db.query('SELECT bill_no FROM sales')).map((x) => x.bill_no);
  const series = (t) => nos.filter((n) => n.startsWith(`MPC/${MMYY}/${t}/`)).map((n) => Number(n.split('/').pop())).sort((x, y) => x - y);
  assert.deepEqual(series('T2'), [1, 2, 3, 4, 5]);
  assert.deepEqual(series('T3'), [1, 2, 3]);
  assert.equal(nos.length, 8);
  assert.equal((await owner.get(`/api/products/${rice.id}`)).data.item.on_hand, '6');

  const receipt = await cashier.get(`/api/bills/${b.id}`);
  assert.equal(receipt.data.bill.lines[1].qty, '0.75');
  await cashier.post(`/api/bills/${b.id}/printed`, {});
  await cashier.post(`/api/bills/${b.id}/printed`, { reprint: true });
  assert.equal((await db.one("SELECT COUNT(*) n FROM audit WHERE action='reprint'")).n, 1);
});

test('cash closing per counter and the owner dashboard', async () => {
  const c = 'Counter 2';
  const s = (await cashier.get(`/api/shift?counter=${encodeURIComponent(c)}`)).data;
  // float 500 + cash 200 + 3 cash bills of 75
  assert.equal(s.summary.expected, '925.00');
  assert.equal(s.summary.upi, '155.00');
  await cashier.post('/api/shift/cash', { counter: c, kind: 'out', amount: '25', reason: 'Tea for staff' });
  const closed = await cashier.post('/api/shift/close', { shift_id: s.shift.id, counted: '890', retained: '500' });
  assert.equal(closed.data.result.variance, '-10.00', JSON.stringify(closed.data));
  assert.equal((await cashier.get(`/api/shift?counter=${encodeURIComponent(c)}`)).data.shift, null);
  // a new shift can be opened again on that counter
  assert.equal((await cashier.post('/api/shift/open', { counter: c, float: '500' })).data.ok, true);

  const d = (await owner.get('/api/dashboard')).data;
  assert.equal(d.bills, 8);
  assert.equal(d.total, '805.00');
  assert.deepEqual(d.counters.map((x) => [x.counter, x.bills]), [['Counter 2', 5], ['Counter 3', 3]]);
  assert.ok(d.risky.some((x) => x.action === 'price_override'));
});

test('backup download and import from the shop PC', async () => {
  const res = await fetch(`${base}/api/backup`, { headers: { Cookie: owner.cookie } });
  assert.equal(res.status, 200);
  const sql = require('zlib').gunzipSync(Buffer.from(await res.arrayBuffer())).toString();
  assert.match(sql, /INSERT INTO `sales`/);
  assert.ok(sql.includes(`MPC/${MMYY}/T2/1`));
  assert.match(sql, /பொன்னி அரிசி/);

  // import is refused once the cloud has bills
  const file = require('zlib').gzipSync(JSON.stringify({ format: 'madhuram-cloud-export', items: [] }));
  const r = await owner.call('POST', '/api/import-shop', file, { 'Content-Type': 'application/octet-stream' });
  assert.equal(r.status, 409);
});

test('pages, install files and the counter shortcut are served', async () => {
  const page = await fetch(`${base}/`);
  assert.match(await page.text(), /manifest\.webmanifest/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  const man = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(man.display, 'standalone');
  assert.equal((await fetch(`${base}/sw.js`)).status, 200);
  const bat = await (await fetch(`${base}/counter-shortcut.bat?counter=3`)).text();
  assert.match(bat, /--kiosk-printing/);
  assert.match(bat, /\?counter=3/);
});

test("the shop's details from its printed bill are filled in once, and the owner's own entries are kept", async () => {
  const settings = require('../src/settings');
  const keys = ['name', 'address', 'phone', 'gstin', 'bill_footer'];
  const before = Object.fromEntries((await db.query('SELECT k, v FROM settings WHERE k IN (?)', [keys])).map((r) => [r.k, r.v]));
  await db.query("DELETE FROM settings WHERE k IN (?) OR k='_shop_details_2026_11'", [keys]);
  await settings.save({ name: 'Madhuram Pazhamudhir Cholai', address: '', phone: '', gstin: '29ABCDE1234F1Z5', bill_footer: 'Thank you! Visit again. நன்றி, மீண்டும் வருக!' });
  await settings.upgrade();
  let s = await settings.load();
  assert.equal(s.name, 'Madhuram Pazhamudhir Solai');
  assert.equal(s.address, 'NO.1,ARCOT PETTAI,METTU COLONY\nManapakkam,Chennai-600125');
  assert.equal(s.phone, '9841123414');
  assert.equal(s.gstin, '29ABCDE1234F1Z5');                    // typed by the owner: kept
  assert.equal(s.bill_footer, 'THANK U VISIT AGAIN');
  assert.equal((await settings.shopSettings()).address, 'NO.1,ARCOT PETTAI,METTU COLONY, Manapakkam,Chennai-600125');
  await settings.save({ phone: '' });                           // later changes by the owner are never undone
  await settings.upgrade();
  s = await settings.load();
  assert.equal(s.phone, '');
  // a prefix typed in small letters is saved in capitals; more than 3 would make bill numbers too long for GST
  assert.equal((await owner.post('/api/settings', { invoice_prefix: 'mu' })).data.settings.invoice_prefix, 'MU');
  assert.match((await owner.post('/api/settings', { invoice_prefix: 'MADH' })).data.error, /1 to 3/);
  await owner.post('/api/settings', { invoice_prefix: 'MPC' });
  await db.query('DELETE FROM settings WHERE k IN (?)', [keys]);
  for (const [k, v] of Object.entries(before)) await settings.save({ [k]: v });
});
