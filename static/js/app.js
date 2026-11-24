// Confirm forms marked data-confirm; global shortcut F1 opens billing.
document.addEventListener('submit', function (e) {
  const m = e.target.dataset && e.target.dataset.confirm;
  if (m && !window.confirm(m)) e.preventDefault();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'F1' && !document.body.classList.contains('pos-page')) { e.preventDefault(); location.href = '/billing/'; }
});

// New online orders: red count on "Online orders" and a short sound when one arrives (every 20 seconds).
(function () {
  const link = document.getElementById('nav-orders');
  if (!link) return;
  let last = Number(sessionStorage.getItem('mpc-last-order') || 0);
  const chime = () => { try { const a = new AudioContext(); [880, 1175].forEach((f, i) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; g.gain.value = .08; o.connect(g); g.connect(a.destination); o.start(a.currentTime + i * .18); o.stop(a.currentTime + i * .18 + .15); }); } catch (e) { /* no sound */ } };
  async function poll() {
    try {
      const r = await fetch('/orders/api/badge/', { headers: { Accept: 'application/json' } });
      if (!r.ok) return;
      const d = await r.json();
      let b = link.querySelector('.nav-badge');
      if (d.new) { if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; link.appendChild(b); } b.textContent = d.new; } else if (b) b.remove();
      if (last && d.last > last && d.new) {
        chime();
        const t = document.createElement('div'); t.className = 'alert alert-info order-toast'; t.innerHTML = '<b>New online order!</b> <a href="/orders/">Open online orders</a>';
        document.body.appendChild(t); setTimeout(() => t.remove(), 9000);
      }
      last = d.last; sessionStorage.setItem('mpc-last-order', String(last));
    } catch (e) { /* server busy or offline: try again later */ }
  }
  poll(); setInterval(poll, 20000);
})();
