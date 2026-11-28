'use strict';
// Two websites, one shared backend and database:
//   billing site  (staff: billing, GST invoices, stock, ledger, Online orders)  e.g. mps.madhurampazhamudhirsolai.com
//   customers' site (shop, orders, tracking, invoices)                         e.g. madhurampazhamudhirsolai.com
//
// Either run ONE copy of the app for both addresses (set SHOP_HOST, and BILLING_HOST to refuse every other address),
// or TWO copies from the same code and database, one per address (SITE_ROLE=billing / SITE_ROLE=shop).
// Without these settings the app works as before: staff at /, the shop at /shop/.
//
// Each site only answers its own routes: the staff API (/api/…) does not exist on the customers' site and the customers'
// API (/api/shop/…) does not exist on the billing site. Logins are separate cookies, set without a Domain, so the browser
// only ever sends them to the address that made them (staff sessions: billing site only; customer sessions: shop only).
const config = require('./config');
const { UserError } = require('./money');

const env = process.env;
const lc = (s) => String(s || '').trim().toLowerCase();
const role = () => lc(env.SITE_ROLE || env.APP_ROLE);

// 'shop' | 'billing' | 'both' (not split) | 'unknown' (BILLING_HOST is set and this is neither address)
function siteOf(req) {
  const r = role();
  if (r === 'shop' || r === 'billing') return r;
  const host = lc(String(req.headers.host || '').replace(/:\d+$/, ''));      // the address the browser asked for (not a forwarded header)
  const shopHost = lc(env.SHOP_HOST);
  const billHost = lc(env.BILLING_HOST);
  if (shopHost && host === shopHost) return 'shop';
  if (billHost) return host === billHost ? 'billing' : 'unknown';
  return shopHost ? 'billing' : 'both';
}
const split = () => !!(role() === 'shop' || role() === 'billing' || env.SHOP_HOST || env.BILLING_HOST);

// The customers' site address, for QR posters, WhatsApp tracking links and redirects. Ends with '/'.
// The "Customer website address" in Settings (the owner changes it there after moving to a new domain), else SHOP_URL /
// SHOP_HOST when they name another site, else /shop/ on this address. An address that is this billing site itself is ignored.
function shopUrl(req, cfg = require('./settings').cached()) {
  const own = lc(String(req.headers.host || '').replace(/:\d+$/, ''));
  const other = (u) => {
    try { const x = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`); return x.hostname.toLowerCase() !== own ? `${x.origin}${x.pathname.replace(/\/+$/, '')}/` : null; } catch (_) { return null; }
  };
  return (siteOf(req) !== 'both' && cfg && cfg.shop_url && other(String(cfg.shop_url).trim()))
    || (env.SHOP_URL && other(env.SHOP_URL)) || (env.SHOP_HOST && other(env.SHOP_HOST)) || `${req.protocol}://${req.headers.host}/shop/`;
}
// The billing site's address, for the customers' site (product photos, order alerts): the address the billing site noted
// itself (Settings, shared database), else BILLING_URL. No trailing '/'.
function billingUrl(cfg = require('./settings').cached()) {
  const u = String((cfg && cfg.billing_url) || env.BILLING_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+$/i.test(u) ? u : '';
}

// The customers' site may use only these API paths (everything under /api/shop/).
const SHOP_API = /^\/shop(\/|$)/;
// Files the customers' site serves (the staff screens' files are not served there).
const SHOP_FILES = /^\/(shop\.css|shop\.js|icons\.js|sw\.js|manifest\.webmanifest|fe\/|img\/|photos\/|print\.js)/;

function scope(req, res, next) {
  const site = siteOf(req);
  req.site = site;
  if (site === 'unknown') return res.status(421).type('text/plain').send('This address is not set up for this app.');
  if (site === 'shop') {
    if (req.path.startsWith('/api/')) {
      if (!SHOP_API.test(req.path.slice(4))) return res.status(404).json({ ok: false, error: 'Not found.' });
      return next();
    }
    if (req.path === '/internal/events') return res.status(404).end();
    if (req.path === '/' || req.path === '/shop' || req.path === '/shop/' || req.path === '/index.html') return next();
    if (SHOP_FILES.test(req.path)) return next();
    return res.status(404).type('text/plain').send('Not found.');
  }
  if (site === 'billing') {
    if (req.path.startsWith('/api/shop/') || req.path === '/api/shop') return res.status(404).json({ ok: false, error: 'Not found.' });
    if (req.path === '/shop' || req.path.startsWith('/shop/')) {
      const to = shopUrl(req);
      if (new URL(to).host !== req.headers.host) return res.redirect(302, to);       // never back to this same site
      return res.status(404).type('text/plain').send('Not found.');
    }
  }
  return next();
}

// ---------------------------------------------------------------- CORS: nobody else's pages may call this API
// Both sites use their own address only, so no cross-site browser call is needed. An Origin that is not this address
// (or listed in CORS_ALLOW) gets no CORS headers (the browser blocks reading) and every change request is refused.
function cors(req, res, next) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (!origin) return next();
  let host = '';
  try { host = new URL(origin).host; } catch (_) { /* bad origin */ }
  const allowed = host === req.headers.host || lc(env.CORS_ALLOW).split(',').map((s) => s.trim()).filter(Boolean).includes(lc(origin));
  if (allowed && host !== req.headers.host) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(allowed ? 204 : 403).end();
  return next();
}

// Changes are only accepted from this site's own pages: the browser's Origin (or Referer) must be this address.
function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin || req.headers.referer || '';
  let host = '';
  try { host = new URL(origin).host; } catch (_) { /* missing */ }
  if (!host || host !== req.headers.host) return next(new UserError('Request blocked: open the store from its own address.', 403));
  return next();
}

// ---------------------------------------------------------------- rate limits (per visitor address, per minute)
// Token buckets in memory: enough for one shop's traffic; each copy of the app counts its own requests.
// Mobile networks often put many customers behind one address, so the customers' limits are per address but generous;
// logins also have their own per-account lockout.
const LIMITS = {
  login: [10, 60],          // staff login, manager PIN, first setup
  account: [20, 60],        // customers: sign up, log in, codes, password reset
  order: [10, 60],          // placing orders, payment numbers
  ai: [10, 60],             // shop assistant questions
  shop: [600, 60],          // everything else on the customers' site
  api: [900, 60],           // everything else on the billing site (several counters share one address)
};
const buckets = new Map();
function take(name, key) {
  const [cap, per] = LIMITS[name];
  const k = `${name}:${key}`;
  const now = Date.now();
  let b = buckets.get(k);
  if (!b) { b = { t: cap, at: now }; buckets.set(k, b); }
  b.t = Math.min(cap, b.t + ((now - b.at) / 1000) * (cap / per));
  b.at = now;
  if (b.t < 1) return Math.ceil(((1 - b.t) * per) / cap);
  b.t -= 1;
  return 0;
}
setInterval(() => {                                     // forget idle visitors
  const old = Date.now() - 10 * 60000;
  for (const [k, b] of buckets) if (b.at < old) buckets.delete(k);
}, 60000).unref();

function bucketFor(req) {
  const p = req.path;
  if (req.method === 'POST' && /^\/(login|setup|approve)$/.test(p)) return 'login';
  if (req.method === 'POST' && /^\/shop\/account\/(signup|login|otp|reset)$/.test(p)) return 'account';
  if (req.method === 'POST' && (p === '/shop/order' || /^\/shop\/track\/[^/]+\/(payref|cancel)$/.test(p))) return 'order';
  if (p === '/shop/assistant') return 'ai';
  return req.site === 'shop' || p.startsWith('/shop/') ? 'shop' : 'api';
}
function rateLimit(req, res, next) {
  if (config.test && !env.RATE_LIMIT_TEST) return next();
  const name = bucketFor(req);
  const wait = take(name, req.ip || 'x');
  if (name !== 'api' && name !== 'shop' && !wait) {
    const w2 = take(req.site === 'shop' || req.path.startsWith('/shop/') ? 'shop' : 'api', req.ip || 'x');
    if (w2) { res.setHeader('Retry-After', String(w2)); return next(new UserError('Too many requests. Please wait a moment and try again.', 429)); }
  }
  if (wait) {
    res.setHeader('Retry-After', String(wait));
    return next(new UserError('Too many requests. Please wait a moment and try again.', 429));
  }
  return next();
}

module.exports = { siteOf, split, shopUrl, billingUrl, scope, cors, sameOrigin, rateLimit, take, LIMITS, _buckets: buckets };
