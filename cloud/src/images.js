'use strict';
// Product photos. Kept as files outside the app folder (a redeploy does not delete them), one small picture per product.
// Two ways to get them:
//   1. Staff take or choose a photo for a product (resized on the phone/PC before upload).
//   2. "Find photos by barcode": the server looks each barcode up in Open Food Facts (open data, photos under CC BY-SA)
//      and saves the front-of-pack picture. Runs in the background; about 80 products a minute.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { nowIST, UserError } = require('./money');

const DIR = process.env.IMAGE_DIR || require('./config').dataDir('madhuram_images');
// Open Food Facts (food), Open Beauty Facts (soap, shampoo, cream…), Open Products Facts (detergent, household…): same open format.
const SOURCES = (process.env.OFF_BASES || process.env.OFF_BASE ||
  'https://world.openfoodfacts.org,https://world.openbeautyfacts.org,https://world.openproductsfacts.org').split(',').map((x) => x.trim()).filter(Boolean);
const NAME = /^(p\d+|b)_[0-9a-f]{8}\.(jpg|png|webp)$/;
const MAX = 800 * 1024;

function kind(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

async function save(itemId, buf, source = 'upload') {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new UserError('Choose a photo.');
  if (buf.length > MAX) throw new UserError('The photo is too large (more than 800 KB).');
  const ext = kind(buf);
  if (!ext) throw new UserError('This is not a JPG, PNG or WebP photo.');
  const it = await db.one('SELECT id, image FROM items WHERE id=?', [itemId]);
  if (!it) throw new UserError('Product not found.', 404);
  const name = `p${it.id}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await keep(name, buf);
  writeCopy(name, buf);
  await db.query('UPDATE items SET image=?, image_source=?, updated_at=? WHERE id=?', [name, source, nowIST(), it.id]);
  await db.bump();
  if (it.image && NAME.test(it.image)) await drop(it.image);
  return name;
}

// A banner photo for the online shop (wide picture, resized on the PC before upload).
async function saveBanner(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new UserError('Choose a photo.');
  if (buf.length > MAX) throw new UserError('The photo is too large (more than 800 KB).');
  const ext = kind(buf);
  if (!ext) throw new UserError('This is not a JPG, PNG or WebP photo.');
  const name = `b_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await keep(name, buf);
  writeCopy(name, buf);
  return name;
}

// ------------------------------------------------------------------ the database copy of every photo
// The file on this app's disk is a fast copy. The database copy survives a redeploy, a change of domain or hosting folder,
// and the customers' site (its own copy of the app) reads it straight from the shared database.
async function keep(name, buf) {
  await db.query(`INSERT INTO photo_files (name, data, bytes, created_at) VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE data=VALUES(data), bytes=VALUES(bytes)`, [name, buf, buf.length, nowIST()]);
}
function writeCopy(name, buf) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, name), buf); return true; } catch (_) { return false; }
}
async function drop(name) {
  try { fs.unlinkSync(path.join(DIR, name)); } catch (_) { /* gone */ }
  await db.query('DELETE FROM photo_files WHERE name=?', [name]).catch(() => {});
}
// A photo to send: this app's file, else the database copy (kept on disk again for next time). A path, a Buffer or null.
async function photo(name) {
  if (!NAME.test(name || '')) return null;
  const p = path.join(DIR, name);
  if (fs.existsSync(p)) return p;
  const row = await db.one('SELECT data FROM photo_files WHERE name=?', [name]).catch(() => null);
  if (!row || !row.data || !row.data.length) return null;
  const buf = Buffer.from(row.data);
  return writeCopy(name, buf) ? p : buf;
}

async function remove(itemId) {
  const it = await db.one('SELECT image FROM items WHERE id=?', [itemId]);
  if (it && it.image && NAME.test(it.image)) await drop(it.image);
  await db.query('UPDATE items SET image=NULL, image_source=NULL, updated_at=? WHERE id=?', [nowIST(), itemId]);
  await db.bump();
}

// A photo file named after a barcode, product code (SKU) or PLU, e.g. 8901030677106.jpg or 10002.png
async function saveByCode(code, buf) {
  code = String(code || '').trim().replace(/\.(jpe?g|png|webp)$/i, '').replace(/\s*\(\d+\)$/, '').trim();
  if (!code) throw new UserError('The file name must be the barcode or product code.');
  const it = await db.one(`SELECT i.id, i.name FROM items i WHERE i.id IN (SELECT item_id FROM barcodes WHERE code=?) OR i.sku=? OR i.plu=?
    ORDER BY i.active DESC LIMIT 1`, [code, code, code]);
  if (!it) throw new UserError(`No product has barcode / code ${code}.`, 404);
  await save(it.id, buf, 'upload');
  return it;
}

function filePath(name) {
  if (!NAME.test(name || '')) return null;
  const p = path.join(DIR, name);
  return fs.existsSync(p) ? p : null;
}

// Two copies of the app (billing site and customers' site) live in different hosting folders. Photos are uploaded on the
// billing site, so the customers' site fetches each one from there the first time a customer needs it and keeps a copy
// (every upload gets a new file name, so a copy is never out of date).
async function fetchFromBilling(name) {
  const base = require('./site').billingUrl();
  if (!base || !NAME.test(name || '')) return null;
  const r = await fetch(`${base}/img/p/${name}`, { signal: AbortSignal.timeout(8000), headers: { 'X-MPC-Photo-Copy': '1' } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > 2 * MAX || !kind(buf)) return null;
  await keep(name, buf).catch(() => {});
  return writeCopy(name, buf) ? path.join(DIR, name) : buf;
}

// ------------------------------------------------------------------ background lookup by barcode
const job = { running: false, total: 0, done: 0, found: 0, missing: 0, failed: 0, started: null, finished: null, stop: false, last: '', error: '' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBuf(url, limit) {
  const r = await fetch(url, { headers: { 'User-Agent': 'MadhuramStore/2026 (supermarket billing; product photos by barcode)' }, signal: AbortSignal.timeout(20000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (limit && buf.length > limit) return null;
  return buf;
}

async function lookup(code) {
  for (const base of SOURCES) {
    const img = await lookupIn(base, code);
    if (img) return img;
    await sleep(300);
  }
  return null;
}

async function lookupIn(base, code) {
  const buf = await fetchBuf(`${base}/api/v2/product/${encodeURIComponent(code)}.json?fields=image_front_small_url,image_front_url,image_url`);
  if (!buf) return null;
  let d;
  try { d = JSON.parse(buf.toString('utf8')); } catch (_) { return null; }
  if (d.status !== 1 || !d.product) return null;
  const url = d.product.image_front_small_url || d.product.image_front_url || d.product.image_url;
  if (!url || !/^https?:\/\//.test(url)) return null;
  return fetchBuf(url, MAX);
}

async function runJob() {
  // products that sell (have a price), have a real barcode, and no photo yet
  const rows = await db.query(`SELECT i.id, GROUP_CONCAT(b.code ORDER BY LENGTH(b.code) DESC) codes FROM items i JOIN barcodes b ON b.item_id=i.id
    WHERE i.image IS NULL AND i.price IS NOT NULL AND (LENGTH(b.code) IN (8, 12, 13, 14)) AND b.code REGEXP '^[0-9]+$'
    GROUP BY i.id ORDER BY i.on_hand > 0 DESC, i.id`);
  Object.assign(job, { total: rows.length, done: 0, found: 0, missing: 0, failed: 0, started: nowIST(), finished: null, error: '' });
  let fails = 0;
  for (const r of rows) {
    if (job.stop) break;
    let got = false;
    for (const code of String(r.codes).split(',').slice(0, 3)) {
      try {
        const buf = await lookup(code);
        fails = 0;
        if (buf && kind(buf)) { await save(r.id, buf, 'openfoodfacts'); got = true; job.last = code; break; }
      } catch (err) {
        fails += 1;
        job.failed += 1;
        job.error = err.message;
        if (fails >= 8) { job.error = `Stopped: the photo database cannot be reached (${err.message}). Try again later.`; job.stop = true; break; }
        await sleep(3000);
      }
      await sleep(700);                               // stay well inside the database's fair-use limit
    }
    job.done += 1;
    if (got) job.found += 1; else job.missing += 1;
  }
  job.finished = nowIST();
}

function start() {
  if (job.running) return status();
  job.running = true;
  job.stop = false;
  runJob().catch((err) => { job.error = err.message; }).finally(() => { job.running = false; job.finished = job.finished || nowIST(); });
  return status();
}
function stop() { job.stop = true; return status(); }

async function status() {
  const c = await db.one(`SELECT SUM(image IS NOT NULL) with_photo, SUM(image IS NULL) without_photo,
    SUM(image_source='openfoodfacts') from_db FROM items WHERE price IS NOT NULL`);
  const { stop: _s, ...j } = job;
  const { running: _r, ...rec } = recovery;
  return { ...j, with_photo: Number(c.with_photo || 0), without_photo: Number(c.without_photo || 0), from_db: Number(c.from_db || 0), recovery: rec };
}

// ------------------------------------------------------------------ photos from a list of web addresses
// The owner's spreadsheet gives each product's code (or barcode) and a photo link. The links wait in photo_links; a staff
// browser works through them: the server downloads one photo (internet addresses only), the browser makes it small, and it
// is saved like any product photo. A photo the shop took itself is never replaced. Prices and stock are not touched.
const dns = require('dns').promises;
const net = require('net');
const LINK_MAX = 8 * 1024 * 1024;
const LINK_UA = 'MadhuramStore/2026 (supermarket; product photos from the shop\'s own list)';
const OPEN_DB = /(^|\.)open(food|beauty|products)facts\.org$/;

async function addLinks(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new UserError('The file has no photo links.');
  if (rows.length > 20000) throw new UserError('At most 20,000 rows at a time.');
  const items = await db.query('SELECT id, sku, plu, image, image_source FROM items');
  const byId = new Map(items.map((it) => [it.id, it]));
  const bySku = new Map(items.filter((it) => it.sku).map((it) => [String(it.sku).trim().toUpperCase(), it]));
  const byPlu = new Map(items.filter((it) => it.plu).map((it) => [String(it.plu).trim(), it]));
  const byCode = new Map((await db.query('SELECT code, item_id FROM barcodes')).map((b) => [b.code, byId.get(b.item_id)]));
  const out = { rows: rows.length, queued: 0, not_found: 0, bad_link: 0, own_photo: 0, already: 0, missing: [] };
  const added = new Map((await db.query("SELECT item_id, url FROM photo_links WHERE status='done'")).map((l) => [l.item_id, l.url]));
  const take = new Map();
  for (const r of rows) {
    const code = String(r.code ?? '').trim();
    const url = String(r.url ?? '').trim();
    let it = (code && (bySku.get(code.toUpperCase()) || byCode.get(code) || byPlu.get(code))) || null;
    if (!it) for (const b of String(r.barcodes ?? '').split(/[|,;\s]+/).filter(Boolean)) { it = byCode.get(b); if (it) break; }
    if (!it) { out.not_found += 1; if (out.missing.length < 40) out.missing.push(code || String(r.barcodes || '').slice(0, 40) || '?'); continue; }
    if (url.length > 1000 || !/^https?:\/\/[^\s"'<>]+$/i.test(url)) { out.bad_link += 1; continue; }
    if (it.image && it.image_source === 'upload') { out.own_photo += 1; continue; }
    if (it.image && added.get(it.id) === url) { out.already += 1; continue; }        // the same file again: done ones are not fetched twice
    take.set(it.id, url);
  }
  const now = nowIST();
  const list = [...take.entries()];
  for (let i = 0; i < list.length; i += 400) {
    const part = list.slice(i, i + 400);
    await db.query(`INSERT INTO photo_links (item_id, url, status, note, added_at, tried_at) VALUES ${part.map(() => "(?, ?, 'waiting', NULL, ?, NULL)").join(',')}
      ON DUPLICATE KEY UPDATE url=VALUES(url), status='waiting', note=NULL, added_at=VALUES(added_at), tried_at=NULL`, part.flatMap(([id, url]) => [id, url, now]));
  }
  out.queued = list.length;
  return out;
}

async function linksStatus() {
  const c = Object.fromEntries((await db.query('SELECT status, COUNT(*) n FROM photo_links GROUP BY status')).map((r) => [r.status, Number(r.n)]));
  const failures = await db.query(`SELECT l.item_id id, i.sku code, i.name, l.url, l.note FROM photo_links l JOIN items i ON i.id=l.item_id
    WHERE l.status='failed' ORDER BY l.tried_at DESC LIMIT 200`);
  return { waiting: c.waiting || 0, done: c.done || 0, failed: c.failed || 0, failures };
}

// the next products to fetch (best sellers in stock first); one taken in the last 2 minutes is left to the browser that took it
async function nextLinks(n) {
  return db.query(`SELECT l.item_id id, i.name FROM photo_links l JOIN items i ON i.id=l.item_id
    WHERE l.status='waiting' AND (l.tried_at IS NULL OR l.tried_at < ?) ORDER BY i.on_hand > 0 DESC, l.item_id LIMIT ?`,
  [nowIST(Date.now() - 120000), Math.min(Math.max(Math.trunc(Number(n)) || 6, 1), 20)]);
}

// internet addresses only: no "localhost", private networks or the hosting's own machines
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}
async function checkLink(href) {
  let url;
  try { url = new URL(href); } catch (_) { throw new UserError('This is not a web address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new UserError('Only http and https links can be used.');
  if (url.port && !['80', '443'].includes(url.port) && process.env.PHOTO_LINKS_LOCAL !== '1') throw new UserError('This link uses an unusual port.');
  if (process.env.PHOTO_LINKS_LOCAL === '1') return url;        // tests: a photo server on this machine
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  try { addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }); } catch (_) { throw new UserError('This website was not found.'); }
  if (!addrs.length || addrs.some((x) => privateIp(x.address))) throw new UserError('This address is not on the internet.');
  return url;
}
// JPG, PNG, WebP, GIF, AVIF or BMP (the browser reads it and saves a small copy)
function photoType(buf) {
  const k = kind(buf);
  if (k) return { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[k];
  const head = buf.slice(0, 16).toString('latin1');
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif';
  if (head.slice(4, 12) === 'ftypavif' || head.slice(4, 12) === 'ftypavis') return 'image/avif';
  if (head.slice(4, 12) === 'ftypheic' || head.slice(4, 12) === 'ftypmif1') throw new UserError('HEIC photo: web browsers cannot show it.');
  if (head.startsWith('BM')) return 'image/bmp';
  return null;
}
async function download(href) {
  let url = await checkLink(href);
  for (let hop = 0; hop < 4; hop++) {
    let r;
    try {
      r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': LINK_UA, Accept: 'image/*,*/*;q=0.5' }, signal: AbortSignal.timeout(20000) });
    } catch (err) { throw new UserError(err.name === 'TimeoutError' ? 'The website did not answer in 20 seconds.' : 'The website could not be reached.'); }
    const to = r.headers.get('location');
    if (r.status >= 300 && r.status < 400 && to) { url = await checkLink(new URL(to, url).href); continue; }
    if (!r.ok) throw new UserError(`The website answered ${r.status}${r.status === 403 ? ' (it does not allow copying)' : r.status === 404 ? ' (photo not found)' : ''}.`);
    if (Number(r.headers.get('content-length') || 0) > LINK_MAX) throw new UserError('The photo is larger than 8 MB.');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > LINK_MAX) throw new UserError('The photo is larger than 8 MB.');
    const type = photoType(buf);
    if (!type) throw new UserError('The link does not give a photo (it may be a web page).');
    return { buf, type, host: url.hostname };
  }
  throw new UserError('The link goes through too many other addresses.');
}

const mark = (id, status, note = null) => db.query('UPDATE photo_links SET status=?, note=?, tried_at=? WHERE item_id=?',
  [status, note ? String(note).slice(0, 190) : null, nowIST(), id]);

// the photo of one waiting link, downloaded now (a failure is noted on the list and the browser moves on)
async function linkSource(itemId) {
  const l = await db.one("SELECT item_id, url FROM photo_links WHERE item_id=? AND status='waiting'", [itemId]);
  if (!l) throw new UserError('This product is not waiting for a photo.', 404);
  await db.query('UPDATE photo_links SET tried_at=? WHERE item_id=?', [nowIST(), itemId]);
  try {
    return await download(l.url);
  } catch (err) {
    await mark(itemId, 'failed', err instanceof UserError ? err.message : 'The photo could not be downloaded.');
    throw err instanceof UserError ? err : new UserError('The photo could not be downloaded.');
  }
}

// the small copy the browser made: saved as the product's photo (unless the shop took its own meanwhile)
async function linkDone(itemId, buf) {
  const l = await db.one("SELECT l.url, i.image, i.image_source FROM photo_links l JOIN items i ON i.id=l.item_id WHERE l.item_id=? AND l.status='waiting'", [itemId]);
  if (!l) throw new UserError('This product is not waiting for a photo.', 404);
  if (l.image && l.image_source === 'upload') { await mark(itemId, 'done', 'Kept the shop\'s own photo'); return { kept: true }; }
  let host = '';
  try { host = new URL(l.url).hostname; } catch (_) { /* checked when it was added */ }
  await save(itemId, buf, OPEN_DB.test(host) ? 'openfoodfacts' : 'link');
  await mark(itemId, 'done');
  return { kept: false };
}

// the browser could not use the photo (only a link still waiting is marked: another PC may have finished it)
async function linkFailed(itemId, note) {
  await db.query("UPDATE photo_links SET status='failed', note=?, tried_at=? WHERE item_id=? AND status='waiting'",
    [String(note || 'The photo could not be read.').slice(0, 190), nowIST(), itemId]);
}
async function linksAgain() { await db.query("UPDATE photo_links SET status='waiting', note=NULL, tried_at=NULL WHERE status='failed'"); }
async function linksClear() { await db.query("DELETE FROM photo_links WHERE status IN ('waiting','failed')"); }

// ------------------------------------------------------------------ after a move to a new domain or hosting folder
// Photos in use (products, UPI QR, festival photo, shop banners) that are not in the database yet are looked for on this
// app's disk and in other "madhuram_images" folders of the same hosting account (the old domain's folder is usually still
// there), and kept in the database. The billing site then queues the ones still missing from the owner's photo list again,
// and clears the rest so the screens show "no photo" instead of a broken picture.
const recovery = { ran: false, running: false, at: null, in_use: 0, saved: 0, found: 0, missing: 0, requeued: 0, cleared: 0, folders: 0 };
const PHOTO_IN = /(?:p\d+|b)_[0-9a-f]{8}\.(?:jpg|png|webp)/g;
async function namesInUse() {
  const names = new Set((await db.query('SELECT image FROM items WHERE image IS NOT NULL')).map((r) => r.image).filter((n) => NAME.test(n)));
  for (const r of await db.query("SELECT v FROM settings WHERE k IN ('upi_qr','festival_banner','shop_banners')")) {
    for (const m of String(r.v || '').matchAll(PHOTO_IN)) names.add(m[0]);
  }
  return names;
}
const SKIP_DIRS = new Set(['node_modules', 'proc', 'sys', 'dev', 'tmp', 'cache', 'logs', 'mail', 'wp-admin', 'wp-includes', 'wp-content']);
function photoFolders(where) {
  const own = path.resolve(DIR);
  const base = path.basename(own);
  const roots = new Set((where || [path.resolve(DIR, '..', '..'), require('os').homedir()]).filter((r) => r && r !== path.parse(r).root));
  const found = new Set();
  let seen = 0;
  for (const root of roots) {
    const queue = [[root, 0]];
    while (queue.length && seen < 4000) {
      const [d, depth] = queue.shift();
      seen += 1;
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
      for (const e of ents) {
        if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const p = path.resolve(d, e.name);
        if (e.name === 'madhuram_images' || e.name === base) { if (p !== own) found.add(p); continue; }
        if (depth < 3) queue.push([p, depth + 1]);
      }
    }
  }
  return [...found];
}
async function recover({ authority = true, roots } = {}) {
  if (recovery.running) return recovery;
  recovery.running = true;
  try {
    const names = await namesInUse();
    const have = new Set((await db.query('SELECT name FROM photo_files')).map((r) => r.name));
    const want = [...names].filter((n) => !have.has(n));
    const folders = want.length ? photoFolders(roots) : [];
    let saved = 0;
    let found = 0;
    const still = [];
    for (const n of want) {
      let src = path.join(DIR, n);
      let old = false;
      if (!fs.existsSync(src)) {
        src = null;
        for (const d of folders) { const p = path.join(d, n); if (fs.existsSync(p)) { src = p; old = true; break; } }
      }
      if (!src) { still.push(n); continue; }
      try {
        const buf = fs.readFileSync(src);
        if (!buf.length || buf.length > 2 * MAX || !kind(buf)) { still.push(n); continue; }
        await keep(n, buf);
        if (old) { writeCopy(n, buf); found += 1; } else saved += 1;
      } catch (_) { still.push(n); }
    }
    let requeued = 0;
    let cleared = 0;
    if (authority && still.length) {
      const lost = await db.query(`SELECT i.id, i.image, l.status FROM items i LEFT JOIN photo_links l ON l.item_id=i.id
        WHERE i.image IN (${still.map(() => '?').join(',')})`, still);
      const now = nowIST();
      for (const it of lost) {
        if (it.status) {
          await db.query("UPDATE photo_links SET status='waiting', note=NULL, tried_at=NULL, added_at=? WHERE item_id=?", [now, it.id]);
          requeued += 1;
        }
        await db.query('UPDATE items SET image=NULL, image_source=NULL, updated_at=? WHERE id=? AND image=?', [now, it.id, it.image]);
        cleared += 1;
      }
      if (cleared) await db.bump();
    }
    Object.assign(recovery, { ran: true, at: nowIST(), in_use: names.size, saved, found, missing: still.length, requeued, cleared, folders: folders.length });
    if (want.length) console.log(`Product photos: ${saved} kept in the database, ${found} found in an old folder, ${still.length} missing (${requeued} to fetch again).`);
  } finally { recovery.running = false; }
  return recovery;
}

module.exports = { fetchFromBilling, saveBanner, saveByCode, save, remove, filePath, photo, keep, recover, recovery, photoFolders, start, stop, status, DIR, kind,
  addLinks, linksStatus, nextLinks, linkSource, linkDone, linkFailed, linksAgain, linksClear, privateIp, photoType };
