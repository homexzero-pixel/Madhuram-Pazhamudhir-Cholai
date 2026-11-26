'use strict';
// Checks around every AI call: personal and payment details are masked before anything leaves the server, attempts to
// take over the assistant are refused, and whatever comes back is checked against a schema and the shop's own data.

// ---------------------------------------------------------------- masking (applied to every text sent to the model and to the log)
const MASKS = [
  [/\b[\w.+-]{1,64}@[\w-]{1,63}(\.[\w-]{1,63})+\b/g, '[email]'],                 // e-mail
  [/\b[\w.-]{2,64}@(ok\w+|ybl|ibl|axl|paytm|upi|apl|yapl|icici|sbi|hdfcbank|axisbank|kotak|barodampay|aubank|fbl|idfcbank|waicici|wahdfcbank|waaxis|wasbi)\b/gi, '[upi-id]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[card-number]'],                                    // card numbers
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, '[id-number]'],                                    // Aadhaar-like
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[pan]'],                                             // PAN
  [/(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, '[phone]'],                        // Indian mobile numbers
  [/\b(?:cvv|cvc|otp|pin|password|passcode|utr|upi ref)\s*[:=-]?\s*\S+/gi, '[secret]'],
  [/\b\d{6,}\b/g, '[number]'],                                                       // any other long number (UTR, account…)
];
function mask(text) {
  let t = String(text || '');
  for (const [re, by] of MASKS) t = t.replace(re, by);
  return t;
}

// ---------------------------------------------------------------- prompt injection / jailbreak attempts in a customer's question
const INJECTION = [
  /ignore (all |any |the )?(previous|above|earlier|prior|your) (instructions|rules|prompts?|messages?)/i,
  /disregard (all |the |your )?(instructions|rules|guidelines)/i,
  /(reveal|show|print|repeat|leak|tell me) (me )?(your|the) (system )?(prompt|instructions|rules|hidden)/i,
  /\b(system prompt|developer mode|jailbreak|DAN mode|do anything now)\b/i,
  /you are (now|no longer)|from now on you|act as (an?|the) (admin|developer|system|shop owner|manager)/i,
  /pretend (to be|you are)|roleplay as|new instructions|override (the )?(rules|policy|instructions)/i,
  /<\/?(system|assistant|instructions?|tool|admin)>|\[\/?(system|INST)\]|<\|im_start\|>|###\s*(system|instruction)/i,
  /\b(sql|select \* from|drop table|union select|<script|javascript:)/i,
  /(other|another|all) customers?('s)? (orders?|details|phone|address|data)/i,
  /\b(cost price|purchase price|profit margin|margin|supplier rate|buying price)\b/i,
];
function injection(text) {
  const t = String(text || '');
  return INJECTION.some((re) => re.test(t));
}

// ---------------------------------------------------------------- promises the assistant must never make
const PROMISE = [
  /\b(i|we)('ll| will| can| shall| could)? ?(give|offer|apply|provide|arrange|process|issue|add) (you )?(a |an |the )?(\d+ ?%|extra|special|additional|free|full)? ?(discount|refund|coupon|cashback|voucher|price ?match|compensation|free (item|delivery|gift))/i,
  /\b(you('ll| will) (get|receive) (a |an )?(\d+ ?%|extra|full)? ?(discount|refund|cashback|coupon))/i,
  /\b(refund (has been|is|will be) (processed|initiated|approved|issued))/i,
  /\b(coupon code|promo code|use code)\b/i,
  /\bprice (is|has been) (reduced|changed) for you\b/i,
];
const promises = (text) => PROMISE.some((re) => re.test(String(text || '')));

// ---------------------------------------------------------------- tiny JSON-schema check for the model's answer
function validate(schema, value, path = '$') {
  const errs = [];
  const t = schema.type;
  const isType = { object: (v) => v && typeof v === 'object' && !Array.isArray(v), array: Array.isArray, string: (v) => typeof v === 'string',
    integer: Number.isInteger, number: (v) => typeof v === 'number' && Number.isFinite(v), boolean: (v) => typeof v === 'boolean' };
  if (t && !isType[t](value)) return [`${path}: expected ${t}`];
  if (t === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path}.${k}: missing`);
    for (const [k, v] of Object.entries(value)) {
      if (!schema.properties || !schema.properties[k]) { if (schema.additionalProperties === false) errs.push(`${path}.${k}: not allowed`); continue; }
      errs.push(...validate(schema.properties[k], v, `${path}.${k}`));
    }
  }
  if (t === 'array') {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: too many items`);
    value.forEach((v, i) => errs.push(...validate(schema.items || {}, v, `${path}[${i}]`)));
  }
  if (t === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${path}: too long`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not one of ${schema.enum.join(', ')}`);
  return errs;
}

// Rupee amounts written in an answer must be ones the shop's data gave (the model must not work out prices or totals).
function unknownAmounts(text, allowed) {
  const ok = new Set([...allowed].map((v) => Number(v).toFixed(2)));
  const found = String(text || '').match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/gi) || [];
  return found.map((m) => Number(m.replace(/[^\d.]/g, '')).toFixed(2)).filter((v) => !ok.has(v));
}

module.exports = { mask, injection, promises, validate, unknownAmounts };
