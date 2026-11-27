'use strict';
// The GST tax invoice of a completed online order, as a printable page for the customer ("Download invoice").
// All numbers come from the saved bill (worked out by the billing code, never by the browser or the AI).
const settings = require('./settings');
const billing = require('./billing');
const db = require('./db');
const { paise, rs, UserError } = require('./money');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const inr = (v) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Only the logged-in customer who placed the order, and only once the shop has completed it.
async function forCustomer(customer, number) {
  if (!customer) throw new UserError('Please log in.', 401);
  const o = await db.one(`SELECT o.*, x.bill_no FROM online_orders o JOIN sales x ON x.id=o.sale_id WHERE o.number=? AND o.customer_id=?`,
    [String(number || '').slice(0, 12), customer.id]);
  if (!o) throw new UserError('Invoice not found.', 404);
  if (o.status !== 'done') throw new UserError('The invoice is ready when the shop completes your order.', 409);
  return html(o, await billing.receipt(o.sale_id), await settings.load());
}

function html(o, b, cfg) {
  const paid = b.payments.map((p) => {
    const how = p.method === 'cod' ? `Cash on delivery${o.settle_method === 'upi' ? ' (paid by UPI)' : o.settle_method === 'cash' ? ' (paid in cash)' : ''}`
      : { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit', points: 'Loyalty points' }[p.method] || p.method;
    return `<tr><td>${esc(how)}${p.reference ? ` · ${esc(p.reference)}` : ''}</td><td class="r">${inr(p.amount)}</td></tr>`;
  }).join('');
  const lines = b.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.name_ta ? `<div class="ta">${esc(l.name_ta)}</div>` : ''}</td>
    <td class="r">${esc(l.qty)} ${esc(l.unit)}</td><td class="r">${inr(l.rate)}</td><td class="r">${Number(l.gst_rate) ? `${Number(l.gst_rate)}%` : '–'}</td>
    <td class="r">${inr(l.net)}</td></tr>`).join('');
  const gst = b.gst.map((g) => `<tr><td>${Number(g.rate)}%</td><td class="r">${inr(g.taxable)}</td><td class="r">${inr(g.cgst)}</td><td class="r">${inr(g.sgst)}</td></tr>`).join('');
  const saved = b.lines.reduce((t, l) => t + Math.max(0, (paise(l.mrp || '0') - paise(l.rate)) * Number(l.qty)), 0);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Invoice ${esc(b.bill_no)}</title><style>
body{font-family:'Segoe UI',Roboto,'Noto Sans Tamil',Arial,sans-serif;color:#1c2433;margin:0;background:#f4f6f8}
.page{max-width:780px;margin:16px auto;background:#fff;padding:28px;border-radius:12px;box-shadow:0 2px 12px #0001}
h1{font-size:20px;margin:0}h2{font-size:15px;margin:18px 0 6px}.muted{color:#647084;font-size:13px}.ta{color:#647084;font-size:12px}
.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:2px solid #0c831f;padding-bottom:12px}
.tag{display:inline-block;background:#e8f5ec;color:#0c831f;font-weight:700;padding:4px 10px;border-radius:6px;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:7px 6px;border-bottom:1px solid #e6e9ee;text-align:left;vertical-align:top}
th{background:#f7f8fa;font-size:12px;text-transform:uppercase;color:#647084}.r{text-align:right}.tot td{font-weight:700;font-size:16px;border-bottom:0}
.btn{display:inline-block;margin:16px 0 0;padding:10px 18px;border-radius:8px;border:0;background:#0c831f;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;padding:0}.btn{display:none}}
</style></head><body><div class="page">
<div class="top"><div><h1>${esc(cfg.name)}</h1><div class="muted">${esc(cfg.address).replace(/\r?\n/g, '<br>')}${cfg.phone ? `<br>Phone ${esc(cfg.phone)}` : ''}
  ${cfg.gstin ? `<br>GSTIN ${esc(cfg.gstin)}` : ''}${cfg.fssai ? ` · FSSAI ${esc(cfg.fssai)}` : ''}</div></div>
  <div style="text-align:right"><span class="tag">TAX INVOICE</span><div style="margin-top:6px"><b>${esc(b.bill_no)}</b></div>
  <div class="muted">${esc(String(b.at).slice(0, 16))}<br>Online order ${esc(o.number)}</div></div></div>
<h2>Billed to</h2><div>${esc(o.name)} · ${esc(o.phone)}${o.address ? `<br><span class="muted">${esc(o.address)}</span>` : ''}
  <br><span class="muted">${o.mode === 'delivery' ? 'Home delivery' : 'Takeaway'}${o.completed_at ? ` · completed ${esc(String(o.completed_at).slice(0, 16))}` : ''}</span></div>
<h2>Items</h2><table><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amount</th></tr>${lines}
  ${paise(b.discount) ? `<tr><td></td><td>Discount</td><td></td><td></td><td></td><td class="r">−${inr(b.discount)}</td></tr>` : ''}
  <tr class="tot"><td></td><td>Total</td><td></td><td></td><td></td><td class="r">${inr(b.total)}</td></tr></table>
${saved > 0 ? `<p class="muted">You saved ${inr(rs(Math.round(saved)))} on MRP.</p>` : ''}
${gst ? `<h2>GST included</h2><table><tr><th>Rate</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th></tr>${gst}</table>` : ''}
<h2>Payment</h2><table>${paid}</table>
${b.returned ? `<p class="muted">Returned on credit note: ${inr(b.returned)}</p>` : ''}
<p class="muted">${esc(cfg.bill_footer || 'Thank you!')}</p>
<button class="btn" id="p" type="button">Print / Save as PDF</button>
</div><script src="/print.js"></script></body></html>`;
}

module.exports = { forCustomer, html };
