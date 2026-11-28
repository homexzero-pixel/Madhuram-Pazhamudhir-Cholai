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

// ------------------------------------------------------------------ online orders: live alert on every staff screen
// New orders arrive by a live connection (Server-Sent Events) with a chime and a red count; a poll every 20 s backs it up.
let lastOrder = null;
let orderTimer = null;
let orderStream = null;
function chime() {
  try {
    const a = new AudioContext();
    [880, 1320, 1760].forEach((f, i) => { const o = a.createOscillator(); const g = a.createGain(); o.frequency.value = f; g.gain.value = 0.09;
      o.connect(g); g.connect(a.destination); o.start(a.currentTime + i * 0.22); o.stop(a.currentTime + i * 0.22 + 0.18); });
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
const EVENT_TEXT = { NEW_ONLINE_ORDER: (e) => `New online order ${e.number} · ${e.items} items · ${inr(e.total)}`, ORDER_INVOICED: (e) => `${e.number} billed (${e.bill_no})`,
  ORDER_DISPATCHED: (e) => `${e.number} out for delivery with ${e.agent}`, ORDER_COMPLETED: (e) => `${e.number} completed`, ORDER_CANCELLED: (e) => `${e.number} cancelled` };
function liveOrders() {
  if (orderStream || !window.EventSource || !can('orders')) return;
  orderStream = new EventSource('/api/events');
  orderStream.addEventListener('order', (m) => {
    let e = {};
    try { e = JSON.parse(m.data); } catch (_) { return; }
    if (e.type === 'NEW_ONLINE_ORDER') chime();
    if (EVENT_TEXT[e.type]) toast(EVENT_TEXT[e.type](e));
    pollOrders();
    if (location.hash.startsWith('#/orders') && !$('dialog[open]')) route();
  });
  orderStream.onerror = () => { /* the browser reconnects by itself; the poll keeps the count right meanwhile */ };
}
App.afterFrame.push(() => {
  pollOrders();
  liveOrders();
  if (!orderTimer) orderTimer = setInterval(pollOrders, 20000);
});

// ================================================================== Online orders (staff)
const ORDER_TABS = [['open', 'To do'], ['done', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All'], ['perf', 'Performance'], ['checks', 'Checks & AI']];
const statusPill = (o) => `<span class="pill ${{ new: 'bad', cancelled: 'off', done: 'ok' }[o.status] || ''}">${esc(o.status_label)}</span>`;
// the one next step for an order, as a button on the list
function nextStep(o) {
  if (o.status === 'new') return ['accept', 'Accept'];
  if (!o.sale_id && ['accepted', 'ready', 'out'].includes(o.status)) return can('bill') ? ['bill', 'Bill & pack'] : null;
  if (o.status === 'packing') return o.mode === 'delivery' ? ['dispatch', 'Out for delivery'] : ['ready', 'Ready for pickup'];
  if (['ready', 'out'].includes(o.status)) return ['complete', 'Process completed'];
  return null;
}
App.views.orders = async (main) => {
  const tab = hashParam('tab') || 'open';
  if (tab === 'perf') return ordersPerformance(main);
  if (tab === 'checks') return checksView(main);
  const { orders, cod, shop_url: shopUrl, online_enabled: onlineOn } = await api(`/orders?tab=${tab}`);
  App.shopUrl = shopUrl;
  App.settings.online_enabled = onlineOn;
  const counts = { new: orders.filter((o) => o.status === 'new').length, busy: orders.filter((o) => ['accepted', 'packing', 'ready', 'out'].includes(o.status)).length };
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Online orders</h1>
      <div class="row"><a class="btn" href="${esc(shopUrl)}" target="_blank" rel="noopener">Open customer site</a><button id="poster">QR poster for customers</button></div></div>
    ${App.settings.online_enabled !== '1' ? `<div class="notice">Online orders are switched off. Turn on in ${can('settings') ? '<a href="#/settings">Settings</a>' : 'Settings'} → Online orders.</div>` : ''}
    ${tab === 'open' ? `<div class="cards"><div class="card stat"><div class="l">New</div><div class="v ${counts.new ? 'bad' : ''}">${counts.new}</div><div class="l">waiting to be accepted</div></div>
      <div class="card stat"><div class="l">In progress</div><div class="v">${counts.busy}</div><div class="l">being packed or delivered</div></div>
      <div class="card stat"><div class="l">Cash on delivery out</div><div class="v ${Number(cod.amount) ? 'warn' : ''}">${inr(cod.amount)}</div><div class="l">${cod.orders} orders not completed</div></div></div>` : ''}
    ${tabs(ORDER_TABS, tab, 'orders')}
    ${orders.length ? `<table><tr><th>Order</th><th>Slot</th><th>Customer</th><th class="hide-sm">Type</th><th>Status</th><th class="r">Amount</th><th></th></tr>
      ${orders.map((o) => { const n = nextStep(o); return `<tr class="click" data-id="${o.id}"><td><b>${esc(o.number)}</b><div class="small muted">${o.items} items${o.bill_no ? ` · ${esc(o.bill_no)}` : ''}</div></td>
      <td>${esc(o.slot_label)}</td><td>${esc(o.name)}<div class="small muted">${esc(o.phone)}</div></td>
      <td class="hide-sm">${o.mode === 'delivery' ? 'Delivery' : 'Takeaway'}${o.agent_name ? `<div class="small muted">${esc(o.agent_name)}</div>` : ''}</td>
      <td>${statusPill(o)}${Number(o.cod) && o.status !== 'done' ? '<div class="small warn">Cash on delivery</div>' : ''}</td>
      <td class="r">${inr(o.bill_total || Money.rs(Money.paise(o.est_items) + Money.paise(o.delivery_charge)))}</td>
      <td class="r">${n ? `<button class="small ${n[0] === 'complete' || n[0] === 'accept' ? 'primary' : ''}" data-go="${n[0]}" data-oid="${o.id}">${esc(n[1])}</button>` : ''}</td></tr>`; }).join('')}</table>`
    : '<p class="muted">No orders here.</p>'}`;
  $$('tr[data-id]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('[data-go]')) orderDialog(Number(tr.dataset.id)); }));
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => submitting(b, () => orderStep(b.dataset.go, Number(b.dataset.oid)))));
  $('#poster').addEventListener('click', posterPrint);
  const t = setInterval(() => { if (!$('dialog[open]') && document.visibilityState === 'visible') route(); }, 30000);
  App.leave = () => clearInterval(t);
};

async function ordersPerformance(main) {
  const period = hashParam('period') || 'month';
  const p = await api(`/orders-stats?period=${period}`);
  main.innerHTML = `<h1>Online orders</h1>${tabs(ORDER_TABS, 'perf', 'orders')}
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

// ------------------------------------------------------------------ Checks & AI: held stock, waiting orders, cash out, AI log
async function checksView(main) {
  const withAi = hashParam('ai') === '1';
  const [c, logs] = await Promise.all([api(`/checks${withAi ? '?ai=1' : ''}`), can('reports') ? api('/ai/logs?limit=60') : Promise.resolve(null)]);
  const lvl = { high: 'bad', medium: 'warn', low: '' };
  const st = c.status;
  main.innerHTML = `<h1>Online orders</h1>${tabs(ORDER_TABS, 'checks', 'orders')}
    <div class="grid2"><div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Things to check</h2>
        ${can('products') ? '<button id="reconcile">Correct held stock</button>' : ''}</div>
      <p class="small muted">Worked out from the stock and the open orders. Products with more held than in stock are hidden from the customers' site until stock comes in.</p>
      ${c.items.length ? `<table>${c.items.map((i) => `<tr><td><span class="pill ${lvl[i.level]}">${esc(i.kind.replace(/_/g, ' '))}</span></td><td>${esc(i.text)}</td>
        <td class="r">${i.order_id ? `<button class="small" data-oid="${i.order_id}">Open</button>` : ''}</td></tr>`).join('')}</table>` : '<p class="ok">Nothing to check. Held stock matches the open orders.</p>'}
      ${c.ai ? `<div class="card" style="margin-top:12px;background:#f5f6ff"><div class="row"><span class="pill" style="background:#e5e8ff;color:#2c3db8">AI summary</span>
          <span class="small muted">${esc(c.ai.model)} · from the list above only</span></div><p>${esc(c.ai.summary)}</p>
          <ul>${c.ai.actions.map((a) => `<li><b>${esc(a.ref)}</b>: ${esc(a.action)}</li>`).join('')}</ul></div>`
    : st.on && c.items.length && can('reports') ? '<button id="aiSum" style="margin-top:10px">Ask the AI what to do first</button>' : ''}</div>
      <div class="card"><h2 style="margin-top:0">AI helpers</h2>
        <p>Customers' site: <b class="${logs && logs.shop.on ? 'ok' : 'muted'}">${logs ? (logs.shop.on ? 'on' : `off (${!logs.shop.keyed ? 'no API key on the server' : logs.shop.hard_off ? 'switched off on the server' : 'switched off in Settings'})`) : '–'}</b><br>
        Billing site: <b class="${st.on ? 'ok' : 'muted'}">${st.on ? 'on' : 'off'}</b>${logs ? ` · model ${esc(logs.shop.model)}` : ''}</p>
        ${logs ? `<p class="small muted">Tokens used today: ${logs.used.toLocaleString('en-IN')} of ${Number(App.settings.ai_daily_tokens || 0).toLocaleString('en-IN')} ·
          ${logs.today.map((t) => `${esc(t.outcome)} ${t.n}`).join(' · ') || 'no questions today'} · blocked today: ${c.blocked_today}</p>` : ''}
        <p class="small muted">Without an AI key the customers' "Ask the shop" answers from the shop's own search. The AI never works out prices, GST, totals or stock,
          only suggests products that are in stock, and never promises discounts or refunds.</p></div></div>
    ${logs ? `<h2>AI log</h2><p class="small muted">Phone numbers, e-mail, UPI and card numbers are masked before anything is sent or saved.</p>
      <table><tr><th>When</th><th>Site</th><th>Who</th><th>Question</th><th>Answer</th><th>Outcome</th><th class="r hide-sm">Tokens</th></tr>
      ${logs.rows.map((r) => `<tr><td class="small">${esc(r.at.slice(5, 16))}</td><td>${esc(r.site)}</td><td class="small">${esc(r.customer || r.staff || '–')}</td>
        <td class="small">${esc(r.question)}</td><td class="small">${esc(r.answer)}</td>
        <td><span class="pill ${{ ok: 'ok', blocked: 'bad', error: 'warn', refused: 'warn' }[r.outcome] || 'off'}">${esc(r.outcome)}</span>${r.reason ? `<div class="small muted">${esc(r.reason)}</div>` : ''}</td>
        <td class="r hide-sm small">${r.tokens_in + r.tokens_out || ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No questions yet.</td></tr>'}</table>` : ''}`;
  if ($('#reconcile')) $('#reconcile').addEventListener('click', () => submitting($('#reconcile'), async () => {
    const r = await api('/stock/reconcile', { method: 'POST', body: {} });
    toast(r.fixed.length ? `Corrected ${r.fixed.length} products.` : 'Held stock already matches the open orders.');
    route();
  }));
  if ($('#aiSum')) $('#aiSum').addEventListener('click', () => { location.hash = '#/orders?tab=checks&ai=1'; });
  $$('[data-oid]', main).forEach((b) => b.addEventListener('click', () => orderDialog(Number(b.dataset.oid))));
}

// ------------------------------------------------------------------ one order
// what the customer asked for when an item is not available
const SUB_TEXT = { call: 'call the customer', replace: 'replace with a similar item', remove: 'remove it' };
const STEP_NAMES = (o) => ['Order placed', 'Billed & packed', o.mode === 'delivery' ? 'Delivery person assigned' : 'Ready for pickup', 'Process completed'];
function stepBar(o) {
  const done = [true, !!o.sale_id, o.mode === 'delivery' ? !!o.dispatched_at && ['out', 'done'].includes(o.status) : ['ready', 'done'].includes(o.status), o.status === 'done'];
  if (o.status === 'cancelled') return '<div class="notice">This order is cancelled.</div>';
  return `<ol class="ostep">${STEP_NAMES(o).map((n, i) => `<li class="${done[i] ? 'done' : ''}">${esc(n)}</li>`).join('')}</ol>`;
}
async function orderStep(kind, id) {
  if (kind === 'accept') { const r = await api(`/orders/${id}/accept`, { method: 'POST', body: {} }); sendUpdate(r.whatsapp); route(); return; }
  if (kind === 'ready') { const r = await api(`/orders/${id}/ready`, { method: 'POST', body: {} }); sendUpdate(r.whatsapp); route(); return; }
  if (kind === 'bill') { await billAtCounter(id); return; }
  if (kind === 'dispatch') { dispatchDialog(id); return; }
  if (kind === 'complete') { await completeDialog(id); return; }
  if (kind === 'cancel') cancelDialog(id);
}
function sendUpdate(wa, text = 'Saved. Send the customer the WhatsApp update.') {
  toast(text);
  if (wa) window.open(waLink(wa.phone, wa.text), '_blank', 'noopener');
}
async function billAtCounter(id) {
  if (!myCounter()) throw new Error('Choose this PC\'s counter first (Billing).');
  const cur = JSON.parse(localStorage.getItem(`mpc_bill_${myCounter()}`) || 'null');
  if (cur && cur.lines && cur.lines.length) throw new Error('Finish, hold (F8) or cancel the bill on the billing screen first.');
  const { bill } = await api(`/orders/${id}/bill`, { method: 'POST', body: {} });
  const lines = bill.lines.map((l) => ({ id: l.id, qty: Money.milli(l.qty), rate: null, disc: 0, note: '' }));
  if (bill.delivery) lines.push({ id: bill.delivery.id, qty: 1000, rate: Money.paise(bill.delivery.rate), disc: 0, note: '', delivery: true, name: bill.delivery.name });
  localStorage.setItem(`mpc_bill_${myCounter()}`, JSON.stringify({ uuid: crypto.randomUUID(), lines, customer: bill.customer, order_id: bill.order_id,
    order_no: bill.number, order_pay: bill.pay_pref, order_ref: bill.pay_ref, order_mode: bill.mode }));
  $$('dialog[open]').forEach((d) => d.close());
  toast(`${bill.number} is on the bill. Weigh loose items (F4), then take payment: "Cash on delivery" if the customer pays later.`);
  location.hash = '#/bill';
}
function dispatchDialog(id, o = {}) {
  const d = modal(`<h3>Out for delivery</h3><p class="muted">The customer sees the name, can call this number, and gets the WhatsApp update.</p>
    <form><label>Delivery person's name</label><input name="agent_name" value="${esc(o.agent_name || localStorage.getItem('mpc_agent_name') || '')}" required autofocus>
      <label>Delivery person's mobile</label><input name="agent_phone" inputmode="tel" value="${esc(o.agent_phone || localStorage.getItem('mpc_agent_phone') || '')}" required>
      <label>Tracking (optional: vehicle number, or a https:// tracking link)</label><input name="tracking" value="${esc(o.tracking || '')}" maxlength="200">
      <div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Send out</button></div></form>`);
  $('form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    submitting($('button.primary', d), async () => {
      const body = formData(e.target);
      const r = await api(`/orders/${id}/dispatch`, { method: 'POST', body });
      localStorage.setItem('mpc_agent_name', body.agent_name); localStorage.setItem('mpc_agent_phone', body.agent_phone);
      d.close();
      sendUpdate(r.whatsapp, 'Out for delivery. Send the customer the WhatsApp update.');
      route();
    });
  });
}
async function completeDialog(id) {
  const { preview: p } = await api(`/orders/${id}/complete`);
  const cod = Money.paise(p.cod);
  const d = modal(`<h3>Process completed · ${esc(p.number)}</h3>
    <p class="muted">Bill <b>${esc(p.bill_no)}</b> · ${inr(p.total)}${p.agent ? ` · delivered by ${esc(p.agent.name)}` : ''}. When you confirm, these items leave the stock,
      the held stock is released and the customer can download the invoice.</p>
    <table>${p.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="r">${esc(l.qty)} ${esc(l.unit)}</td><td class="r small muted">stock now ${esc(l.on_hand)}</td><td class="r">${inr(l.amount)}</td></tr>`).join('')}</table>
    <form>${cod ? `<h3 style="margin:14px 0 6px">Cash on delivery: ${inr(p.cod)}</h3>
      <label class="row" style="font-weight:400;flex-wrap:nowrap"><input type="radio" name="method" value="cash" checked style="width:auto"> Cash, handed in at <b>${esc(myCounter() || 'this counter')}</b> (goes into its cash drawer)</label>
      <label class="row" style="font-weight:400;flex-wrap:nowrap"><input type="radio" name="method" value="upi" style="width:auto"> Paid by UPI to the delivery person or the shop</label>
      <div id="upiRef" hidden><label>UPI transaction number (UTR)</label><input name="ref" value="${esc(p.pay_ref)}"></div>`
    : `<p class="ok">Already paid: ${p.payments.map((x) => `${esc(x.method.toUpperCase())} ${inr(x.amount)}${x.reference ? ` (${esc(x.reference)})` : ''}`).join(', ')}.</p>`}
      <div class="actions"><button type="button" data-close>Back</button><button class="primary">Process completed</button></div></form>`);
  d.classList.add('wide');
  const f = $('form', d);
  if (cod) $$('[name=method]', d).forEach((r) => r.addEventListener('change', () => { $('#upiRef', d).hidden = f.method.value !== 'upi'; }));
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting($('button.primary', d), async () => {
      const r = await api(`/orders/${id}/complete`, { method: 'POST', body: { counter: myCounter(), method: cod ? f.method.value : '', ref: f.ref ? f.ref.value : '' } });
      d.close();
      sendUpdate(r.whatsapp, `${r.result.number} completed${Money.paise(r.result.cod) ? `: ${inr(r.result.cod)} by ${r.result.settle}` : ''}.`);
      route();
    });
  });
}
function cancelDialog(id, o = {}) {
  const billed = !!o.sale_id;
  const d = modal(`<h3>Cancel ${esc(o.number || 'order')}</h3>
    ${billed ? `<p class="notice">This order is already billed (${esc(o.bill_no)}). A credit note reverses the bill; nothing was taken out of stock yet.
      ${can('refund') ? '' : 'A manager approves with their PIN.'}</p>` : '<p class="muted">The held items become available again in the shop.</p>'}
    <form><label>Why is it cancelled? (the customer sees this)</label><input name="note" required autofocus>
      <div class="actions"><button type="button" data-close>Back</button><button class="danger">Cancel the order</button></div></form>`);
  $('form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    submitting($('button.danger', d), async () => {
      let approval;
      if (billed && !can('refund')) {
        approval = await managerApproval('refund', `Cancel ${o.number} and reverse bill ${o.bill_no} (${inr(o.bill_total)})`);
        if (!approval) return;
      }
      const r = await api(`/orders/${id}/cancel`, { method: 'POST', body: { note: e.target.note.value, approval, counter: myCounter() } });
      d.close();
      const cr = r.credit;
      sendUpdate(r.whatsapp, cr ? `Cancelled. Credit note ${cr.no}${Number(cr.refund_cash) ? `: give ${inr(cr.refund_cash)} cash back` : ''}${Number(cr.refund_upi) ? `: refund ${inr(cr.refund_upi)} by UPI` : ''}.` : 'Cancelled.');
      route();
    });
  });
}

async function orderDialog(id) {
  const { order: o, whatsapp } = await api(`/orders/${id}`);
  const open = ['new', 'accepted', 'packing', 'ready', 'out'].includes(o.status);
  const editable = open && !o.sale_id;
  const n = nextStep(o);
  const d = modal(`<h3>${esc(o.number)} · ${esc(o.status_label)}</h3>${stepBar(o)}
    <p><b>${esc(o.name)}</b> · ${esc(o.phone)} ${o.phone_verified ? '<span class="pill">Phone verified</span>' : '<span class="pill off">phone not verified</span>'} · ${o.mode === 'delivery' ? 'Home delivery' : 'Takeaway'}<br>${esc(o.slot_label)}
    ${o.address ? `<br>${ico('pin')} ${esc(o.address)}` : ''}${o.notes ? `<br>Note: ${esc(o.notes)}` : ''}
    <br>If an item is not available: <b>${esc(SUB_TEXT[o.sub_pref] || SUB_TEXT.call)}</b>${o.drop_note ? `<br>For the delivery person: <b>${esc(o.drop_note)}</b>` : ''}
    <br>Pays by ${o.pay_pref.toUpperCase()}${o.pay_ref ? ` · <b>UPI ref ${esc(o.pay_ref)}</b> (check it in your UPI app)` : ''}
    ${o.bill_no ? `<br>Bill <b>${esc(o.bill_no)}</b> ${inr(o.bill_total)}${Money.paise(o.cod_due || '0') && o.status !== 'done' ? ` · <b class="warn">cash on delivery ${inr(o.cod_due)}</b>` : ''}` : ''}
    ${o.agent_name ? `<br>${ico('scooter')} ${esc(o.agent_name)} · ${esc(o.agent_phone)}${o.tracking ? ` · ${esc(o.tracking)}` : ''}` : ''}
    ${o.status_note ? `<br><i>${esc(o.status_note)}</i>` : ''}</p>
    <table>${o.lines.map((l) => `<tr class="${Number(l.qty) ? '' : 'struck'}"><td>${esc(l.name)}<div class="small ta muted">${esc(l.name_ta)}</div>
      ${l.note ? `<div class="small warn">${esc(l.note)}${l.ordered_qty !== null ? ` (ordered ${esc(Number(l.ordered_qty))})` : ''}</div>` : ''}</td>
      <td class="r">${esc(l.qty)} ${esc(l.unit)}</td><td class="r">${inr(Money.line(Money.paise(l.price), Money.milli(l.qty)))}</td>
      <td class="r">${editable ? `<button class="small" data-less="${l.id}" title="Less is available">Less</button>
        ${Number(l.qty) ? `<button class="small danger" data-na="${l.id}" title="Remove: not available">Not available</button>` : ''}` : ''}</td></tr>`).join('')}
      ${Number(o.delivery_charge) ? `<tr><td>Delivery charge</td><td></td><td class="r">${inr(o.delivery_charge)}</td></tr>` : ''}
      <tr><td><b>${o.bill_no ? 'Order total (approx.)' : 'Approx. total'}</b></td><td></td><td class="r"><b>${inr(o.est_total)}</b></td></tr></table>
    <div class="actions" style="justify-content:flex-start">
      ${n ? `<button class="primary" data-step="${n[0]}">${esc(n[1])}</button>` : ''}
      ${o.status === 'packing' && o.mode === 'pickup' ? '<button data-step="complete">Process completed</button>' : ''}
      ${o.status === 'out' ? '<button data-step="dispatch">Change delivery person</button>' : ''}
      ${o.status === 'accepted' && !o.sale_id && can('bill') && (!n || n[0] !== 'bill') ? '<button data-step="bill">Bill & pack</button>' : ''}
      <a class="btn" target="_blank" rel="noopener" href="${esc(waLink(whatsapp.phone, whatsapp.text))}">WhatsApp the customer</a>
      <button id="opack">Print packing list</button>
      ${open ? '<button class="danger" data-step="cancel">Cancel order</button>' : ''}
      <button data-close>Close</button></div>`);
  d.classList.add('wide');
  const lineChange = async (lineId, qty) => {
    const r = await api(`/orders/${id}/line`, { method: 'POST', body: { line_id: lineId, qty } });
    d.close();
    sendUpdate(r.whatsapp, 'Order changed. Send the customer the WhatsApp update.');
    orderDialog(id);
  };
  $$('[data-na]', d).forEach((b) => b.addEventListener('click', () => submitting(b, () => lineChange(Number(b.dataset.na), '0'))));
  $$('[data-less]', d).forEach((b) => b.addEventListener('click', () => submitting(b, async () => {
    const q = prompt('How much is available? (0 = none)');
    if (q === null) return;
    await lineChange(Number(b.dataset.less), q.trim() || '0');
  })));
  $$('[data-step]', d).forEach((b) => b.addEventListener('click', () => submitting(b, async () => {
    const k = b.dataset.step;
    if (k === 'dispatch') { d.close(); dispatchDialog(id, o); return; }
    if (k === 'cancel') { d.close(); cancelDialog(id, o); return; }
    if (k === 'complete') { d.close(); await completeDialog(id); return; }
    d.close();
    await orderStep(k, id);
  })));
  $('#opack', d).addEventListener('click', () => {
    $('#print-area').innerHTML = `<div class="receipt"><h2>${esc(o.number)} packing list</h2><div>${esc(o.name)} ${esc(o.phone)}</div>
      <div>${esc(o.slot_label)} · ${o.mode === 'delivery' ? 'DELIVERY' : 'TAKEAWAY'}</div>${o.address ? `<div>${esc(o.address)}</div>` : ''}${o.bill_no ? `<div>Bill ${esc(o.bill_no)}</div>` : ''}<hr>
      <table>${o.lines.filter((l) => Number(l.qty)).map((l) => `<tr><td>[ ] ${esc(l.name)}<br><span class="ta">${esc(l.name_ta)}</span></td><td class="r">${esc(l.qty)} ${esc(l.unit)}</td></tr>`).join('')}</table>
      <hr>${o.notes ? `<div>Note: ${esc(o.notes)}</div>` : ''}<div>Not available: ${esc(SUB_TEXT[o.sub_pref] || SUB_TEXT.call)}</div>
      ${o.drop_note ? `<div>Delivery: ${esc(o.drop_note)}</div>` : ''}</div>`;
    setTimeout(() => window.print(), 50);
  });
}

function posterPrint() {
  const s = App.settings;
  $('#print-area').innerHTML = `<div style="width:190mm;padding:12mm;text-align:center;font-family:'Segoe UI','Nirmala UI',sans-serif">
    <img src="/img/logo-full.webp" style="width:120mm" alt=""><h1 style="font-size:30px;margin:6mm 0">Order from your phone!</h1>
    <div class="ta" style="font-size:22px">உங்கள் மொபைலில் ஆர்டர் செய்யுங்கள்!</div>
    <img src="/api/orders-poster.svg" style="width:110mm;margin:8mm 0">
    <div style="font-size:20px">Scan → choose → <b>Takeaway</b> or <b>Home delivery</b> → pick a time</div>
    <div style="font-size:18px;margin-top:4mm">${esc(App.shopUrl || `${location.origin}/shop/`)}</div>
    <div style="font-size:18px;margin-top:6mm">${esc(s.name)} ${s.phone ? `· ${esc(s.phone)}` : ''}</div></div>`;
  const img = $('#print-area img[src$="svg"]');
  img.onload = () => window.print();
}

// ================================================================== Returns
App.views.returns = async (main) => {
  main.innerHTML = `<h1>Returns</h1>
    <div class="card" style="margin-bottom:14px"><form id="rf" class="row"><input name="bill" placeholder="Bill number (e.g. 107 or MU/1126/T2/107)" style="max-width:340px" autofocus required>
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
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Customers & credit</h1><div class="row">
    ${can('reports') ? `<a class="btn" href="/api/customers/export">${ico('download')} Download all (Excel)</a>` : ''}<button class="primary" id="cadd">+ Add customer</button></div></div>
    <div class="row" style="margin-bottom:10px"><input id="cq" placeholder="Name or mobile" style="max-width:300px">
    <label class="row" style="font-weight:400;margin:0"><input type="checkbox" id="cown" style="width:auto"> Only those who owe money</label></div><div id="clist"></div>`;
  const load = async () => {
    const { customers } = await api(`/customers/list?q=${encodeURIComponent($('#cq').value)}&owing=${$('#cown').checked ? 1 : 0}`);
    if (!$('#clist')) return;
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
// The Reports page: one look tells what is happening in the shop. Pick a period; sales by day, categories by day (pivot),
// best products, payments and busy hours. The detailed reports (Excel) are below.
const PAY_LABEL = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit (udhaar)', cod: 'Cash on delivery', points: 'Points' };
const rupees = (v) => { const r = Math.round((Money.paise(String(v)) || 0) / 100); return `₹${r.toLocaleString('en-IN')}`; };
App.views.reports = async (main) => {
  const name = hashParam('r') || '';
  const period = hashParam('period') || (hashParam('from') ? '' : 'month');
  const d = await api(`/reports/dashboard?${period ? `period=${period}` : `from=${hashParam('from')}&to=${hashParam('to')}`}`);
  const s = d.summary;
  const from = s.from;
  const to = s.to;
  const P = (v) => Money.paise(String(v ?? 0)) || 0;
  const maxDay = Math.max(1, ...d.days.map((x) => P(x.sales)));
  const label = (k) => (d.by === 'month' ? new Date(`${k}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })
    : `${Number(k.slice(8))}`);
  const week = (k) => (d.by === 'month' ? '' : new Date(`${k}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }));
  // pivot: the busiest categories, every day of the period
  const catTotal = new Map();
  for (const c of d.cats) catTotal.set(c.cat, (catTotal.get(c.cat) || 0) + P(c.sales));
  const cats = [...catTotal.entries()].sort((x, y) => y[1] - x[1]);
  const shown = cats.slice(0, 10).map((x) => x[0]);
  const cell = new Map();
  for (const c of d.cats) {
    const row = shown.includes(c.cat) ? c.cat : 'Others';
    const key = `${row}|${c.d}`;
    cell.set(key, (cell.get(key) || 0) + P(c.sales));
  }
  const rows = cats.length > 10 ? [...shown, 'Others'] : shown;
  const maxCell = Math.max(1, ...cell.values());
  const rowTotal = (r) => (r === 'Others' ? cats.slice(10).reduce((t, x) => t + x[1], 0) : catTotal.get(r));
  const payTotal = d.pay.reduce((t, x) => t + P(x.amount), 0) || 1;
  const hours = d.hours.filter((h) => h.bills);
  const maxHour = Math.max(1, ...hours.map((h) => P(h.sales)));
  const best = hours.slice().sort((x, y) => P(y.sales) - P(x.sales))[0];
  const netProfit = P(s.net_profit);
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Reports</h1><form id="rr" class="row">
      <input type="date" name="from" value="${from}" style="width:160px"> to <input type="date" name="to" value="${to}" style="width:160px">
      <button class="primary">Show</button></form></div>
    ${periodChips(period, 'reports')}
    <p class="dash-say">From <b>${esc(from)}</b> to <b>${esc(to)}</b> the shop sold <b>${inr(s.net)}</b> in <b>${s.bills}</b> bills.
      Profit on the goods: <b class="ok">${inr(s.margin)}</b> (${s.margin_pct}%). After expenses of ${inr(s.expenses)}:
      <b class="${netProfit < 0 ? 'bad' : 'ok'}">${inr(s.net_profit)}</b>.${best ? ` Busiest hour: <b>${best.h}:00–${best.h + 1}:00</b>.` : ''}</p>
    <div class="dash-kpis">
      <div class="kpi"><span>Sales</span><b>${rupees(s.net)}</b><small>${s.bills} bills · ${inr(s.avg_bill)} a bill</small></div>
      <div class="kpi"><span>Profit</span><b class="ok">${rupees(s.margin)}</b><small>${s.margin_pct}% of sales</small></div>
      <div class="kpi"><span>Expenses</span><b>${rupees(s.expenses)}</b><small>Net profit ${inr(s.net_profit)}</small></div>
      <div class="kpi"><span>Returns · discounts</span><b>${rupees(s.returns)}</b><small>Discounts ${inr(s.discount)}</small></div></div>
    <section class="dash-card"><h2>Sales by ${d.by}</h2>
      <div class="vbars" style="--n:${d.days.length}">${d.days.map((x) => `<div class="vb" title="${esc(x.d)}: ${inr(x.sales)} · ${x.bills} bills · profit ${inr(x.profit)}">
        <em>${P(x.sales) && d.days.length <= 14 ? rupees(x.sales) : ''}</em><i style="height:${Math.round((P(x.sales) / maxDay) * 100)}%"></i><span>${esc(label(x.d))}<br><small>${esc(week(x.d))}</small></span></div>`).join('')}</div></section>
    <section class="dash-card"><h2>Categories by ${d.by}</h2>
      ${rows.length ? `<div class="scroll"><table class="pivot"><tr><th>Category</th>${d.days.map((x) => `<th class="r">${esc(label(x.d))}</th>`).join('')}<th class="r">Total</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r)}</td>${d.days.map((x) => { const v = cell.get(`${r}|${x.d}`) || 0;
    return `<td class="r" style="background:rgba(30,155,38,${v ? (0.08 + 0.55 * (v / maxCell)).toFixed(2) : 0})">${v ? rupees(Money.rs(v)) : ''}</td>`; }).join('')}
        <td class="r"><b>${rupees(Money.rs(rowTotal(r)))}</b></td></tr>`).join('')}
      <tr class="tot"><td>All</td>${d.days.map((x) => `<td class="r">${P(x.sales) ? rupees(x.sales) : ''}</td>`).join('')}<td class="r"><b>${rupees(s.sales)}</b></td></tr></table></div>`
    : '<p class="muted">No sales in this period.</p>'}</section>
    <div class="dash-two">
      <section class="dash-card"><h2>Best products</h2>${d.top.length ? `<table><tr><th>Product</th><th class="r">Sold</th><th class="r">Sales</th><th class="r">Profit</th></tr>
        ${d.top.map((t) => `<tr><td>${esc(t.name)}</td><td class="r">${esc(t.qty)} ${t.unit === 'kg' ? 'kg' : ''}</td><td class="r">${rupees(t.sales)}</td>
        <td class="r ${P(t.profit) < 0 ? 'bad' : 'ok'}">${rupees(t.profit)}</td></tr>`).join('')}</table>` : '<p class="muted">No sales.</p>'}</section>
      <section class="dash-card"><h2>How customers paid</h2>${d.pay.map((x) => `<div class="hbar"><span>${esc(PAY_LABEL[x.method] || x.method)}</span>
        <i><u style="width:${Math.round((P(x.amount) / payTotal) * 100)}%"></u></i><b>${rupees(x.amount)}</b></div>`).join('') || '<p class="muted">No payments.</p>'}
        <h2 style="margin-top:18px">Busy hours</h2>${hours.length ? `<div class="vbars hours" style="--n:${hours.length}">${hours.map((h) => `<div class="vb" title="${h.h}:00: ${inr(h.sales)} · ${h.bills} bills">
          <em></em><i style="height:${Math.round((P(h.sales) / maxHour) * 100)}%"></i><span>${h.h}</span></div>`).join('')}</div>` : '<p class="muted">No bills.</p>'}</section></div>
    <section class="dash-card"><h2>Detailed reports (Excel)</h2>
      <div class="cats">${(await api('/reports?period=today')).list.map((x) => `<a class="btn ${x.name === name ? 'primary' : ''}" href="#/reports?from=${from}&to=${to}&r=${x.name}">${esc(x.title)}</a>`).join('')}</div>
      <div id="rout" style="margin-top:12px"></div></section>`;
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
  const tab = hashParam('tab') || 'prices';
  const T = [['prices', "Today's prices"], ['offers', 'Offers'], ['expenses', 'Expenses'], ['board', 'Price board'],
    ['labels', 'Barcode labels'], ['day', 'Day summary (WhatsApp)']];
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
  if (tab === 'prices') await todaysPrices(body);
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
};


// ================================================================== Today's prices: the price, today's offer and the stock on the shelf
// The list loads once per category and switches in place (no page reload). What is typed is kept until Save, even when the
// category is changed. Fruit and vegetables with a price and stock show in the online shop at once.
const PER = { kg: [[1000, 'per kg'], [500, 'per 500 g'], [250, 'per 250 g'], [100, 'per 100 g']], pcs: [[1, 'per piece']] };
async function todaysPrices(body) {
  const cache = new Map();
  const pending = new Map();                     // id → { unit, name, per, price, offer, stock, su }
  const saved = new Set();
  const state = { cat: '', q: '' };
  let catsShown = false;
  body.innerHTML = `<div class="row tp-bar">
      <input id="pfind" placeholder="Scan barcode or type a name, Enter" style="max-width:260px">
      <select id="pcat" style="max-width:250px"><option value="">Fruit & vegetables (sold by kg)</option></select>
      ${can('products') ? '<button id="padd2">+ Add product</button>' : ''}
      <button class="primary" id="psave">Save changes <span id="pn"></span></button><span id="pmsg" class="small muted"></span></div>
    <p class="small muted">Type the price (choose per kg or per 250 g), today's offer if any, and the stock on the shelf (kg or g). Enter goes to the next box.
      Changed boxes turn <b class="bad">red</b>; after Save they turn <b class="ok">green</b>.</p>
    <div id="ptable" class="tablewrap"></div>`;
  const perKg = (v, g, unit) => { const x = Money.paise(v); return x === null ? null : unit === 'kg' ? Math.round((x * 1000) / g) : x; };
  const show = (paiseKg, g, unit) => (paiseKg === null || paiseKg === undefined ? '' : Money.rs(unit === 'kg' ? Math.round((paiseKg * g) / 1000) : paiseKg));
  const count = () => { $('#pn').textContent = pending.size ? `(${pending.size})` : ''; };
  const draw = (items) => {
    if (!$('#ptable')) return;
    $('#ptable').innerHTML = `<table class="tp"><tr><th>Product</th><th>Price ₹</th><th>Today's offer ₹</th><th>Stock on the shelf</th></tr>
      ${items.map((i) => {
    const p = pending.get(i.id) || {};
    const per = Number(p.per || (i.unit === 'kg' ? 1000 : 1));
    const opts = PER[i.unit === 'kg' ? 'kg' : 'pcs'];
    const price = p.price !== undefined ? p.price : show(Money.paise(i.price), per, i.unit);
    const offer = p.offer !== undefined ? p.offer : show(i.offer === null ? null : Money.paise(i.offer), per, i.unit);
    return `<tr data-id="${i.id}" class="${saved.has(i.id) ? 'saved' : ''}"><td><b>${esc(i.name)}</b><div class="small ta muted">${esc(i.name_ta)}</div>
        <div class="small">${i.online ? '<span class="ok">In the online shop</span>' : '<span class="muted">Not online yet (needs price and stock)</span>'}</div></td>
      <td><div class="tp-in"><input class="tpi ${p.price !== undefined ? 'changed' : ''}" data-k="price" inputmode="decimal" value="${esc(price)}">
        <select data-k="per" ${opts.length < 2 ? 'disabled' : ''}>${opts.map(([g, l]) => `<option value="${g}" ${g === per ? 'selected' : ''}>${l}</option>`).join('')}</select></div></td>
      <td><input class="tpi ${p.offer !== undefined ? 'changed' : ''}" data-k="offer" inputmode="decimal" value="${esc(offer)}" placeholder="none"></td>
      <td><div class="tp-in"><input class="tpi ${p.stock !== undefined ? 'changed' : ''}" data-k="stock" inputmode="decimal" value="${esc(p.stock ?? '')}" placeholder="${esc(i.on_hand)}">
        ${i.unit === 'kg' ? `<select data-k="su"><option value="kg">kg</option><option value="g" ${p.su === 'g' ? 'selected' : ''}>g</option></select>` : '<span class="small">pcs</span>'}</div>
        <div class="small muted">now ${esc(i.on_hand)} ${i.unit === 'kg' ? 'kg' : 'pcs'}</div></td></tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">Nothing found.</td></tr>'}</table>`;
    const inputs = $$('.tpi', body);
    inputs.forEach((inp, n) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (inputs[n + 1] || $('#psave')).focus(); } }));
    $$('tr[data-id]', body).forEach((tr) => {
      const id = Number(tr.dataset.id);
      const it = items.find((x) => x.id === id);
      const entry = () => { if (!pending.has(id)) pending.set(id, { unit: it.unit, name: it.name }); saved.delete(id); tr.classList.remove('saved'); return pending.get(id); };
      $$('.tpi', tr).forEach((inp) => inp.addEventListener('input', () => { entry()[inp.dataset.k] = inp.value; inp.classList.add('changed'); count(); }));
      const per = $('[data-k=per]', tr);
      if (per) per.addEventListener('change', () => {        // the same price shown for the new weight (₹80 per kg = ₹20 per 250 g)
        const e = entry();
        const old = Number(e.per || 1000);
        const g = Number(per.value);
        for (const k of ['price', 'offer']) {
          const inp = $(`[data-k=${k}]`, tr);
          const v = perKg(inp.value, old, it.unit);
          if (v !== null) { inp.value = show(v, g, it.unit); e[k] = inp.value; inp.classList.add('changed'); }
        }
        e.per = g; count();
      });
      const su = $('[data-k=su]', tr);
      if (su) su.addEventListener('change', () => { entry().su = su.value; count(); });
    });
  };
  const load = async () => {
    const key = `${state.cat}|${state.q}`;
    if (!cache.has(key)) {
      $('#pmsg').textContent = 'Loading…';
      try {
        const r = await api(`/owner/prices?cat=${encodeURIComponent(state.cat)}&q=${encodeURIComponent(state.q)}`);
        cache.set(key, r.items);
        if (!$('#pcat')) return;
        if (!catsShown) { catsShown = true; $('#pcat').insertAdjacentHTML('beforeend', r.cats.map((c) => `<option>${esc(c)}</option>`).join('')); }
      } finally { if ($('#pmsg')) $('#pmsg').textContent = ''; }
    }
    draw(cache.get(key));
  };
  $('#pcat').addEventListener('change', (e) => { state.cat = e.target.value; state.q = ''; $('#pfind').value = ''; load(); });
  $('#pfind').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); state.q = e.target.value.trim(); load(); } });
  if ($('#padd2')) $('#padd2').addEventListener('click', () => productDialog(null, () => { cache.clear(); load(); }));
  $('#psave').addEventListener('click', () => submitting($('#psave'), async () => {
    if (!pending.size) throw new Error('Nothing was changed.');
    const changes = [];
    for (const [id, p] of pending) {
      const g = Number(p.per || (p.unit === 'kg' ? 1000 : 1));
      const ch = { id };
      for (const k of ['price', 'offer']) {
        if (p[k] === undefined) continue;
        if (String(p[k]).trim() === '') { if (k === 'offer') ch.offer = ''; continue; }
        const v = perKg(p[k], g, p.unit);
        if (v === null) throw new Error(`Check the ${k === 'price' ? 'price' : 'offer'} of ${p.name}.`);
        ch[k] = Money.rs(v);
      }
      if (p.stock !== undefined && String(p.stock).trim() !== '') {
        const q = Money.milli(p.stock);
        if (q === null) throw new Error(`Check the stock of ${p.name}.`);
        ch.stock = Money.qty(p.unit === 'kg' && p.su === 'g' ? Math.round(q / 1000) : q);
      }
      changes.push(ch);
    }
    const r = await api('/owner/prices', { method: 'POST', body: { changes } });
    for (const id of pending.keys()) saved.add(id);
    pending.clear(); cache.clear(); count();
    await load();
    toast(`Saved: ${r.changed} prices / offers${r.stock ? `, ${r.stock} stock counts` : ''}. The counters and the online shop have them.`);
  }));
  await load();
}

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
  const [{ offers }, info] = await Promise.all([api('/offers'), api('/shop-categories').catch(() => ({ cats: [] }))]);
  const msg = sessionStorage.getItem('mpc_offer_msg') || `*${App.settings.name}*\nThis week's offers are on! Fresh fruits, vegetables and daily needs at the best price.` +
    `\nOrder online: ${App.shopUrl || ''}\nOr visit the shop${App.settings.phone ? ` · ${App.settings.phone}` : ''}`;
  body.innerHTML = `<div class="card share-card" style="margin-bottom:12px"><h2 style="margin-top:0">${ico('share')} Tell your customers</h2>
      <p class="small muted" style="margin-top:0">Send the offer to everyone: <b>Share on WhatsApp</b> opens WhatsApp, where you choose a broadcast list, a group or your status.
        To make a broadcast list, download the customers' numbers and add them in WhatsApp (New broadcast).</p>
      <textarea id="omsg" rows="5">${esc(msg)}</textarea>
      <div class="row" style="margin-top:8px"><a class="btn primary" id="oshare" target="_blank" rel="noopener">Share on WhatsApp</a><button id="ocopy">Copy message</button>
        ${can('reports') ? `<a class="btn" href="/api/customers/export">${ico('download')} Customers' numbers (Excel)</a>` : ''}</div></div>
    <div class="card" style="margin-bottom:12px"><h2 style="margin-top:0">Offer on a whole category (festival offer)</h2>
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
    toast(`Offer set on ${r.count} products. Now tell your customers.`);
    const when = (v) => (v ? new Date(`${v}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
    sessionStorage.setItem('mpc_offer_msg', `*${App.settings.name}*\n${$('#bpct').value}% OFF on ${cat.value ? label : 'everything in the shop'}` +
      `${$('#bfrom').value ? ` from ${when($('#bfrom').value)}` : ''}${$('#bto').value ? ` till ${when($('#bto').value)}` : ''}!` +
      `\nOrder online: ${App.shopUrl || ''}\nOr visit the shop${App.settings.phone ? ` · ${App.settings.phone}` : ''}`);
    route();
  }));
  $('#bclear').addEventListener('click', () => submitting($('#bclear'), async () => {
    const cat = $('#bcat');
    if (!confirm(`Remove all offers on ${cat.value ? cat.options[cat.selectedIndex].text : 'ALL products'}?`)) return;
    const r = await api('/offers/clear', { method: 'POST', body: { category_id: cat.value } });
    toast(`Offers removed from ${r.count} products.`);
    route();
  }));
  const shareLink = () => {
    const t = encodeURIComponent($('#omsg').value);
    $('#oshare').href = /Android|iPhone|iPad/i.test(navigator.userAgent) ? `https://wa.me/?text=${t}`
      : App.settings.whatsapp_open === 'web' ? `https://web.whatsapp.com/send?text=${t}` : `whatsapp://send?text=${t}`;
  };
  $('#omsg').addEventListener('input', () => { sessionStorage.setItem('mpc_offer_msg', $('#omsg').value); shareLink(); });
  shareLink();
  $('#ocopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#omsg').value); toast('Copied. Paste it in WhatsApp.'); } catch (_) { toast('Select the text and copy it.', true); } });
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

// ================================================================== Low stock (instead of purchases)
App.views.lowstock = async (main) => {
  const [alert, out] = await Promise.all([api('/products?status=alert&limit=200'), api('/products?status=out&limit=100')]);
  const table = (items) => `<table><tr><th>Product</th><th class="r">Stock</th><th class="r hide-sm">Alert at</th><th></th></tr>
    ${items.map((i) => `<tr class="click" data-id="${i.id}"><td>${esc(i.name)}<div class="small ta muted">${esc(i.name_ta)}</div></td>
      <td class="r ${Number(i.on_hand) <= 0 ? 'bad' : 'warn'}"><b>${esc(i.on_hand)}</b> ${i.unit === 'kg' ? 'kg' : 'pcs'}</td>
      <td class="r hide-sm">${Number(i.reorder_level) ? `${esc(i.reorder_level)} ${i.unit === 'kg' ? 'kg' : 'pcs'}` : ''}</td>
      <td class="r">${can('receive') ? '<button class="small" data-add>Add stock</button>' : ''}</td></tr>`).join('')}</table>`;
  main.innerHTML = `<h1>Low stock</h1>
    <p class="muted small">Products at or below their <b>low stock alert</b>. Set the alert in each product (Products & stock, open the product,
      "Low stock alert when stock ≤"). Tap a product to add stock or count it.</p>
    <h2>Below the alert (${alert.total})</h2>
    ${alert.items.length ? table(alert.items) : '<p class="muted">Nothing is below its alert.</p>'}
    <h2 style="margin-top:18px">Selling, but no stock (${out.total})</h2>
    <p class="small muted">Best sellers first${out.total > out.items.length ? `; the first ${out.items.length} are shown` : ''}. These do not show in the online shop until stock is added.</p>
    ${out.items.length ? table(out.items) : '<p class="muted">Every selling product has stock.</p>'}`;
  const all = [...alert.items, ...out.items];
  $$('tr[data-id]', main).forEach((tr) => tr.addEventListener('click', (e) => {
    const it = all.find((x) => x.id === Number(tr.dataset.id));
    if (e.target.closest('[data-add]') || can('receive')) stockDialog(it, 'in', () => route());
    else productDialog(it.id, () => route());
  }));
};
