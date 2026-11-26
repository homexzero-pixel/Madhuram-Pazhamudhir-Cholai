'use strict';
// Automatic backups kept on the server (outside the app folder, so a redeploy does not delete them):
// one every evening, plus on demand. Kept: the last 14 days and the first backup of each of the last 12 months.
// Hostinger's own daily backups and the owner's "Download backup" copies are the other two places.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { nowIST, todayIST, UserError } = require('./money');

const DIR = process.env.BACKUP_DIR || require('./config').dataDir('madhuram_backups');
const NAME = /^madhuram_(auto|manual)_\d{12}\.sql\.gz$/;

async function make(kind = 'auto') {
  const conn = await db.getPool().getConnection();
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('mpc_backup', 0) got");
    if (!lock.got) throw new UserError('A backup is already being made. Try again in a minute.', 409);
    fs.mkdirSync(DIR, { recursive: true });
    const name = `madhuram_${kind}_${nowIST().replace(/\D/g, '').slice(0, 12)}.sql.gz`;
    const file = path.join(DIR, name);
    const tmp = `${file}.part`;
    await require('./admin').dumpTo(fs.createWriteStream(tmp));
    fs.renameSync(tmp, file);
    const bytes = fs.statSync(file).size;
    await db.query('INSERT INTO stored_backups (name, created_at, bytes, kind) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE bytes=VALUES(bytes)',
      [name, nowIST(), bytes, kind]);
    await prune();
    await conn.query("SELECT RELEASE_LOCK('mpc_backup')");
    return { name, bytes };
  } finally {
    conn.release();
  }
}

async function prune() {
  const rows = await db.query('SELECT name, created_at FROM stored_backups ORDER BY created_at DESC, id DESC');
  const newestOfDay = new Map();                       // day -> newest backup of that day (rows are newest first)
  for (const r of rows) if (!newestOfDay.has(r.created_at.slice(0, 10))) newestOfDay.set(r.created_at.slice(0, 10), r.name);
  const keep = new Set([...newestOfDay.values()].slice(0, 14));
  const oldestOfMonth = new Map();                     // month -> first backup of that month
  for (const r of [...rows].reverse()) if (!oldestOfMonth.has(r.created_at.slice(0, 7))) oldestOfMonth.set(r.created_at.slice(0, 7), r.name);
  for (const name of [...oldestOfMonth.values()].slice(-12)) keep.add(name);
  for (const r of rows) {
    if (keep.has(r.name)) continue;
    try { fs.unlinkSync(path.join(DIR, r.name)); } catch (_) { /* already gone */ }
    await db.query('DELETE FROM stored_backups WHERE name=?', [r.name]);
  }
}

async function list() {
  const rows = await db.query('SELECT name, created_at, bytes, kind FROM stored_backups ORDER BY created_at DESC');
  return rows.map((r) => ({ ...r, on_disk: fs.existsSync(path.join(DIR, r.name)) }));
}

function filePath(name) {
  if (!NAME.test(name)) throw new UserError('Backup not found.', 404);
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) throw new UserError('Backup not found.', 404);
  return p;
}

async function status() {
  const last = await db.one('SELECT name, created_at, bytes FROM stored_backups ORDER BY created_at DESC LIMIT 1');
  const ageH = last ? (Date.parse(`${nowIST().replace(' ', 'T')}Z`) - Date.parse(`${last.created_at.replace(' ', 'T')}Z`)) / 3600000 : null;
  return { last, ok: ageH !== null && ageH < 30, age_hours: ageH === null ? null : Math.round(ageH), dir: DIR };
}

// Secret key for the Hostinger "Cron job" that can also start the evening backup.
async function cronKey() {
  await db.query("INSERT IGNORE INTO settings (k, v) VALUES ('_cron_key', ?)", [crypto.randomBytes(18).toString('base64url')]);
  return (await db.one("SELECT v FROM settings WHERE k='_cron_key'")).v;
}

// Inside the running app: every 20 minutes, after 9 pm, make the day's backup if there is none yet.
let timer = null;
function schedule() {
  if (timer) return;
  const tick = async () => {
    try {
      const hour = Number(nowIST().slice(11, 13));
      const today = await db.one("SELECT COUNT(*) n FROM stored_backups WHERE created_at >= ? AND kind='auto'", [`${todayIST()} 00:00:00`]);
      const st = await status();
      if ((hour >= 21 && Number(today.n) === 0) || (st.last === null && Number((await db.one('SELECT COUNT(*) n FROM sales')).n) > 0) ||
          (st.age_hours !== null && st.age_hours > 30)) {
        await make('auto');
      }
    } catch (err) {
      if (!err.expose) console.error('Automatic backup failed:', err.message);
    }
  };
  timer = setInterval(tick, 20 * 60000);
  timer.unref();
  setTimeout(tick, 60000).unref();
}

module.exports = { make, list, filePath, status, cronKey, schedule, prune, DIR };
