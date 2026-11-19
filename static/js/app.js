// Ask for confirmation on forms marked with data-confirm (delete, void, clear).
document.addEventListener('submit', function (e) {
  const msg = e.target.dataset && e.target.dataset.confirm;
  if (msg && !window.confirm(msg)) e.preventDefault();
});
