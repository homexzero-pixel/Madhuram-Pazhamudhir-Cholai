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
  fs.mkdirSync(DIR, { recursive: true });
  const name = `p${it.id}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(DIR, name), buf);
  await db.query('UPDATE items SET image=?, image_source=?, updated_at=? WHERE id=?', [name, source, nowIST(), it.id]);
  if (it.image && NAME.test(it.image)) { try { fs.unlinkSync(path.join(DIR, it.image)); } catch (_) { /* gone */ } }
  return name;
}

// A banner photo for the online shop (wide picture, resized on the PC before upload).
function saveBanner(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new UserError('Choose a photo.');
  if (buf.length > MAX) throw new UserError('The photo is too large (more than 800 KB).');
  const ext = kind(buf);
  if (!ext) throw new UserError('This is not a JPG, PNG or WebP photo.');
  fs.mkdirSync(DIR, { recursive: true });
  const name = `b_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(DIR, name), buf);
  return name;
}

async function remove(itemId) {
  const it = await db.one('SELECT image FROM items WHERE id=?', [itemId]);
  if (it && it.image && NAME.test(it.image)) { try { fs.unlinkSync(path.join(DIR, it.image)); } catch (_) { /* gone */ } }
  await db.query('UPDATE items SET image=NULL, image_source=NULL, updated_at=? WHERE id=?', [nowIST(), itemId]);
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
  return { ...j, with_photo: Number(c.with_photo || 0), without_photo: Number(c.without_photo || 0), from_db: Number(c.from_db || 0) };
}

module.exports = { saveBanner, saveByCode, save, remove, filePath, start, stop, status, DIR, kind };
