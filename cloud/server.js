'use strict';
// Madhuram Pazhamudhir Solai – cloud edition. Start: `node server.js` (Hostinger: entry file server.js).
const path = require('path');
const express = require('express');
const config = require('./src/config');
const db = require('./src/db');
const api = require('./src/routes/api');
const site = require('./src/site');
const events = require('./src/events');
const { UserError } = require('./src/money');

function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), payment=()');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  // Which site this request is for (billing / customers' shop), and only that site's pages and API.
  app.use(site.scope);

  // A signed wake-up call from the customers' site (two copies of the app): read the new events from the database now.
  app.post('/internal/events', express.text({ type: '*/*', limit: '64kb' }), (req, res) => {
    if (req.site === 'shop' || !events.verify(String(req.body || ''), req.headers['x-mpc-timestamp'], req.headers['x-mpc-signature'])) {
      return res.status(403).json({ ok: false });
    }
    events.kick();
    return res.json({ ok: true });
  });

  // No other website may call this API from a browser; changes only from this site's own pages; requests per minute capped.
  app.use('/api', site.cors, site.sameOrigin, site.rateLimit);
  app.use('/api', express.json({ limit: '2mb' }), api);
  app.use(require('./src/routes/more').cron);

  // Windows shortcut for a counter PC: opens the store as its own window and prints bills without the print dialog.
  app.get('/counter-shortcut.bat', (req, res) => {
    const n = String(req.query.counter || '1').replace(/\D/g, '').slice(0, 2) || '1';
    const url = `${req.protocol}://${req.headers.host}/?counter=${n}`;
    const lines = [
      '@echo off',
      'rem Madhuram cloud - counter shortcut. Double-click once on each counter PC.',
      'set "EDGE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
      'if not exist "%EDGE%" set "EDGE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
      'if not exist "%EDGE%" (echo Microsoft Edge was not found. & pause & exit /b 1)',
      `set "LNK=%USERPROFILE%\\Desktop\\Madhuram Counter ${n}.lnk"`,
      `set "ARGS=--app=${url} --kiosk-printing --user-data-dir="%LOCALAPPDATA%\\MadhuramCloud""`,
      'powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath=$env:EDGE; ' +
        '$s.Arguments=$env:ARGS; $s.Save()"',
      'copy /y "%LNK%" "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\" >nul',
      `echo Done. A desktop icon "Madhuram Counter ${n}" was made. It also opens when Windows starts.`,
      'echo Set the bill printer as the Windows default printer.',
      'pause',
    ];
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="Madhuram_Counter_${n}.bat"`);
    res.send(lines.join('\r\n') + '\r\n');
  });

  const pub = path.join(__dirname, 'public');
  app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(pub, 'sw.js'));
  });
  // product photos (public: the customers' shop shows them)
  app.get('/img/p/:name', async (req, res, next) => {
    const images = require('./src/images');
    let p = images.filePath(req.params.name);
    // customers' site as its own app: the photo was uploaded on the billing site; copy it from there once
    if (!p && req.site === 'shop' && !req.headers['x-mpc-photo-copy']) p = await images.fetchFromBilling(req.params.name).catch(() => null);
    if (!p) return next(new UserError('Not found.', 404));
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    return res.sendFile(p);
  });
  app.use(express.static(pub, { index: false, maxAge: '1h' }));
  app.get(['/shop', '/shop/'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(pub, 'shop.html'));
  });
  // the customers' site opens straight into the shop; the billing site into the staff screens
  app.get(['/', '/index.html'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(pub, req.site === 'shop' ? 'shop.html' : 'index.html'));
  });

  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') err = new UserError('The file is too large.', 413);
    if (err.type === 'entity.parse.failed') err = new UserError('Bad request.', 400);
    if (err.statusCode === 404 || err.code === 'ENOENT') err = new UserError('Not found.', 404);
    if (!err.expose) console.error(new Date().toISOString(), req.method, req.originalUrl, err);
    const status = err.expose ? err.status || 400 : 500;
    if (res.headersSent) return res.end();
    return res.status(status).json({ ok: false, error: err.expose ? err.message : 'Something went wrong on the server. Try again.' });
  });
  return app;
}

// Explains a database problem in plain words (no password is ever shown).
function dbHelp(err) {
  const c = config.db;
  const seen = `DB_HOST=${c.host || '(empty)'} · DB_PORT=${c.port} · DB_NAME=${c.database || '(empty)'} · DB_USER=${c.user || '(empty)'} · ` +
    `DB_PASSWORD=${c.password ? '(set)' : '(NOT set)'}`;
  let what;
  if (!c.database || !c.user) what = 'The database settings are missing. Add the environment variables DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD in hPanel, then Redeploy.';
  else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
    what = 'The database user name or password is wrong.';
    const full = (v) => /^u\d+_/.test(String(v || ''));
    if (!full(c.user) || !full(c.database)) {
      what += ` On Hostinger the full names start with "u", your account number and "_" (for example u123456789_${c.user || 'name'}), but this app received DB_USER=${c.user || '(empty)'} and DB_NAME=${c.database || '(empty)'}.`;
    }
    what += ' Copy them again from hPanel → Databases (or from the billing website\'s Environment variables), then Redeploy.';
  }
  else if (err.code === 'ER_BAD_DB_ERROR') what = 'There is no database with that name. Copy the exact database name from hPanel → Databases (it starts with u…_), then Redeploy.';
  else if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(err.code)) {
    what = 'The database server cannot be reached. In hPanel → Databases, look for "MySQL host" and put that in DB_HOST (try 127.0.0.1 if it says localhost), then Redeploy.';
  } else what = 'The database could not be prepared.';
  if (String(process.env.SITE_ROLE || '').toLowerCase() === 'shop') {
    what += ' This is the customers\' website: it must use exactly the same 5 database values as the billing website (the same database, not a new one).';
  }
  return { what, seen, code: err.code || '', detail: String(err.message || '').replace(c.password || '\u0000', '***').slice(0, 300) };
}

let started = false;
async function main() {
  if (started) return;
  started = true;
  // Start listening at once, so Hostinger sees the app running even while the database is not ready.
  let app = null;
  let problem = null;
  const shell = express();
  shell.use((req, res, next) => {
    if (app) return app(req, res, next);
    const p = problem || { what: 'Starting… connecting to the database. Reload in a few seconds.', seen: '', code: '', detail: '' };
    res.status(503).type('html').send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
      <meta http-equiv="refresh" content="20"><title>Madhuram – setup needed</title>
      <body style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#1c2433">
      <h1 style="color:#1f56c8">Madhuram Store – almost there</h1><p style="font-size:18px"><b>${escapeHtml(p.what)}</b></p>
      ${p.seen ? `<p>What the app received:<br><code>${escapeHtml(p.seen)}</code></p>` : ''}
      ${p.code || p.detail ? `<p style="color:#6b7689">Technical detail: ${escapeHtml(p.code)} ${escapeHtml(p.detail)}</p>` : ''}
      <p style="color:#6b7689">This page checks again by itself every 20 seconds.</p></body>`);
  });
  shell.listen(config.port, () => console.log(`Madhuram cloud listening on port ${config.port}`));

  for (;;) {
    try {
      await db.migrate();
      await require('./src/settings').upgrade();
      app = createApp();
      problem = null;
      startJobs();
      console.log(`Database ready. Madhuram cloud is running${process.env.SITE_ROLE ? ` (${process.env.SITE_ROLE} site)` : ''}.`);
      return;
    } catch (err) {
      problem = dbHelp(err);
      console.error('Database problem:', problem.code, problem.detail);
      await db.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
}
// Background work. The billing site (or the single app) runs backups, keeps the held-stock numbers right, refreshes the
// "popular" counts and pushes order events to the staff screens. A customers'-site-only copy just wakes the billing site.
function startJobs() {
  const shopOnly = ['shop'].includes(String(process.env.SITE_ROLE || process.env.APP_ROLE || '').toLowerCase());
  events.start({ billing: !shopOnly });
  if (shopOnly) return;
  require('./src/backups').schedule();
  const stock = require('./src/stock');
  const quiet = (p) => p.catch((e) => console.error('job:', e.message));
  quiet(stock.reconcile().then((fixed) => { if (fixed.length) console.log(`Held stock corrected for ${fixed.length} products.`); }));
  quiet(stock.refreshStats());
  setInterval(() => quiet(stock.refreshStats()), 10 * 60000).unref();
  setInterval(() => quiet(events.cleanup()), 24 * 3600000).unref();
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Start by itself however the file is loaded (`node server.js`, Hostinger's Node.js runner, or the root server.js).
// Only the automated tests load it without starting (they set MPC_NO_AUTOSTART=1).
if (process.env.MPC_NO_AUTOSTART !== '1') main();

module.exports = { createApp, main };
