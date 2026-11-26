'use strict';
// Small in-memory cache for the customers' site (product lists, sections, search index).
// Every entry remembers the database "change version" it was made at (db.changeVersion – bumped after every committed
// change on either site), so a sale, a stock entry, an order or a price change clears it at once. Entries also expire
// after `ttlMs` (prices change at midnight with offers). Requests for the same thing at the same moment share one load.
const db = require('./db');

const MAX = 400;
const store = new Map();
const loading = new Map();

async function cached(key, loader, ttlMs = 120000) {
  const v = await db.changeVersion();
  const hit = store.get(key);
  if (hit && hit.v === v && Date.now() - hit.at < ttlMs) {
    store.delete(key); store.set(key, hit);               // most recently used last
    return hit.data;
  }
  const lk = `${key}\u0000${v}`;
  if (loading.has(lk)) return loading.get(lk);
  const p = (async () => {
    try {
      const data = await loader();
      store.set(key, { v, at: Date.now(), data });
      while (store.size > MAX) store.delete(store.keys().next().value);
      return data;
    } finally {
      loading.delete(lk);
    }
  })();
  loading.set(lk, p);
  return p;
}

const clear = () => store.clear();
module.exports = { cached, clear, size: () => store.size };
