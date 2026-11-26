/* "Print / Save as PDF" button on the invoice page (no inline scripts: the pages' security policy forbids them). */
(function () {
  var b = document.getElementById('p');
  if (b) b.addEventListener('click', function () { window.print(); });
}());
