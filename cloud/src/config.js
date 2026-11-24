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
module.exports = {
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
