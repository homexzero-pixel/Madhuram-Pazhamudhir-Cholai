/* Madhuram cloud: online orders, returns, customers & credit, purchases & suppliers, reports, owner tools. */
'use strict';

// ------------------------------------------------------------------ WhatsApp (free: opens the shop's own WhatsApp with the text ready)
function waPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
}
function waLink(phone, text) {
  const p = waPhone(phone);
  const t = encodeURIComponent(text);
  if (/Android|iPhone|iPad/i.test(navigator.userAgent)) return `https://wa.me/${p}?text=${t}`;
  return App.settings.whatsapp_open === 'web' ? `https://web.whatsapp.com/send?phone=${p}&text=${t}` : `whatsapp://send?phone=${p}&text=${t}`;
}
function billText(b) {
  const s = App.settings;
  const L = [`*${s.name}*`, `Bill ${b.bill_no} · ${b.at.slice(0, 16)}`, ''];
  for (const l of b.lines) L.push(`${l.name}  ${l.qty}${l.unit === 'kg' ? ' kg' : ''} × ${l.rate} = ${l.net}`);
  L.push('', `*Total ${inr(b.total)}*`);
  for (const p of b.payments) L.push(`${p.method.toUpperCase()} ${inr(p.amount)}`);
  L.push('', s.bill_footer || 'Thank you!');
  return L.join('\n');
}
const tabs = (list, cur, base) => `<div class="cats" style="margin-bottom:12px">${list.map(([k, l]) =>
  `<a class="btn ${k === cur ? 'primary' : ''}" href="#/${base}?tab=${k}">${esc(l)}</a>`).join('')}</div>`;
const hashParam = (k) => (location.hash.match(new RegExp(`[?&]${k}=([^&]*)`)) || [])[1];

// ------------------------------------------------------------------ new online order alert on every staff screen
let lastOrder = null;
let orderTimer = null;
function chime() {
  try {
    const a = new AudioContext();
    [880, 1320].forEach((f, i) => { const o = a.createOscillator(); const g = a.createGain(); o.frequency.value = f; g.gain.value = 0.08;
      o.connect(g); g.connect(a.destination); o.start(a.currentTime + i * 0.25); o.stop(a.currentTime + i * 0.25 + 0.2); });
  } catch (_) { /* no sound */ }
}
async function pollOrders() {
  if (!App.me || !can('orders')) return;
  try {
    const b = await api('/orders/badge');
    const link = $('.nav a[data-r="orders"] .badge');
    if (link) link.innerHTML = b.new ? `<span class="count">${b.new}</span>` : '';
    if (lastOrder !== null && b.last > lastOrder) { chime(); toast('New online order!'); }
    lastOrder = b.last;
  } catch (_) { /* offline: try again later */ }
}
App.afterFrame.push(() => {
  pollOrders();
  if (!orderTimer) orderTimer = setInterval(pollOrders, 20000);
});

// ================================================================== Online orders (staff)
App.views.orders = async (main) => {
  const tab = hashParam('tab') || 'open';
  if (tab === 'perf') return ordersPerformance(main);
  const { orders } = await api(`/orders?tab=${tab}`);
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Online orders</h1>
      <div class="row"><a class="btn" href="/shop/" target="_blank">Open customer page</a><button id="poster">QR poster for customers</button></div></div>
    ${App.settings.online_enabled !== '1' ? `<div class="notice">Online orders are switched off. Turn on in ${can('settings') ? '<a href="#/settings">Settings</a>' : 'Settings'} → Online orders.</div>` : ''}
    ${tabs([['open', 'To do'], ['done', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All'], ['perf', 'Performance']], tab, 'orders')}
    ${orders.length ? `<table><tr><th>Order</th><th>Slot</th><th>Customer</th><th class="hide-sm">Type</th><th>Status</th><th class="r">Approx.</th></tr>
      ${orders.map((o) => `<tr class="click" data-id="${o.id}"><td><b>${esc(o.number)}</b><div class="small muted">${o.items} items</div></td>
      <td>${esc(o.slot_label)}</td><td>${esc(o.name)}<div class="small muted">${esc(o.phone)}</div></td>
      <td class="hide-sm">${o.mode === 'delivery' ? 'Delivery' : 'Takeaway'}</td>
      <td><span class="pill ${o.status === 'new' ? 'bad' : o.status === 'cancelled' ? 'off' : ''}">${esc(o.status_label)}</span></td>
      <td class="r">${inr(Money.paise(o.est_items) + Money.paise(o.delivery_charge))}</td></tr>`).join('')}</table>` : '<p class="muted">No orders here.</p>'}`;
  $$('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => orderDialog(Number(tr.dataset.id))));
  $('#poster').addEventListener('click', posterPrint);
  const t = setInterval(() => { if (!$('dialog[open]') && document.visibilityState === 'visible') route(); }, 30000);
  App.leave = () => clearInterval(t);
};

async function ordersPerformance(main) {
  const period = hashParam('period') || 'month';
  const p = await api(`/orders-stats?period=${period}`);
  main.innerHTML = `<h1>Online orders</h1>${tabs([['open', 'To do'], ['done', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All'], ['perf', 'Performance']], 'perf', 'orders')}
    ${periodChips(period, 'orders?tab=perf')}
    <div class="cards">
      <div class="card stat"><div class="l">Orders</div><div class="v">${p.orders}</div><div class="l">${p.delivery} delivery · ${p.pickup} takeaway</div></div>
      <div class="card stat"><div class="l">Completed · billed</div><div class="v ok">${p.done}</div><div class="l">${inr(p.sales)} from ${p.billed} bills</div></div>
      <div class="card stat"><div class="l">Cancelled</div><div class="v ${p.cancelled ? 'bad' : ''}">${p.cancelled}</div><div class="l">${p.open} still open</div></div>
      <div class="card stat"><div class="l">Time to accept</div><div class="v">${p.accept_minutes === null ? '–' : `${p.accept_minutes} min`}</div><div class="l">average</div></div>
      <div class="card stat"><div class="l">Items not available</div><div class="v ${p.removed_items ? 'warn' : ''}">${p.removed_items}</div><div class="l">${inr(p.removed_value)} not charged</div></div></div>
    <div class="grid2"><div class="card"><h2 style="margin-top:0">Most ordered online</h2><table>${p.top.map((t) => `<tr><td>${esc(t.name)}</td><td class="r">${t.orders} orders</td><td class="r">${esc(t.qty)} ${esc(t.unit)}</td></tr>`).join('') || '<tr><td class="muted">No orders</td></tr>'}</table></div>
      <div class="card"><h2 style="margin-top:0">Why orders were cancelled</h2><table>${p.cancel_reasons.map((c) => `<tr><td>${esc(c.reason || '(no reason)')}</td><td class="r">${c.n}</td></tr>`).join('') || '<tr><td class="muted">None</td></tr>'}</table></div></div>`;
  return undefined;
}

async function orderDialog(id) {
  const { order: o, whatsapp } = await api(`/orders/${id}`);
  const open = ['new', 'accepted', 'ready', 'out'].includes(o.status);
  const d = modal(`<h3>${esc(o.number)} · ${esc(o.status_label)}</h3>
    <p><b>${esc(o.name)}</b> · ${esc(o.phone)} ${o.phone_verified ? '<span class="pill">Phone verified</span>' : '<span class="pill off">phone not verified</span>'} · ${o.mode === 'delivery' ? 'Home delivery' : 'Takeaway'}<br>${esc(o.slot_label)}
    ${o.address ? `<br>${ico('pin')} ${esc(o.address)}` : ''}${o.notes ? `<br>Note: ${esc(o.notes)}` : ''}<br>Pays by ${o.pay_pref.toUpperCase()}${o.pay_ref ? ` · <b>UPI ref ${esc(o.pay_ref)}</b> (check it in your UPI app)` : ''}
    ${o.bill_no ? `<br>Bill <b>${esc(o.bill_no)}</b> ${inr(o.bill_total)}` : ''}${o.status_note ? `<br><i>${esc(o.status_note)}</i>` : ''}</p>
    <table>${o.lines.map((l) => `<tr class="${Number(l.qty) ? '' : 'struck'}"><td>${esc(l.name)}<div class="small ta muted">${esc(l.name_ta)}</div>
      ${l.note ? `<div class="small warn">${esc(l.note)}${l.ordered_qty !== null ? ` (ordered ${esc(Number(l.ordered_qty))})` : ''}</div>` : ''}</td>
      <td class="r">${esc(l.qty)} ${esc(l.unit)}</td><td class="r">${inr(Money.line(Money.paise(l.price), Money.milli(l.qty)))}</td>
      <td class="r">${open && !o.sale_id ? `<button class="small" data-less="${l.id}" title="Less is available">Less</button>
        ${Number(l.qty) ? `<button class="small danger" data-na="${l.id}" title="Remove: not available">Not available</button>` : ''}` : ''}</td></tr>`).join('')}
      ${Number(o.delivery_charge) ? `<tr><td>Delivery charge</td><td></td><td class="r">${inr(o.delivery_charge)}</td></tr>` : ''}
      <tr><td><b>Approx. total</b></td><td></td><td class="r"><b>${inr(o.est_total)}</b></td></tr></table>
    <div class="actions" style="justify-content:flex-start">
      ${o.status === 'new' ? '<button class="primary" data-s="accepted">Accept</button>' : ''}
      ${open && o.mode === 'pickup' && o.status !== 'ready' ? '<button data-s="ready">Ready for pickup</button>' : ''}
      ${open && o.mode === 'delivery' && o.status !== 'out' ? '<button data-s="out">Out for delivery</button>' : ''}
      ${open && can('bill') ? '<button class="primary" id="obill">Bill this order at this counter</button>' : ''}
      <a class="btn" target="_blank" rel="noopener" href="${esc(waLink(whatsapp.phone, whatsapp.text))}">WhatsApp the customer</a>
      <button id="opack">Print packing list</button>
      ${open ? '<button class="danger" data-s="cancelled">Cancel order</button>' : ''}
      <button data-close>Close</button></div>`);
  const lineChange = async (lineId, qty) => {
    const r = await api(`/orders/${id}/line`, { method: 'POST', body: { line_id: lineId, qty } });
    d.close();
    toast('Order changed. Send the customer the WhatsApp update.');
    window.open(waLink(r.whatsapp.phone, r.whatsapp.text), '_blank', 'noopener');
    orderDialog(id);
  };
  $$('[data-na]', d).forEach((b) => b.addEventListener('click', () => submitting(b, () => lineChange(Number(b.dataset.na), '0'))));
  $$('[data-less]', d).forEach((b) => b.addEventListener('click', () => submitting(b, async () => {
    const q = prompt('How much is available? (0 = none)');
    if (q === null) return;
    await lineChange(Number(b.dataset.less), q.trim() || '0');
  })));
  $$('[data-s]', d).forEach((b) => b.addEventListener('click', () => submitting(b, async () => {
    let note = '';
    if (b.dataset.s === 'cancelled') { note = prompt('Why is the order cancelled? (the customer sees this)') || ''; if (!note.trim()) return; }
    const r = await api(`/orders/${id}/status`, { method: 'POST', body: { status: b.dataset.s, note } });
    d.close();
    toast('Saved. Now send the customer the WhatsApp update.');
    window.open(waLink(r.whatsapp.phone, r.whatsapp.text), '_blank', 'noopener');
    route();
  })));
  $('#opack', d).addEventListener('click', () => {
    $('#print-area').innerHTML = `<div class="receipt"><h2>${esc(o.number)} packing list</h2><div>${esc(o.name)} ${esc(o.phone)}</div>
      <div>${esc(o.slot_label)} · ${o.mode === 'delivery' ? 'DELIVERY' : 'TAKEAWAY'}</div>${o.address ? `<div>${esc(o.address)}</div>` : ''}<hr>
      <table>${o.lines.filter((l) => Number(l.qty)).map((l) => `<tr><td>[ ] ${esc(l.name)}<br><span class="ta">${esc(l.name_ta)}</span></td><td class="r">${esc(l.qty)} ${esc(l.unit)}</td></tr>`).join('')}</table>
      <hr>${o.notes ? `<div>Note: ${esc(o.notes)}</div>` : ''}</div>`;
    setTimeout(() => window.print(), 50);
  });
  if ($('#obill', d)) $('#obill', d).addEventListener('click', () => submitting($('#obill', d), async () => {
    if (!myCounter()) throw new Error('Choose this PC\'s counter first (Billing).');
    const cur = JSON.parse(localStorage.getItem(`mpc_bill_${myCounter()}`) || 'null');
    if (cur && cur.lines && cur.lines.length) throw new Error('Finish, hold (F8) or cancel the bill on the billing screen first.');
    const { bill } = await api(`/orders/${id}/bill`, { method: 'POST', body: {} });
    const lines = bill.lines.map((l) => ({ id: l.id, qty: Money.milli(l.qty), rate: null, disc: 0, note: '' }));
    if (bill.delivery) lines.push({ id: bill.delivery.id, qty: 1000, rate: Money.paise(bill.delivery.rate), disc: 0, note: '', delivery: true, name: bill.delivery.name });
    localStorage.setItem(`mpc_bill_${myCounter()}`, JSON.stringify({ uuid: crypto.randomUUID(), lines, customer: bill.customer, order_id: bill.order_id, order_no: bill.number }));
    d.close();
    toast(`${bill.number} is on the bill. Correct weighed items with F4, then take payment.`);
    location.hash = '#/bill';
  }));
}

function posterPrint() {
  const s = App.settings;
  $('#print-area').innerHTML = `<div style="width:190mm;padding:12mm;text-align:center;font-family:'Segoe UI','Nirmala UI',sans-serif">
    <img src="/img/logo.webp" style="width:70mm"><h1 style="font-size:30px;margin:6mm 0">Order from your phone!</h1>
    <div class="ta" style="font-size:22px">உங்கள் மொபைலில் ஆர்டர் செய்யுங்கள்!</div>
    <img src="/api/orders-poster.svg" style="width:110mm;margin:8mm 0">
    <div style="font-size:20px">Scan → choose → <b>Takeaway</b> or <b>Home delivery</b> → pick a time</div>
    <div style="font-size:18px;margin-top:4mm">${esc(location.origin)}/shop/</div>
    <div style="font-size:18px;margin-top:6mm">${esc(s.name)} ${s.phone ? `· ${esc(s.phone)}` : ''}</div></div>`;
  const img = $('#print-area img[src$="svg"]');
  img.onload = () => window.print();
}

// ================================================================== Returns
App.views.returns = async (main) => {
  main.innerHTML = `<h1>Returns</h1>
    <div class="card" style="margin-bottom:14px"><form id="rf" class="row"><input name="bill" placeholder="Bill number (e.g. 152 or MPC/2627/00152)" style="max-width:340px" autofocus required>
      <button class="primary">Find bill</button></form><div id="rbill"></div></div>
    <h2>Returns today</h2><div id="rlist"></div>`;
  const list = async () => {
    const { returns } = await api(`/returns?date=${today()}`);
    $('#rlist').innerHTML = returns.length ? `<table><tr><th>Return</th><th>Bill</th><th>Time</th><th>By</th><th>Money back</th><th>Reason</th><th class="r">Amount</th></tr>
      ${returns.map((r) => `<tr><td>${esc(r.return_no)}</td><td>${esc(r.bill_no)}</td><td>${esc(r.created_at.slice(11, 16))}</td><td>${esc(r.who)}${r.approver && r.approver !== r.who ? ` (OK ${esc(r.approver)})` : ''}</td>
      <td>${esc(r.method.toUpperCase())}</td><td>${esc(r.reason)}</td><td class="r">${inr(r.total)}</td></tr>`).join('')}</table>` : '<p class="muted">None.</p>';
  };
  $('#rf').addEventListener('submit', (e) => { e.preventDefault(); submitting($('button', e.target), async () => {
    const { bill } = await api(`/returns/find?bill=${encodeURIComponent(e.target.bill.value)}`);
    const box = $('#rbill');
    box.innerHTML = `<h2>${esc(bill.bill_no)} · ${esc(bill.at.slice(0, 16))} · ${inr(bill.total)}${bill.customer ? ` · ${esc(bill.customer.name)}` : ''}</h2>
      <form id="rret"><table><tr><th>Product</th><th class="r">Sold</th><th class="r">Already returned</th><th>Return qty</th><th>Back on shelf?</th></tr>
      ${bill.lines.map((l) => `<tr><td>${esc(l.name)}<div class="small muted">${esc(l.qty)} × ${inr(l.rate)} = ${inr(l.net)}</div></td><td class="r">${esc(l.qty)}</td>
        <td class="r">${esc(l.returned_qty)}</td><td><input name="q${l.id}" data-line="${l.id}" inputmode="decimal" style="width:90px" placeholder="0"></td>
        <td><label class="row" style="font-weight:400"><input type="checkbox" name="s${l.id}" style="width:auto" checked> Yes (not damaged)</label></td></tr>`).join('')}</table>
      <div class="grid3"><div><label>Money back by</label><select name="method"><option value="cash">Cash from this counter</option><option value="upi">UPI</option>
        ${bill.customer ? '<option value="credit">Reduce customer\'s credit</option>' : ''}</select></div>
        <div style="grid-column:span 2"><label>Reason</label><input name="reason" required placeholder="Damaged / expired / wrong item / customer changed mind"></div></div>
      <p id="rsum" class="muted"></p><button class="primary big">Make return</button></form>`;
    const form = $('#rret');
    form.addEventListener('submit', (ev) => { ev.preventDefault(); submitting($('button.primary', form), async () => {
      const lines = $$('[data-line]', form).filter((i) => i.value).map((i) => ({ line_id: Number(i.dataset.line), qty: i.value, restock: form[`s${i.dataset.line}`].checked }));
      if (!lines.length) throw new Error('Enter the quantity to return.');
      let approval;
      if (!can('refund')) { approval = await managerApproval('refund', `Return on ${bill.bill_no}`); if (!approval) return; }
      const { result } = await api('/returns', { method: 'POST', body: { sale_id: bill.id, counter: myCounter(), method: form.method.value, reason: form.reason.value, lines, approval } });
      box.innerHTML = `<div class="notice">Return <b>${esc(result.return_no)}</b> saved: give back <b>${inr(result.total)}</b> by ${esc(result.method.toUpperCase())}.</div>`;
      $('#print-area').innerHTML = `<div class="receipt"><div class="c"><h2>${esc(App.settings.name)}</h2><div>RETURN / CREDIT NOTE</div></div><hr>
        <div>${esc(result.return_no)} · against ${esc(result.bill_no)}</div><div>${new Date().toLocaleString('en-IN')}</div><hr>
        <table><tr class="tot"><td>Refund (${esc(result.method.toUpperCase())})</td><td class="r">${inr(result.total)}</td></tr></table><hr>
        <div>Reason: ${esc(form.reason.value)}</div><br><div>Customer sign: ____________</div></div>`;
      setTimeout(() => window.print(), 50);
      list();
    }); });
  }); });
  await list();
};

// ================================================================== Customers & credit (udhaar)
App.views.customers = async (main) => {
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Customers & credit</h1><button class="primary" id="cadd">+ Add customer</button></div>
    <div class="row" style="margin-bottom:10px"><input id="cq" placeholder="Name or mobile" style="max-width:300px">
    <label class="row" style="font-weight:400;margin:0"><input type="checkbox" id="cown" style="width:auto"> Only those who owe money</label></div><div id="clist"></div>`;
  const load = async () => {
    const { customers } = await api(`/customers/list?q=${encodeURIComponent($('#cq').value)}&owing=${$('#cown').checked ? 1 : 0}`);
    $('#clist').innerHTML = customers.length ? `<table><tr><th>Name</th><th>Mobile</th><th class="r hide-sm">Bills</th><th class="r hide-sm">Spent</th><th class="hide-sm">Last visit</th><th class="r">Owes</th></tr>
      ${customers.map((c) => `<tr class="click" data-id="${c.id}"><td>${esc(c.name)}</td><td>${esc(c.phone || '')}</td><td class="r hide-sm">${c.bills}</td>
      <td class="r hide-sm">${c.spent ? inr(c.spent) : ''}</td><td class="hide-sm">${esc((c.last_visit || '').slice(0, 10))}</td>
      <td class="r ${Number(c.balance) > 0 ? 'bad' : ''}">${Number(c.balance) ? inr(c.balance) : ''}</td></tr>`).join('')}</table>` : '<p class="muted">No customers.</p>';
    $$('#clist tr[data-id]').forEach((tr) => tr.addEventListener('click', () => customerCard(Number(tr.dataset.id), load)));
  };
  let t;
  $('#cq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  $('#cown').addEventListener('change', load);
  $('#cadd').addEventListener('click', () => customerCard(null, load));
  await load();
};

async function customerCard(id, onDone) {
  const c = id ? (await api(`/customers/${id}`)).customer : { name: '', phone: '', address: '', credit_limit: '0', balance: '0', ledger: [], bills: [] };
  const owes = Money.paise(c.balance) > 0;
  const remind = `Dear ${c.name},\nThis is a friendly reminder from *${App.settings.name}*. Your pending balance is *${inr(c.balance)}*.` +
    ` Please pay at the counter or by UPI${App.settings.upi_id ? ` (${App.settings.upi_id})` : ''} at your convenience.\n` +
    `அன்புடையீர், உங்கள் நிலுவைத் தொகை ${inr(c.balance)}. வசதியான நேரத்தில் செலுத்தவும்.\nThank you! 🙏`;
  const d = modal(`<h3>${id ? esc(c.name) : 'Add customer'}</h3>
    <form id="cf"><div class="grid2"><div><label>Name</label><input name="name" value="${esc(c.name)}" required></div>
      <div><label>Mobile</label><input name="phone" value="${esc(c.phone || '')}" inputmode="tel"></div></div>
      <div class="grid2"><div><label>Address</label><input name="address" value="${esc(c.address || '')}"></div>
      <div><label>Credit limit ₹ (0 = no limit set)</label><input name="credit_limit" value="${esc(c.credit_limit)}" inputmode="decimal"></div></div>
      <div class="actions"><button type="button" data-close>Close</button><button class="primary">Save</button></div></form>
    ${id ? `<p class="small">Online shop account: ${c.online ? `<b>yes</b>${c.verified ? ', phone verified' : ''}` : 'none'}
      ${c.phone ? ' · <button type="button" id="cpw" class="small">Set online password</button>' : ''}</p>` : ''}
    ${id && App.settings.loyalty_enabled === '1' ? `<h3 style="margin-top:10px">Loyalty points: ${Number(c.points)}
      <span class="small muted">(worth ${inr((Number(c.points) * Number(App.settings.loyalty_point_value || 0)).toFixed(2))})</span></h3>
      ${can('settings') ? '<button type="button" id="cpts" class="small">Add / take away points</button>' : ''}
      ${c.points_log && c.points_log.length ? `<div style="max-height:150px;overflow:auto;margin-top:6px"><table>${c.points_log.map((l) => `<tr><td class="small">${esc(l.at.slice(0, 16))}</td>
        <td>${esc({ earn: 'Earned', redeem: 'Used', return: 'Return', adjust: 'Adjusted', refer: 'Friend joined and bought' }[l.kind] || l.kind)}</td><td class="small">${esc(l.ref)}</td>
        <td class="r ${Number(l.points) < 0 ? 'bad' : 'ok'}">${Number(l.points) > 0 ? '+' : ''}${Number(l.points)}</td></tr>`).join('')}</table></div>` : ''}` : ''}
    ${id ? `<h3 style="margin-top:10px">Owes: <span class="${owes ? 'bad' : 'ok'}">${inr(c.balance)}</span></h3>
      ${owes && can('cash') ? `<form id="cpay" class="row"><input name="amount" inputmode="decimal" placeholder="Amount ₹" style="width:120px" required>
        <select name="method" style="width:110px"><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select>
        <button class="primary">Payment received</button></form>` : ''}
      ${owes && c.phone ? `<a class="btn" style="margin-top:8px" target="_blank" rel="noopener" href="${esc(waLink(c.phone, remind))}">WhatsApp reminder</a>` : ''}
      <div style="max-height:220px;overflow:auto;margin-top:10px"><table>${c.ledger.map((l) => `<tr><td class="small">${esc(l.at.slice(0, 16))}</td>
        <td>${esc({ sale: 'Bought on credit', payment: `Paid ${l.method.toUpperCase()}`, return: 'Return', adjust: 'Adjusted' }[l.kind] || l.kind)}</td>
        <td class="small">${esc(l.ref)}</td><td class="r">${inr(l.amount)}</td></tr>`).join('')}</table></div>
      <h3>Recent bills</h3><div style="max-height:160px;overflow:auto"><table>${c.bills.map((b) => `<tr class="click" data-b="${b.id}"><td>${esc(b.bill_no)}</td>
        <td>${esc(b.created_at.slice(0, 16))}</td><td class="r">${inr(b.total)}</td></tr>`).join('')}</table></div>` : ''}`);
  $('#cf', d).addEventListener('submit', (e) => { e.preventDefault(); submitting($('button.primary', e.target), async () => {
    await api('/customers', { method: 'POST', body: { ...formData(e.target), id } });
    toast('Saved.'); d.close(); if (onDone) onDone();
  }); });
  if ($('#cpts', d)) $('#cpts', d).addEventListener('click', () => submitting($('#cpts', d), async () => {
    const pts = prompt(`Points to add for ${c.name} (use minus to take away, e.g. -20):`);
    if (!pts) return;
    const reason = prompt('Reason (e.g. old loyalty card, mistake):');
    if (!reason) return;
    await api(`/customers/${id}/points`, { method: 'POST', body: { points: pts, reason } });
    toast('Points updated.'); d.close(); customerCard(id, onDone);
  }));
  if ($('#cpw', d)) $('#cpw', d).addEventListener('click', () => submitting($('#cpw', d), async () => {
    const pw = prompt(`New online-shop password for ${c.name} (${c.phone}). At least 6 characters. Tell it to the customer:`);
    if (!pw) return;
    await api(`/customers/${id}/online-password`, { method: 'POST', body: { password: pw } });
    toast('Password set. The customer logs in with the mobile number and this password.');
  }));
  if ($('#cpay', d)) $('#cpay', d).addEventListener('submit', (e) => { e.preventDefault(); submitting($('button', e.target), async () => {
    const r = await api('/customers/pay', { method: 'POST', body: { ...formData(e.target), customer_id: id, counter: myCounter() } });
    toast(`Saved. Still owes ${inr(r.balance)}.`); d.close(); if (onDone) onDone();
  }); });
  $$('[data-b]', d).forEach((tr) => tr.addEventListener('click', () => showBill(tr.dataset.b)));
}

// ================================================================== Purchases & suppliers
App.views.purchases = async (main) => {
  const tab = hashParam('tab') || 'new';
  main.innerHTML = `<h1>Purchases & suppliers</h1>${tabs([['new', '+ Goods received (supplier bill)'], ['list', 'Purchase bills'], ['suppliers', 'Suppliers']], tab, 'purchases')}<div id="pbody"></div>`;
  const body = $('#pbody');
  const { suppliers } = await api('/suppliers?all=1');
  if (tab === 'suppliers') return supplierList(body, suppliers);
  if (tab === 'list') {
    const { purchases } = await api('/purchases');
    body.innerHTML = purchases.length ? `<table><tr><th>GRN</th><th>Date</th><th>Supplier</th><th>Bill no.</th><th class="r">Lines</th><th class="r">Total</th></tr>
      ${purchases.map((p) => `<tr class="click" data-id="${p.id}"><td>${esc(p.grn_no)}</td><td>${esc(p.created_at.slice(0, 10))}</td><td>${esc(p.supplier)}</td>
      <td>${esc(p.bill_ref)}</td><td class="r">${p.line_count}</td><td class="r">${inr(p.total)}</td></tr>`).join('')}</table>` : '<p class="muted">No purchases yet.</p>';
    $$('tr[data-id]', body).forEach((tr) => tr.addEventListener('click', async () => {
      const { purchase: p } = await api(`/purchases/${tr.dataset.id}`);
      modal(`<h3>${esc(p.grn_no)} · ${esc(p.supplier)}</h3><p>Bill ${esc(p.bill_ref)} ${esc(p.bill_date || '')} · by ${esc(p.who)}</p>
        <table><tr><th>Product</th><th class="r">Qty</th><th class="r">Free</th><th class="r">Cost/unit</th><th>Expiry</th><th class="r">Amount</th></tr>
        ${p.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="r">${esc(l.qty)}</td><td class="r">${esc(l.free_qty)}</td><td class="r">${esc(Number(l.cost).toFixed(2))}</td>
        <td>${esc(l.expiry || '')}</td><td class="r">${inr(l.amount)}</td></tr>`).join('')}<tr><td colspan="5"><b>Total</b></td><td class="r"><b>${inr(p.total)}</b></td></tr></table>
        <div class="actions"><button data-close>Close</button></div>`);
    }));
    return undefined;
  }
  // new goods received
  const lines = [];
  body.innerHTML = `<div class="card"><div class="grid3"><div><label>Supplier</label><select id="psup"><option value="">Choose…</option>
      ${suppliers.filter((s) => s.active).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
      <a href="#/purchases?tab=suppliers" class="small">+ new supplier</a></div>
    <div><label>Supplier's bill number</label><input id="pref"></div><div><label>Bill date</label><input id="pdate" type="date" value="${today()}"></div></div>
    <label>Add product (name, barcode or SKU)</label><input id="pq" placeholder="Type or scan…" autocomplete="off"><div class="results" id="pres" hidden></div>
    <div id="plines" style="margin-top:10px"></div>
    <div class="row" style="justify-content:space-between;margin-top:10px"><span class="muted small">Cost per unit = amount ÷ (qty + free). Free goods lower the cost.</span>
      <b id="ptot">₹0.00</b></div>
    <button class="primary big" id="psave" style="margin-top:10px">Save purchase</button></div>`;
  const draw = () => {
    $('#plines').innerHTML = lines.length ? `<table><tr><th>Product</th><th>Qty</th><th>Free</th><th>Rate ₹</th><th>Amount ₹</th><th>Expiry</th><th>New selling price</th><th></th></tr>
      ${lines.map((l, i) => `<tr data-i="${i}"><td>${esc(l.name)}<div class="small muted">stock ${esc(l.on_hand)} ${esc(l.unit)} · now ₹${esc(l.cur_price || '-')}</div></td>
      <td><input data-k="qty" value="${esc(l.qty)}" inputmode="decimal" style="width:70px"></td><td><input data-k="free_qty" value="${esc(l.free_qty)}" inputmode="decimal" style="width:60px"></td>
      <td><input data-k="rate" value="${esc(l.rate)}" inputmode="decimal" style="width:80px"></td><td><input data-k="amount" value="${esc(l.amount)}" inputmode="decimal" style="width:90px"></td>
      <td><input data-k="expiry" type="date" value="${esc(l.expiry)}" style="width:140px"></td><td><input data-k="price" value="${esc(l.price)}" inputmode="decimal" style="width:80px"></td>
      <td><button class="danger icon-btn" data-del="${i}" title="Remove">${ico('x')}</button></td></tr>`).join('')}</table>` : '<p class="muted">No products added yet.</p>';
    $$('#plines input').forEach((inp) => inp.addEventListener('input', () => {
      const l = lines[Number(inp.closest('tr').dataset.i)];
      l[inp.dataset.k] = inp.value;
      if (inp.dataset.k === 'rate' || inp.dataset.k === 'qty') {
        const r = Money.paise(l.rate); const q = Money.milli(l.qty);
        if (r !== null && q) { l.amount = Money.rs(Money.line(r, q)); inp.closest('tr').querySelector('[data-k=amount]').value = l.amount; }
      }
      total();
    }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => { lines.splice(Number(b.dataset.del), 1); draw(); }));
    total();
  };
  const total = () => { $('#ptot').textContent = `Total ${inr(lines.reduce((s, l) => s + (Money.paise(l.amount) || 0), 0))}`; };
  let t;
  $('#pq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
    const q = $('#pq').value.trim();
    if (q.length < 2) { $('#pres').hidden = true; return; }
    const { items } = await api(`/products?q=${encodeURIComponent(q)}`);
    $('#pres').hidden = !items.length;
    $('#pres').innerHTML = items.slice(0, 15).map((i) => `<div data-id="${i.id}"><span>${esc(i.name)}</span><span class="muted small">${esc(i.on_hand)} ${esc(i.unit)}</span></div>`).join('');
    $$('#pres div').forEach((row) => row.addEventListener('click', () => {
      const i = items.find((x) => x.id === Number(row.dataset.id));
      lines.push({ item_id: i.id, name: i.name, unit: i.unit, on_hand: i.on_hand, cur_price: i.price, qty: '', free_qty: '', rate: Number(i.cost) ? Number(i.cost).toFixed(2) : '', amount: '', expiry: '', price: '' });
      $('#pq').value = ''; $('#pres').hidden = true; draw();
      $$('#plines tr[data-i]').pop().querySelector('[data-k=qty]').focus();
    }));
  }, 250); });
  $('#psave').addEventListener('click', () => submitting($('#psave'), async () => {
    const r = await api('/purchases', { method: 'POST', body: { supplier_id: $('#psup').value, bill_ref: $('#pref').value, bill_date: $('#pdate').value,
      lines: lines.map((l) => ({ ...l, rate: l.amount ? undefined : l.rate })) } });
    toast(`${r.grn_no} saved: ${inr(r.total)}. Stock updated.`);
    location.hash = '#/purchases?tab=list';
  }));
  draw();
  return undefined;
};

function supplierList(body, suppliers) {
  body.innerHTML = `<button class="primary" id="sadd" style="margin-bottom:10px">+ Add supplier</button>
    <table><tr><th>Supplier</th><th>Phone</th><th class="hide-sm">GSTIN</th><th class="hide-sm">Last bill</th><th class="r">We owe</th></tr>
    ${suppliers.map((s) => `<tr class="click" data-id="${s.id}"><td>${esc(s.name)}${s.active ? '' : ' <span class="pill off">off</span>'}</td><td>${esc(s.phone)}</td>
    <td class="hide-sm">${esc(s.gstin)}</td><td class="hide-sm">${esc((s.last_purchase || '').slice(0, 10))}</td>
    <td class="r ${Number(s.balance) > 0 ? 'warn' : ''}">${inr(s.balance)}</td></tr>`).join('')}</table>`;
  const edit = async (s) => {
    const led = s ? await api(`/suppliers/${s.id}`) : null;
    const d = modal(`<h3>${s ? esc(s.name) : 'Add supplier'}</h3><form id="sf">
      <div class="grid2"><div><label>Name</label><input name="name" value="${esc(s ? s.name : '')}" required></div><div><label>Phone</label><input name="phone" value="${esc(s ? s.phone : '')}"></div></div>
      <div class="grid2"><div><label>GSTIN</label><input name="gstin" value="${esc(s ? s.gstin : '')}"></div><div><label>Address</label><input name="address" value="${esc(s ? s.address : '')}"></div></div>
      <label class="row" style="font-weight:400"><input type="checkbox" name="active" style="width:auto" ${!s || s.active ? 'checked' : ''}> Active</label>
      <div class="actions"><button type="button" data-close>Close</button><button class="primary">Save</button></div></form>
      ${led ? `<h3>We owe: ${inr(led.balance)}</h3>${can('supplier_pay') ? `<form id="spay" class="row"><input name="amount" placeholder="₹" inputmode="decimal" style="width:110px" required>
        <select name="method" style="width:170px"><option value="cash">Cash from this counter</option><option value="upi">UPI</option><option value="bank">Bank / cheque</option></select>
        <input name="reference" placeholder="Ref." style="width:120px"><button class="primary">Pay</button></form>` : ''}
        <div style="max-height:220px;overflow:auto;margin-top:8px"><table>${led.rows.map((r) => `<tr><td class="small">${esc(String(r.at).slice(0, 10))}</td><td>${r.kind === 'bill' ? 'Bill' : 'Paid'}</td>
        <td class="small">${esc(r.ref)} ${esc(r.note || '')}</td><td class="r">${inr(r.amount)}</td></tr>`).join('')}</table></div>` : ''}`);
    $('#sf', d).addEventListener('submit', (e) => { e.preventDefault(); submitting($('button.primary', e.target), async () => {
      await api('/suppliers', { method: 'POST', body: { ...formData(e.target), id: s ? s.id : undefined } });
      toast('Saved.'); d.close(); route();
    }); });
    if ($('#spay', d)) $('#spay', d).addEventListener('submit', (e) => { e.preventDefault(); submitting($('button', e.target), async () => {
      await api('/suppliers/pay', { method: 'POST', body: { ...formData(e.target), supplier_id: s.id, counter: myCounter() } });
      toast('Payment saved.'); d.close(); route();
    }); });
  };
  $('#sadd').addEventListener('click', () => edit(null));
  $$('tr[data-id]', body).forEach((tr) => tr.addEventListener('click', () => edit(suppliers.find((s) => s.id === Number(tr.dataset.id)))));
}

// ================================================================== Reports
App.views.reports = async (main) => {
  const period = hashParam('period');
  const name = hashParam('r') || '';
  let from = hashParam('from');
  let to = hashParam('to');
  if (!from || period) {
    const r0 = await api(`/reports?period=${period || 'month'}`);
    from = r0.summary.from; to = r0.summary.to;
  }
  const { list, summary: s } = await api(`/reports?from=${from}&to=${to}`);
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Reports</h1><form id="rr" class="row">
      <input type="date" name="from" value="${from}" style="width:160px"> to <input type="date" name="to" value="${to}" style="width:160px">
      <button class="primary">Show</button></form></div>
    ${periodChips(period || '', `reports${name ? `?r=${name}` : ''}`)}
    <div class="card plain" style="margin-bottom:12px">From <b>${esc(from)}</b> to <b>${esc(to)}</b> the shop sold <b>${inr(s.sales)}</b> in <b>${s.bills}</b> bills
      (on average <b>${inr(s.avg_bill)}</b> per bill). After returns of ${inr(s.returns)} the sales are <b>${inr(s.net)}</b>.
      The goods sold cost ${inr(s.cost)}, so the gross profit is <b class="ok">${inr(s.margin)}</b> (${s.margin_pct}%).
      Expenses were ${inr(s.expenses)}, leaving a net profit of <b class="${Number(s.net_profit) < 0 ? 'bad' : 'ok'}">${inr(s.net_profit)}</b>.</div>
    <div class="cards">
      <div class="card stat"><div class="l">Net sales (after returns)</div><div class="v">${inr(s.net)}</div><div class="l">${s.bills} bills · avg ${inr(s.avg_bill)}</div></div>
      <div class="card stat"><div class="l">Gross margin</div><div class="v">${inr(s.margin)}</div><div class="l">${s.margin_pct}% of sales</div></div>
      <div class="card stat"><div class="l">Cash · UPI · Card · Credit</div><div class="small">${inr(s.cash)} · ${inr(s.upi)} · ${inr(s.card)} · ${inr(s.credit)}</div>
        <div class="l">Returns ${inr(s.returns)} · Discounts ${inr(s.discount)}</div></div>
      <div class="card stat"><div class="l">Purchases · Written off</div><div class="small">${inr(s.purchases)} · ${inr(s.wastage)}</div></div></div>
    <div class="cats">${list.map((x) => `<a class="btn ${x.name === name ? 'primary' : ''}" href="#/reports?from=${from}&to=${to}&r=${x.name}">${esc(x.title)}</a>`).join('')}</div>
    <div id="rout" style="margin-top:12px"></div>`;
  const go = (f, t) => { location.hash = `#/reports?from=${f}&to=${t}${name ? `&r=${name}` : ''}`; };
  $('#rr').addEventListener('submit', (e) => { e.preventDefault(); go(e.target.from.value, e.target.to.value); });
  if (!name) return;
  const r = await api(`/reports/${name}?from=${from}&to=${to}`);
  const cols = r.rows.length ? Object.keys(r.rows[0]) : [];
  const money = (k) => /sales|returns|net|cash|upi|card|credit|margin|taxable|cgst|sgst|total|value|amount|balance|bills$|paid|discount|float|expected|counted|variance|gross|spent/.test(k) && !/^bills$/.test(k);
  $('#rout').innerHTML = `<div class="row" style="justify-content:space-between"><h2>${esc(r.title)} · ${esc(r.from)} to ${esc(r.to)}</h2>
    <a class="btn" href="/api/reports/${name}?from=${from}&to=${to}&format=csv">${ico('download')} Excel (CSV)</a></div>
    ${r.rows.length ? `<div style="overflow:auto"><table><tr>${cols.map((c) => `<th class="${money(c) ? 'r' : ''}">${esc(c.replace(/_/g, ' '))}</th>`).join('')}</tr>
    ${r.rows.map((row) => `<tr>${cols.map((c) => `<td class="${money(c) ? 'r' : ''}">${money(c) && row[c] !== null && /^-?\d+(\.\d+)?$/.test(String(row[c])) ? inr(String(row[c])) : esc(row[c] ?? '')}</td>`).join('')}</tr>`).join('')}</table></div>`
    : '<p class="muted">Nothing in this period.</p>'}`;
};

// ================================================================== Owner tools
App.views.owner = async (main) => {
  const tab = hashParam('tab') || 'day';
  const T = [['day', 'Summary on WhatsApp'], ['prices', "Today's prices"], ['offers', 'Offers'], ['expenses', 'Expenses'], ['board', 'Price board'],
    ['labels', 'Barcode labels'], ['buy', 'Buy list']];
  if (can('reports')) T.push(['loss', 'Loss watch']);
  main.innerHTML = `<h1>Daily tools</h1>${tabs(T, tab, 'owner')}<div id="obody"></div>`;
  const body = $('#obody');
  if (tab === 'day') {
    const period = hashParam('period') || 'today';
    const { text, owner_whatsapp: ownerNo } = await api(`/owner/day?period=${period}`);
    body.innerHTML = `<div class="card" style="max-width:680px">${periodChips(period, 'owner?tab=day')}
      <label>Send to (owner's WhatsApp)</label><input id="dph" inputmode="tel" value="${esc(ownerNo || localStorage.getItem('mpc_owner_phone') || '')}">
      <pre style="white-space:pre-wrap;font-family:inherit;background:#f7f9fc;padding:12px;border-radius:10px">${esc(text)}</pre>
      <div class="row"><a class="btn primary big" id="dwa" target="_blank" rel="noopener">Send on WhatsApp</a><button id="dcopy">Copy text</button></div></div>`;
    const upd = () => { localStorage.setItem('mpc_owner_phone', $('#dph').value); $('#dwa').href = waLink($('#dph').value, text); };
    $('#dph').addEventListener('input', upd); upd();
    $('#dcopy').addEventListener('click', async () => { await navigator.clipboard.writeText(text); toast('Copied.'); });
  }
  if (tab === 'prices') {
    const cat = decodeURIComponent(hashParam('cat') || '');
    const q = decodeURIComponent(hashParam('q') || '');
    const { items, cats } = await api(`/owner/prices?cat=${encodeURIComponent(cat)}&q=${encodeURIComponent(q)}`);
    body.innerHTML = `<div class="row" style="margin-bottom:10px">
      <input id="pfind" placeholder="Scan barcode or type a name, Enter" value="${esc(q)}" style="max-width:280px">
      <select id="pcat" style="max-width:240px"><option value="">Loose items (sold by kg)</option>${cats.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      ${can('products') ? '<button id="padd2">+ Add product</button>' : ''}
      <button class="primary" id="psave">Save changes</button></div>
      <p class="small muted">Type the new rate and press Enter for the next. A changed price turns <b class="bad">red</b> until you press Save; saved prices turn <b class="ok">green</b>.</p>
      <div class="tablewrap"><table><tr><th>Product</th><th class="r hide-sm">Cost</th><th class="r hide-sm">Stock</th><th>Price ₹</th></tr>${items.map((i) => `<tr><td>${esc(i.name)}<div class="small ta muted">${esc(i.name_ta)}</div></td>
      <td class="r hide-sm">${Number(i.cost) ? inr(Money.paise(Number(i.cost).toFixed(2))) : ''}</td><td class="r hide-sm">${esc(i.on_hand)} ${esc(i.unit)}</td>
      <td><input class="price-in" data-id="${i.id}" data-old="${esc(i.price ?? '')}" value="${esc(i.price ?? '')}" inputmode="decimal" style="width:110px"> ${i.unit === 'kg' ? '/kg' : ''}</td></tr>`).join('')
        || '<tr><td class="muted">Nothing found.</td></tr>'}</table></div>`;
    $('#pcat').addEventListener('change', (e) => { location.hash = `#/owner?tab=prices&cat=${encodeURIComponent(e.target.value)}`; });
    $('#pfind').addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = `#/owner?tab=prices&q=${encodeURIComponent(e.target.value.trim())}`; });
    if ($('#padd2')) $('#padd2').addEventListener('click', () => productDialog(null, () => route()));
    const inputs = $$('input[data-id]', body);
    const mark = (inp) => { inp.classList.toggle('changed', inp.value !== inp.dataset.old); inp.classList.remove('saved'); };
    inputs.forEach((inp, i) => {
      inp.addEventListener('input', () => mark(inp));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (inputs[i + 1] || $('#psave')).focus(); } });
    });
    $('#psave').addEventListener('click', () => submitting($('#psave'), async () => {
      const changed = inputs.filter((i) => i.value !== i.dataset.old);
      if (!changed.length) throw new Error('No price was changed.');
      const r = await api('/owner/prices', { method: 'POST', body: { changes: changed.map((i) => ({ id: Number(i.dataset.id), price: i.value })) } });
      changed.forEach((i) => { i.dataset.old = i.value; i.classList.remove('changed'); i.classList.add('saved'); });
      toast(`${r.changed} prices saved. Counters get them within 5 minutes.`);
    }));
  }
  if (tab === 'board') {
    // Price board: every product as a big card; tick the ones to print; they print one after another on the bill printer.
    const cat = decodeURIComponent(hashParam('cat') || '');
    const q = decodeURIComponent(hashParam('q') || '');
    const { items, cats } = await api(`/owner/prices?cat=${encodeURIComponent(cat)}&q=${encodeURIComponent(q)}`);
    const picked = new Set(JSON.parse(sessionStorage.getItem('mpc_board') || '[]'));
    body.innerHTML = `<div class="row" style="margin-bottom:10px">
      <input id="bfind" placeholder="Scan barcode or type a name, Enter" value="${esc(q)}" style="max-width:260px">
      <select id="bcat" style="max-width:220px"><option value="">Loose items (sold by kg)</option>${cats.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <button id="ball">Select all shown</button><button id="bnone">Clear</button>
      <button class="primary big" id="bprint">${ico('printer')} Print selected (<span id="bn">0</span>)</button></div>
      <div class="boards">${items.filter((i) => i.price).map((i) => `<button class="board ${picked.has(i.id) ? 'on' : ''}" data-id="${i.id}">
        <span class="bn">${esc(i.name)}</span><span class="bt ta">${esc(i.name_ta)}</span>
        <span class="bp">₹${esc(Number(i.price) % 1 ? Number(i.price).toFixed(2) : Number(i.price).toFixed(0))}<small>${i.unit === 'kg' ? '/kg' : ''}</small></span></button>`).join('') || '<p class="muted">Nothing found.</p>'}</div>`;
    const count = () => { $('#bn').textContent = picked.size; sessionStorage.setItem('mpc_board', JSON.stringify([...picked])); };
    $$('.board', body).forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.id);
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      b.classList.toggle('on'); count();
    }));
    $('#ball').addEventListener('click', () => { $$('.board', body).forEach((b) => { picked.add(Number(b.dataset.id)); b.classList.add('on'); }); count(); });
    $('#bnone').addEventListener('click', () => { picked.clear(); $$('.board', body).forEach((b) => b.classList.remove('on')); count(); });
    $('#bcat').addEventListener('change', (e) => { location.hash = `#/owner?tab=board&cat=${encodeURIComponent(e.target.value)}`; });
    $('#bfind').addEventListener('keydown', (e) => { if (e.key === 'Enter') location.hash = `#/owner?tab=board&q=${encodeURIComponent(e.target.value.trim())}`; });
    $('#bprint').addEventListener('click', async () => {
      if (!picked.size) { toast('Tap the products to print first.', true); return; }
      const all = new Map(items.map((i) => [i.id, i]));
      const missing = [...picked].filter((id) => !all.has(id));
      for (const id of missing) { try { const r = await api(`/products/${id}`); all.set(id, r.item); } catch (_) { /* gone */ } }
      const date = new Date().toLocaleDateString('en-IN');
      $('#print-area').innerHTML = [...picked].map((id) => all.get(id)).filter(Boolean).map((i) => `<div class="pricelabel">
        <div class="pl-shop">${esc(App.settings.name)}</div><div class="pl-name">${esc(i.name)}</div><div class="pl-ta ta">${esc(i.name_ta)}</div>
        <div class="pl-price">₹${esc(Number(i.price) % 1 ? Number(i.price).toFixed(2) : Number(i.price).toFixed(0))}${i.unit === 'kg' ? '<span>/kg</span>' : ''}</div>
        ${i.mrp && Number(i.mrp) > Number(i.price) ? `<div class="pl-mrp">MRP ₹${esc(Number(i.mrp).toFixed(0))} · Save ₹${esc((Number(i.mrp) - Number(i.price)).toFixed(0))}</div>` : ''}
        <div class="pl-date">${esc(date)}</div></div>`).join('');
      setTimeout(() => window.print(), 50);
    });
    count();
  }
  if (tab === 'offers') await offersTab(body);
  if (tab === 'expenses') await expensesTab(body);
  if (tab === 'labels') await labelsTab(body);
  if (tab === 'buy') {
    const days = hashParam('days') || '7';
    const { groups } = await api(`/owner/buylist?days=${days}`);
    body.innerHTML = `<div class="row" style="margin-bottom:10px">Based on sales of the last <select id="bdays" style="width:90px">${[3, 7, 14, 30].map((n) => `<option ${String(n) === days ? 'selected' : ''}>${n}</option>`).join('')}</select> days.
      <span class="small muted">Fresh items: stock for 1 day; packed goods: 7 days. Never below the reorder level.</span></div>
      ${groups.length ? groups.map((g, gi) => `<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(g.supplier)}</h2>
        <div class="row"><b>≈ ${inr(g.value)}</b>${g.phone ? `<a class="btn primary" target="_blank" rel="noopener" href="${esc(waLink(g.phone, g.message))}">WhatsApp order</a>` : ''}
        <button data-print="${gi}">Print</button></div></div>
        <table><tr><th>Product</th><th class="r">Stock</th><th class="r">Sells / day</th><th class="r">Days left</th><th class="r">Buy</th></tr>
        ${g.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${esc(r.stock)}</td><td class="r">${esc(r.per_day)}</td>
        <td class="r ${r.days_left !== null && Number(r.days_left) < 1 ? 'bad' : ''}">${esc(r.days_left ?? '-')}</td><td class="r"><b>${esc(r.qty)} ${esc(r.unit)}</b></td></tr>`).join('')}</table></div>`).join('')
      : '<p class="muted">Nothing to buy: stock covers the expected sales.</p>'}`;
    $('#bdays').addEventListener('change', (e) => { location.hash = `#/owner?tab=buy&days=${e.target.value}`; });
    $$('[data-print]').forEach((b) => b.addEventListener('click', () => {
      const g = groups[Number(b.dataset.print)];
      $('#print-area').innerHTML = `<div class="receipt"><pre style="white-space:pre-wrap;font-family:inherit">${esc(g.message)}</pre></div>`;
      setTimeout(() => window.print(), 50);
    }));
  }
  if (tab === 'loss') {
    const from = hashParam('from') || today();
    const to = hashParam('to') || today();
    const { rows } = await api(`/owner/losswatch?from=${from}&to=${to}`);
    body.innerHTML = `<form id="lf" class="row" style="margin-bottom:10px"><input type="date" name="from" value="${from}" style="width:160px"> to
      <input type="date" name="to" value="${to}" style="width:160px"><button class="primary">Show</button></form>
      <p class="small muted">Actions that can hide a loss, per person. A flag is not proof. Check the bill, the reason and the CCTV time.</p>
      ${rows.length ? `<table><tr><th>Staff</th><th class="r">Bills</th><th class="r">Sales</th><th class="r">Cancelled</th><th class="r">Price changes</th><th class="r">Discounts</th>
        <th class="r">Refunds</th><th class="r">Reprints</th><th class="r">Cash diff.</th><th>Needs a look</th></tr>
        ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${r.bills}</td><td class="r">${inr(r.sales)}</td><td class="r">${r.bill_cancel}</td>
        <td class="r">${r.overrides}</td><td class="r">${inr(r.discounts_value)}</td><td class="r">${inr(r.refunds_value)}</td><td class="r">${r.reprint}</td>
        <td class="r ${Number(r.variance) < 0 ? 'bad' : ''}">${inr(r.variance)}</td>
        <td>${r.flags.length ? r.flags.map((f) => `<div class="bad small">${esc(f)}</div>`).join('') : '<span class="ok small">OK</span>'}</td></tr>`).join('')}</table>` : '<p class="muted">No activity.</p>'}`;
    $('#lf').addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/owner?tab=loss&from=${e.target.from.value}&to=${e.target.to.value}`; });
  }
};


// ================================================================== Offers: a special price between two dates
async function pickProduct(input, onPick) {
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    const { items } = await api(`/products?q=${encodeURIComponent(v)}`);
    const it = items.find((x) => x.codes.includes(v) || x.sku === v) || (items.length === 1 ? items[0] : null);
    if (it) { input.value = ''; onPick(it); return; }
    if (!items.length) { toast('Not found.', true); return; }
    const d = modal(`<h3>Choose the product</h3><div class="results">${items.slice(0, 20).map((x) => `<div data-id="${x.id}"><span>${esc(x.name)}</span><b>${inr(x.price || 0)}</b></div>`).join('')}</div>
      <div class="actions"><button data-close>Close</button></div>`);
    $$('[data-id]', d).forEach((row) => row.addEventListener('click', () => { d.close(); input.value = ''; onPick(items.find((x) => x.id === Number(row.dataset.id))); }));
  });
}

async function offersTab(body) {
  const [{ offers }, info] = await Promise.all([api('/offers'), api('/shop/info').catch(() => ({ cats: [] }))]);
  body.innerHTML = `<div class="card" style="margin-bottom:12px"><h2 style="margin-top:0">Offer on a whole category (festival offer)</h2>
      <p class="small muted" style="margin-top:0">Every product in the category gets this discount on its selling price for these dates, at the counters and online.
        The selling price comes back by itself after the last day.</p>
      <div class="grid3"><div><label>Category</label><select id="bcat"><option value="">All products</option>
        ${(info.cats || []).map((c) => `<option value="${c.id}">${esc(c.name)} (${c.items})</option>`).join('')}</select></div>
        <div><label>Discount %</label><input id="bpct" inputmode="decimal" placeholder="e.g. 5"></div>
        <div><label>From – to</label><div class="row" style="flex-wrap:nowrap"><input id="bfrom" type="date"><input id="bto" type="date"></div></div></div>
      <div class="row" style="margin-top:10px"><button class="primary" id="bsave">Apply discount</button><button class="danger" id="bclear">Remove offers in this category</button></div></div>
    <div class="card" style="margin-bottom:12px"><h2 style="margin-top:0">New offer</h2>
      <div class="grid3"><div><label>Product (scan or type, Enter)</label><input id="ofind" placeholder="Barcode or name"></div>
        <div><label>Offer price ₹, or % off</label><div class="row" style="flex-wrap:nowrap"><input id="oprice" inputmode="decimal" placeholder="₹"><input id="opct" inputmode="decimal" placeholder="%" style="width:80px"></div></div>
        <div><label>From – to (empty = no limit)</label><div class="row" style="flex-wrap:nowrap"><input id="ofrom" type="date"><input id="oto" type="date"></div></div></div>
      <div id="opick" class="muted small" style="margin-top:8px">Choose a product.</div>
      <button class="primary" id="osave" style="margin-top:10px">Save offer</button></div>
    <div class="tablewrap"><table><tr><th>Product</th><th class="r">Normal</th><th class="r">Offer</th><th>From</th><th>To</th><th>Status</th><th></th></tr>
    ${offers.map((o) => `<tr><td>${esc(o.name)}</td><td class="r">${inr(o.price || 0)}</td><td class="r"><b>${inr(o.offer_price)}</b></td>
      <td>${esc(o.offer_from || 'now')}</td><td>${esc(o.offer_to || 'no end')}</td><td><span class="state ${o.state}">${o.state}</span></td>
      <td class="r"><button class="danger" data-off="${o.id}">Stop</button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No offers.</td></tr>'}</table></div>`;
  $('#bsave').addEventListener('click', () => submitting($('#bsave'), async () => {
    const cat = $('#bcat');
    const label = cat.value ? cat.options[cat.selectedIndex].text : 'ALL products';
    if (!confirm(`Give ${$('#bpct').value || '?'}% off on ${label}?`)) return;
    const r = await api('/offers/bulk', { method: 'POST', body: { category_id: cat.value, percent: $('#bpct').value, offer_from: $('#bfrom').value, offer_to: $('#bto').value } });
    toast(`Offer set on ${r.count} products.`);
    route();
  }));
  $('#bclear').addEventListener('click', () => submitting($('#bclear'), async () => {
    const cat = $('#bcat');
    if (!confirm(`Remove all offers on ${cat.value ? cat.options[cat.selectedIndex].text : 'ALL products'}?`)) return;
    const r = await api('/offers/clear', { method: 'POST', body: { category_id: cat.value } });
    toast(`Offers removed from ${r.count} products.`);
    route();
  }));
  let item = null;
  pickProduct($('#ofind'), (it) => { item = it; $('#opick').innerHTML = `<b>${esc(it.name)}</b> · normal price ${inr(it.price || 0)}`; $('#oprice').focus(); });
  $('#osave').addEventListener('click', () => submitting($('#osave'), async () => {
    if (!item) throw new Error('Choose the product first.');
    await api('/offers', { method: 'POST', body: { item_id: item.id, offer_price: $('#oprice').value, percent: $('#opct').value, offer_from: $('#ofrom').value, offer_to: $('#oto').value } });
    toast('Offer saved. Counters and the online shop use it on those dates.');
    route();
  }));
  $$('[data-off]').forEach((b) => b.addEventListener('click', () => submitting(b, async () => {
    await api('/offers', { method: 'POST', body: { item_id: Number(b.dataset.off), offer_price: '' } }); route();
  })));
}

// ================================================================== Expenses
async function expensesTab(body) {
  const period = hashParam('period') || 'month';
  const x = await api(`/expenses?period=${period}`);
  body.innerHTML = `<div class="grid2"><form class="card" id="exf"><h2 style="margin-top:0">Add expense</h2>
      <div class="grid2"><div><label>Category</label><select name="category">${x.categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
        <div><label>Amount ₹</label><input name="amount" inputmode="decimal" required></div></div>
      <div class="grid2"><div><label>Paid by</label><select name="method"><option value="cash">Cash${myCounter() ? ` from ${esc(myCounter())} drawer` : ''}</option>
        <option value="upi">UPI</option><option value="bank">Bank / cheque</option></select></div><div><label>Date</label><input name="date" type="date" value="${today()}"></div></div>
      <label>Note</label><input name="note" placeholder="e.g. EB bill, helper salary">
      <button class="primary" style="margin-top:10px">Save</button></form>
    <div class="card"><h2 style="margin-top:0">Total ${inr(x.total)}</h2><p class="small muted">${esc(x.from)} to ${esc(x.to)}</p>
      ${x.by_category.map((c) => `<div class="row" style="justify-content:space-between"><span>${esc(c.category)}</span><b>${inr(c.total)}</b></div>`).join('') || '<p class="muted">No expenses.</p>'}</div></div>
    ${periodChips(period, 'owner?tab=expenses')}
    <div class="tablewrap"><table><tr><th>Date</th><th>Category</th><th>Note</th><th>Paid by</th><th>By</th><th class="r">Amount</th><th></th></tr>
    ${x.rows.map((e) => `<tr><td>${esc(e.business_date)}</td><td>${esc(e.category)}</td><td>${esc(e.note)}</td><td>${esc(e.method)}${e.shift_id ? ' (drawer)' : ''}</td>
      <td>${esc(e.who)}</td><td class="r">${inr(e.amount)}</td><td class="r">${can('reports') ? `<button class="icon-btn danger" data-del="${e.id}" title="Delete">${ico('x')}</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">None.</td></tr>'}</table></div>`;
  $('#exf').addEventListener('submit', (e) => { e.preventDefault(); submitting($('button.primary', e.target), async () => {
    const r = await api('/expenses', { method: 'POST', body: { ...formData(e.target), counter: myCounter() } });
    toast(r.from_drawer ? 'Saved. Taken from the drawer in cash closing.' : 'Saved.');
    route();
  }); });
  $$('[data-del]').forEach((b) => b.addEventListener('click', () => submitting(b, async () => {
    if (!confirm('Delete this expense?')) return;
    await api(`/expenses/${b.dataset.del}/delete`, { method: 'POST', body: {} }); route();
  })));
}

// ================================================================== Barcode labels (EAN-13 / EAN-8) for shop-packed goods, on the bill printer
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = EAN_L.map((p) => p.replace(/./g, (c) => (c === '0' ? '1' : '0')));
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function eanBits(code) {
  if (/^\d{12}$/.test(code)) code = `0${code}`;                    // UPC-A as EAN-13
  if (/^\d{13}$/.test(code)) {
    const par = EAN_PARITY[Number(code[0])];
    let b = '101';
    for (let i = 1; i <= 6; i++) b += (par[i - 1] === 'L' ? EAN_L : EAN_G)[Number(code[i])];
    b += '01010';
    for (let i = 7; i <= 12; i++) b += EAN_R[Number(code[i])];
    return `${b}101`;
  }
  if (/^\d{8}$/.test(code)) {
    let b = '101';
    for (let i = 0; i < 4; i++) b += EAN_L[Number(code[i])];
    b += '01010';
    for (let i = 4; i < 8; i++) b += EAN_R[Number(code[i])];
    return `${b}101`;
  }
  return null;
}
function barcodeSvg(code) {
  const bits = eanBits(code);
  if (!bits) return '';
  const rects = [];
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') rects.push(`<rect x="${i + 8}" y="0" width="1" height="50"/>`);
  return `<svg viewBox="0 0 ${bits.length + 16} 50" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><g fill="#000">${rects.join('')}</g></svg>`;
}

async function labelsTab(body) {
  const queue = JSON.parse(sessionStorage.getItem('mpc_labels') || '[]');
  const save = () => sessionStorage.setItem('mpc_labels', JSON.stringify(queue));
  const draw = () => {
    body.innerHTML = `<div class="card" style="margin-bottom:12px"><div class="grid2"><div><label>Product (scan or type, Enter)</label><input id="lfind" placeholder="Barcode or name"></div>
      <div><label>&nbsp;</label><div class="row"><button class="primary" id="lprint">${ico('printer')} Print labels</button><button id="lclear">Clear list</button></div></div></div>
      <p class="small muted" style="margin:8px 0 0">50 × 25 mm labels with name, price, MRP and barcode. Products without a barcode get a shop barcode (starts with 29)
      that scans at the counter. Set the label printer as the default printer, or print on the bill printer.</p></div>
      <div class="tablewrap"><table><tr><th>Product</th><th>Barcode</th><th class="r">Price</th><th>Copies</th><th></th></tr>
      ${queue.map((q, i) => `<tr><td>${esc(q.name)}</td><td>${esc(q.code)}</td><td class="r">${inr(q.price || 0)}</td>
        <td><input data-n="${i}" value="${q.n}" inputmode="numeric" style="width:70px"></td>
        <td class="r"><button class="icon-btn danger" data-x="${i}">${ico('x')}</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No products added.</td></tr>'}</table></div>`;
    pickProduct($('#lfind'), (it) => submitting(null, async () => {
      let code = it.codes.find((c) => eanBits(c));
      if (!code) code = (await api(`/products/${it.id}/barcode/internal`, { method: 'POST', body: {} })).code;
      queue.push({ id: it.id, name: it.name, price: it.price, mrp: it.mrp, unit: it.unit, code, n: 1 });
      save(); draw(); $('#lfind').focus();
    }));
    $$('[data-n]').forEach((inp) => inp.addEventListener('change', () => { queue[Number(inp.dataset.n)].n = Math.max(1, Math.min(200, Number(inp.value) || 1)); save(); }));
    $$('[data-x]').forEach((b) => b.addEventListener('click', () => { queue.splice(Number(b.dataset.x), 1); save(); draw(); }));
    $('#lclear').addEventListener('click', () => { queue.length = 0; save(); draw(); });
    $('#lprint').addEventListener('click', () => {
      if (!queue.length) { toast('Add products first.', true); return; }
      const html = queue.flatMap((q) => Array.from({ length: q.n }, () => `<div class="blabel"><div class="bl-n">${esc(q.name)}</div>
        <div class="bl-p"><span>${q.mrp && Number(q.mrp) > Number(q.price) ? `MRP ₹${esc(Number(q.mrp).toFixed(2))}` : esc(App.settings.name).slice(0, 22)}</span>
        <b>₹${esc(Number(q.price || 0).toFixed(2))}${q.unit === 'kg' ? '/kg' : ''}</b></div>${barcodeSvg(q.code)}<div class="bl-c">${esc(q.code)}</div></div>`)).join('');
      $('#print-area').innerHTML = `<div class="label-sheet">${html}</div>`;
      setTimeout(() => window.print(), 80);
    });
  };
  draw();
}
