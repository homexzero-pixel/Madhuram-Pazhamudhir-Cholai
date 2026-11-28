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
    if (req.url.startsWith('/beauty/api/v2/product/8901234567890.json')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ status: 1, product: { image_front_small_url: `http://127.0.0.1:${mock.address().port}/front.jpg` } }));
    }
    if (req.url === '/front.jpg') { res.setHeader('Content-Type', 'image/jpeg'); return res.end(JPG); }
    res.statusCode = 404; return res.end('{"status":0}');
  }).listen(0);
  await new Promise((r) => mock.once('listening', r));
  // the first database does not have it, the second (beauty) does
  process.env.OFF_BASES = `http://127.0.0.1:${mock.address().port}/food,http://127.0.0.1:${mock.address().port}/beauty`;
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
  // products without a photo, best sellers first; bulk upload by file name (barcode or product code)
  const no = (await call('GET', '/api/products?status=nophoto')).data.items.map((x) => x.name);
  assert.deepEqual(no, ['Unknown pack']);
  const byCode = await call('POST', '/api/products/image-by-code/8900000000017', JPG, 'image/jpeg');
  assert.equal(byCode.data.name, 'Unknown pack', JSON.stringify(byCode.data));
  assert.equal((await call('POST', '/api/products/image-by-code/123456', JPG, 'image/jpeg')).status, 404);
  assert.equal((await call('GET', '/api/products?status=nophoto')).data.items.length, 0);
  await call('POST', `/api/products/${a.id}/image/remove`, '{}');
  assert.equal((await call('GET', `/api/products/${a.id}`)).data.item.image, null);
});

test('photos from a list of web addresses: matched by code or barcode, downloaded only from the internet, own photos kept', async () => {
  const port = mock.address().port;
  const link = (p) => `http://127.0.0.1:${port}${p}`;
  const add = async (body) => (await call('POST', '/api/products', JSON.stringify(body))).data.item;
  const grapes = await add({ name: 'Panneer Grapes', unit: 'kg', price: '140' });
  const soap = await add({ name: 'Bath soap', price: '35', barcode: '8901111111117' });
  const rice = await add({ name: 'Raw rice', price: '60' });
  const own = await add({ name: 'Own photo pack', price: '20' });
  await call('POST', `/api/products/${own.id}/image`, JPG, 'image/jpeg');                 // the shop's own photo
  const rows = [
    { code: grapes.sku, url: link('/front.jpg') },
    { code: 'NOT-A-CODE', barcodes: '8900000000000|8901111111117', url: link('/front.jpg') },   // found by its barcode
    { code: rice.sku, url: link('/missing.jpg') },
    { code: own.sku, url: link('/front.jpg') },
    { code: 'ZZZ999', url: link('/front.jpg') },
    { code: grapes.sku, url: 'javascript:alert(1)' },
  ];
  let r = await call('POST', '/api/images/links', JSON.stringify({ rows }));
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  const x = r.data.result;
  assert.deepEqual([x.queued, x.not_found, x.own_photo, x.bad_link], [3, 1, 1, 1]);
  assert.deepEqual(x.missing, ['ZZZ999']);
  assert.equal(r.data.waiting, 3);
  assert.deepEqual((await call('GET', '/api/images/links/next?n=10')).data.items.map((i) => i.id).sort((a, b) => a - b), [grapes.id, soap.id, rice.id]);

  // only addresses on the internet: this machine's own addresses are refused, and the link is marked as failed
  const refused = await call('GET', `/api/images/links/${grapes.id}/source`);
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /not on the internet|unusual port/);
  assert.equal((await call('GET', '/api/images/links')).data.failed, 1);
  assert.equal((await call('POST', '/api/images/links/again', '{}')).data.waiting, 3);

  process.env.PHOTO_LINKS_LOCAL = '1';                       // tests only: the stand-in photo server runs on this machine
  try {
    const src = await fetch(`${base}/api/images/links/${grapes.id}/source`, { headers: { Cookie: cookie } });
    assert.equal(src.status, 200);
    assert.equal(src.headers.get('content-type'), 'image/jpeg');
    assert.match(src.headers.get('content-disposition'), /attachment/);
    assert.deepEqual(Buffer.from(await src.arrayBuffer()), JPG);
    const gone = await call('GET', `/api/images/links/${rice.id}/source`);
    assert.match(gone.data.error, /answered 404/);
    // the browser sends back the small copy it made
    assert.equal((await call('POST', `/api/images/links/${grapes.id}/photo`, JPG, 'image/jpeg')).data.ok, true);
    assert.equal((await call('GET', `/api/images/links/${soap.id}/source`)).status, 200);
    assert.equal((await call('POST', `/api/images/links/${soap.id}/photo`, JPG, 'image/jpeg')).data.ok, true);
  } finally { delete process.env.PHOTO_LINKS_LOCAL; }
  // a late "failed" from another PC does not undo a finished one
  await call('POST', `/api/images/links/${grapes.id}/failed`, JSON.stringify({ note: 'late' }));
  const st = (await call('GET', '/api/images/links')).data;
  assert.deepEqual([st.done, st.failed, st.waiting], [2, 1, 0]);
  assert.match(st.failures[0].note, /404/);
  const rows2 = await db.query('SELECT id, image, image_source FROM items WHERE id IN (?) ORDER BY id', [[grapes.id, soap.id, own.id]]);
  assert.deepEqual(rows2.map((i) => [i.id, i.image_source, !!i.image]), [[grapes.id, 'link', true], [soap.id, 'link', true], [own.id, 'upload', true]]);
  assert.equal((await fetch(`${base}/img/p/${rows2[0].image}`)).status, 200);

  const images = require('../src/images');
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.5', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(images.privateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '151.101.1.1', '2606:4700::1111']) assert.equal(images.privateIp(ip), false, ip);
  assert.equal(images.photoType(Buffer.from('GIF89a......')), 'image/gif');
  assert.throws(() => images.photoType(Buffer.from('\0\0\0\x18ftypheic\0\0\0\0')), /HEIC/);
  assert.equal(images.photoType(Buffer.from('<!DOCTYPE html><html>')), null);
});
