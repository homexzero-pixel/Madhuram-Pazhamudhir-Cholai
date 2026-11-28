'use strict';
// More than one selling price for a product (Products → Add another selling price), chosen at billing;
// and Today's prices selling a product by kg or by the piece.
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
  constructor() { this.cookie = ''; this.etag = ''; }
  async call(method, p, body, headers = {}) {
    const res = await fetch(base + p, { method, headers: { Origin: base, Cookie: this.cookie, ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    return { status: res.status, etag: res.headers.get('etag'), data: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
  }
  get(p, headers) { return this.call('GET', p, undefined, headers); }
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
test.after(async () => { server.close(); await db.end(); });

const owner = new Browser();
const staff = new Browser();

test('setup: owner and a counter person', async () => {
  assert.equal((await owner.post('/api/setup', { username: 'owner', password: 'owner-pass-1', pin: '4321', name: 'Raja' })).data.ok, true);
  await owner.post('/api/users', { username: 'priya', name: 'Priya', role: 'cashier', password: 'cash-pass-1' });
  assert.equal((await staff.post('/api/login', { username: 'priya', password: 'cash-pass-1' })).data.ok, true);
  assert.equal((await staff.post('/api/shift/open', { counter: 'Counter 1', float: '500' })).data.ok, true);
});

let tea;
let garlic;
test('a product can have more selling prices: saved in order, checked, kept when edited', async () => {
  const r = await owner.post('/api/products', { name: 'Tea powder 250 g', price: '95', mrp: '100', cat: 'Tea', opening_qty: '20', codes: ['8901234567001'],
    prices: [{ price: '105', mrp: '110', label: 'New MRP' }, { price: '', mrp: '', label: '' }, { price: '90', label: 'Wholesale' }] });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  tea = r.data.item;
  assert.deepEqual(tea.prices.map((x) => [x.price, x.mrp, x.label]), [['105.00', '110.00', 'New MRP'], ['90.00', null, 'Wholesale']]);   // the empty row is left out

  // wrong ones are refused, and nothing changes
  const bad = async (prices, re) => {
    const x = await owner.post('/api/products', { ...tea, prices });
    assert.equal(x.status, 400, JSON.stringify(x.data));
    assert.match(x.data.error, re);
  };
  await bad([{ price: '105' }], /more than the MRP ₹100.00\. Type its own MRP/);               // above the product's MRP, no MRP of its own
  await bad([{ price: '120', mrp: '110' }], /Selling price 2 \(₹120.00\) is more than its MRP ₹110.00/);
  await bad([{ price: '95' }], /same as another price/);                                       // the same as the first price
  await bad([{ price: '80' }, { price: '80' }], /Selling price 3 \(₹80.00\) is the same/);
  await bad([{ price: '0' }], /more than zero/);
  await bad([{ mrp: '120', label: 'Big' }], /Type selling price 2/);
  await bad(Array.from({ length: 9 }, (_, n) => ({ price: String(10 + n) })), /Up to 9 selling prices/);
  assert.equal((await db.one('SELECT COUNT(*) n FROM item_prices WHERE item_id=?', [tea.id])).n, 2);

  // editing one keeps its number (a bill waiting at a counter with that price still works); a removed one goes
  const [p2, p3] = tea.prices;
  const e = await owner.post('/api/products', { ...tea, prices: [{ id: p2.id, price: '104', mrp: '110', label: 'New MRP' }] });
  assert.equal(e.data.ok, true, JSON.stringify(e.data));
  assert.deepEqual(e.data.item.prices, [{ id: p2.id, price: '104.00', mrp: '110.00', label: 'New MRP' }]);
  assert.equal((await db.one('SELECT COUNT(*) n FROM item_prices WHERE id=?', [p3.id])).n, 0);
  const log = await db.one("SELECT summary FROM audit WHERE action='price_change' ORDER BY id DESC LIMIT 1");
  assert.match(log.summary, /Tea powder 250 g: more selling prices ₹105.00 \(MRP ₹110.00\) New MRP, ₹90.00 Wholesale → ₹104.00 \(MRP ₹110.00\) New MRP/);
  tea = e.data.item;

  // saving the product without the list (other screens) leaves the prices alone; the Products list shows them
  assert.equal((await owner.post('/api/products', { id: tea.id, name: tea.name, price: '95', mrp: '100', cat: 'Tea' })).data.ok, true);
  assert.equal((await db.one('SELECT COUNT(*) n FROM item_prices WHERE item_id=?', [tea.id])).n, 1);
  const list = (await owner.get('/api/products?q=Tea%20powder')).data.items;
  assert.deepEqual(list.find((i) => i.id === tea.id).more_prices, ['104.00']);

  garlic = (await owner.post('/api/products', { name: 'Garlic', unit: 'kg', price: '240', cat: 'Vegetables', opening_qty: '10',
    prices: [{ price: '180', label: 'Small' }] })).data.item;
  assert.equal(garlic.prices.length, 1);
});

test('the counters get every price; a change sends them the new list', async () => {
  const c1 = await staff.get('/api/catalog');
  const rows = c1.data.prices.filter((x) => x[0] === tea.id);
  assert.deepEqual(rows, [[tea.id, tea.prices[0].id, '104.00', '110.00', 'New MRP']]);
  assert.ok(c1.data.prices.some((x) => x[0] === garlic.id && x[2] === '180.00' && x[4] === 'Small'));
  assert.equal((await staff.get('/api/catalog', { 'If-None-Match': c1.etag })).status, 304);
  // only the price of the extra price changes (same second, same count): the list still changes
  await db.query('UPDATE item_prices SET price=103 WHERE id=?', [tea.prices[0].id]);
  assert.equal((await staff.get('/api/catalog', { 'If-None-Match': c1.etag })).status, 200);
  await db.query('UPDATE item_prices SET price=104 WHERE id=?', [tea.prices[0].id]);
});

test('billing: the chosen price needs no approval and is the line price; its MRP is kept; a wrong one is refused', async () => {
  const pick = tea.prices[0].id;
  const b = await staff.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1',
    lines: [{ id: tea.id, qty: 2, pick }, { id: tea.id, qty: 1 }, { id: garlic.id, qty: 0.5, pick: garlic.prices[0].id }],
    payments: [{ method: 'cash', amount: '393' }] });
  assert.equal(b.data.ok, true, JSON.stringify(b.data));
  assert.equal(b.data.bill.total, '393.00');                       // 2 × 104 + 95 + 0.5 kg × 180
  const lines = await db.query('SELECT item_id, qty, list_price, rate, mrp, gross FROM sale_lines WHERE sale_id=? ORDER BY id', [b.data.bill.id]);
  assert.deepEqual(lines.map((l) => [l.list_price, l.rate, l.mrp, l.gross]), [
    ['104.00', '104.00', '110.00', '208.00'], ['95.00', '95.00', '100.00', '95.00'], ['180.00', '180.00', null, '90.00']]);
  assert.equal((await db.one("SELECT COUNT(*) n FROM audit WHERE action='price_override'")).n, 0);   // choosing a price is not a price change

  // a price changed by hand after choosing: the change is from the chosen price
  const b2 = await staff.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', lines: [{ id: tea.id, qty: 1, pick, rate: '100', note: 'Regular customer' }],
    payments: [{ method: 'cash', amount: '100' }] });
  assert.equal(b2.data.ok, true, JSON.stringify(b2.data));
  assert.match((await db.one("SELECT summary FROM audit WHERE action='price_override' ORDER BY id DESC LIMIT 1")).summary, /Tea powder 250 g ₹104.00 → ₹100.00/);

  // another product's price, or one removed in Products: refused
  const wrong = await staff.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', lines: [{ id: tea.id, qty: 1, pick: garlic.prices[0].id }],
    payments: [{ method: 'cash', amount: '180' }] });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /price chosen for Tea powder 250 g was changed in Products/);
});

test('removing all the other prices: the product has only its own price again', async () => {
  const r = await owner.post('/api/products', { ...tea, prices: [] });
  assert.equal(r.data.ok, true);
  assert.deepEqual(r.data.item.prices, []);
  assert.ok(!(await staff.get('/api/catalog')).data.prices.some((x) => x[0] === tea.id));
});

test("today's prices: fruit and vegetables sold by the piece are in the first list; kg ↔ piece; stock in pieces", async () => {
  const cabbage = (await owner.post('/api/products', { name: 'Cabbage', price: '30', cat: 'Vegetables' })).data.item;      // by the piece, no stock
  const soap = (await owner.post('/api/products', { name: 'Hamam soap', price: '42', cat: 'Soap', opening_qty: '5' })).data.item;
  const first = (await staff.get('/api/owner/prices')).data.items;
  const row = first.find((i) => i.id === cabbage.id);
  assert.ok(row, 'a vegetable sold by the piece is in the first list');
  assert.equal(row.online, true);                                  // vegetables are always in stock online: a price is enough
  assert.ok(first.some((i) => i.id === garlic.id));
  assert.ok(!first.some((i) => i.id === soap.id));

  // to kg at ₹40 per kg, then back to pieces with 12 on the shelf
  let r = await staff.post('/api/owner/prices', { changes: [{ id: cabbage.id, unit: 'kg', price: '40' }] });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.deepEqual(await db.one('SELECT unit, price FROM items WHERE id=?', [cabbage.id]), { unit: 'kg', price: '40.00' });
  assert.match((await db.one("SELECT summary FROM audit WHERE action='price_change' AND summary LIKE 'Cabbage%sold%' ORDER BY id DESC LIMIT 1")).summary,
    /Cabbage: now sold by kg \(was by the piece\)/);
  r = await staff.post('/api/owner/prices', { changes: [{ id: cabbage.id, unit: 'pcs', price: '25', stock: '12' }] });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.deepEqual(await db.one('SELECT unit, price, on_hand FROM items WHERE id=?', [cabbage.id]), { unit: 'pcs', price: '25.00', on_hand: '12.000' });
  // half a piece is refused
  r = await staff.post('/api/owner/prices', { changes: [{ id: cabbage.id, stock: '2.5' }] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /counted in pieces: enter a whole number/);
  // a wrong unit is ignored
  r = await staff.post('/api/owner/prices', { changes: [{ id: cabbage.id, unit: 'box', price: '26' }] });
  assert.equal(r.data.ok, true);
  assert.equal((await db.one('SELECT unit FROM items WHERE id=?', [cabbage.id])).unit, 'pcs');
  // billed by the piece at the counter
  const b = await staff.post('/api/checkout', { uuid: uuid(), counter: 'Counter 1', lines: [{ id: cabbage.id, qty: 2 }], payments: [{ method: 'cash', amount: '52' }] });
  assert.equal(b.data.ok, true, JSON.stringify(b.data));
});

test('backups carry the other selling prices', async () => {
  assert.ok(require('../src/admin').TABLES.includes('item_prices'));
  const ok = await owner.post('/api/products', { ...tea, prices: [{ price: '99', label: 'Festival' }] });
  assert.equal(ok.data.ok, true);
  const chunks = [];
  const { PassThrough } = require('stream');
  const out = new PassThrough();
  out.on('data', (c) => chunks.push(c));
  await require('../src/admin').dumpTo(out);
  const sql = require('zlib').gunzipSync(Buffer.concat(chunks)).toString('utf8');
  assert.match(sql, /INSERT INTO `item_prices`[^;]*'Festival'/);
});
