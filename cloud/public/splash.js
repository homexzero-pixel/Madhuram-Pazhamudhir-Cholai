/* Madhuram: the opening screen of the customers' shop and of the billing software.
   The shop's logo drives in from the left, the Tamil name and a line come up, and when the page has drawn its first screen
   (it calls Splash.done()) the logo drives out to the right. It stays at least about 1.5 seconds and at most 10 seconds. */
(function () {
  'use strict';
  var el = document.getElementById('splash');
  var MIN = 1450;
  var started = 0;
  var ended = false;
  var asked = false;
  var now = function () { return (window.performance && performance.now()) || Date.now(); };

  function run() {
    if (started || !el) return;
    started = now();
    el.classList.add('run');
  }
  function out() {
    if (ended || !el) return;
    ended = true;
    el.classList.add('out');
    setTimeout(function () { el.classList.add('go'); }, 380);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 800);
  }

  window.Splash = {
    done: function () {
      if (asked) return;
      asked = true;
      (function wait() {
        if (!started) { setTimeout(wait, 60); return; }
        setTimeout(out, Math.max(0, started + MIN - now()));
      }());
    },
  };
  if (!el) return;

  // the timeline starts once the logo can be seen (first visit on a slow phone network)
  var logo = el.querySelector('.sp-logo');
  if (logo && !logo.complete) {
    logo.addEventListener('load', run);
    logo.addEventListener('error', run);
    setTimeout(run, 1200);
  } else run();
  setTimeout(function () { if (!ended) el.classList.add('wait'); }, 2700);   // still loading: three dots
  setTimeout(out, 10000);
}());
