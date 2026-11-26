'use strict';
// The only way the app talks to an AI model. Every call goes through here, so the same safeguards always apply:
//   - off unless ANTHROPIC_API_KEY is set; separate switches for the customers' site and the billing site
//     (owner: Settings → AI helpers; hosting: AI_SHOP=off / AI_BILLING=off stop it at once, whatever the settings say);
//   - a daily token budget for the whole shop (Settings), a time limit per answer, one retry;
//   - personal and payment details are masked before the text leaves the server (guard.mask);
//   - the model must answer in a fixed JSON shape (structured output), which is checked again here;
//   - a refusal, a time-out or a bad answer never reaches the customer: the caller answers from its own data instead;
//   - every call is written to ai_logs (masked) with its outcome, tokens and time.
// The model never works out GST, totals, stock or ledgers: callers only use it to word an answer and pick record ids
// from data the server already checked.
const db = require('../db');
const settings = require('../settings');
const guard = require('./guard');
const { nowIST } = require('../money');

const env = process.env;
const MODEL = env.AI_MODEL || 'claude-opus-5-5';
const TIMEOUT_MS = Number(env.AI_TIMEOUT_MS || 20000);

let client = null;
let fake = null;                     // tests put a stand-in here
function sdk() {
  if (fake) return fake;
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk').default;
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 1 });
  }
  return client;
}

// Is the AI on for this site? (key present, not switched off by the hosting settings or by the owner)
async function status(site) {
  const cfg = await settings.load();
  const hardOff = String(env[site === 'shop' ? 'AI_SHOP' : 'AI_BILLING'] || '').toLowerCase() === 'off' || String(env.AI_ALL || '').toLowerCase() === 'off';
  const keyed = !!(fake || env.ANTHROPIC_API_KEY);
  const owner = cfg[site === 'shop' ? 'ai_shop_enabled' : 'ai_billing_enabled'] === '1';
  return { on: keyed && !hardOff && owner, keyed, hard_off: hardOff, owner, model: MODEL };
}

async function usedToday() {
  const r = await db.one('SELECT COALESCE(SUM(tokens_in + tokens_out), 0) t FROM ai_logs WHERE at >= ?', [`${nowIST().slice(0, 10)} 00:00:00`]);
  return Number(r.t);
}

// JSON schema features the API may not take (lengths, counts) are checked here instead of being sent.
function forApi(schema) {
  if (Array.isArray(schema)) return schema.map(forApi);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) if (!['maxLength', 'maxItems', 'minLength', 'minItems'].includes(k)) out[k] = forApi(v);
  return out;
}

// One structured call. Returns { outcome: 'ok', data, tokens_in, tokens_out, ms } or { outcome: off|limit|refused|error, reason }.
// `text` is masked here, unless the caller already masked the person's words and the rest is the shop's own data (maskText false).
async function ask({ site, system, text, schema, maxTokens = 2000, maskText = true }) {
  const st = await status(site);
  if (!st.on) return { outcome: 'off', reason: !st.keyed ? 'no API key' : st.hard_off ? 'switched off on the server' : 'switched off in Settings' };
  const cap = Number((await settings.load()).ai_daily_tokens) || 300000;
  if ((await usedToday()) >= cap) return { outcome: 'limit', reason: `daily budget of ${cap} tokens used` };
  const t0 = Date.now();
  let resp;
  try {
    resp = await sdk().beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      // a declined request is answered by Anthropic's recommended fallback model inside the same call
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: forApi(schema) } },
      system,
      messages: [{ role: 'user', content: maskText ? guard.mask(text) : String(text) }],
    });
  } catch (err) {
    const name = err && err.constructor ? err.constructor.name : 'Error';
    return { outcome: 'error', reason: `${name}${err && err.status ? ` ${err.status}` : ''}`.slice(0, 150), ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  const usage = { tokens_in: Number(resp.usage && resp.usage.input_tokens) || 0, tokens_out: Number(resp.usage && resp.usage.output_tokens) || 0, ms };
  if (resp.stop_reason === 'refusal') return { outcome: 'refused', reason: 'the model declined', ...usage };
  if (resp.stop_reason === 'max_tokens') return { outcome: 'error', reason: 'answer too long', ...usage };
  const textOut = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let data;
  try { data = JSON.parse(textOut); } catch (_) { return { outcome: 'error', reason: 'answer was not JSON', ...usage }; }
  const errs = guard.validate(schema, data);
  if (errs.length) return { outcome: 'error', reason: `answer failed the check: ${errs[0]}`.slice(0, 150), ...usage };
  return { outcome: 'ok', data, model: resp.model || MODEL, ...usage };
}

async function log(entry) {
  await db.query(`INSERT INTO ai_logs (at, site, kind, customer_id, user_id, question, answer, outcome, reason, model, tokens_in, tokens_out, ms, ip)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [nowIST(), entry.site, entry.kind, entry.customer_id || null, entry.user_id || null,
    guard.mask(entry.question).slice(0, 600), guard.mask(entry.answer).slice(0, 1200), entry.outcome, String(entry.reason || '').slice(0, 160),
    String(entry.model || '').slice(0, 40), entry.tokens_in || 0, entry.tokens_out || 0, entry.ms || 0, String(entry.ip || '').slice(0, 45)]).catch(() => {});
}

// How many questions this customer asked today (per-customer cap).
async function customerCount(customerId, ip) {
  const day = `${nowIST().slice(0, 10)} 00:00:00`;
  const r = customerId ? await db.one('SELECT COUNT(*) n FROM ai_logs WHERE customer_id=? AND at >= ?', [customerId, day])
    : await db.one('SELECT COUNT(*) n FROM ai_logs WHERE customer_id IS NULL AND ip=? AND at >= ?', [ip || '', day]);
  return Number(r.n);
}

module.exports = { ask, log, status, usedToday, customerCount, MODEL, _setClient: (c) => { fake = c; } };
