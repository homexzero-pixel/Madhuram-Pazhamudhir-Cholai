'use strict';
// Customers' online accounts: sign up with a mobile number verified by an SMS code, log in, wrong passwords, forgot password, my orders.
process.env.NODE_ENV = 'test';
process.env.MPC_NO_AUTOSTART = '1';
process.env.SMS_PROVIDER = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const cust = require('../src/custauth');

let base; let server;
class B {
  constructor() { this.cookie = ''; }
  async call(method, p, body) {
    const r = await fetch(base + p, { method, headers: { Origin: base, Cookie: this.cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const c = r.headers.get('set-cookie'); if (c) this.cookie = c.split(';')[0];
    return { status: r.status, data: await r.json() };
  }
  get(p) { return this.call('GET', p); } post(p, b) { return this.call('POST', p, b || {}); }
}
test.before(async () => {
  if (!/test/.test(process.env.DB_NAME || '')) throw new Error('DB_NAME must be a test database.');
  for (const t of (await db.query('SHOW TABLES')).map((r) => Object.values(r)[0])) await db.query(`DROP TABLE \`${t}\``);
  await db.migrate();
  require('../src/settings').reset();
  server = require('../server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.end(); });

test('sign up with SMS code, log in, forgot password, my orders', async () => {
  const owner = new B();
  await owner.post('/api/setup', { username: 'owner', password: 'owner-pass-1', pin: '4321' });
  const rice = (await owner.post('/api/products', { name: 'Rice', price: '75', opening_qty: '20' })).data.item;
  await owner.post('/api/settings', { online_enabled: '1', online_open: '00:00', online_close: '23:59', online_lead_minutes: '30' });
  require('../src/settings').reset();

  const c = new B();
  assert.equal((await c.get('/api/shop/account')).data.sms, true);
  assert.match((await c.post('/api/shop/account/signup', { name: 'Lakshmi', phone: '9840012345', password: 'secret-1', code: '000000' })).data.error, /expired|not correct/);
  assert.equal((await c.post('/api/shop/account/otp', { phone: '98400 12345', purpose: 'signup' })).data.ok, true);
  assert.match((await c.post('/api/shop/account/signup', { name: 'Lakshmi', phone: '9840012345', password: 'secret-1', code: '111111' })).data.error, /not correct/);
  const code = cust.sentForTests.get('9840012345');
  const s = await c.post('/api/shop/account/signup', { name: 'Lakshmi', phone: '9840012345', password: 'secret-1', code });
  assert.deepEqual([s.data.me.phone, s.data.me.verified], ['9840012345', true], JSON.stringify(s.data));
  assert.match((await c.post('/api/shop/account/otp', { phone: '9840012345', purpose: 'signup' })).data.error, /already has an account/);

  // order as this customer: the phone comes from the account
  const info = (await c.get('/api/shop/info')).data;
  const o = await c.post('/api/shop/order', { mode: 'pickup', slot: info.slots[0].slots[0].v, lines: [{ id: rice.id, qty: 2 }] });
  assert.equal(o.data.ok, true, JSON.stringify(o.data));
  const mine = (await c.get('/api/shop/account/orders')).data.orders;
  assert.deepEqual(mine.map((x) => [x.number, x.est_total]), [['ON-00001', '150.00']]);
  const staffView = (await owner.get('/api/orders')).data.orders;
  assert.equal(staffView.length, 1);
  assert.equal((await owner.get(`/api/orders/${staffView[0].id}`)).data.order.phone_verified, 1);

  // log out / log in / wrong password lockout
  await c.post('/api/shop/account/logout');
  assert.equal((await c.get('/api/shop/account')).data.me, null);
  assert.equal((await c.post('/api/shop/account/login', { phone: '9840012345', password: 'wrong-pw' })).status, 401);
  assert.equal((await c.post('/api/shop/account/login', { phone: '9840012345', password: 'secret-1' })).data.me.name, 'Lakshmi');
  // profile and password change
  assert.equal((await c.post('/api/shop/account/update', { name: 'Lakshmi R', address: '4 Temple St', password: 'bad', new_password: 'secret-2' })).status, 400);
  assert.equal((await c.post('/api/shop/account/update', { name: 'Lakshmi R', address: '4 Temple St', password: 'secret-1', new_password: 'secret-2' })).data.me.address, '4 Temple St');
  // forgot password by SMS code
  const d = new B();
  await d.post('/api/shop/account/otp', { phone: '9840012345', purpose: 'reset' });
  const r = await d.post('/api/shop/account/reset', { phone: '9840012345', code: cust.sentForTests.get('9840012345'), password: 'secret-3' });
  assert.equal(r.data.me.name, 'Lakshmi R');
  assert.equal((await c.get('/api/shop/account')).data.me, null);          // other sessions logged out after a reset
  // staff can set a password for a customer who calls
  const id = (await owner.get('/api/customers/list?q=Lakshmi')).data.customers[0].id;
  assert.equal((await owner.post(`/api/customers/${id}/online-password`, { password: 'counter-1' })).data.ok, true);
  assert.equal((await c.post('/api/shop/account/login', { phone: '9840012345', password: 'counter-1' })).data.ok, true);
  // too many codes
  for (let i = 0; i < 3; i++) await d.post('/api/shop/account/otp', { phone: '9840099999', purpose: 'signup' });
  assert.equal((await d.post('/api/shop/account/otp', { phone: '9840099999', purpose: 'signup' })).status, 429);
});
