'use strict';
// Settings come from environment variables (Hostinger: hPanel → Node.js app → Environment variables) or a .env file next to server.js.
const fs = require('fs');
const path = require('path');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadDotEnv(path.join(__dirname, '..', '.env'));

const env = process.env;

// Folders for backups and product photos are kept OUTSIDE the deployed app, so a redeploy never deletes them.
// The app is either this "cloud" folder or (when the whole repository is deployed) its parent, which then has server.js.
const cloudDir = path.join(__dirname, '..');
const appRoot = fs.existsSync(path.join(cloudDir, '..', 'server.js')) ? path.join(cloudDir, '..') : cloudDir;
const dataDir = (name) => path.join(appRoot, '..', name);
module.exports = {
  dataDir,
  port: Number(env.PORT || 3000),
  db: {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || '',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || '',
  },
  // Hostinger runs the app behind its own web server; trust the first proxy so https and the visitor's address are seen correctly.
  trustProxy: env.TRUST_PROXY === undefined ? 1 : Number(env.TRUST_PROXY),
  sessionHours: Number(env.SESSION_HOURS || 16),
  test: env.NODE_ENV === 'test',
};
