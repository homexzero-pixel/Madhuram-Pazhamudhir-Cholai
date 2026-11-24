'use strict';
// Exact arithmetic: money in integer paise, quantities in integer thousandths (grams / milli-pieces), GST rates in hundredths of a percent.
// All rounding is half-up, as on Indian bills. Values stay far below 2^53, so plain numbers are exact.

function divRound(n, d) {          // n / d rounded half away from zero, for integers
  if (d < 0) { n = -n; d = -d; }
  return n >= 0 ? Math.floor((2 * n + d) / (2 * d)) : -Math.floor((-2 * n + d) / (2 * d));
}

function parseFixed(value, places, what) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim().replace(/,/g, '');
  const m = s.match(/^(-?)(\d*)(?:\.(\d*))?$/);
  if (!m || (m[2] === '' && !m[3])) throw new UserError(`'${value}' is not a number${what ? ` (${what})` : ''}.`);
  const frac = (m[3] || '');
  let whole = Number((m[2] || '0') + frac.slice(0, places).padEnd(places, '0'));
  if (frac.length > places && Number(frac[places]) >= 5) whole += 1;   // half-up on the first dropped digit
  if (!Number.isSafeInteger(whole) || whole > 1e13) throw new UserError(`'${value}' is too large.`);
  return m[1] ? -whole : whole;
}
const paise = (v, what) => parseFixed(v, 2, what);         // '12.50' -> 1250
const milli = (v, what) => parseFixed(v, 3, what);         // '0.750' -> 750
const rateBp = (v) => parseFixed(v ?? 0, 2) || 0;          // '5' -> 500 (hundredths of a percent)

function fmt(int, places) {
  const neg = int < 0; int = Math.abs(int);
  const p = 10 ** places;
  const s = `${Math.floor(int / p)}.${String(int % p).padStart(places, '0')}`;
  return (neg ? '-' : '') + s;
}
const rs = (p) => fmt(p, 2);                                // 1250 -> '12.50' (for the database and JSON)
const qtyStr = (m) => fmt(m, 3).replace(/\.?0+$/, '');      // 750 -> '0.75', 2000 -> '2'
const qtyDb = (m) => fmt(m, 3);

function lineAmount(ratePaise, qtyMilli) { return divRound(ratePaise * qtyMilli, 1000); }

// Split a GST-inclusive amount into taxable value, CGST and SGST (intra-state), like the shop software.
function splitTax(amount, bp) {
  if (!bp || bp <= 0) return { taxable: amount, cgst: 0, sgst: 0 };
  const taxable = divRound(amount * 10000, 10000 + bp);
  const tax = amount - taxable;
  const cgst = divRound(tax, 2);
  return { taxable, cgst, sgst: tax - cgst };
}

// Indian financial year code: 1 Nov 2026 -> '2627'.
function financialYear(ymd) {
  const [y, m] = ymd.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}${String((start + 1) % 100).padStart(2, '0')}`;
}

// Shop clock (India, no daylight saving): 'YYYY-MM-DD HH:MM:SS'.
function nowIST(ms = Date.now()) {
  return new Date(ms + 330 * 60000).toISOString().slice(0, 19).replace('T', ' ');
}
const todayIST = () => nowIST().slice(0, 10);

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}

module.exports = { divRound, paise, milli, rateBp, rs, qtyStr, qtyDb, lineAmount, splitTax, financialYear, nowIST, todayIST, UserError };
