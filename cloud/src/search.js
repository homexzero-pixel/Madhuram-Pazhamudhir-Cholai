'use strict';
// Word index of product names (English and Tamil) and categories, kept in memory for the customers' search.
// "toma" finds "Tomato Nadu", "tomatoes" finds "Tomato", Tamil words work the same way. The index is rebuilt when products
// are added or renamed (not when stock moves); finding the matching products takes well under a millisecond for 20,000
// products, and the database then only reads those rows. Unknown words fall back to the old "contains" search.
const db = require('./db');

let idx = { v: null, words: [], post: [] };
let checkedAt = 0;
let building = null;

const norm = (s) => String(s || '').toLowerCase().normalize('NFC');
const tokens = (s) => norm(s).split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);

async function ensure() {
  if (Date.now() - checkedAt < 10000 && idx.v !== null) return idx;
  if (building) return building;
  building = (async () => {
    try {
      const v = await require('./catalog').version();
      checkedAt = Date.now();
      if (v === idx.v) return idx;
      const rows = await db.query(`SELECT i.id, i.name, i.name_ta, c.name cat FROM items i LEFT JOIN categories c ON c.id=i.category_id
        WHERE i.active=1 AND i.price IS NOT NULL AND i.price > 0`);
      const map = new Map();
      for (const r of rows) {
        for (const t of new Set([...tokens(r.name), ...tokens(r.name_ta), ...tokens(r.cat)])) {
          let a = map.get(t);
          if (!a) map.set(t, (a = []));
          a.push(r.id);
        }
      }
      const words = [...map.keys()].sort();
      idx = { v, words, post: words.map((w) => map.get(w)) };
      return idx;
    } finally {
      building = null;
    }
  })();
  return building;
}

// first position in the sorted word list that is >= w
function lower(words, w) {
  let lo = 0;
  let hi = words.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (words[m] < w) lo = m + 1; else hi = m; }
  return lo;
}
function prefixIds(ix, w) {
  const out = new Set();
  for (let i = lower(ix.words, w); i < ix.words.length && ix.words[i].startsWith(w); i++) for (const id of ix.post[i]) out.add(id);
  return out;
}

// Product ids matching every word of the query (as the start of a word), or null when the index cannot answer.
async function find(q) {
  const words = tokens(q).slice(0, 5);
  if (!words.length) return null;
  const ix = await ensure();
  let result = null;
  for (const w of words) {
    let ids = prefixIds(ix, w);
    if (!ids.size && w.length > 3) {          // plurals: tomatoes → tomato, onions → onion
      const stem = w.replace(/(es|s)$/, '');
      if (stem !== w) ids = prefixIds(ix, stem);
    }
    if (!ids.size) return null;               // let the "contains" search try (e.g. part of a joined word)
    result = result ? new Set([...result].filter((id) => ids.has(id))) : ids;
    if (!result.size) return [];
  }
  return [...result];
}

module.exports = { find, ensure, tokens, reset: () => { idx = { v: null, words: [], post: [] }; checkedAt = 0; } };
