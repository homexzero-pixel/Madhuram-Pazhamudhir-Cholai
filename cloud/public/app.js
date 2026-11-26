/* Madhuram cloud: all screens except billing (pos.js). */
'use strict';

const App = { me: null, perms: new Set(), settings: {}, counters: [], version: '', installEvent: null, views: {}, afterFrame: [] };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const can = (p) => App.perms.has(p);

// ------------------------------------------------------------------ money (same integer rules as the server)
const Money = {
  paise(v) {
    const s = String(v ?? '').trim().replace(/,/g, '');
    if (!/^-?\d*(\.\d*)?$/.test(s) || s === '' || s === '.' || s === '-') return null;
    const neg = s.startsWith('-');
    const [w, f = ''] = s.replace('-', '').split('.');
    let n = Number((w || '0') + f.slice(0, 2).padEnd(2, '0'));
    if (f.length > 2 && Number(f[2]) >= 5) n += 1;
    return neg ? -n : n;
  },
  milli(v) {
    const s = String(v ?? '').trim();
    if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') return null;
    const [w, f = ''] = s.split('.');
    let n = Number((w || '0') + f.slice(0, 3).padEnd(3, '0'));
    if (f.length > 3 && Number(f[3]) >= 5) n += 1;
    return n;
  },
  rs(p) { const neg = p < 0; p = Math.abs(p); return `${neg ? '-' : ''}${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`; },
  qty(m) { return `${Math.floor(m / 1000)}.${String(m % 1000).padStart(3, '0')}`.replace(/\.?0+$/, ''); },
  line(ratePaise, qtyMilli) { const n = ratePaise * qtyMilli; return Math.floor((2 * n + 1000) / 2000); },
};
function inr(v) {                       // '1234567.5' or paise number -> ₹12,34,567.50
  const p = typeof v === 'number' ? v : Money.paise(v) ?? 0;
  const s = Money.rs(Math.abs(p));
  let [w, f] = s.split('.');
  if (w.length > 3) w = `${w.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${w.slice(-3)}`;
  return `${p < 0 ? '-' : ''}₹${w}.${f}`;
}
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month'],
  ['quarter', 'This quarter'], ['year', 'This year']];
const periodChips = (cur, base) => `<div class="cats periods">${PERIODS.map(([k, l]) =>
  `<a class="btn ${k === cur ? 'primary' : ''}" href="#/${base}${base.includes('?') ? '&' : '?'}period=${k}">${l}</a>`).join('')}</div>`;
const backupDoneToday = () => localStorage.getItem('mpc_backup_day') === today();

// Make a phone photo small before sending it: at most 640 px, WebP or JPEG.
async function shrinkPhoto(file, max = 640) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('Could not read this photo.')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/webp', 0.82));
    return blob && blob.type === 'image/webp' ? blob : new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}

// ------------------------------------------------------------------ server calls
async function api(path, { method = 'GET', body, raw, type } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (raw !== undefined) { opts.body = raw; opts.headers['Content-Type'] = type || 'application/octet-stream'; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch (_) {
    const e = new Error('No internet connection to the store server. Check the internet and try again.');
    e.offline = true;
    throw e;
  }
  let data = {};
  try { data = await res.json(); } catch (_) { data = { ok: false, error: `Server answered ${res.status}. Try again.` }; }
  if (res.status === 401 && path !== '/login' && path !== '/approve') { App.me = null; showLogin(); }
  if (!res.ok || data.ok === false) {
    const e = new Error(data.error || 'Something went wrong.');
    e.status = res.status;
    throw e;
  }
  return data;
}

function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, bad ? 5000 : 2600);
}

// A modal box. `html` is the inside; returns the <dialog>. It is removed when closed.
function modal(html, { onClose } = {}) {
  const d = document.createElement('dialog');
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => { d.remove(); if (onClose) onClose(d.returnValue); });
  $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => d.close('cancel')));
  d.showModal();
  const first = $('[autofocus]', d) || $('input, select, textarea', d);
  if (first) setTimeout(() => first.focus(), 30);
  return d;
}
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}
async function submitting(button, fn) {
  if (button) button.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); return undefined; } finally { if (button) button.disabled = false; }
}

// A manager types their login name + PIN on this screen. Resolves to an approval token, or null if cancelled.
function managerApproval(perm, why) {
  return new Promise((resolve) => {
    let token = null;
    const d = modal(`<h3>Manager approval</h3><p class="muted">${esc(why)}</p>
      <form><label>Manager / owner login name</label><input name="username" autocomplete="off" required autofocus>
      <label>PIN</label><input name="pin" type="password" inputmode="numeric" autocomplete="off" required>
      <div class="error" hidden></div>
      <div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Approve</button></div></form>`,
    { onClose: () => resolve(token) });
    $('form', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      try {
        const r = await api('/approve', { method: 'POST', body: { ...f, perm } });
        token = r.token;
        toast(`Approved by ${r.approver.name}`);
        d.close('ok');
      } catch (err) {
        const box = $('.error', d); box.hidden = false; box.textContent = err.message;
      }
    });
  });
}

// ------------------------------------------------------------------ install on this PC (PWA)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  App.installEvent = e;
  $$('.install-btn').forEach((b) => b.classList.add('show'));
});
window.addEventListener('appinstalled', () => {
  App.installEvent = null;
  $$('.install-btn').forEach((b) => b.classList.remove('show'));
  toast('Installed. Open "Madhuram Store" from the desktop or Start menu.');
});
async function installApp() {
  if (App.installEvent) {
    App.installEvent.prompt();
    await App.installEvent.userChoice;
    App.installEvent = null;
    return;
  }
  location.hash = '#/install';
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// ------------------------------------------------------------------ this PC's counter
function counterFromUrl() {
  const m = location.search.match(/[?&]counter=(\d{1,2})/);
  if (!m) return;
  const name = App.counters.find((c) => c.replace(/\D/g, '') === m[1]) || `Counter ${m[1]}`;
  localStorage.setItem('mpc_counter', name);
  history.replaceState(null, '', `/${location.hash || '#/bill'}`);
}
const myCounter = () => localStorage.getItem('mpc_counter') || '';
function pickCounter(after) {
  const d = modal(`<h3>Which counter is this PC?</h3><p class="muted">Each counter has its own shift and cash drawer. This is remembered on this PC.</p>
    <div class="cards">${App.counters.map((c) => `<button class="big ${c === myCounter() ? 'primary' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    ${can('reopen_shift') ? `<form id="addc" class="row"><input name="name" placeholder="New counter name" value="Counter ${App.counters.length + 1}" style="max-width:220px">
      <button>+ Add counter</button></form>` : ''}
    <div class="actions"><button data-close>Close</button></div>`);
  $$('[data-c]', d).forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('mpc_counter', b.dataset.c);
    const w = $('#who-c'); if (w) w.textContent = b.dataset.c;
    d.close('ok');
    if (after) after();
  }));
  if ($('#addc', d)) $('#addc', d).addEventListener('submit', (e) => { e.preventDefault(); submitting($('button', e.target), async () => {
    const name = e.target.name.value.trim();
    const r = await api('/counters', { method: 'POST', body: { counters: [...App.counters, name] } });
    App.counters = r.counters;
    toast(`${name} added.`);
    d.close();
    pickCounter(after);
  }); });
}

// ------------------------------------------------------------------ frame, menu and routing
// [route, label, permission, icon, group]
const MENU = [
  ['bill', 'Billing', 'bill', 'bill', 'Sales'], ['orders', 'Online orders', 'orders', 'bag', 'Sales'], ['bills', 'Bills', 'bill', 'file', 'Sales'],
  ['returns', 'Returns', 'bill', 'undo', 'Sales'], ['cash', 'Cash closing', 'cash', 'wallet', 'Sales'],
  ['products', 'Products & stock', 'stock_view', 'box', 'Stock'], ['purchases', 'Purchases', 'purchase', 'truck', 'Stock'],
  ['customers', 'Customers', 'customers', 'users', 'People'], ['staff', 'Staff', 'users', 'user', 'People'],
  ['dashboard', 'Dashboard', 'reports', 'chart', 'Reports'], ['reports', 'Reports', 'reports', 'pie', 'Reports'], ['owner', 'Daily tools', 'daily', 'tools', 'Reports'],
  ['settings', 'Settings & backup', 'settings', 'settings', 'Admin'], ['install', 'Install on this PC', null, 'download', 'Admin'],
];
function navHtml() {
  let group = '';
  return MENU.filter((m) => !m[2] || can(m[2])).map((m) => {
    const head = m[4] !== group ? `<div class="nav-h">${esc(m[4])}</div>` : '';
    group = m[4];
    return `${head}<a href="#/${m[0]}" data-r="${m[0]}">${ico(m[3])}<span class="lbl">${esc(m[1])}</span><span class="badge"></span></a>`;
  }).join('');
}

function frame() {
  const s = App.settings;
  $('#app').className = '';
  $('#app').innerHTML = `
    <div class="topbar"><button id="menu-btn" aria-label="Menu">${ico('menu')}</button><b>${esc(s.name)}</b>
      <button class="install-btn primary">Install</button></div>
    <div class="shell">
      <aside class="side" id="side">
        <div class="side-brand"><img src="/img/logo.webp" alt=""><div><b>${esc(s.name)}</b><span>Store software</span></div></div>
        <nav class="nav">${navHtml()}</nav>
        <button class="install-btn" id="install-btn">${ico('download')} Install on this PC</button>
        <div class="who"><div class="who-n">${esc(App.me.name)}</div><div class="who-r">${esc(App.me.role)} · <span id="who-c">${esc(myCounter() || 'no counter')}</span></div>
          <a href="#" id="logout">${ico('logout')} Log out</a><span class="ver">v${esc(App.version)}</span></div>
      </aside>
      <main class="main" id="main"></main>
    </div>`;
  if (App.installEvent) $$('.install-btn').forEach((b) => b.classList.add('show'));
  $$('.install-btn').forEach((b) => b.addEventListener('click', installApp));
  $('#menu-btn').addEventListener('click', () => $('#side').classList.toggle('open'));
  markBackup();
  if (window.matchMedia('(display-mode: standalone)').matches) { const b = $('.nav a[data-r="install"] .badge'); if (b) b.innerHTML = `<span class="ok">${ico('check')}</span>`; }
  App.afterFrame.forEach((fn) => fn());
  $('#logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await api('/logout', { method: 'POST' }).catch(() => {});
    App.me = null;
    showLogin();
  });
}

// The settings menu shows a red dot until today's backup has been downloaded on this PC.
function markBackup() {
  const a = $('.nav a[data-r="settings"] .badge');
  if (!a || !can('backup')) return;
  a.innerHTML = backupDoneToday() ? '<span class="dot ok-dot" title="Backup downloaded today"></span>' : '<span class="dot bad-dot" title="Download today\'s backup"></span>';
}

async function route() {
  if (!App.me) return;
  if (!$('#main')) frame();
  const name = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'bill');
  const m = MENU.find((x) => x[0] === name);
  const allowed = m && (!m[2] || can(m[2]));
  const target = allowed ? name : (can('bill') ? 'bill' : can('reports') ? 'dashboard' : 'products');
  if (!allowed && name !== target) { location.hash = `#/${target}`; return; }
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === target));
  $('#side').classList.remove('open');
  if (App.leave) { App.leave(); App.leave = null; }
  const main = $('#main');
  main.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await App.views[target](main);
  } catch (e) {
    main.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', route);

async function start() {
  try {
    const st = await api('/status');
    App.version = st.version;
    document.title = st.name;
    if (st.setup_needed) return showSetup(st);
    if (!st.logged_in) return showLogin(st);
    await loadMe();
    counterFromUrl();
    frame();
    route();
  } catch (e) {
    $('#app').innerHTML = `<div class="login card"><h1>Cannot reach the store server</h1><p>${esc(e.message)}</p>
      <button class="primary" id="retry">Try again</button></div>`;
    $('#retry').addEventListener('click', () => location.reload());
  }
}
async function loadMe() {
  const me = await api('/me');
  App.me = me.user;
  App.perms = new Set(me.perms);
  App.settings = me.settings;
  App.counters = me.counters;
  App.version = me.version;
}

// ------------------------------------------------------------------ login and first-time setup
function showLogin(st) {
  if (App.leave) { App.leave(); App.leave = null; }
  $('#app').className = '';
  $('#app').innerHTML = `<div class="login card">
    <img src="/img/logo.webp" alt="">
    <h1>Log in</h1>
    <form id="login-form"><label>Login name</label><input name="username" autocomplete="username" required autofocus>
      <label>Password</label><input name="password" type="password" autocomplete="current-password" required>
      <label class="row small" style="font-weight:400"><input type="checkbox" id="showpw" style="width:auto"> Show password</label>
      <div class="error" hidden></div>
      <button class="primary big" style="width:100%;margin-top:10px">Log in</button></form>
    <p class="small muted">Forgot the password? The owner can set a new one in Staff logins.</p>
    <button class="install-btn" style="width:100%">Install on this PC</button></div>`;
  if (App.installEvent) $$('.install-btn').forEach((b) => b.classList.add('show'));
  $$('.install-btn').forEach((b) => b.addEventListener('click', installApp));
  $('#showpw').addEventListener('change', (e) => { $('[name=password]').type = e.target.checked ? 'text' : 'password'; });
  $('[name=username]').focus();
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button.primary', e.target);
    btn.disabled = true;
    try {
      await api('/login', { method: 'POST', body: formData(e.target) });
      await loadMe();
      counterFromUrl();
      frame();
      if (!location.hash) location.hash = can('bill') ? '#/bill' : '#/dashboard';
      route();
    } catch (err) {
      const box = $('.error', e.target); box.hidden = false; box.textContent = err.message;
    } finally { btn.disabled = false; }
  });
  void st;
}

function showSetup() {
  $('#app').className = '';
  $('#app').innerHTML = `<div class="login card" style="max-width:520px">
    <img src="/img/logo.webp" alt="">
    <h1>Welcome! First-time setup</h1>
    <p class="muted">Create the owner login. You can add cashiers and managers afterwards.</p>
    <form id="setup-form">
      <label>Shop name</label><input name="shop_name" value="Madhuram Pazhamudhir Cholai" required>
      <div class="grid2"><div><label>Your name</label><input name="name" value="Owner" required></div>
        <div><label>Login name</label><input name="username" value="owner" required autocomplete="off"></div></div>
      <div class="grid2"><div><label>Password (at least 6 letters/digits)</label><input name="password" type="text" required minlength="6" autocomplete="new-password"></div>
        <div><label>Approval PIN (4–6 digits)</label><input name="pin" inputmode="numeric" pattern="\\d{4,6}" required></div></div>
      <p class="small muted">The password is shown while you type so you can check it. Write it down and keep it safe.
        The PIN is used to approve discounts and price changes at the counter.</p>
      <div class="error" hidden></div>
      <button class="primary big" style="width:100%">Create owner login and start</button></form></div>`;
  $('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/setup', { method: 'POST', body: formData(e.target) });
      await loadMe();
      frame();
      location.hash = '#/settings';
      route();
      toast('Store set up. Next: fill in the shop details, add products and staff.');
    } catch (err) {
      const box = $('.error', e.target); box.hidden = false; box.textContent = err.message;
    }
  });
}

// ------------------------------------------------------------------ receipt (80 mm / 58 mm thermal)
function receiptHtml(b) {
  const s = App.settings;
  const lines = b.lines.map((l) => `<tr><td colspan="3">${esc(l.name)}${l.name_ta ? `<br><span class="ta">${esc(l.name_ta)}</span>` : ''}</td></tr>
    <tr><td>${esc(l.qty)} ${l.unit === 'kg' ? 'kg' : ''} × ${esc(l.rate)}</td><td></td><td class="r">${esc(l.gross)}</td></tr>
    ${Number(l.discount) ? `<tr><td colspan="2">  Discount</td><td class="r">-${esc(l.discount)}</td></tr>` : ''}`).join('');
  const saved = b.lines.reduce((sum, l) => sum + (l.mrp ? Math.max(0, Money.line(Money.paise(l.mrp), Money.milli(l.qty)) - Money.paise(l.net)) : 0), 0);
  const pays = b.payments.map((p) => `<tr><td>${esc(p.method.toUpperCase())}${p.reference ? ` ${esc(p.reference)}` : ''}</td><td></td>
    <td class="r">${esc(p.amount)}</td></tr>${p.tendered ? `<tr><td>Cash given</td><td></td><td class="r">${esc(p.tendered)}</td></tr>
    <tr><td>Change</td><td></td><td class="r">${esc(p.change_amt)}</td></tr>` : ''}`).join('');
  const gst = b.gst.length ? `<hr><table><tr><th>GST%</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th></tr>
    ${b.gst.map((g) => `<tr><td>${esc(Number(g.rate))}</td><td class="r">${esc(g.taxable)}</td><td class="r">${esc(g.cgst)}</td><td class="r">${esc(g.sgst)}</td></tr>`).join('')}</table>` : '';
  return `<div class="receipt ${s.receipt_width === '58' ? 'w58' : ''}">
    <div class="c"><h2>${esc(s.name)}</h2>${s.name_ta ? `<div class="ta">${esc(s.name_ta)}</div>` : ''}
    ${s.address ? `<div>${esc(s.address)}</div>` : ''}${s.phone ? `<div>Ph: ${esc(s.phone)}</div>` : ''}
    ${s.gstin ? `<div>GSTIN: ${esc(s.gstin)}</div>` : ''}${s.fssai ? `<div>FSSAI: ${esc(s.fssai)}</div>` : ''}</div><hr>
    <div>Bill: <b>${esc(b.bill_no)}</b>${b.print_count > 0 ? ' (COPY)' : ''}</div>
    <div>${esc(b.at)} · ${esc(b.counter)} · ${esc(b.cashier)}</div>
    ${b.customer ? `<div>Customer: ${esc(b.customer.name)} ${esc(b.customer.phone || '')}</div>` : ''}<hr>
    <table>${lines}</table><hr>
    <table><tr><td>Items</td><td class="r">${b.items_count}</td></tr>
    ${Number(b.discount) ? `<tr><td>Discount</td><td class="r">-${esc(b.discount)}</td></tr>` : ''}
    <tr class="tot"><td>TOTAL</td><td class="r">${inr(b.total)}</td></tr></table>
    <table>${pays}</table>${gst}
    ${saved > 0 ? `<hr><div class="c">You saved ${inr(saved)} on MRP</div>` : ''}
    ${b.customer && (Number(b.points_earned) || Number(b.points_used)) ? `<hr><div class="c">${Number(b.points_used) ? `Points used: ${Number(b.points_used)} · ` : ''}Points earned: ${Number(b.points_earned)}<br>
      Points balance: <b>${Number(b.customer.points)}</b></div>` : ''}
    <hr><div class="c">${esc(s.bill_footer)}</div></div>`;
}
async function printBill(bill, reprint = false) {
  const two = App.settings.print_copies === '2' && !reprint;
  $('#print-area').innerHTML = two
    ? `<div class="copy-label">CUSTOMER COPY</div>${receiptHtml(bill)}<div class="page-break"></div><div class="copy-label">SHOP COPY</div>${receiptHtml(bill)}`
    : receiptHtml(bill);
  await new Promise((r) => setTimeout(r, 50));
  window.print();
  api(`/bills/${bill.id}/printed`, { method: 'POST', body: { reprint } }).catch(() => {});
}

// ================================================================== Bills (recent bills, reprint)
App.views.bills = async (main) => {
  main.innerHTML = `<h1>Bills</h1><div class="row" style="margin-bottom:10px">
    <input id="bq" placeholder="Bill number, customer name or mobile" style="max-width:300px">
    <select id="bp" style="max-width:160px">${PERIODS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}<option value="day">Pick a date…</option></select>
    <input id="bd" type="date" value="${today()}" style="max-width:170px" hidden>
    ${can('reports') ? `<select id="bc" style="max-width:170px"><option value="">All counters</option>${App.counters.map((c) => `<option>${esc(c)}</option>`).join('')}</select>` : ''}
  </div><div id="bsum" class="muted small"></div><div id="blist"></div>`;
  const load = async () => {
    const period = $('#bp').value;
    $('#bd').hidden = period !== 'day';
    const qs = new URLSearchParams({ q: $('#bq').value, ...(period === 'day' ? { date: $('#bd').value } : { period }),
      counter: can('reports') ? $('#bc').value : myCounter() });
    const { bills } = await api(`/bills?${qs}`);
    const sum = bills.reduce((a, b) => a + Money.paise(b.total), 0);
    $('#bsum').textContent = bills.length ? `${bills.length} bills · ${inr(sum)}${bills.length >= 500 ? ' (latest 500 shown)' : ''}` : '';
    $('#blist').innerHTML = bills.length ? `<div class="tablewrap"><table><tr><th>Bill</th><th>Date & time</th><th class="hide-sm">Counter</th><th class="hide-sm">Cashier</th>
      <th>Customer</th><th>Paid by</th><th class="r">Total</th></tr>${bills.map((b) => `<tr class="click" data-id="${b.id}">
      <td>${esc(b.bill_no)}</td><td>${esc(b.created_at.slice(0, 16))}</td><td class="hide-sm">${esc(b.counter)}</td><td class="hide-sm">${esc(b.cashier)}</td>
      <td>${esc(b.customer || '')}</td><td>${esc((b.methods || '').toUpperCase())}</td><td class="r">${inr(b.total)}</td></tr>`).join('')}</table></div>`
      : '<p class="muted">No bills.</p>';
    $$('#blist tr[data-id]').forEach((tr) => tr.addEventListener('click', () => showBill(tr.dataset.id)));
  };
  let t;
  $('#bq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
  $('#bp').addEventListener('change', load);
  $('#bd').addEventListener('change', load);
  if ($('#bc')) $('#bc').addEventListener('change', load);
  await load();
};
async function showBill(id) {
  const { bill } = await api(`/bills/${id}`);
  if (typeof billPreview === 'function') { billPreview(bill, { reprint: true }); return; }
  const d = modal(`<div class="preview">${receiptHtml(bill)}</div>
    <div class="actions"><button data-close>Close</button><button class="primary" id="rp">Print again</button></div>`);
  $('#rp', d).addEventListener('click', () => { d.close(); printBill(bill, true); });
}

// ================================================================== Cash closing (per counter)
App.views.cash = async (main) => {
  const counter = myCounter();
  if (!counter) { main.innerHTML = '<h1>Cash closing</h1><p>Choose this PC\'s counter first.</p><button class="primary" id="pc">Choose counter</button>';
    $('#pc').addEventListener('click', () => pickCounter(route)); return; }
  const { shift, summary } = await api(`/shift?counter=${encodeURIComponent(counter)}`);
  let html = `<h1>Cash closing · ${esc(counter)} <button class="small" id="pc">Change counter</button></h1>`;
  if (!shift) {
    html += `<div class="card" style="max-width:460px"><h2>Open shift</h2><p class="muted">Count the cash in the drawer before starting.</p>
      <form id="open"><label>Opening cash in drawer (₹)</label><input name="float" inputmode="decimal" required autofocus>
      <button class="primary big" style="margin-top:12px">Open shift on ${esc(counter)}</button></form></div>`;
  } else {
    const row = (l, v, cls = '') => `<tr><td>${l}</td><td class="r ${cls}">${inr(v)}</td></tr>`;
    html += `<div class="cards">
      <div class="card stat"><div class="l">Bills this shift</div><div class="v">${summary.bills}</div></div>
      <div class="card stat"><div class="l">Sales this shift</div><div class="v">${inr(summary.sales_total)}</div></div>
      <div class="card stat"><div class="l">Cash expected in drawer</div><div class="v">${inr(summary.expected)}</div></div></div>
      <div class="grid2"><div class="card"><h2 style="margin-top:0">Shift of ${esc(shift.cashier)} · opened ${esc(shift.opened_at.slice(0, 16))}</h2>
        <table>${row('Opening cash (checked at opening)', summary.float)}${row('+ Cash sales', summary.cash_sales)}${row('+ Cash in', summary.cash_in)}
        ${Number(summary.udhaar_received) ? row('&nbsp;&nbsp;(of which credit paid back)', summary.udhaar_received, 'muted') : ''}
        ${row('− Cash out', summary.cash_out)}${Number(summary.refunds) ? row('&nbsp;&nbsp;(of which refunds)', summary.refunds, 'muted') : ''}
        ${Number(summary.supplier_paid) ? row('&nbsp;&nbsp;(of which paid to suppliers)', summary.supplier_paid, 'muted') : ''}
        ${Number(summary.expenses) ? row('&nbsp;&nbsp;(of which expenses)', summary.expenses, 'muted') : ''}<tr><td><b>Cash expected</b></td><td class="r"><b>${inr(summary.expected)}</b></td></tr>
        ${row('UPI (not in drawer)', summary.upi, 'muted')}${row('Card (not in drawer)', summary.card, 'muted')}
        ${Number(summary.credit) ? row('Credit / udhaar given', summary.credit, 'muted') : ''}</table>
        <h2>Cash in / out</h2><form id="move" class="row"><select name="kind" style="max-width:150px"><option value="out">Cash out</option>
          <option value="in">Cash in</option><option value="deposit">To owner / bank</option></select>
          <input name="amount" inputmode="decimal" placeholder="₹" style="max-width:110px" required>
          <input name="reason" placeholder="Reason" style="flex:1" required><button>Save</button></form></div>
      <div class="card"><h2 style="margin-top:0">Close shift</h2><form id="close">
        <label>Cash counted in the drawer now (₹)</label><input name="counted" inputmode="decimal" required>
        <p class="small muted">The counted cash becomes the opening balance of the next shift on ${esc(counter)}; it is checked when the next shift opens.</p>
        <label>Note</label><input name="note" maxlength="200">
        <button class="primary big" style="margin-top:12px">Close shift</button></form><div id="closed"></div></div></div>`;
  }
  if (can('reports')) html += '<h2>Recent shifts (all counters)</h2><div id="shifts"></div>';
  main.innerHTML = html;
  $('#pc').addEventListener('click', () => pickCounter(route));
  if ($('#open')) $('#open').addEventListener('submit', (e) => { e.preventDefault(); submitting($('button', e.target), async () => {
    await api('/shift/open', { method: 'POST', body: { counter, float: e.target.float.value } });
    toast('Shift opened. You can bill now.');
    location.hash = '#/bill';
  }); });
  if ($('#move')) $('#move').addEventListener('submit', (e) => { e.preventDefault(); submitting($('button', e.target), async () => {
    await api('/shift/cash', { method: 'POST', body: { ...formData(e.target), counter } });
    toast('Saved.');
    route();
  }); });
  if ($('#close')) $('#close').addEventListener('submit', (e) => { e.preventDefault(); submitting($('button', e.target), async () => {
    const f = formData(e.target);
    if (!confirm(`Close the shift on ${counter} with ₹${f.counted} counted?`)) return;
    const { result } = await api('/shift/close', { method: 'POST', body: { ...f, shift_id: shift.id } });
    const v = Money.paise(result.variance);
    main.innerHTML = `<h1>Shift closed · ${esc(counter)}</h1><div class="card" style="max-width:520px"><table>
      <tr><td>Cash expected</td><td class="r">${inr(result.expected)}</td></tr><tr><td>Cash counted</td><td class="r">${inr(result.counted)}</td></tr>
      <tr><td><b>${v === 0 ? 'Matches' : v > 0 ? 'Extra cash' : 'Short'}</b></td><td class="r ${v === 0 ? 'ok' : 'bad'}"><b>${inr(result.variance)}</b></td></tr>
      <tr><td>UPI</td><td class="r">${inr(result.upi)}</td></tr><tr><td>Card</td><td class="r">${inr(result.card)}</td></tr>
      <tr><td>Opening balance for the next shift</td><td class="r">${inr(result.counted)}</td></tr></table>
      <div class="row" style="margin-top:12px"><button class="primary" id="again">Open next shift</button></div></div>`;
    $('#again').addEventListener('click', route);
  }); });
  if (can('reports')) {
    const { shifts } = await api('/shifts');
    $('#shifts').innerHTML = `<table><tr><th>Counter</th><th>Cashier</th><th>Opened</th><th>Status</th><th class="r">Expected</th><th class="r">Counted</th>
      <th class="r">Difference</th></tr>${shifts.map((s) => `<tr><td>${esc(s.counter)}</td><td>${esc(s.cashier)}</td><td>${esc(s.opened_at.slice(0, 16))}</td>
      <td>${s.status === 'open' ? '<span class="pill">open</span>' : '<span class="pill off">closed</span>'}</td>
      <td class="r">${s.expected ? inr(s.expected) : ''}</td><td class="r">${s.counted ? inr(s.counted) : ''}</td>
      <td class="r ${Number(s.variance) ? 'bad' : ''}">${s.variance !== null ? inr(s.variance) : ''}</td></tr>`).join('')}</table>`;
  }
};

// ================================================================== Products & stock
App.views.products = async (main) => {
  main.innerHTML = `<h1>Products & stock</h1>
    <div class="row" style="margin-bottom:10px">
      <input id="pq" placeholder="Scan barcode or search name / code" style="max-width:380px" autofocus>
      <select id="ps" style="max-width:200px"><option value="all">All products</option><option value="active">Selling now</option>
        <option value="inactive">Not selling (no price)</option><option value="low">Low stock</option><option value="nophoto">No photo (best sellers first)</option></select>
      ${can('products') ? `<button class="primary" id="padd">+ Add product</button><button id="pimp">Import CSV</button>
        <button id="pbulk">${ico('image')} Bulk photos</button><button id="pmode">${ico('camera')} Photo mode</button>` : ''}
    </div><div id="plist"></div><div id="pmore"></div>`;
  let offset = 0;
  const load = async (more = false) => {
    offset = more ? offset + 50 : 0;
    const qs = new URLSearchParams({ q: $('#pq').value, status: $('#ps').value, offset });
    const { items, total } = await api(`/products?${qs}`);
    const rows = items.map((i) => `<tr class="click" data-id="${i.id}"><td><div class="row" style="flex-wrap:nowrap;gap:8px">
      ${i.image ? `<img class="thumb" src="${esc(i.image)}" alt="" loading="lazy">` : '<span class="thumb none"></span>'}
      <span>${esc(i.name)}${i.name_ta ? `<div class="small ta muted">${esc(i.name_ta)}</div>` : ''}</span></div></td>
      <td class="hide-sm small">${esc(i.sku)}${i.plu ? ` · PLU ${esc(i.plu)}` : ''}<br>${esc(i.codes.join(', '))}</td>
      <td class="r">${i.price ? inr(i.price) : '<span class="pill off">no price</span>'}${i.unit === 'kg' ? '/kg' : ''}</td>
      <td class="r ${Number(i.on_hand) <= Number(i.reorder_level) && i.active ? 'warn' : ''}">${esc(i.on_hand)} ${esc(i.unit)}</td>
      <td class="hide-sm">${i.active ? '<span class="pill">selling</span>' : '<span class="pill off">off</span>'}</td></tr>`).join('');
    if (!more) $('#plist').innerHTML = `<p class="small muted">${total} products</p><table><tbody id="ptb"><tr><th>Product</th><th class="hide-sm">Codes</th>
      <th class="r">Price</th><th class="r">Stock</th><th class="hide-sm"></th></tr></tbody></table>`;
    $('#ptb').insertAdjacentHTML('beforeend', rows);
    $$('#ptb tr[data-id]:not([data-b])').forEach((tr) => { tr.dataset.b = 1; tr.addEventListener('click', () => productDialog(Number(tr.dataset.id), () => load())); });
    $('#pmore').innerHTML = offset + 50 < total ? '<button id="more" style="margin-top:10px">Show more</button>' : '';
    if ($('#more')) $('#more').addEventListener('click', () => load(true));
  };
  let t;
  $('#pq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load(), 300); });
  $('#ps').addEventListener('change', () => load());
  if ($('#padd')) $('#padd').addEventListener('click', () => productDialog(null, () => load()));
  // Scan or type + Enter: open the product; a new barcode opens "Add product" with the barcode filled in
  $('#pq').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = $('#pq').value.trim();
    if (!v) return;
    const { items } = await api(`/products?q=${encodeURIComponent(v)}`);
    const exact = items.find((i) => i.codes.includes(v) || i.sku === v || i.plu === v) || (items.length === 1 ? items[0] : null);
    if (exact) { productDialog(exact.id, () => load()); return; }
    if (/^\d{6,14}$/.test(v) && can('products')) { productDialog(null, () => load(), { barcode: v }); return; }
    load();
  });
  if ($('#pimp')) $('#pimp').addEventListener('click', () => importDialog(() => load()));
  if ($('#pbulk')) $('#pbulk').addEventListener('click', () => bulkPhotos(() => load()));
  if ($('#pmode')) $('#pmode').addEventListener('click', () => photoMode(() => load()));
  await load();
};

// Add / edit a product. Also used at the counter for an unknown barcode (`preset.barcode`). onSaved(item) is called after saving.
async function productDialog(id, onSaved, preset = {}) {
  let item = { name: '', name_ta: '', unit: 'pcs', price: '', mrp: '', gst_rate: '0', tax_class: 'unset', hsn: '', plu: '', reorder_level: '0',
    cat: '', codes: preset.barcode ? [preset.barcode] : [], active: true, on_hand: '0' };
  let moves = [];
  if (id) ({ item, moves } = await api(`/products/${id}`));
  const editable = can('products') || preset.approval;
  const d = modal(`<h3>${id ? 'Product' : 'Add product'}</h3>
    <form id="pf">
      ${id ? `<div class="photo-row"><div class="photo" id="ph">${item.image ? `<img src="${esc(item.image)}" alt="">` : '<span>No photo</span>'}</div>
        ${can('products') ? `<div><label class="btn" for="phf">${ico('camera')} Take or choose photo</label><input id="phf" type="file" accept="image/*" capture="environment" hidden>
          ${item.image ? '<button type="button" class="danger" id="phx">Remove photo</button>' : ''}
          <div class="small muted">${item.image_source === 'openfoodfacts' ? 'Photo: Open Food Facts' : 'Shown in the online shop and on the billing tiles.'}</div></div>` : ''}</div>` : ''}
      <label>Name (English)</label><input name="name" value="${esc(item.name)}" required ${id ? '' : 'autofocus'}>
      <label>Name (Tamil)</label><input name="name_ta" class="ta" value="${esc(item.name_ta)}">
      <div class="grid3"><div><label>Selling price ₹</label><input name="price" inputmode="decimal" value="${esc(item.price ?? '')}" ${id ? 'autofocus' : ''}></div>
        <div><label>MRP ₹</label><input name="mrp" inputmode="decimal" value="${esc(item.mrp ?? '')}"></div>
        <div><label>Sold by</label><select name="unit"><option value="pcs">Piece / pack</option><option value="kg" ${item.unit === 'kg' ? 'selected' : ''}>Weight (kg)</option></select></div></div>
      <div class="grid3"><div><label>GST %</label><select name="gst_rate">${['0', '5', '12', '18', '28', '40', '3', '0.25'].map((g) => `<option ${Number(item.gst_rate) === Number(g) ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
        <div><label>GST type</label><select name="tax_class">${[['unset', 'Not set yet'], ['taxable', 'Taxable'], ['exempt', 'Exempt'], ['nil', 'Nil-rated']].map(([v, l]) => `<option value="${v}" ${item.tax_class === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>HSN</label><input name="hsn" value="${esc(item.hsn)}"></div></div>
      <div class="grid3"><div><label>Category</label><input name="cat" value="${esc(item.cat)}" list="catlist"></div>
        <div><label>PLU (loose items)</label><input name="plu" inputmode="numeric" value="${esc(item.plu)}"></div>
        <div><label>Reorder when stock ≤</label><input name="reorder_level" inputmode="decimal" value="${esc(item.reorder_level)}"></div></div>
      <label>Barcodes (click and scan)</label>
      <div class="row"><input id="bcscan" placeholder="Scan the barcode here" autocomplete="off" style="flex:1"><button type="button" id="bcadd">Add</button></div>
      <div id="bclist" class="chips-list"></div><input type="hidden" name="codes" value="${esc(item.codes.join(','))}">
      ${id ? '' : `<div class="grid2"><div><label>Stock now (opening)</label><input name="opening_qty" inputmode="decimal" placeholder="0"></div>
        <div><label>Purchase cost ₹ (per piece / kg)</label><input name="cost" inputmode="decimal"></div></div>`}
      <label class="row" style="font-weight:400"><input type="checkbox" name="active" style="width:auto" ${item.active ? 'checked' : ''}> Selling (shows at the counter)</label>
      ${id ? `<p>Stock now: <b>${esc(item.on_hand)} ${esc(item.unit)}</b> · SKU ${esc(item.sku)}</p>` : ''}
      <div class="actions">
        ${id && can('receive') ? '<button type="button" id="sin">Stock (add / count)</button>' : ''}
        ${id && can('products') ? '<button type="button" class="danger" id="woff">Write off</button>' : ''}
        <button type="button" data-close>Close</button>${editable ? '<button class="primary">Save</button>' : ''}</div>
    </form>
    ${moves.length ? `<h3 style="margin-top:14px">Stock history</h3><div style="max-height:200px;overflow:auto"><table>${moves.map((m) => `<tr><td class="small">${esc(m.at.slice(0, 16))}</td>
      <td>${esc(m.kind)}</td><td class="r">${esc(Number(m.qty))}</td><td class="small">${esc(m.ref)} ${esc(m.reason)}</td><td class="small">${esc(m.who || '')}</td></tr>`).join('')}</table></div>` : ''}`);
  if (!editable) $$('input, select', $('#pf', d)).forEach((el) => { el.disabled = true; });
  if ($('#phf', d)) $('#phf', d).addEventListener('change', (e) => submitting(null, async () => {
    const file = e.target.files[0];
    if (!file) return;
    $('#ph', d).innerHTML = '<span>Saving…</span>';
    const blob = await shrinkPhoto(file);
    const r = await api(`/products/${id}/image`, { method: 'POST', raw: blob, type: blob.type });
    $('#ph', d).innerHTML = `<img src="${esc(r.image)}" alt="">`;
    toast('Photo saved.');
    if (onSaved) onSaved();
  }));
  if ($('#phx', d)) $('#phx', d).addEventListener('click', () => submitting($('#phx', d), async () => {
    await api(`/products/${id}/image/remove`, { method: 'POST', body: {} });
    $('#ph', d).innerHTML = '<span>No photo</span>'; $('#phx', d).remove();
    if (onSaved) onSaved();
  }));
  let codes = [...item.codes];
  const drawCodes = () => {
    $('#bclist', d).innerHTML = codes.map((c, i) => `<span class="chip">${esc(c)} <button type="button" data-x="${i}" title="Remove">×</button></span>`).join('') ||
      '<span class="small muted">No barcode yet.</span>';
    $('[name=codes]', d).value = codes.join(',');
    $$('[data-x]', d).forEach((b) => b.addEventListener('click', () => { codes.splice(Number(b.dataset.x), 1); drawCodes(); }));
  };
  const addCode = async () => {
    const v = $('#bcscan', d).value.trim();
    if (!v) return;
    $('#bcscan', d).value = '';
    if (codes.includes(v)) { toast('Already added.'); return; }
    const { items } = await api(`/products?q=${encodeURIComponent(v)}`);
    const other = items.find((i) => i.codes.includes(v) && i.id !== id);
    if (other) {
      if (confirm(`Barcode ${v} already belongs to "${other.name}". Open that product instead?`)) { d.close(); productDialog(other.id, onSaved); }
      return;
    }
    codes.push(v);
    drawCodes();
    toast(`Barcode ${v} added.`);
  };
  $('#bcscan', d).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCode(); } });
  $('#bcadd', d).addEventListener('click', addCode);
  drawCodes();
  $('#pf', d).addEventListener('submit', (e) => {
    e.preventDefault();
    submitting($('button.primary', d), async () => {
      const f = formData(e.target);
      const pending = $('#bcscan', d).value.trim();
      if (pending && !codes.includes(pending)) codes.push(pending);
      f.codes = codes;
      if (id) f.id = id;
      if (preset.approval) f.approval = preset.approval;
      const r = await api('/products', { method: 'POST', body: f });
      toast(`Saved: ${r.item.name}`);
      d.close('ok');
      if (onSaved) onSaved(r.item);
    });
  });
  if ($('#sin', d)) $('#sin', d).addEventListener('click', () => { d.close(); stockDialog(item, 'in', onSaved); });
  if ($('#woff', d)) $('#woff', d).addEventListener('click', () => { d.close(); stockDialog(item, 'off', onSaved); });
}

function stockDialog(item, mode, onDone) {
  const now = Money.milli(String(item.on_hand)) || 0;
  const d = modal(mode === 'in' ? `<h3>Stock: ${esc(item.name)}</h3>
    <div class="cards"><div class="card stat"><div class="l">Available now</div><div class="v">${esc(item.on_hand)} <span class="small">${esc(item.unit)}</span></div></div>
      <div class="card stat"><div class="l">After saving</div><div class="v" id="after">${esc(item.on_hand)}</div></div></div>
    <div class="cats"><button type="button" class="on" data-m="add">Add stock</button><button type="button" data-m="count">Correct the count</button></div>
    <form id="sadd"><div class="grid2"><div><label>Add quantity (${esc(item.unit)})</label><input name="qty" inputmode="decimal" required autofocus></div>
      <div><label>Cost per ${item.unit === 'kg' ? 'kg' : 'piece'} ₹</label><input name="cost" inputmode="decimal" value="${esc(Number(item.cost) ? Number(item.cost).toFixed(2) : '')}"></div></div>
      <div class="grid2"><div><label>Expiry date (if any)</label><input name="expiry" type="date"></div><div><label>Supplier bill no. / note</label><input name="ref"></div></div>
      <div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Add to stock</button></div></form>
    <form id="scount" hidden><label>Quantity counted on the shelf now (${esc(item.unit)})</label><input name="count" inputmode="decimal" required>
      <p class="small muted">The stock is set to this number; the difference is recorded as "stock count".</p>
      <div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Set stock</button></div></form>`
    : `<h3>Write off: ${esc(item.name)}</h3><p class="muted">Stock now: ${esc(item.on_hand)} ${esc(item.unit)}</p>
    <form><label>Quantity to remove (${esc(item.unit)})</label><input name="qty" inputmode="decimal" required autofocus>
      <label>Reason</label><select name="reason"><option>Damaged</option><option>Expired</option><option>Spoiled / rotten</option><option>Theft / missing</option><option>Own use</option></select>
    <div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`);
  const done = () => { toast('Stock updated.'); d.close('ok'); if (onDone) onDone(); };
  if (mode !== 'in') {
    $('form', d).addEventListener('submit', (e) => { e.preventDefault(); submitting($('button.primary', d), async () => {
      await api('/stock/writeoff', { method: 'POST', body: { ...formData(e.target), item_id: item.id } }); done();
    }); });
    return;
  }
  const after = (v) => { $('#after', d).textContent = v; };
  $('#sadd [name=qty]', d).addEventListener('input', (e) => { const q = Money.milli(e.target.value); after(q ? Money.qty(now + q) : item.on_hand); });
  $('#scount [name=count]', d).addEventListener('input', (e) => { const q = Money.milli(e.target.value); after(q !== null ? Money.qty(q) : item.on_hand); });
  $$('[data-m]', d).forEach((b) => b.addEventListener('click', () => {
    $$('[data-m]', d).forEach((x) => x.classList.toggle('on', x === b));
    $('#sadd', d).hidden = b.dataset.m !== 'add'; $('#scount', d).hidden = b.dataset.m !== 'count';
    after(item.on_hand); $(`#${b.dataset.m === 'add' ? 'sadd' : 'scount'} input`, d).focus();
  }));
  $('#sadd', d).addEventListener('submit', (e) => { e.preventDefault(); submitting($('#sadd button.primary', d), async () => {
    await api('/stock/receive', { method: 'POST', body: { ...formData(e.target), item_id: item.id } }); done();
  }); });
  $('#scount', d).addEventListener('submit', (e) => { e.preventDefault(); submitting($('#scount button.primary', d), async () => {
    await api('/stock/count', { method: 'POST', body: { count: e.target.count.value, item_id: item.id } }); done();
  }); });
}

// Many photo files at once. Each file is named after the product's barcode or code (8901030677106.jpg, 10002.png).
function bulkPhotos(onDone) {
  const d = modal(`<h3>Bulk photos</h3>
    <p class="small">Choose many photo files at once (or a whole folder). <b>Name each file with the product's barcode or product code</b>, for example
      <code>8901030677106.jpg</code> or <code>10002.png</code>. Distributors and brands often give photo packs named like this. Each photo is made small and
      linked to its product automatically; a product that already has a photo gets the new one.</p>
    <div class="row"><label class="btn primary" for="bpf">Choose photo files</label><input id="bpf" type="file" accept="image/*" multiple hidden>
      <label class="btn" for="bpd">Choose a folder</label><input id="bpd" type="file" webkitdirectory multiple hidden></div>
    <div id="bpres" style="margin-top:10px"></div><div class="actions"><button data-close>Close</button></div>`);
  const run = async (files) => {
    files = [...files].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
    if (!files.length) return;
    let ok = 0; const missing = [];
    for (const [i, f] of files.entries()) {
      $('#bpres', d).innerHTML = `<p><b>${i + 1} / ${files.length}</b> · ${ok} linked · ${missing.length} not matched</p>`;
      try {
        const blob = await shrinkPhoto(f);
        await api(`/products/image-by-code/${encodeURIComponent(f.name.replace(/\.[^.]+$/, ''))}`, { method: 'POST', raw: blob, type: blob.type });
        ok += 1;
      } catch (e) { missing.push(`${f.name}: ${e.message}`); }
    }
    $('#bpres', d).innerHTML = `<p class="ok"><b>${ok}</b> photos linked to products.</p>${missing.length ? `<details><summary class="bad">${missing.length} not matched</summary>
      <div class="small" style="max-height:200px;overflow:auto">${missing.map(esc).join('<br>')}</div></details>` : ''}`;
    if (onDone) onDone();
  };
  $('#bpf', d).addEventListener('change', (e) => run(e.target.files));
  $('#bpd', d).addEventListener('change', (e) => run(e.target.files));
}

// Photo mode: one product after another (best sellers without a photo first). Snap, it saves, the next one comes. Scan to jump to a product.
async function photoMode(onDone) {
  let list = [];
  let i = 0;
  let saved = 0;
  const d = modal(`<h3>Photo mode</h3><input id="pmscan" placeholder="Scan a pack to jump to it" autocomplete="off">
    <div id="pmbody" style="margin-top:10px"><p class="muted">Loading…</p></div>
    <div class="actions"><button data-close>Finish</button></div>`, { onClose: () => { if (saved && onDone) onDone(); } });
  const fetchList = async () => { list = (await api('/products?status=nophoto&limit=200')).items; i = 0; };
  const show = () => {
    const it = list[i];
    if (!it) { $('#pmbody', d).innerHTML = '<p class="ok"><b>All done.</b> Every product in this list has a photo.</p>'; return; }
    $('#pmbody', d).innerHTML = `<div class="pm-card"><div class="muted small">${i + 1} of ${list.length} without a photo · ${saved} saved now</div>
      <h2 style="margin:6px 0 2px">${esc(it.name)}</h2><div class="ta muted">${esc(it.name_ta)}</div>
      <div class="small">${esc(it.codes.join(', ') || it.sku)} · ₹${esc(it.price || '')}</div>
      <div class="row" style="margin-top:12px"><label class="btn primary big" for="pmf">${ico('camera')} Take photo</label>
        <input id="pmf" type="file" accept="image/*" capture="environment" hidden><button id="pmskip" class="big">Skip ›</button></div></div>`;
    $('#pmf', d).addEventListener('change', (e) => submitting(null, async () => {
      const f = e.target.files[0];
      if (!f) return;
      $('#pmbody', d).innerHTML = '<p class="muted">Saving…</p>';
      const blob = await shrinkPhoto(f);
      await api(`/products/${it.id}/image`, { method: 'POST', raw: blob, type: blob.type });
      saved += 1; list.splice(i, 1); show();
    }));
    $('#pmskip', d).addEventListener('click', () => { i += 1; show(); });
  };
  $('#pmscan', d).addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim(); e.target.value = '';
    if (!v) return;
    const { items } = await api(`/products?q=${encodeURIComponent(v)}`);
    const it = items.find((x) => x.codes.includes(v) || x.sku === v) || items[0];
    if (!it) { toast('Not found.', true); return; }
    list.splice(i, 0, it); show();
  });
  await fetchList();
  show();
}

function importDialog(onDone) {
  const d = modal(`<h3>Import products from a CSV file</h3>
    <p class="muted small">Columns (first row): <b>Product name</b>, and any of SKU, Tamil name, Category, Sale unit (pcs/kg), Pack barcode,
    MRP, Selling price, GST %, Cost, Reorder level, PLU, Barcodes (several in one cell, separated by |). The product master file and the starter list <i>Madhuram_20000_SKUs.csv</i> works as it is. Products with a selling
    price start selling at once; the others wait until you give them a price. Rows with an SKU that already exists are updated.</p>
    <input type="file" accept=".csv,text/csv" id="csvf"><div id="res"></div>
    <div class="actions"><button data-close>Close</button><button class="primary" id="go">Import</button></div>`);
  $('#go', d).addEventListener('click', () => submitting($('#go', d), async () => {
    const f = $('#csvf', d).files[0];
    if (!f) throw new Error('Choose the CSV file.');
    $('#res', d).innerHTML = '<p class="muted">Importing… (20,000 products take about a minute)</p>';
    const r = await api('/products/import', { method: 'POST', raw: await f.text(), type: 'text/csv' });
    $('#res', d).innerHTML = `<p class="ok">${r.created} new, ${r.updated} updated.</p>${r.errors.length ? `<div class="error">${r.errors.map(esc).join('<br>')}</div>` : ''}`;
    if (onDone) onDone();
  }));
}

// ================================================================== Owner dashboard (works on the phone)
App.views.dashboard = async (main) => {
  const period = (location.hash.match(/period=(\w+)/) || [])[1] || 'today';
  const d = await api(`/dashboard?period=${period}`);
  const m = Object.fromEntries(d.methods.map((x) => [x.method, x.amount]));
  const ch = Object.fromEntries(d.channels.map((x) => [x.channel, x]));
  const max = Math.max(1, ...d.trend.map((w) => Number(w.total)));
  const label = PERIODS.find((p) => p[0] === period)[1];
  const bar = (lab, v, n) => `<div class="barrow"><span class="bl">${esc(lab)}</span><span class="bb"><span style="width:${Math.round(Number(v) / max * 100)}%"></span></span>
    <span class="bv">${inr(v)}<span class="small muted"> · ${n}</span></span></div>`;
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Dashboard · ${esc(label)}</h1><span class="muted small">${esc(d.from)}${d.from !== d.to ? ` to ${esc(d.to)}` : ''}</span></div>
    ${periodChips(period, 'dashboard')}
    <div class="cards">
      <div class="card stat big1"><div class="l">Sales (after returns)</div><div class="v">${inr(d.net)}</div><div class="l">${d.bills} bills · average ${inr(d.average)}</div></div>
      <div class="card stat"><div class="l">Gross profit</div><div class="v ok">${inr(d.profit)}</div><div class="l">${d.margin_pct}% of sales</div></div>
      <div class="card stat"><div class="l">Expenses · Net profit</div><div class="v ${Number(d.net_profit) < 0 ? 'bad' : ''}">${inr(d.net_profit)}</div>
        <div class="l">after ${inr(d.expenses)} expenses</div></div>
      <div class="card stat"><div class="l">In the shop · Online</div><div class="small" style="margin-top:6px"><b>${inr((ch.store || {}).total || 0)}</b> (${(ch.store || {}).bills || 0})
        · <b>${inr((ch.online || {}).total || 0)}</b> (${(ch.online || {}).bills || 0})</div><div class="l">${d.orders.total} online orders · ${d.orders.open} open</div></div>
      <div class="card stat"><div class="l">Cash · UPI · Card · Credit</div><div class="small" style="margin-top:6px">${inr(m.cash || 0)} · ${inr(m.upi || 0)} · ${inr(m.card || 0)} · ${inr(m.credit || 0)}</div>
        <div class="l">Returns ${inr(d.returns)} · Discounts ${inr(d.discount)}</div></div>
      <div class="card stat"><div class="l">Needs attention</div><div class="small" style="margin-top:6px">
        <a href="#/products">${d.low_stock} low stock</a> · <a href="#/reports?r=expiry">${d.expiring} expiring in 7 days</a></div></div>
    </div>
    <div class="grid2">
      <div class="card"><h2 style="margin-top:0">${d.trend_kind === 'hour' ? 'Sales by hour' : 'Sales by day'}</h2>
        ${d.trend.map((w) => bar(d.trend_kind === 'hour' ? `${w.label}:00` : String(w.label).slice(5), w.total, w.bills)).join('') || '<p class="muted">No sales.</p>'}
        <h2>Counters</h2>${d.counters.map((c) => bar(c.counter, c.total, `${c.bills} bills`)).join('') || '<p class="muted">No bills.</p>'}</div>
      <div class="card"><h2 style="margin-top:0">Top 10 products</h2><div class="tablewrap"><table><tr><th>#</th><th>Product</th><th class="r">Qty</th><th class="r">Sales</th><th class="r">Profit</th></tr>
        ${d.top.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.name)}</td><td class="r">${esc(t.qty)} ${esc(t.unit)}</td><td class="r">${inr(t.amount)}</td><td class="r ok">${inr(t.profit)}</td></tr>`).join('')
          || '<tr><td colspan="5" class="muted">No sales</td></tr>'}</table></div></div>
    </div>
    <h2>Counter cash (opening · expected · counted)</h2>
    <div class="card" style="padding:0"><div class="tablewrap"><table><tr><th>Counter</th><th>Cashier</th><th>Opened</th><th class="r">Opening</th><th class="r">Expected</th><th class="r">Counted</th><th class="r">Difference</th></tr>
      ${d.shifts.map((s) => `<tr><td>${esc(s.counter)}</td><td>${esc(s.cashier)}</td><td class="small">${esc(String(s.opened_at).slice(0, 16))}</td><td class="r">${inr(s.opening_float)}</td>
        <td class="r">${s.expected ? inr(s.expected) : '<span class="pill">open</span>'}</td><td class="r">${s.counted ? inr(s.counted) : ''}</td>
        <td class="r ${Number(s.variance) ? 'bad' : 'ok'}">${s.variance !== null ? inr(s.variance) : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No shifts.</td></tr>'}</table></div></div>
    <h2>Watch list</h2>
    <div class="card" style="padding:0"><div class="tablewrap">${d.risky.length ? `<table>${d.risky.map((a) => `<tr><td class="small">${esc(String(a.at).slice(5, 16))}</td><td>${esc(a.action.replace(/_/g, ' '))}</td>
      <td>${esc(a.summary)}</td><td class="small">${esc(a.who || '')}${a.approver ? ` (OK: ${esc(a.approver)})` : ''}</td></tr>`).join('')}</table>` : '<p class="muted" style="padding:12px">Nothing unusual.</p>'}</div></div>`;
  const timer = setInterval(() => { if (document.visibilityState === 'visible' && !$('dialog[open]')) route(); }, 60000);
  App.leave = () => clearInterval(timer);
};

// ================================================================== Staff logins
App.views.staff = async (main) => {
  const { users, roles } = await api('/users');
  main.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Staff logins</h1><button class="primary" id="uadd">+ Add login</button></div>
    <p class="muted small">One login per person. Owner and manager PINs approve discounts and price changes at the counter.</p>
    <table><tr><th>Name</th><th>Login name</th><th>Role</th><th>PIN</th><th>Status</th></tr>${users.map((u) => `<tr class="click" data-id="${u.id}">
      <td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${u.has_pin ? 'set' : '-'}</td>
      <td>${u.active ? '<span class="pill">active</span>' : '<span class="pill off">disabled</span>'}</td></tr>`).join('')}</table>
    <div class="card small" style="margin-top:14px"><b>Roles:</b> Owner: everything. Manager: everything except settings and staff.
      Cashier: billing, own cash drawer, customers. Purchaser: products and stock. Auditor: reports only.</div>`;
  const edit = (u) => {
    const d = modal(`<h3>${u ? 'Edit login' : 'Add login'}</h3><form>
      <div class="grid2"><div><label>Name</label><input name="name" value="${esc(u ? u.name : '')}" required autofocus></div>
      <div><label>Login name</label><input name="username" value="${esc(u ? u.username : '')}" ${u ? 'readonly' : ''} required autocomplete="off"></div></div>
      <div class="grid2"><div><label>Role</label><select name="role">${roles.map((r) => `<option ${u && u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div><label>${u ? 'New password (empty = keep)' : 'Password'}</label><input name="password" type="text" autocomplete="new-password" ${u ? '' : 'required minlength="6"'}></div></div>
      <div class="grid2"><div><label>Approval PIN (4–6 digits${u ? ', empty = keep' : ', managers/owner'})</label><input name="pin" inputmode="numeric" autocomplete="off"></div>
      <div><label>&nbsp;</label><label class="row" style="font-weight:400"><input type="checkbox" name="active" style="width:auto" ${!u || u.active ? 'checked' : ''}> Active (can log in)</label></div></div>
      <div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`);
    $('form', d).addEventListener('submit', (e) => { e.preventDefault(); submitting($('button.primary', d), async () => {
      await api('/users', { method: 'POST', body: { ...formData(e.target), id: u ? u.id : undefined } });
      toast('Saved.');
      d.close('ok');
      route();
    }); });
  };
  $('#uadd').addEventListener('click', () => edit(null));
  $$('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => edit(users.find((u) => u.id === Number(tr.dataset.id)))));
};

// ================================================================== Settings & backup
App.views.settings = async (main) => {
  const { settings: s } = await api('/settings');
  const f = (k, label, attrs = '') => `<div><label>${label}</label><input name="${k}" value="${esc(s[k])}" ${attrs}></div>`;
  main.innerHTML = `<h1>Settings & backup</h1>
    <form id="sf" class="card"><h2 style="margin-top:0">Shop details (printed on the bill)</h2>
      <div class="grid2">${f('name', 'Shop name')}${f('name_ta', 'Shop name in Tamil', 'class="ta"')}</div>
      <div class="grid2">${f('address', 'Address')}${f('phone', 'Phone')}</div>
      <div class="grid3">${f('gstin', 'GSTIN')}${f('fssai', 'FSSAI licence')}${f('invoice_prefix', 'Bill number prefix', 'maxlength="6"')}</div>
      <div class="grid3">${f('bill_footer', 'Bill footer')}<div><label>Bill paper width</label><select name="receipt_width">
        <option value="80">80 mm</option><option value="58" ${s.receipt_width === '58' ? 'selected' : ''}>58 mm</option></select></div>
        <div><label>Copies of each bill</label><select name="print_copies"><option value="1">1 (customer)</option>
        <option value="2" ${s.print_copies === '2' ? 'selected' : ''}>2 (customer + shop copy)</option></select></div></div>
      <h2>Loyalty points</h2>
      <label class="row" style="font-weight:400"><input type="checkbox" name="loyalty_enabled" style="width:auto" ${s.loyalty_enabled === '1' ? 'checked' : ''}>
        <b>Give loyalty points</b> on store bills and online orders (the customer must be on the bill: F7 at the counter, or their online account)</label>
      <div class="grid3">${f('loyalty_points_per_100', 'Points for every ₹100 purchase', 'inputmode="decimal"')}
        ${f('loyalty_point_value', 'Value of 1 point when used (₹)', 'inputmode="decimal"')}
        ${f('loyalty_min_redeem', 'Points needed before they can be used', 'inputmode="numeric"')}</div>
      <p class="small muted" id="loyex"></p>
      <h2>Counters</h2>${f('counters', 'Counter names (separate with commas)')}
      <label class="row" style="font-weight:400"><input type="checkbox" name="require_tax_setup" style="width:auto" ${s.require_tax_setup === '1' ? 'checked' : ''}>
        Stop billing products whose GST type is "Not set yet" (turn on after the accountant checks the GST data)</label>
      <h2>WhatsApp and UPI</h2>
      <div class="grid3"><div><label>Open WhatsApp in</label><select name="whatsapp_open"><option value="app">WhatsApp program (PC / phone)</option>
        <option value="web" ${s.whatsapp_open === 'web' ? 'selected' : ''}>WhatsApp Web (browser)</option></select></div>
        ${f('upi_id', 'Shop UPI ID (shown to online customers)', 'placeholder="shopname@okaxis"')}
        ${f('owner_whatsapp', "Owner's WhatsApp number (daily summary)", 'inputmode="tel" placeholder="98xxxxxxxx"')}
        <div><label>&nbsp;</label><label class="row" style="font-weight:400"><input type="checkbox" name="whatsapp_bill" style="width:auto" ${s.whatsapp_bill === '1' ? 'checked' : ''}>
        Offer "WhatsApp bill" after each sale</label></div></div>
      <p class="small muted">WhatsApp bills are free: they open in the shop's own WhatsApp with the message ready; press Send. The paper bill always prints.</p>
      <h2>Returns and expiry</h2>
      <div class="grid3">${f('credit_note_prefix', 'Return (credit note) number prefix', 'maxlength="6"')}${f('near_expiry_days', 'Warn when stock expires within (days)')}<div></div></div>
      <h2>Online orders (customers order from their phone)</h2>
      <label class="row" style="font-weight:400"><input type="checkbox" name="online_enabled" style="width:auto" ${s.online_enabled === '1' ? 'checked' : ''}>
        <b>Take online orders</b> (customer page: <a href="/shop/" target="_blank">${esc(location.origin)}/shop/</a>)</label>
      <div class="grid3"><div><label class="row" style="font-weight:400"><input type="checkbox" name="online_pickup" style="width:auto" ${s.online_pickup === '1' ? 'checked' : ''}> Takeaway (customer collects)</label></div>
        <div><label class="row" style="font-weight:400"><input type="checkbox" name="online_delivery" style="width:auto" ${s.online_delivery === '1' ? 'checked' : ''}> Home delivery</label></div>
        ${f('online_area', 'Delivery area', 'placeholder="Within 3 km of the shop"')}</div>
      <div class="grid3">${f('online_open', 'Orders from (time)', 'type="time"')}${f('online_close', 'Orders until (time)', 'type="time"')}${f('online_slot_minutes', 'Slot length (minutes)')}</div>
      <div class="grid3">${f('online_lead_minutes', 'First slot after (minutes)')}${f('online_days_ahead', 'Days ahead customers can choose')}${f('online_min_order', 'Minimum order for delivery ₹')}</div>
      <div class="grid3">${f('online_delivery_charge', 'Delivery charge ₹')}${f('online_free_delivery_above', 'Free delivery above ₹ (0 = never)')}<div></div></div>
      <h3 style="margin:18px 0 4px">Banner photos at the top of the online shop</h3>
      <p class="small muted" style="margin:0 0 8px">Optional. Take a wide photo of your fresh stock or a festival offer; it shows first, with your words on the left.
        Without photos the shop shows its own banners for offers, fresh produce, delivery and loyalty points.</p>
      <input type="hidden" name="shop_banners" id="sbJson" value="${esc(s.shop_banners || '[]')}"><div id="sbRows"></div>
      <h2>Weighing scale labels</h2>
      <label class="row" style="font-weight:400"><input type="checkbox" name="scale_enabled" style="width:auto" ${s.scale_enabled === '1' ? 'checked' : ''}> The shop uses barcode labels printed by the weighing scale</label>
      <div class="grid3">${f('scale_prefixes', 'Label starts with')}${f('scale_item_start', 'Item code starts at (0 = first digit)')}${f('scale_item_length', 'Item code digits')}</div>
      <div class="grid3">${f('scale_value_start', 'Weight starts at')}${f('scale_value_length', 'Weight digits')}${f('scale_value_decimals', 'Decimals in weight')}</div>
      <button class="primary" style="margin-top:12px">Save settings</button></form>
    <div class="grid2" style="margin-top:14px">
      <div class="card"><h2 style="margin-top:0">Backup</h2><p class="small">Download a copy of everything (products, stock, bills, cash, staff) to this PC.
        Do it every evening and keep the files in Google Drive or a pen drive. Hostinger also keeps its own daily backups.</p>
        ${can('backup') ? `<a class="btn big ${backupDoneToday() ? 'okbtn' : 'badbtn'}" id="bkdl" href="/api/backup">${backupDoneToday() ? 'Today\'s backup downloaded' : 'Download today\'s backup'}</a>
          <button id="bknow">Save a backup on the server now</button>` : ''}
        <div id="bklist" class="small" style="margin-top:10px"></div>
        <p class="small muted">To restore: Hostinger hPanel → Databases → phpMyAdmin → choose the database → Import → the backup file.</p></div>
      <div class="card"><h2 style="margin-top:0">Product photos</h2><div id="phst" class="small">…</div>
        <p class="small">Finds the photo of each packed product by its barcode in the open product databases <b>Open Food Facts</b>, <b>Open Beauty Facts</b>
          and <b>Open Products Facts</b> (food, soap/shampoo/cream, household; free, open data whose photos may be
          used with credit, which the shop page shows). Runs on the server, about 80 products a minute.
          Loose items and local brands are not there: use <b>Products, Bulk photos</b> (photo files named by barcode, e.g. from your distributor)
          or <b>Photo mode</b> (best sellers first, one tap per product).</p>
        <button class="primary" id="phgo">Find photos by barcode</button> <button id="phstop">Stop</button></div>
      <div class="card"><h2 style="margin-top:0">Bring data from the shop PC</h2><p class="small">On the shop PC double-click <b>Export_For_Cloud.bat</b>.
        It makes <i>madhuram_cloud_export.json.gz</i> on the desktop with all products, prices, barcodes, stock, customers and staff logins
        (they keep their passwords). Choose that file here. Allowed only before the first cloud bill.</p>
        <input type="file" id="impf" accept=".gz,.json"><button id="impgo" style="margin-top:8px">Bring in</button><div id="impres"></div></div>
    </div>`;
  const loyEx = () => {
    const sf = $('#sf'); const per = Number(sf.loyalty_points_per_100.value) || 0; const val = Number(sf.loyalty_point_value.value) || 0;
    const pts = Math.floor(5 * per);
    $('#loyex').textContent = `Example: a ₹500 bill earns ${pts} points. ${pts} points are worth ₹${(pts * val).toFixed(2)} on a later bill.`;
  };
  ['loyalty_points_per_100', 'loyalty_point_value'].forEach((n) => $('#sf')[n].addEventListener('input', loyEx));
  loyEx();
  // banner photos for the online shop: up to 3, kept as JSON in one setting
  let banners = [];
  try { banners = JSON.parse(s.shop_banners || '[]'); } catch (_) { banners = []; }
  if (!Array.isArray(banners)) banners = [];
  const cats = (await api('/shop/info').catch(() => ({ cats: [] }))).cats || [];
  const drawBanners = () => {
    while (banners.length < 3) banners.push({ img: '', kicker: '', title: '', sub: '', link: '' });
    $('#sbJson').value = JSON.stringify(banners.filter((b) => b.img));
    $('#sbRows').innerHTML = banners.slice(0, 3).map((b, i) => `<div class="sb-row" data-i="${i}">
      <div class="sb-img">${b.img ? `<img src="/img/p/${esc(b.img)}" alt="">` : `<span class="small muted">No photo</span>`}</div>
      <div class="sb-f"><div class="grid3"><div><label>Small line</label><input data-k="kicker" value="${esc(b.kicker)}" placeholder="Vegetable offers" maxlength="40"></div>
        <div><label>Big words</label><input data-k="title" value="${esc(b.title)}" placeholder="20% OFF" maxlength="40"></div>
        <div><label>Last line</label><input data-k="sub" value="${esc(b.sub)}" placeholder="Till 30 November" maxlength="60"></div></div>
        <div class="row" style="margin-top:6px"><select data-k="link" style="max-width:240px"><option value="">Button: none</option>
          <option value="offers" ${b.link === 'offers' ? 'selected' : ''}>Button opens: all offers</option>
          ${cats.map((c) => `<option value="cat=${c.id}" ${b.link === `cat=${c.id}` ? 'selected' : ''}>Button opens: ${esc(c.name)}</option>`).join('')}</select>
          <label class="btn" style="margin:0">${ico('camera')} ${b.img ? 'Change photo' : 'Choose photo'}<input type="file" accept="image/*" data-up hidden></label>
          ${b.img ? `<button type="button" class="danger" data-rm>${ico('x')} Remove</button>` : ''}</div></div></div>`).join('');
    $$('#sbRows [data-k]').forEach((el) => el.addEventListener('input', () => {
      banners[Number(el.closest('.sb-row').dataset.i)][el.dataset.k] = el.value;
      $('#sbJson').value = JSON.stringify(banners.filter((b) => b.img));
    }));
    $$('#sbRows [data-up]').forEach((el) => el.addEventListener('change', () => submitting(null, async () => {
      const file = el.files[0];
      if (!file) return;
      const blob = await shrinkPhoto(file, 1400);
      const r = await api('/shop-banners/image', { method: 'POST', raw: blob, type: blob.type });
      banners[Number(el.closest('.sb-row').dataset.i)].img = r.name;
      drawBanners();
      toast('Photo added. Press Save to show it in the online shop.');
    })));
    $$('#sbRows [data-rm]').forEach((el) => el.addEventListener('click', () => {
      banners[Number(el.closest('.sb-row').dataset.i)] = { img: '', kicker: '', title: '', sub: '', link: '' };
      drawBanners();
    }));
  };
  drawBanners();
  $('#sf').addEventListener('submit', (e) => { e.preventDefault(); submitting($('button.primary', e.target), async () => {
    const v = formData(e.target);
    for (const el of e.target.elements) if (el.type === 'checkbox') v[el.name] = el.checked ? '1' : '0';
    const r = await api('/settings', { method: 'POST', body: v });
    App.settings = r.settings;
    await loadMe();
    toast('Settings saved.');
  }); });
  const loadBackups = async () => {
    const b = await api('/backups');
    const st = b.status;
    $('#bklist').innerHTML = `<p class="${st.ok ? 'ok' : 'bad'}">${st.last ? `Last server backup: ${esc(st.last.created_at.slice(0, 16))} (${st.age_hours} h ago)` :
      'No server backup yet.'} The server also saves one by itself every evening after 9 pm and keeps 14 days + 12 months.</p>
      ${b.backups.slice(0, 8).map((x) => `<div><a href="/api/backups/${encodeURIComponent(x.name)}">${esc(x.name)}</a> · ${Math.ceil(x.bytes / 1024)} KB</div>`).join('')}
      ${b.cron_url ? `<details style="margin-top:6px"><summary>Extra safety: Hostinger cron job</summary>hPanel → Advanced → Cron Jobs → Custom → every day 21:30 →
        command: <code style="word-break:break-all">curl -s "${esc(b.cron_url)}"</code></details>` : ''}`;
  };
  if ($('#bkdl')) $('#bkdl').addEventListener('click', () => {
    localStorage.setItem('mpc_backup_day', today());
    setTimeout(() => { const b = $('#bkdl'); if (b) { b.className = 'btn big okbtn'; b.textContent = 'Today\'s backup downloaded'; } markBackup(); }, 800);
  });
  if ($('#bklist')) {
    loadBackups().catch((e) => { $('#bklist').textContent = e.message; });
    $('#bknow').addEventListener('click', () => submitting($('#bknow'), async () => { await api('/backups', { method: 'POST', body: {} }); toast('Backup saved.'); loadBackups(); }));
  }
  const photoStatus = async () => {
    if (!$('#phst')) return;
    const p = await api('/images/fetch');
    $('#phst').innerHTML = `<b>${p.with_photo}</b> products have a photo · <b>${p.without_photo}</b> without.
      ${p.running ? `<br><b class="ok">Finding photos… ${p.done} of ${p.total} checked, ${p.found} found.</b>` : p.started ? `<br>Last run: ${p.done} of ${p.total} checked, ${p.found} found${p.finished ? ` (${esc(p.finished.slice(11, 16))})` : ''}.` : ''}
      ${p.error ? `<br><span class="bad">${esc(p.error)}</span>` : ''}`;
    if (p.running) setTimeout(() => { if ($('#phst')) photoStatus(); }, 4000);
  };
  if ($('#phgo')) {
    photoStatus().catch(() => {});
    $('#phgo').addEventListener('click', () => submitting($('#phgo'), async () => { await api('/images/fetch', { method: 'POST', body: {} }); toast('Finding photos. You can keep working.'); photoStatus(); }));
    $('#phstop').addEventListener('click', () => submitting($('#phstop'), async () => { await api('/images/fetch', { method: 'POST', body: { action: 'stop' } }); photoStatus(); }));
  }
  $('#impgo').addEventListener('click', () => submitting($('#impgo'), async () => {
    const file = $('#impf').files[0];
    if (!file) throw new Error('Choose the export file first.');
    if (!confirm('This replaces all products and stock on the cloud with the shop PC\'s. Continue?')) return;
    $('#impres').innerHTML = '<p class="muted">Bringing in… please wait.</p>';
    const r = await api('/import-shop', { method: 'POST', raw: await file.arrayBuffer() });
    $('#impres').innerHTML = `<p class="ok">Done: ${r.items} products, ${r.lots} stock lots, ${r.customers} customers, ${r.users} staff logins.</p>`;
  }));
};

// ================================================================== Install on this PC
App.views.install = async (main) => {
  const n = (myCounter().match(/\d+/) || ['1'])[0];
  main.innerHTML = `<h1>Install on this PC</h1>
    <div class="grid2">
      <div class="card"><h2 style="margin-top:0">1. Install the app</h2>
        <p>Click the button. "Madhuram Store" gets its own window, a desktop icon and a Start-menu entry, like a normal program.</p>
        <button class="primary big install-btn show" id="inst">${ico('download')} Install Madhuram Store</button>
        <p class="small muted">If nothing happens: in Microsoft Edge click ⋯ → Apps → Install this site as an app. In Google Chrome click ⋮ →
          Cast, save and share → Install page as app. On an Android phone: ⋮ → Add to Home screen / Install app.</p></div>
      <div class="card"><h2 style="margin-top:0">2. Counter PC with bill printer (recommended)</h2>
        <p>For counters, use this instead: bills print straight away without the print window, and the store opens when the PC starts.</p>
        <div class="row">${App.counters.map((c) => { const k = c.replace(/\D/g, '') || '1'; return `<a class="btn ${k === n ? 'primary' : ''}" href="/counter-shortcut.bat?counter=${esc(k)}">${esc(c)}</a>`; }).join('')}</div>
        <ol class="small"><li>Click this counter's button. A small file downloads.</li><li>Open it (Windows may ask "Run anyway").</li>
          <li>Use the new desktop icon <b>Madhuram Counter N</b>. Set the bill printer as the Windows default printer.</li></ol></div>
    </div>
    <div class="card" style="margin-top:14px"><h2 style="margin-top:0">Good to know</h2><ul class="small">
      <li>Everything is saved on the cloud server: all counters, the owner's mobile and home PC see the same stock and bills.</li>
      <li>The internet must be working to complete a bill. Keep a mobile hotspot ready as a backup connection.</li>
      <li>Updates reach every PC automatically.</li></ul></div>`;
  $('#inst').addEventListener('click', installApp);
};

document.addEventListener('DOMContentLoaded', start);
