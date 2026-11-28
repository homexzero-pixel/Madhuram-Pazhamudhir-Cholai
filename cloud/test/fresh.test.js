'use strict';
// Start fresh: after testing, the owner removes the test bills, returns, online orders, cash drawers and expenses.
// A backup is saved first; products, customers, staff and settings stay; the stock the bills took goes back; numbers restart.
process.env.NODE_ENV = 'test';
process.env.MPC_NO_AUTOSTART = '1';
const os = require('os');
const path = require('path');
process.env.BACKUP_DIR = path.join(os.tmpdir(), `mpc_fresh_bk_${process.pid}`);
process.env.IMAGE_DIR = path.join(os.tmpdir(), `mpc_fresh_img_${process.pid}`);
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const db = require('../src/db');
const { createApp } = require('../server');

const MMYY = (() => { const d = new Date(Date.now() + 330 * 60000).toISOString(); return d.slice(5, 7) + d.slice(2, 4); })();
let base;
let server;
class Browser {
  constructor() { this.cookie = ''; }
  async call(method, p, body) {
    const res = await fetch(base + p, { method, headers: { Origin: base, Cookie: this.cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    return { status: res.status, data: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  }
  get(p) { return this.call('GET', p); }
  post(p, b) { return this.call('POST', p, b ?? {}); }
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
test.after(async () => { server.close(); await db.end(); fs.rmSync(process.env.BACKUP_DIR, { recursive: true, force: true }); });

test('start fresh: test bills, returns, orders, cash and expenses go; stock goes back; numbers start from 1; owner only', async () => {
  const owner = new Browser();
  assert.equal((await owner.post('/api/setup', { username: 'owner', password: 'owner-pass-1', pin: '4321', name: 'Raja' })).data.ok, true);
  await owner.post('/api/users', { username: 'priya', name: 'Priya', role: 'cashier', password: 'cash-pass-1' });
  const staff = new Browser();
  assert.equal((await staff.post('/api/login', { username: 'priya', password: 'cash-pass-1' })).data.ok, true);
  await owner.post('/api/settings', { loyalty_enabled: '1', loyalty_points_per_100: '1', loyalty_point_value: '1', loyalty_min_redeem: '0' });
  const rice = (await owner.post('/api/products', { name: 'Ponni rice 1 kg', price: '75', gst_rate: '5', tax_class: 'taxable', opening_qty: '10', cat: 'Rice' })).data.item;
  const dal = (await owner.post('/api/products', { name: 'Toor dal', price: '150', opening_qty: '4', cat: 'Dal' })).data.item;
  const kept = (await owner.post('/api/products', { name: 'Not sold', price: '20', opening_qty: '3', cat: 'Dal' })).data.item;
  // one customer from before the tests (a due brought over), and some test bills
  const old = await db.query("INSERT INTO customers (name, phone, points, created_at) VALUES ('Old customer', '9840000001', 0, NOW())");
  await db.query("INSERT INTO customer_ledger (customer_id, at, kind, amount, ref) VALUES (?, NOW(), 'adjust', 250, 'Brought from the shop PC')", [old.insertId]);
  assert.equal((await staff.post('/api/shift/open', { counter: 'Counter 1', float: '500' })).data.ok, true);
  const b1 = await staff.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', customer: { phone: '9840012345', name: 'Lakshmi' },
    lines: [{ id: rice.id, qty: 2 }, { id: dal.id, qty: 1 }], payments: [{ method: 'cash', amount: '300' }] });
  assert.equal(b1.data.ok, true, JSON.stringify(b1.data));
  const b2 = await staff.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', customer: { phone: '9840012345', name: 'Lakshmi' },
    lines: [{ id: rice.id, qty: 1 }], payments: [{ method: 'credit', amount: '75' }] });
  assert.equal(b2.data.ok, true, JSON.stringify(b2.data));
  const sale = (await staff.get(`/api/bills/${b1.data.bill.id}`)).data.bill;
  const ret = await staff.post('/api/returns', { sale_id: sale.id, counter: 'Counter 1', method: 'cash', reason: 'Test', lines: [{ line_id: sale.lines.find((l) => l.item_id === dal.id || l.name === 'Toor dal').id, qty: 1 }] });
  assert.equal(ret.data.ok, true, JSON.stringify(ret.data));
  assert.equal((await staff.post('/api/expenses', { amount: '30', note: 'Tea while testing' })).data.ok, true);
  assert.equal((await db.one('SELECT on_hand FROM items WHERE id=?', [rice.id])).on_hand, '7.000');
  const lakshmi = await db.one("SELECT id, points FROM customers WHERE phone='9840012345'");
  assert.ok(Number(lakshmi.points) > 0);

  // only the owner; the word FRESH confirms
  assert.equal((await staff.get('/api/fresh-start')).status, 403);
  assert.equal((await staff.post('/api/fresh-start', { confirm: 'FRESH' })).status, 403);
  const p = (await owner.get('/api/fresh-start')).data.preview;
  assert.deepEqual([p.bills, p.returns, p.shifts], [2, 1, 1]);
  assert.match((await owner.post('/api/fresh-start', { confirm: 'yes' })).data.error, /Type FRESH/);
  assert.equal((await db.one('SELECT COUNT(*) n FROM sales')).n, 2);          // nothing removed

  const r = await owner.post('/api/fresh-start', { confirm: 'fresh', stock: 'restore' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.match(r.data.result.backup, /^madhuram_fresh_\d+\.sql\.gz$/);
  assert.ok(fs.existsSync(path.join(process.env.BACKUP_DIR, r.data.result.backup)));
  for (const t of ['sales', 'sale_lines', 'payments', 'sale_returns', 'return_lines', 'shifts', 'cash_moves', 'expenses', 'online_orders']) {
    assert.equal(Number((await db.one(`SELECT COUNT(*) n FROM ${t}`)).n), 0, t);
  }
  // stock back as before the tests; products, customers and staff stay
  assert.equal((await db.one('SELECT on_hand FROM items WHERE id=?', [rice.id])).on_hand, '10.000');
  assert.equal((await db.one('SELECT on_hand FROM items WHERE id=?', [dal.id])).on_hand, '4.000');
  assert.equal((await db.one('SELECT on_hand FROM items WHERE id=?', [kept.id])).on_hand, '3.000');
  assert.equal((await db.one('SELECT SUM(qty) q FROM lots WHERE item_id=?', [rice.id])).q, '10.000');
  assert.equal(Number((await db.one('SELECT COUNT(*) n FROM items')).n), 3);
  assert.equal(Number((await db.one('SELECT points FROM customers WHERE id=?', [lakshmi.id])).points), 0);
  const dues = await db.query('SELECT customer_id, SUM(amount) a FROM customer_ledger GROUP BY customer_id');
  assert.deepEqual(dues.map((d) => [d.customer_id, d.a]), [[old.insertId, '250.00']]);      // the old due stays, the test credit is gone
  assert.equal((await staff.post('/api/login', { username: 'priya', password: 'cash-pass-1' })).data.ok, true);
  assert.ok((await db.one("SELECT summary FROM audit WHERE action='fresh_start'")).summary.includes('2 test bills'));

  // real billing starts again from bill 1 (the shift opens again too)
  assert.equal((await staff.post('/api/shift/open', { counter: 'Counter 1', float: '0' })).data.ok, true);
  const first = await staff.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', lines: [{ id: rice.id, qty: 1 }], payments: [{ method: 'upi', amount: '75' }] });
  assert.equal(first.data.bill.bill_no, `MPC/${MMYY}/T1/1`);

  // "set every product's stock to 0" (test stock-in as well)
  const z = await owner.post('/api/fresh-start', { confirm: 'FRESH', stock: 'zero' });
  assert.equal(z.data.ok, true, JSON.stringify(z.data));
  assert.equal(Number((await db.one('SELECT SUM(on_hand) s FROM items')).s), 0);
});
