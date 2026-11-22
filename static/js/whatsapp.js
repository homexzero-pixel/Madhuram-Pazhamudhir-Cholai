/* Free WhatsApp bills: ask the server for the bill message, then open it in the shop's WhatsApp
   (Desktop app or WhatsApp Web) with the customer's number filled in. The cashier presses Send. */
(function () {
  'use strict';
  const csrf = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
  function openLink(url, newWindow) {
    if (newWindow) { const w = window.open(url, '_blank', 'noopener'); if (w) return true; }
    const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; if (newWindow) a.target = '_blank';
    document.body.appendChild(a); a.click(); a.remove(); return true;
  }
  async function send(saleId, phone) {
    const r = await fetch(`/api/sales/${saleId}/whatsapp/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() }, body: JSON.stringify({ phone }) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Could not prepare the WhatsApp bill.');
    if (d.open === 'web') openLink(d.web, true); else openLink(d.app, false);
    return d;
  }
  // 10-digit check in the browser too, so mistakes show before the bill is saved
  function valid(raw) {
    let d = String(raw || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2); else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return d.length === 10 && /^[6-9]/.test(d);
  }
  window.WA = { send, valid };
})();
