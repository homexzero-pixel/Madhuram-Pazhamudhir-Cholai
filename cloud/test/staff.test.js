'use strict';
// Staff logins: the owner adds and deletes them. A deleted login leaves the list, is signed out at once, cannot log in or approve
// with its PIN, and its name stays on the bills it made; the login name can be given to a new person.
process.env.NODE_ENV = 'test';
process.env.MPC_NO_AUTOSTART = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../src/db');
const { createApp } = require('../server');

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

test.before(async () => {
  if (!process.env.DB_NAME || !/test/.test(process.env.DB_NAME)) throw new Error('Set DB_NAME to a test database (its name must contain "test").');
  for (const t of (await db.query('SHOW TABLES')).map((r) => Object.values(r)[0])) await db.query(`DROP TABLE \`${t}\``);
  await db.migrate();
  require('../src/settings').reset();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await db.end(); });

test('the owner deletes a staff login: gone from the list, signed out, no login or PIN, name kept on old bills, login name free again', async () => {
  const owner = new Browser();
  assert.equal((await owner.post('/api/setup', { username: 'owner', password: 'owner-pass-1', pin: '4321', name: 'Raja' })).data.ok, true);
  const me = (await owner.get('/api/me')).data.user;
  const priyaId = (await owner.post('/api/users', { username: 'priya', name: 'Priya', role: 'cashier', password: 'cash-pass-1' })).data.id;
  const ravi = (await owner.post('/api/users', { username: 'ravi', name: 'Ravi', role: 'manager', password: 'mgr-pass-11', pin: '2468' })).data.id;
  const rice = (await owner.post('/api/products', { name: 'Ponni rice 1 kg', price: '75', opening_qty: '10', cat: 'Rice' })).data.item;

  // Priya bills on her shift
  const priya = new Browser();
  assert.equal((await priya.post('/api/login', { username: 'priya', password: 'cash-pass-1' })).data.ok, true);
  assert.equal((await priya.post('/api/shift/open', { counter: 'Counter 1', float: '0' })).data.ok, true);
  const bill = await priya.post('/api/checkout', { uuid: crypto.randomUUID(), counter: 'Counter 1', lines: [{ id: rice.id, qty: 1 }],
    payments: [{ method: 'cash', amount: '75' }] });
  assert.equal(bill.data.ok, true, JSON.stringify(bill.data));
  // the manager's PIN works before
  assert.equal((await priya.post('/api/approve', { username: 'ravi', pin: '2468', perm: 'price_override' })).data.ok, true);

  // only the owner deletes logins, and never their own
  assert.equal((await priya.post(`/api/users/${ravi}/delete`)).status, 403);
  const self = await owner.post(`/api/users/${me.id}/delete`);
  assert.equal(self.status, 400);
  assert.match(self.data.error, /your own login/);

  // delete Priya and Ravi
  const del = await owner.post(`/api/users/${priyaId}/delete`);
  assert.equal(del.data.ok, true, JSON.stringify(del.data));
  assert.deepEqual(del.data.deleted, { username: 'priya', name: 'Priya' });
  assert.equal((await owner.post(`/api/users/${ravi}/delete`)).data.ok, true);
  assert.equal((await owner.post(`/api/users/${priyaId}/delete`)).status, 404);              // already gone

  // signed out at once; cannot log in again; the PIN no longer approves
  assert.equal((await priya.get('/api/me')).status, 401);
  assert.notEqual((await new Browser().post('/api/login', { username: 'priya', password: 'cash-pass-1' })).data.ok, true);
  const counter = new Browser();
  await owner.post('/api/users', { username: 'kavi', name: 'Kavi', role: 'cashier', password: 'cash-pass-2' });
  await counter.post('/api/login', { username: 'kavi', password: 'cash-pass-2' });
  assert.equal((await counter.post('/api/approve', { username: 'ravi', pin: '2468', perm: 'price_override' })).status, 401);

  // not in the staff list; the bill still shows who made it; the delete is in the log
  const list = (await owner.get('/api/users')).data.users;
  assert.deepEqual(list.map((u) => u.username).sort(), ['kavi', 'owner']);
  assert.equal((await owner.get(`/api/bills/${bill.data.bill.id}`)).data.bill.cashier, 'Priya');
  const log = await db.query("SELECT summary FROM audit WHERE action='user_delete' ORDER BY id");
  assert.deepEqual(log.map((l) => l.summary), ['Login priya (Priya) deleted', 'Login ravi (Ravi) deleted']);

  // a deleted login cannot be changed back by editing it; the login name can go to a new person
  assert.equal((await owner.post('/api/users', { id: priyaId, username: 'priya', name: 'Priya', role: 'cashier', active: true })).status, 404);
  const again = await owner.post('/api/users', { username: 'priya', name: 'Priya S', role: 'cashier', password: 'new-pass-22' });
  assert.equal(again.data.ok, true, JSON.stringify(again.data));
  assert.notEqual(again.data.id, priyaId);
  assert.equal((await new Browser().post('/api/login', { username: 'priya', password: 'new-pass-22' })).data.ok, true);
});
