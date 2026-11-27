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

// Words customers in Tamil Nadu type, in Tamil or in English letters ("thakkali"), and the word the product list uses.
const SYN = {};
const syn = (target, words) => { for (const w of words.split(' ')) (SYN[w] ||= []).push(target); };
syn('tomato', 'thakkali takkali thakali தக்காளி');
syn('onion', 'vengayam venkayam vengaayam வெங்காயம்');
syn('potato', 'urulai urulaikizhangu urulaikilangu aloo உருளைக்கிழங்கு உருளை');
syn('brinjal', 'kathirikai kathirikkai kathrikai baingan கத்தரிக்காய் கத்தரி');
syn('ladies', 'vendakkai vendaikai bhindi okra வெண்டைக்காய் வெண்டை');
syn('drumstick', 'murungakkai murungai murunga முருங்கைக்காய் முருங்கை');
syn('coriander', 'kothamalli kothamali malli கொத்தமல்லி');
syn('mint', 'pudina புதினா');
syn('curry', 'karuveppilai kariveppilai karivepilai கறிவேப்பிலை');
syn('ginger', 'inji இஞ்சி');
syn('garlic', 'poondu பூண்டு');
syn('chilli', 'milagai milakai மிளகாய்');
syn('lemon', 'elumichai elumichambazham எலுமிச்சை');
syn('coconut', 'thengai thenga thengaai தேங்காய்');
syn('banana', 'vazhaipazham valaipalam vazhai valai வாழைப்பழம் வாழை');
syn('mango', 'maambazham mambazham maangai மாம்பழம் மாங்காய்');
syn('guava', 'koyya கொய்யா');
syn('watermelon', 'tharpoosani tharbusani தர்பூசணி');
syn('milk', 'paal பால்');
syn('curd', 'thayir thair தயிர்');
syn('ghee', 'nei ney நெய்');
syn('butter', 'vennai வெண்ணெய்');
syn('egg', 'muttai mutta முட்டை');
syn('rice', 'arisi அரிசி');
syn('dhal', 'paruppu பருப்பு');
syn('dal', 'paruppu பருப்பு');
syn('toor', 'thuvaram thuvarai துவரம்');
syn('moong', 'pasiparuppu பாசிப்பருப்பு');
syn('gram', 'kadalai கடலை');
syn('sugar', 'sakkarai sakkara seeni சர்க்கரை சீனி');
syn('salt', 'uppu உப்பு');
syn('oil', 'ennai ennei yennai எண்ணெய்');
syn('gingelly', 'nallennai நல்லெண்ணெய்');
syn('wheat', 'godhumai gothumai கோதுமை');
syn('atta', 'maavu மாவு');
syn('rava', 'ravai ரவை');
syn('coffee', 'kaapi kapi காபி');
syn('tea', 'டீ தேநீர்');
syn('jaggery', 'vellam வெல்லம்');
syn('tamarind', 'puli புளி');
syn('turmeric', 'manjal மஞ்சள்');
syn('pepper', 'milagu மிளகு');
syn('jeera', 'seeragam jeeragam சீரகம்');
syn('mustard', 'kadugu கடுகு');
syn('methi', 'vendhayam vendayam வெந்தயம்');
syn('soap', 'sopu சோப்பு');
const SYN_KEYS = Object.keys(SYN).sort();
// the word itself, and the product-list words of any Tamil / Tanglish word it starts (typing "thakk" already finds tomatoes)
function expand(w) {
  const out = new Set([w]);
  if ([...w].length >= 3) for (const k of SYN_KEYS) if (k.startsWith(w)) for (const t of SYN[k]) out.add(t);
  return [...out];
}

// Product ids matching every word of the query (as the start of a word), or null when the index cannot answer.
async function find(q) {
  const words = tokens(q).slice(0, 5);
  if (!words.length) return null;
  const ix = await ensure();
  let result = null;
  for (const w of words) {
    let ids = new Set();
    for (const x of expand(w)) for (const id of prefixIds(ix, x)) ids.add(id);
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

module.exports = { find, ensure, tokens, expand, reset: () => { idx = { v: null, words: [], post: [] }; checkedAt = 0; } };
