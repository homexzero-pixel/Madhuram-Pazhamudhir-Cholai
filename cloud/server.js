'use strict';
// Madhuram Pazhamudhir Cholai – cloud edition. Start: `node server.js` (Hostinger: entry file server.js).
const path = require('path');
const express = require('express');
const config = require('./src/config');
const db = require('./src/db');
const api = require('./src/routes/api');
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
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; " +
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  // Changes are only accepted from this site's own pages: the browser's Origin must be this host.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin || req.headers.referer || '';
    let host = '';
    try { host = new URL(origin).host; } catch (_) { /* missing */ }
    if (!host || host !== req.headers.host) return next(new UserError('Request blocked: open the store from its own address.', 403));
    return next();
  });
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
  app.use(express.static(pub, { index: false, maxAge: '1h' }));
  app.get(['/shop', '/shop/'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(pub, 'shop.html'));
  });
  app.get(['/', '/index.html'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(pub, 'index.html'));
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
  else if (err.code === 'ER_ACCESS_DENIED_ERROR') what = 'The database user name or password is wrong. Copy them again from hPanel → Databases (the names start with u…_), then Redeploy.';
  else if (err.code === 'ER_BAD_DB_ERROR') what = 'There is no database with that name. Copy the exact database name from hPanel → Databases (it starts with u…_), then Redeploy.';
  else if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(err.code)) {
    what = 'The database server cannot be reached. In hPanel → Databases, look for "MySQL host" and put that in DB_HOST (try 127.0.0.1 if it says localhost), then Redeploy.';
  } else what = 'The database could not be prepared.';
  return { what, seen, code: err.code || '', detail: String(err.message || '').replace(c.password || '\u0000', '***').slice(0, 300) };
}

async function main() {
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
      app = createApp();
      problem = null;
      require('./src/backups').schedule();
      console.log('Database ready. Madhuram cloud is running.');
      return;
    } catch (err) {
      problem = dbHelp(err);
      console.error('Database problem:', problem.code, problem.detail);
      await db.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
}
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

if (require.main === module) main();

module.exports = { createApp, main };
