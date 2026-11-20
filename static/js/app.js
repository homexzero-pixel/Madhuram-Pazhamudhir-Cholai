// Confirm forms marked data-confirm; global shortcut F1 opens billing.
document.addEventListener('submit', function (e) {
  const m = e.target.dataset && e.target.dataset.confirm;
  if (m && !window.confirm(m)) e.preventDefault();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'F1' && !document.body.classList.contains('pos-page')) { e.preventDefault(); location.href = '/billing/'; }
});
