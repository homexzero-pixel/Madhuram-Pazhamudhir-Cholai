/* Madhuram cloud – Stage 2 screens: online orders, returns, customers & credit, purchases & suppliers, reports, owner tools. */
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
    const link = $('.nav a[data-r="orders"]');
    if (link) link.innerHTML = `Online orders${b.new ? ` <span class="pill bad">${b.new}</span>` : ''}`;
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
  const { orders } = await api(`/orders?tab=${tab}`);
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Online orders</h1>
      <div class="row"><a class="btn" href="/shop/" target="_blank">Open customer page</a><button id="poster">QR poster for customers</button></div></div>
    ${App.settings.online_enabled !== '1' ? `<div class="notice">Online orders are switched off. Turn on in ${can('settings') ? '<a href="#/settings">Settings</a>' : 'Settings'} → Online orders.</div>` : ''}
    ${tabs([['open', 'To do'], ['done', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']], tab, 'orders')}
    ${orders.length ? `<table><tr><th>Order</th><th>Slot</th><th>Customer</th><th class="hide-sm">Type</th><th>Status</th><th class="r">Approx.</th></tr>
      ${orders.map((o) => `<tr class="click" data-id="${o.id}"><td><b>${esc(o.number)}</b><div class="small muted">${o.items} items</div></td>
      <td>${esc(o.slot_label)}</td><td>${esc(o.name)}<div class="small muted">${esc(o.phone)}</div></td>
      <td class="hide-sm">${o.mode === 'delivery' ? 'Delivery' : 'Takeaway'}</td>
      <td><span class="pill ${o.status === 'new' ? 'bad' : o.status === 'cancelled' ? 'off' : ''}">${esc(o.status_label)}</span></td>
      <td class="r">${inr(Money.paise(o.est_items) + Money.paise(o.delivery_charge))}</td></tr>`).join('')}</table>` : '<p class="muted">No orders here.</p>'}`;
  $$('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => orderDialog(Number(tr.dataset.id))));
  $('#poster').addEventListener('click', posterPrint);
  const t = setInterval(() => { if (!$('dialog') && document.visibilityState === 'visible') route(); }, 30000);
  App.leave = () => clearInterval(t);
};

async function orderDialog(id) {
  const { order: o, whatsapp } = await api(`/orders/${id}`);
  const open = ['new', 'accepted', 'ready', 'out'].includes(o.status);
  const d = modal(`<h3>${esc(o.number)} · ${esc(o.status_label)}</h3>
    <p><b>${esc(o.name)}</b> · ${esc(o.phone)} · ${o.mode === 'delivery' ? 'Home delivery' : 'Takeaway'}<br>${esc(o.slot_label)}
    ${o.address ? `<br>📍 ${esc(o.address)}` : ''}${o.notes ? `<br>Note: ${esc(o.notes)}` : ''}<br>Pays by ${o.pay_pref.toUpperCase()}
    ${o.bill_no ? `<br>Bill <b>${esc(o.bill_no)}</b> ${inr(o.bill_total)}` : ''}${o.status_note ? `<br><i>${esc(o.status_note)}</i>` : ''}</p>
    <table>${o.lines.map((l) => `<tr><td>${esc(l.name)}<div class="small ta muted">${esc(l.name_ta)}</div></td><td class="r">${esc(l.qty)} ${esc(l.unit)}</td>
      <td class="r">${inr(Money.line(Money.paise(l.price), Money.milli(l.qty)))}</td></tr>`).join('')}
      ${Number(o.delivery_charge) ? `<tr><td>Delivery charge</td><td></td><td class="r">${inr(o.delivery_charge)}</td></tr>` : ''}
      <tr><td><b>Approx. total</b></td><td></td><td class="r"><b>${inr(o.est_total)}</b></td></tr></table>
    <div class="actions" style="justify-content:flex-start">
      ${o.status === 'new' ? '<button class="primary" data-s="accepted">Accept – start packing</button>' : ''}
      ${open && o.mode === 'pickup' && o.status !== 'ready' ? '<button data-s="ready">Packed – ready for pickup</button>' : ''}
      ${open && o.mode === 'delivery' && o.status !== 'out' ? '<button data-s="out">Out for delivery</button>' : ''}
      ${open && can('bill') ? '<button class="primary" id="obill">Bill this order at this counter</button>' : ''}
      <a class="btn" target="_blank" rel="noopener" href="${esc(waLink(whatsapp.phone, whatsapp.text))}">WhatsApp the customer</a>
      <button id="opack">Print packing list</button>
      ${open ? '<button class="danger" data-s="cancelled">Cancel order</button>' : ''}
      <button data-close>Close</button></div>`);
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
    $('#print-area').innerHTML = `<div class="receipt"><h2>${esc(o.number)} – packing list</h2><div>${esc(o.name)} ${esc(o.phone)}</div>
      <div>${esc(o.slot_label)} · ${o.mode === 'delivery' ? 'DELIVERY' : 'TAKEAWAY'}</div>${o.address ? `<div>${esc(o.address)}</div>` : ''}<hr>
      <table>${o.lines.map((l) => `<tr><td>☐ ${esc(l.name)}<br><span class="ta">${esc(l.name_ta)}</span></td><td class="r">${esc(l.qty)} ${esc(l.unit)}</td></tr>`).join('')}</table>
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
    <button class="primary big" id="psave" style="margin-top:10px">Save – stock goes up</button></div>`;
  const draw = () => {
    $('#plines').innerHTML = lines.length ? `<table><tr><th>Product</th><th>Qty</th><th>Free</th><th>Rate ₹</th><th>Amount ₹</th><th>Expiry</th><th>New selling price</th><th></th></tr>
      ${lines.map((l, i) => `<tr data-i="${i}"><td>${esc(l.name)}<div class="small muted">stock ${esc(l.on_hand)} ${esc(l.unit)} · now ₹${esc(l.cur_price || '-')}</div></td>
      <td><input data-k="qty" value="${esc(l.qty)}" inputmode="decimal" style="width:70px"></td><td><input data-k="free_qty" value="${esc(l.free_qty)}" inputmode="decimal" style="width:60px"></td>
      <td><input data-k="rate" value="${esc(l.rate)}" inputmode="decimal" style="width:80px"></td><td><input data-k="amount" value="${esc(l.amount)}" inputmode="decimal" style="width:90px"></td>
      <td><input data-k="expiry" type="date" value="${esc(l.expiry)}" style="width:140px"></td><td><input data-k="price" value="${esc(l.price)}" inputmode="decimal" style="width:80px"></td>
      <td><button class="danger" data-del="${i}">✕</button></td></tr>`).join('')}</table>` : '<p class="muted">No products added yet.</p>';
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
  const from = hashParam('from') || `${today().slice(0, 8)}01`;
  const to = hashParam('to') || today();
  const name = hashParam('r') || '';
  const { list, summary: s } = await api(`/reports?from=${from}&to=${to}`);
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Reports</h1><form id="rr" class="row">
      <input type="date" name="from" value="${from}" style="width:160px"> to <input type="date" name="to" value="${to}" style="width:160px">
      <button class="primary">Show</button><button type="button" id="rtoday">Today</button><button type="button" id="rmonth">This month</button></form></div>
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
  $('#rtoday').addEventListener('click', () => go(today(), today()));
  $('#rmonth').addEventListener('click', () => go(`${today().slice(0, 8)}01`, today()));
  if (!name) return;
  const r = await api(`/reports/${name}?from=${from}&to=${to}`);
  const cols = r.rows.length ? Object.keys(r.rows[0]) : [];
  const money = (k) => /sales|returns|net|cash|upi|card|credit|margin|taxable|cgst|sgst|total|value|amount|balance|bills$|paid|discount|float|expected|counted|variance|gross|spent/.test(k) && !/^bills$/.test(k);
  $('#rout').innerHTML = `<div class="row" style="justify-content:space-between"><h2>${esc(r.title)} · ${esc(r.from)} to ${esc(r.to)}</h2>
    <a class="btn" href="/api/reports/${name}?from=${from}&to=${to}&format=csv">⬇ Download for Excel (CSV)</a></div>
    ${r.rows.length ? `<div style="overflow:auto"><table><tr>${cols.map((c) => `<th class="${money(c) ? 'r' : ''}">${esc(c.replace(/_/g, ' '))}</th>`).join('')}</tr>
    ${r.rows.map((row) => `<tr>${cols.map((c) => `<td class="${money(c) ? 'r' : ''}">${money(c) && row[c] !== null && /^-?\d+(\.\d+)?$/.test(String(row[c])) ? inr(String(row[c])) : esc(row[c] ?? '')}</td>`).join('')}</tr>`).join('')}</table></div>`
    : '<p class="muted">Nothing in this period.</p>'}`;
};

// ================================================================== Owner tools
App.views.owner = async (main) => {
  const tab = hashParam('tab') || 'day';
  main.innerHTML = `<h1>Owner tools</h1>${tabs([['day', 'Day summary on WhatsApp'], ['prices', "Today's prices"], ['buy', 'Buy list'], ['loss', 'Loss watch']], tab, 'owner')}<div id="obody"></div>`;
  const body = $('#obody');
  if (tab === 'day') {
    const date = hashParam('date') || today();
    const { text } = await api(`/owner/day?date=${date}`);
    body.innerHTML = `<div class="card" style="max-width:640px"><div class="row"><input type="date" id="dd" value="${date}" style="width:170px">
      <input id="dph" placeholder="Send to mobile (yours or a partner's)" value="${esc(localStorage.getItem('mpc_owner_phone') || '')}" style="flex:1"></div>
      <pre style="white-space:pre-wrap;font-family:inherit;background:#f7f9fc;padding:12px;border-radius:10px">${esc(text)}</pre>
      <div class="row"><a class="btn primary" id="dwa" target="_blank" rel="noopener">Send on WhatsApp</a><button id="dcopy">Copy text</button></div></div>`;
    const upd = () => { localStorage.setItem('mpc_owner_phone', $('#dph').value); $('#dwa').href = waLink($('#dph').value, text); };
    $('#dph').addEventListener('input', upd); upd();
    $('#dd').addEventListener('change', (e) => { location.hash = `#/owner?tab=day&date=${e.target.value}`; });
    $('#dcopy').addEventListener('click', async () => { await navigator.clipboard.writeText(text); toast('Copied.'); });
  }
  if (tab === 'prices') {
    const cat = decodeURIComponent(hashParam('cat') || '');
    const { items, cats } = await api(`/owner/prices?cat=${encodeURIComponent(cat)}`);
    body.innerHTML = `<div class="row" style="margin-bottom:10px"><select id="pcat" style="max-width:260px"><option value="">Loose items (sold by kg)</option>
      ${cats.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <button class="primary" id="psave">Save changed prices</button><button id="pboard">Print price board</button></div>
      <p class="small muted">Type the new rate and press Enter to go to the next. Only changed prices are saved; each change is recorded.</p>
      <table><tr><th>Product</th><th class="r hide-sm">Cost</th><th class="r hide-sm">Stock</th><th>Price ₹</th></tr>${items.map((i) => `<tr><td>${esc(i.name)}<div class="small ta muted">${esc(i.name_ta)}</div></td>
      <td class="r hide-sm">${Number(i.cost) ? inr(Money.paise(Number(i.cost).toFixed(2))) : ''}</td><td class="r hide-sm">${esc(i.on_hand)} ${esc(i.unit)}</td>
      <td><input data-id="${i.id}" data-old="${esc(i.price ?? '')}" value="${esc(i.price ?? '')}" inputmode="decimal" style="width:110px"> ${i.unit === 'kg' ? '/kg' : ''}</td></tr>`).join('')}</table>`;
    $('#pcat').addEventListener('change', (e) => { location.hash = `#/owner?tab=prices&cat=${encodeURIComponent(e.target.value)}`; });
    const inputs = $$('input[data-id]', body);
    inputs.forEach((inp, i) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (inputs[i + 1] || $('#psave')).focus(); } }));
    $('#psave').addEventListener('click', () => submitting($('#psave'), async () => {
      const changes = inputs.filter((i) => i.value !== i.dataset.old).map((i) => ({ id: Number(i.dataset.id), price: i.value }));
      if (!changes.length) throw new Error('No price was changed.');
      const r = await api('/owner/prices', { method: 'POST', body: { changes } });
      toast(`${r.changed} prices saved. Counters pick them up within 5 minutes (or press F5 on the counter).`);
      route();
    }));
    $('#pboard').addEventListener('click', () => {
      $('#print-area').innerHTML = `<div style="width:190mm;padding:10mm;font-family:'Segoe UI','Nirmala UI',sans-serif"><h1 style="text-align:center;margin:0">${esc(App.settings.name)}</h1>
        <h2 style="text-align:center;margin:2mm 0 6mm">Today's prices · இன்றைய விலை · ${new Date().toLocaleDateString('en-IN')}</h2>
        <table style="width:100%;font-size:20px">${items.filter((i) => i.price).map((i) => `<tr><td style="border-bottom:1px solid #999;padding:6px">${esc(i.name)}<br><span class="ta" style="font-size:17px">${esc(i.name_ta)}</span></td>
        <td style="border-bottom:1px solid #999;text-align:right;font-weight:800;font-size:26px">₹${esc(Number(i.price).toFixed(0))}${i.unit === 'kg' ? '<span style="font-size:15px">/kg</span>' : ''}</td></tr>`).join('')}</table></div>`;
      setTimeout(() => window.print(), 50);
    });
  }
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
      <p class="small muted">Actions that can hide a loss, per person. A flag is not proof – check the bill, the reason and the CCTV time.</p>
      ${rows.length ? `<table><tr><th>Staff</th><th class="r">Bills</th><th class="r">Sales</th><th class="r">Cancelled</th><th class="r">Price changes</th><th class="r">Discounts</th>
        <th class="r">Refunds</th><th class="r">Reprints</th><th class="r">Cash diff.</th><th>Needs a look</th></tr>
        ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="r">${r.bills}</td><td class="r">${inr(r.sales)}</td><td class="r">${r.bill_cancel}</td>
        <td class="r">${r.overrides}</td><td class="r">${inr(r.discounts_value)}</td><td class="r">${inr(r.refunds_value)}</td><td class="r">${r.reprint}</td>
        <td class="r ${Number(r.variance) < 0 ? 'bad' : ''}">${inr(r.variance)}</td>
        <td>${r.flags.length ? r.flags.map((f) => `<div class="bad small">⚠ ${esc(f)}</div>`).join('') : '<span class="ok small">OK</span>'}</td></tr>`).join('')}</table>` : '<p class="muted">No activity.</p>'}`;
    $('#lf').addEventListener('submit', (e) => { e.preventDefault(); location.hash = `#/owner?tab=loss&from=${e.target.from.value}&to=${e.target.to.value}`; });
  }
};
