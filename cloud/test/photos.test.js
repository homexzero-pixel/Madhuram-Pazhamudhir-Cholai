'use strict';
// Product photos: upload, serve, show in the shop, and find by barcode (against a stand-in for the open product database).
process.env.NODE_ENV = 'test';
process.env.MPC_NO_AUTOSTART = '1';
const os = require('os');
const path = require('path');
const http = require('http');
process.env.IMAGE_DIR = path.join(os.tmpdir(), `mpc_img_test_${process.pid}`);
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');

// a real 1×1 JPEG
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');
let mock;
let base;
let server;
let cookie = '';
const call = async (method, p, body, type = 'application/json') => {
  const r = await fetch(base + p, { method, headers: { Origin: base, Cookie: cookie, 'Content-Type': type }, body: body === undefined ? undefined : body });
  const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0];
  return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : null };
};

test.before(async () => {
  mock = http.createServer((req, res) => {
    if (req.url.startsWith('/api/v2/product/8901234567890.json')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ status: 1, product: { image_front_small_url: `http://127.0.0.1:${mock.address().port}/front.jpg` } }));
    }
    if (req.url === '/front.jpg') { res.setHeader('Content-Type', 'image/jpeg'); return res.end(JPG); }
    res.statusCode = 404; return res.end('{"status":0}');
  }).listen(0);
  await new Promise((r) => mock.once('listening', r));
  process.env.OFF_BASE = `http://127.0.0.1:${mock.address().port}`;
  if (!/test/.test(process.env.DB_NAME || '')) throw new Error('DB_NAME must be a test database.');
  for (const t of (await db.query('SHOW TABLES')).map((r) => Object.values(r)[0])) await db.query(`DROP TABLE \`${t}\``);
  await db.migrate();
  require('../src/settings').reset();
  server = require('../server').createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/api/setup', JSON.stringify({ username: 'owner', password: 'owner-pass-1', pin: '4321' }));
});
test.after(async () => { server.close(); mock.close(); await db.end(); require('fs').rmSync(process.env.IMAGE_DIR, { recursive: true, force: true }); });

test('upload a photo, it is served and shown in the shop; find photos by barcode', async () => {
  const a = (await call('POST', '/api/products', JSON.stringify({ name: 'Apple', unit: 'kg', price: '180' }))).data.item;
  const b = (await call('POST', '/api/products', JSON.stringify({ name: 'Choco bar', price: '40', barcode: '8901234567890' }))).data.item;
  await call('POST', '/api/products', JSON.stringify({ name: 'Unknown pack', price: '10', barcode: '8900000000017' }));
  assert.equal((await call('POST', `/api/products/${a.id}/image`, Buffer.from('not a photo'), 'image/jpeg')).status, 400);
  const up = await call('POST', `/api/products/${a.id}/image`, JPG, 'image/jpeg');
  assert.equal(up.data.ok, true, JSON.stringify(up.data));
  const img = await fetch(base + up.data.image);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('cache-control'), /max-age/);
  assert.equal((await fetch(`${base}/img/p/..%2F..%2Fetc%2Fpasswd`)).status, 404);
  assert.equal((await call('GET', `/api/products/${a.id}`)).data.item.image, up.data.image);

  await call('POST', '/api/settings', JSON.stringify({ online_enabled: '1' }));
  require('../src/settings').reset();
  let st = (await call('POST', '/api/images/fetch', '{}')).data;
  for (let i = 0; i < 40 && st.running; i++) { await new Promise((r) => setTimeout(r, 300)); st = (await call('GET', '/api/images/fetch')).data; }
  assert.deepEqual([st.total, st.found, st.missing], [2, 1, 1], JSON.stringify(st));
  const shop = (await call('GET', '/api/shop/items?ids=' + [a.id, b.id].join(','))).data.items;
  assert.ok(shop.every((x) => x.image && x.image.startsWith('/img/p/')), JSON.stringify(shop));
  assert.equal((await call('GET', `/api/products/${b.id}`)).data.item.image_source, 'openfoodfacts');
  await call('POST', `/api/products/${a.id}/image/remove`, '{}');
  assert.equal((await call('GET', `/api/products/${a.id}`)).data.item.image, null);
});
