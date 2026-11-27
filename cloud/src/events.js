'use strict';
// Events between the customers' site and the billing site.
//
// 1. emit()  – the event is written to the `outbox` table in the SAME transaction as the change (a new online order, an
//              invoice, a dispatch…). A rolled-back change never sends an event; a committed one is never lost.
// 2. pump()  – on the billing site, new outbox rows are pushed to every open billing screen (Server-Sent Events,
//              GET /api/events) within a second; the screens also poll as a fallback.
// 3. Signed webhooks (HMAC-SHA256, shared secret EVENTS_SECRET):
//    - the customers' site wakes the billing site at once: POST {BILLING_URL}/internal/events (only a wake-up call;
//      the billing site then reads the event from the shared database, so a forged call can never create an order);
//    - optional EVENTS_WEBHOOK_URL receives every event as JSON (for an automation), retried with back-off.
//    Headers: X-MPC-Event, X-MPC-Id, X-MPC-Timestamp, X-MPC-Signature: sha256=hex(HMAC(secret, `${timestamp}.${body}`)).
const crypto = require('crypto');
const db = require('./db');
const { nowIST } = require('./money');

const env = process.env;
const clients = new Set();          // { res, user }
let pumping = false;
let timer = null;

async function emit(q, type, data) {
  await q('INSERT INTO outbox (type, data, created_at) VALUES (?,?,?)', [type, JSON.stringify(data).slice(0, 8000), nowIST()]);
}

// ---------------------------------------------------------------- signatures
const secret = () => String(env.EVENTS_SECRET || '');
function sign(body, ts = Math.floor(Date.now() / 1000)) {
  return { ts: String(ts), sig: `sha256=${crypto.createHmac('sha256', secret()).update(`${ts}.${body}`).digest('hex')}` };
}
// Checks a signed request (raw body as text). Rejects old or future timestamps (replay) and bad signatures.
function verify(body, ts, sig, maxSkewSec = 300) {
  if (!secret() || secret().length < 16) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > maxSkewSec) return false;
  const want = Buffer.from(sign(body, t).sig);
  const got = Buffer.from(String(sig || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

async function post(url, type, id, payload) {
  const body = JSON.stringify(payload);
  const { ts, sig } = sign(body);
  const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/json', 'X-MPC-Event': type, 'X-MPC-Id': String(id), 'X-MPC-Timestamp': ts, 'X-MPC-Signature': sig } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// ---------------------------------------------------------------- billing screens (Server-Sent Events)
// Hosting cuts every request after 120 seconds (Hostinger), so each connection ends by itself after 100 seconds and the
// browser reconnects 3 seconds later, sending the last event id it saw; events from that gap are sent again.
async function subscribe(req, res, user) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const c = { res, user };
  const seen = Number(req.headers['last-event-id']) || 0;
  if (seen > 0) {
    try {
      const missed = await db.query(`SELECT id, type, data, created_at FROM outbox WHERE id > ? AND pushed=1 AND created_at > ?
        ORDER BY id LIMIT 50`, [seen, nowIST(Date.now() - 10 * 60000)]);
      for (const r of missed) res.write(message(r));
    } catch (_) { /* the poll on the screen covers it */ }
  }
  clients.add(c);
  const beat = setInterval(() => res.write(': keep-alive\n\n'), 20000);
  const end = setTimeout(() => res.end(), 100000);
  req.on('close', () => { clearInterval(beat); clearTimeout(end); clients.delete(c); });
}
function message(row) {
  let data;
  try { data = JSON.parse(row.data); } catch (_) { data = {}; }
  return `id: ${row.id}\nevent: order\ndata: ${JSON.stringify({ type: row.type, at: row.created_at, ...data })}\n\n`;
}
function broadcast(row) {
  const msg = message(row);
  for (const c of clients) { try { c.res.write(msg); } catch (_) { clients.delete(c); } }
}

// ---------------------------------------------------------------- the pump (billing site only)
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    const rows = await db.query('SELECT id, type, data, created_at FROM outbox WHERE pushed=0 ORDER BY id LIMIT 200');
    if (rows.length) {
      for (const r of rows) broadcast(r);
      await db.query('UPDATE outbox SET pushed=1 WHERE id IN (?)', [rows.map((r) => r.id)]);
    }
    if (env.EVENTS_WEBHOOK_URL && secret()) {
      const due = await db.query('SELECT id, type, data, created_at, attempts FROM outbox WHERE hooked=0 AND attempts < 10 AND (next_try IS NULL OR next_try <= ?) ORDER BY id LIMIT 20', [nowIST()]);
      for (const r of due) {
        try {
          await post(env.EVENTS_WEBHOOK_URL, r.type, r.id, { id: Number(r.id), type: r.type, at: r.created_at, data: JSON.parse(r.data) });
          await db.query('UPDATE outbox SET hooked=1 WHERE id=?', [r.id]);
        } catch (_) {
          const wait = Math.min(3600, 15 * 2 ** r.attempts);            // 15 s, 30 s, 1 min … 1 hour
          await db.query('UPDATE outbox SET attempts=attempts+1, next_try=? WHERE id=?', [nowIST(Date.now() + wait * 1000), r.id]);
        }
      }
    }
  } catch (err) {
    if (!/ECONNREFUSED|PROTOCOL_CONNECTION_LOST|pool is closed|Pool is closed/i.test(String(err && err.message))) console.error('events pump:', err.message);
  } finally {
    pumping = false;
  }
}
const kick = () => { setImmediate(() => { pump().catch(() => {}); }); };

// The customers' site: wake the billing site after a change (signed). Failure is fine: the billing site polls too.
let wakeAt = 0;
function wakeBilling(type = 'change') {
  const url = env.BILLING_URL && `${env.BILLING_URL.replace(/\/+$/, '')}/internal/events`;
  if (!url || !secret() || Date.now() - wakeAt < 200) return;
  wakeAt = Date.now();
  post(url, type, 0, { wake: true, at: nowIST() }).catch(() => {});
}

function start({ billing }) {
  if (timer) return;
  if (billing) {
    db.onChange(kick);
    timer = setInterval(() => { pump().catch(() => {}); }, 1000);
  } else {
    db.onChange(() => wakeBilling());
    timer = setInterval(() => {}, 1 << 30);
  }
  timer.unref();
}
function stop() { if (timer) clearInterval(timer); timer = null; }

// Old events are removed after 30 days.
async function cleanup() { await db.query('DELETE FROM outbox WHERE created_at < DATE_SUB(?, INTERVAL 30 DAY)', [nowIST()]); }

module.exports = { emit, sign, verify, subscribe, pump, kick, start, stop, cleanup, clientCount: () => clients.size };
