'use strict';
// The version of the two web pages: the ?v= on their program files (public/index.html for billing, public/shop.html for the
// customers' site). Open screens and installed apps ask for it and load a new version by themselves after an update.
const fs = require('fs');
const path = require('path');

const pub = path.join(__dirname, '..', 'public');
const read = (file, re) => {
  try { return (fs.readFileSync(path.join(pub, file), 'utf8').match(re) || [])[1] || ''; } catch (_) { return ''; }
};

module.exports = {
  bill: read('index.html', /\/app\.js\?v=([\w.-]+)/),
  shop: read('shop.html', /\/shop\.js\?v=([\w.-]+)/),
};
