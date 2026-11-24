'use strict';
const db = require('./db');
const { paise, milli, rateBp, rs, qtyDb, qtyStr, nowIST, UserError } = require('./money');
const { audit } = require('./auth');

const UNITS = ['pcs', 'kg'];
const TAX_CLASSES = ['unset', 'taxable', 'exempt', 'nil'];

// Everything the counter needs to bill offline-fast: active items and their barcodes. Cached by the browser
// and refreshed when `version` changes.
async function version() {
  const r = await db.one('SELECT COUNT(*) n, MAX(updated_at) u FROM items WHERE active=1');
  const b = await db.one('SELECT COUNT(*) n FROM barcodes');
  return `${r.n}-${(r.u || '').replace(/\D/g, '')}-${b.n}`;
}

async function counterCatalogue() {
  const items = await db.query(
    `SELECT i.id, i.sku, i.plu, i.name, i.name_ta, i.unit, i.price, i.mrp, i.gst_rate, i.tax_class, i.on_hand, c.name cat
     FROM items i LEFT JOIN categories c ON c.id=i.category_id WHERE i.active=1 ORDER BY i.name`);
  const codes = await db.query('SELECT b.code, b.item_id, b.per FROM barcodes b JOIN items i ON i.id=b.item_id WHERE i.active=1');
  return {
    version: await version(),
    // compact rows: [id, sku, plu, name, name_ta, unit, price, mrp, gst, tax_class, on_hand, category]
    items: items.map((i) => [i.id, i.sku, i.plu || '', i.name, i.name_ta, i.unit, i.price, i.mrp, i.gst_rate, i.tax_class,
      qtyStr(milli(i.on_hand)), i.cat || '']),
    barcodes: codes.map((b) => [b.code, b.item_id, qtyStr(milli(b.per))]),
  };
}

async function search({ q = '', status = 'all', limit = 50, offset = 0 }) {
  const where = [];
  const args = [];
  q = String(q).trim().slice(0, 60);
  if (q) {
    where.push('(i.name LIKE ? OR i.name_ta LIKE ? OR i.sku = ? OR i.plu = ? OR i.id IN (SELECT item_id FROM barcodes WHERE code = ?))');
    args.push(`%${q}%`, `%${q}%`, q, q, q);
  }
  if (status === 'active') where.push('i.active=1');
  if (status === 'inactive') where.push('i.active=0');
  if (status === 'low') where.push('i.active=1 AND i.on_hand <= i.reorder_level');
  if (status === 'noprice') where.push('i.price IS NULL');
  const sql = `SELECT i.*, c.name cat, (SELECT GROUP_CONCAT(code) FROM barcodes WHERE item_id=i.id) codes
     FROM items i LEFT JOIN categories c ON c.id=i.category_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY i.active DESC, i.name LIMIT ? OFFSET ?`;
  const rows = await db.query(sql, [...args, Math.min(Number(limit) || 50, 200), Number(offset) || 0]);
  const total = (await db.one(`SELECT COUNT(*) n FROM items i ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, args)).n;
  return { total: Number(total), items: rows.map(itemOut) };
}

function itemOut(i) {
  return {
    id: i.id, sku: i.sku, plu: i.plu || '', name: i.name, name_ta: i.name_ta, unit: i.unit, price: i.price, mrp: i.mrp,
    cost: i.cost, gst_rate: i.gst_rate, tax_class: i.tax_class, hsn: i.hsn, reorder_level: qtyStr(milli(i.reorder_level)),
    on_hand: qtyStr(milli(i.on_hand)), active: !!i.active, cat: i.cat || '', codes: i.codes ? String(i.codes).split(',') : [],
  };
}

async function get(id) {
  const i = await db.one(`SELECT i.*, c.name cat, (SELECT GROUP_CONCAT(code) FROM barcodes WHERE item_id=i.id) codes
    FROM items i LEFT JOIN categories c ON c.id=i.category_id WHERE i.id=?`, [id]);
  if (!i) throw new UserError('Product not found.', 404);
  return itemOut(i);
}

async function categoryId(q, name) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) return null;
  await q('INSERT IGNORE INTO categories (name) VALUES (?)', [name]);
  return (await q('SELECT id FROM categories WHERE name=?', [name]))[0].id;
}

async function nextSku(q) {
  await q("INSERT INTO sequences (k, last) VALUES ('sku', 1) ON DUPLICATE KEY UPDATE last=LAST_INSERT_ID(last+1)");
  const r = (await q('SELECT last FROM sequences WHERE k=?', ['sku']))[0];
  return `NEW${String(r.last).padStart(5, '0')}`;
}

function cleanCode(code) {
  code = String(code || '').trim();
  if (code && !/^[0-9A-Za-z\-]{3,32}$/.test(code)) throw new UserError(`Barcode '${code}' should be 3–32 letters or digits.`);
  return code;
}

// Create or update a product. Used by the Products page and by "Quick add" at the counter (unknown barcode).
async function save(data, user) {
  const name = String(data.name || '').trim().slice(0, 160);
  if (!name) throw new UserError('Enter the product name.');
  const unit = UNITS.includes(data.unit) ? data.unit : 'pcs';
  const price = paise(data.price, 'price');
  const mrp = paise(data.mrp, 'MRP');
  if (price !== null && price < 0) throw new UserError('Price cannot be negative.');
  if (mrp !== null && price !== null && price > mrp) throw new UserError('Selling price is more than MRP.');
  const gst = rateBp(data.gst_rate);
  if (![0, 25, 300, 500, 1200, 1800, 2800, 4000].includes(gst)) throw new UserError('GST rate should be 0, 0.25, 3, 5, 12, 18, 28 or 40.');
  const taxClass = TAX_CLASSES.includes(data.tax_class) ? data.tax_class : (gst > 0 ? 'taxable' : 'unset');
  const active = data.active === undefined ? price !== null : !!data.active;
  if (active && price === null) throw new UserError('Enter a selling price before the product can be sold.');
  const plu = String(data.plu || '').trim() || null;
  if (plu && !/^\d{1,8}$/.test(plu)) throw new UserError('PLU should be up to 8 digits.');
  const codes = [].concat(data.codes || data.barcode || []).map(cleanCode).filter(Boolean);
  const opening = milli(data.opening_qty) || 0;
  if (opening < 0) throw new UserError('Opening stock cannot be negative.');
  if (unit === 'pcs' && opening % 1000) throw new UserError('Opening stock for a piece item must be a whole number.');

  return db.tx(async (q) => {
    const now = nowIST();
    const cat = await categoryId(q, data.cat);
    const fields = [name, String(data.name_ta || '').trim().slice(0, 160), cat, unit, price === null ? null : rs(price),
      mrp === null ? null : rs(mrp), rs(gst), taxClass, String(data.hsn || '').replace(/\D/g, '').slice(0, 8),
      qtyDb(milli(data.reorder_level) || 0), active ? 1 : 0, plu, now];
    let id = Number(data.id) || 0;
    try {
      if (id) {
        const old = await q.one('SELECT * FROM items WHERE id=? FOR UPDATE', [id]);
        if (!old) throw new UserError('Product not found.', 404);
        await q(`UPDATE items SET name=?, name_ta=?, category_id=?, unit=?, price=?, mrp=?, gst_rate=?, tax_class=?, hsn=?,
          reorder_level=?, active=?, plu=?, updated_at=? WHERE id=?`, [...fields, id]);
        if (old.price !== fields[4]) {
          await audit({ user_id: user.id, action: 'price_change', summary: `${name}: ₹${old.price ?? '-'} → ₹${fields[4] ?? '-'}` }, q);
        }
      } else {
        const sku = await nextSku(q);
        const r = await q(`INSERT INTO items (name, name_ta, category_id, unit, price, mrp, gst_rate, tax_class, hsn, reorder_level, active,
          plu, updated_at, sku, cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [...fields, sku, rs(paise(data.cost) || 0)]);
        id = r.insertId;
        await audit({ user_id: user.id, action: 'product_add', summary: `${sku} ${name} added at ₹${fields[4] ?? '-'}` }, q);
      }
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new UserError(`PLU ${plu} is already used by another product.`);
      throw err;
    }
    for (const code of codes) {
      const other = await q.one('SELECT b.item_id, i.name FROM barcodes b JOIN items i ON i.id=b.item_id WHERE b.code=?', [code]);
      if (other && other.item_id !== id) throw new UserError(`Barcode ${code} already belongs to "${other.name}".`);
      if (!other) await q('INSERT INTO barcodes (code, item_id, per) VALUES (?,?,1)', [code, id]);
    }
    if (data.codes !== undefined) {         // the Products page sends the full list: drop codes that were removed
      const keep = codes.length ? codes : ['\u0000'];
      await q(`DELETE FROM barcodes WHERE item_id=? AND code NOT IN (${keep.map(() => '?').join(',')})`, [id, ...keep]);
    }
    if (opening > 0) {
      await receiveIn(q, { item_id: id, qty: opening, unit_cost: paise(data.cost) || 0, ref: 'Opening stock', user });
    }
    return id;
  });
}

// Add stock as a new lot (goods received, opening stock). Runs inside an open transaction.
async function receiveIn(q, { item_id, qty, unit_cost = 0, expiry = null, batch = '', ref = '', user, kind = 'receive' }) {
  const now = nowIST();
  const lot = await q(`INSERT INTO lots (item_id, qty, received, unit_cost, expiry, batch, ref, created_at)
    VALUES (?,?,?,?,?,?,?,?)`, [item_id, qtyDb(qty), qtyDb(qty), (unit_cost / 100).toFixed(4), expiry || null, batch, ref, now]);
  await q(`INSERT INTO stock_moves (at, item_id, lot_id, kind, qty, unit_cost, ref, user_id) VALUES (?,?,?,?,?,?,?,?)`,
    [now, item_id, lot.insertId, kind, qtyDb(qty), (unit_cost / 100).toFixed(4), ref, user ? user.id : null]);
  await q('UPDATE items SET on_hand = on_hand + ?, cost = IF(? > 0, ?, cost) WHERE id=?',
    [qtyDb(qty), unit_cost, (unit_cost / 100).toFixed(4), item_id]);
  return lot.insertId;
}

async function receive(data, user) {
  const qty = milli(data.qty, 'quantity');
  if (!qty || qty <= 0) throw new UserError('Enter the quantity received.');
  const cost = paise(data.cost, 'cost') || 0;
  if (cost < 0) throw new UserError('Cost cannot be negative.');
  const expiry = data.expiry ? String(data.expiry).slice(0, 10) : null;
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new UserError('Expiry date is not valid.');
  return db.tx(async (q) => {
    const item = await q.one('SELECT id, name, unit FROM items WHERE id=? FOR UPDATE', [data.item_id]);
    if (!item) throw new UserError('Product not found.', 404);
    if (item.unit === 'pcs' && qty % 1000) throw new UserError('This product is counted in pieces: enter a whole number.');
    await receiveIn(q, { item_id: item.id, qty, unit_cost: cost, expiry, batch: String(data.batch || '').slice(0, 40),
      ref: String(data.ref || 'Goods received').slice(0, 60), user });
    await audit({ user_id: user.id, action: 'stock_in', summary: `${item.name}: +${qtyStr(qty)} ${item.unit} (${data.ref || 'received'})` }, q);
    return (await q.one('SELECT on_hand FROM items WHERE id=?', [item.id])).on_hand;
  });
}

// Remove damaged / expired stock (FEFO) with a reason.
async function writeOff(data, user) {
  const qty = milli(data.qty, 'quantity');
  const reason = String(data.reason || '').trim();
  if (!qty || qty <= 0) throw new UserError('Enter the quantity.');
  if (reason.length < 3) throw new UserError('Write the reason (damaged, expired, …).');
  return db.tx(async (q) => {
    const item = await q.one('SELECT id, name, unit FROM items WHERE id=? FOR UPDATE', [data.item_id]);
    if (!item) throw new UserError('Product not found.', 404);
    await issue(q, item, qty, { kind: 'write_off', ref: 'Write-off', reason, user });
    await audit({ user_id: user.id, action: 'write_off', summary: `${item.name}: −${qtyStr(qty)} ${item.unit} – ${reason}` }, q);
  });
}

// Take stock out of the sellable lots, earliest expiry first. Returns [{lot_id, qty, unit_cost}]. Inside a transaction.
async function issue(q, item, qty, { kind, ref, reason = '', user }) {
  const lots = await q(`SELECT id, qty, unit_cost FROM lots WHERE item_id=? AND status='sellable' AND qty > 0
    ORDER BY expiry IS NULL, expiry, id FOR UPDATE`, [item.id]);
  const have = lots.reduce((s, l) => s + milli(l.qty), 0);
  if (have < qty) {
    throw new UserError(`Not enough stock of ${item.name}: need ${qtyStr(qty)}, in stock ${qtyStr(have)} ${item.unit}. ` +
      'Receive the stock first (Products → Stock in).', 409);
  }
  const taken = [];
  let left = qty;
  const now = nowIST();
  for (const lot of lots) {
    if (!left) break;
    const take = Math.min(left, milli(lot.qty));
    left -= take;
    await q('UPDATE lots SET qty = qty - ? WHERE id=?', [qtyDb(take), lot.id]);
    await q(`INSERT INTO stock_moves (at, item_id, lot_id, kind, qty, unit_cost, ref, reason, user_id) VALUES (?,?,?,?,?,?,?,?,?)`,
      [now, item.id, lot.id, kind, qtyDb(-take), lot.unit_cost, ref, reason.slice(0, 200), user ? user.id : null]);
    taken.push({ lot_id: lot.id, qty: take, unit_cost: lot.unit_cost });
  }
  await q('UPDATE items SET on_hand = on_hand - ? WHERE id=?', [qtyDb(qty), item.id]);
  return taken;
}

async function moves(itemId) {
  return db.query(`SELECT m.at, m.kind, m.qty, m.ref, m.reason, u.name who FROM stock_moves m LEFT JOIN users u ON u.id=m.user_id
    WHERE m.item_id=? ORDER BY m.id DESC LIMIT 50`, [itemId]);
}

// ------------------------------------------------------------------ CSV import (starter catalogue or the owner's own list)
function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

const HEADERS = {
  sku: ['sku'], name: ['product name', 'name'], name_ta: ['tamil name', 'name_ta'], cat: ['category'],
  unit: ['sale unit', 'unit'], barcode: ['pack barcode', 'barcode'], mrp: ['mrp inr', 'mrp'],
  price: ['selling price inr', 'price', 'selling price'], hsn: ['hsn'], gst: ['gst rate', 'gst'],
};

async function importCsv(text, user) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new UserError('The file has no product rows.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const [k, names] of Object.entries(HEADERS)) col[k] = head.findIndex((h) => names.includes(h));
  if (col.name < 0) throw new UserError('The first row must have a "Product name" (or "Name") column.');
  const errors = [];
  let created = 0;
  let updated = 0;
  const cell = (r, k) => (col[k] >= 0 ? String(r[col[k]] || '').trim() : '');
  await db.tx(async (q) => {
    const cats = new Map();
    for (const r of rows.slice(1)) {
      const c = cell(r, 'cat');
      if (c && !cats.has(c)) cats.set(c, await categoryId(q, c));
    }
    const now = nowIST();
    const batch = [];
    const codes = [];
    for (const [n, r] of rows.slice(1).entries()) {
      try {
        const name = cell(r, 'name').slice(0, 160);
        if (!name) continue;
        const price = paise(cell(r, 'price'));
        const mrp = paise(cell(r, 'mrp'));
        const gstRaw = cell(r, 'gst').replace('%', '');
        const gst = gstRaw ? rateBp(gstRaw) : 0;
        const unit = /kg/i.test(cell(r, 'unit')) ? 'kg' : 'pcs';
        let sku = cell(r, 'sku').slice(0, 20);
        if (!sku) sku = await nextSku(q);
        batch.push([sku, name, cell(r, 'name_ta').slice(0, 160), cats.get(cell(r, 'cat')) || null, unit,
          price === null ? null : rs(price), mrp === null ? null : rs(mrp), rs(gst), gstRaw ? 'taxable' : 'unset',
          cell(r, 'hsn').replace(/\D/g, '').slice(0, 8), price !== null ? 1 : 0, now]);
        const code = cell(r, 'barcode');
        if (code) codes.push([cleanCode(code), sku]);
      } catch (err) {
        if (!err.expose) throw err;
        errors.push(`Row ${n + 2}: ${err.message}`);
      }
    }
    for (let i = 0; i < batch.length; i += 500) {
      const part = batch.slice(i, i + 500);
      const known = (await q('SELECT COUNT(*) n FROM items WHERE sku IN (?)', [part.map((x) => x[0])]))[0];
      await q(`INSERT INTO items (sku, name, name_ta, category_id, unit, price, mrp, gst_rate, tax_class, hsn, active, updated_at)
        VALUES ? ON DUPLICATE KEY UPDATE name=VALUES(name), name_ta=IF(VALUES(name_ta)='', name_ta, VALUES(name_ta)),
        category_id=COALESCE(VALUES(category_id), category_id), unit=VALUES(unit), price=COALESCE(VALUES(price), price),
        mrp=COALESCE(VALUES(mrp), mrp), gst_rate=IF(VALUES(tax_class)='taxable', VALUES(gst_rate), gst_rate),
        tax_class=IF(VALUES(tax_class)='taxable', 'taxable', tax_class), hsn=IF(VALUES(hsn)='', hsn, VALUES(hsn)),
        active=IF(VALUES(price) IS NULL, active, 1), updated_at=VALUES(updated_at)`, [part]);
      updated += Number(known.n);
      created += part.length - Number(known.n);
    }
    for (let i = 0; i < codes.length; i += 500) {
      const part = codes.slice(i, i + 500);
      await q(`INSERT IGNORE INTO barcodes (code, item_id, per) SELECT x.code, i.id, 1 FROM items i JOIN (${
        part.map(() => 'SELECT ? code, ? sku').join(' UNION ALL ')}) x ON x.sku=i.sku`, part.flat());
    }
    await audit({ user_id: user.id, action: 'import', summary: `Imported products: ${created} new, ${updated} updated` }, q);
  });
  return { created, updated, errors: errors.slice(0, 50) };
}

module.exports = { counterCatalogue, version, search, get, save, receive, receiveIn, writeOff, issue, moves, importCsv, parseCsv,
  categoryId, UNITS };
