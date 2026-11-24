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

async function main() {
  await db.migrate();
  const app = createApp();
  app.listen(config.port, () => console.log(`Madhuram cloud running on port ${config.port}`));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Could not start:', err.message);
    console.error('Check DB_HOST, DB_USER, DB_PASSWORD and DB_NAME (Hostinger: Databases → MySQL Databases).');
    process.exit(1);
  });
}

module.exports = { createApp };
