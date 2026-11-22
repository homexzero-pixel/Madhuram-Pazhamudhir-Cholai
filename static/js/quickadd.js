/* Quick add product – one short form, keyboard first. Enter moves to the next box; Enter on the last box saves.
   Used by the billing counter (new barcode scanned) and by Products → Quick add. */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cats = () => { const el = document.getElementById('qa-cats'); return el ? JSON.parse(el.textContent) : []; };
  const last = () => { try { return JSON.parse(localStorage.getItem('qa-last')) || {}; } catch (e) { return {}; } };
  const GST = [['0', '0 % – exempt (fruit, vegetables, milk, eggs)'], ['5', '5 %'], ['12', '12 %'], ['18', '18 %'], ['28', '28 %'], ['', 'Not sure – accountant to set']];

  function html(o) {
    const L = last(), groups = {};
    cats().forEach(c => (groups[c.dept] = groups[c.dept] || []).push(c));
    const gst = o.gst != null ? o.gst : (L.gst != null ? L.gst : '');
    return `<div class="qa" data-candidate="">
      <div class="row g-2">
        <div class="col-md-5"><label class="form-label" for="qa-code">Barcode <span class="text-muted small">(scan the pack; leave empty for loose items)</span></label>
          <input id="qa-code" class="form-control form-control-lg font-monospace" value="${esc(o.code || '')}" autocomplete="off" ${o.lockCode ? 'readonly' : ''}></div>
        <div class="col-md-7 position-relative"><label class="form-label" for="qa-name">Product name, as printed <span class="text-muted small">(also searches the 20,000-item starter list)</span></label>
          <input id="qa-name" class="form-control form-control-lg" autocomplete="off" placeholder="e.g. Aashirvaad Atta 1 kg">
          <div class="list-group qa-sugg shadow" id="qa-sugg"></div></div>
      </div>
      <div class="qa-cand alert alert-info py-2 mt-2 d-none" id="qa-cand"></div>
      <div class="row g-2 mt-1">
        <div class="col-md-4"><label class="form-label" for="qa-cat">Category</label><select id="qa-cat" class="form-select">
          <option value="">Choose…</option>${Object.entries(groups).map(([d, cs]) => `<optgroup label="${esc(d)}">${cs.map(c => `<option value="${c.id}" ${String(L.cat) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}</select></div>
        <div class="col-md-3"><label class="form-label" for="qa-unit">Sold by</label><select id="qa-unit" class="form-select">
          <option value="pcs" ${L.unit !== 'kg' ? 'selected' : ''}>Piece / pack</option><option value="kg" ${L.unit === 'kg' ? 'selected' : ''}>Weight (kg)</option></select></div>
        <div class="col-md-5"><label class="form-label" for="qa-ta">Tamil name <span class="text-muted small">(optional)</span></label><input id="qa-ta" class="form-control ta" autocomplete="off"></div>
      </div>
      <div class="row g-2 mt-1">
        <div class="col-6 col-md-2"><label class="form-label" for="qa-mrp">MRP ₹</label><input id="qa-mrp" class="form-control form-control-lg num" inputmode="decimal" autocomplete="off"></div>
        <div class="col-6 col-md-2"><label class="form-label" for="qa-price">Selling price ₹</label><input id="qa-price" class="form-control form-control-lg num fw-bold" inputmode="decimal" autocomplete="off"></div>
        <div class="col-md-3"><label class="form-label" for="qa-gst">GST</label><select id="qa-gst" class="form-select form-select-lg">${GST.map(([v, l]) => `<option value="${v}" ${v === gst ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="col-6 col-md-3"><label class="form-label" for="qa-stock">${o.stockRequired ? '<b>On the shelf now</b>' : 'Opening stock'} <span class="text-muted small" id="qa-su">(pcs)</span></label><input id="qa-stock" class="form-control form-control-lg num" inputmode="decimal" autocomplete="off"></div>
        <div class="col-6 col-md-2"><label class="form-label" for="qa-cost">Cost ₹ <span class="text-muted small">(optional)</span></label><input id="qa-cost" class="form-control num" inputmode="decimal" autocomplete="off"></div>
      </div>
      ${o.needApprover ? `<div class="row g-2 mt-1"><div class="col"><label class="form-label small" for="qa-ap">Manager user name (your role cannot add products)</label><input id="qa-ap" class="form-control" autocomplete="off"></div>
        <div class="col"><label class="form-label small" for="qa-pin">Manager PIN</label><input id="qa-pin" type="password" class="form-control" inputmode="numeric" autocomplete="off"></div></div>` : ''}
      <div class="qa-margin small text-muted mt-2" id="qa-margin"></div>
      <p class="text-danger fw-semibold mb-0 mt-1" id="qa-err" role="alert"></p></div>`;
  }

  function bind(root, o) {
    const $ = s => root.querySelector(s), order = ['#qa-code', '#qa-name', '#qa-cat', '#qa-unit', '#qa-ta', '#qa-mrp', '#qa-price', '#qa-gst', '#qa-stock', '#qa-cost', '#qa-ap', '#qa-pin'].filter(s => $(s) && !$(s).readOnly);
    let candidate = '', sugg = [], si = -1, t;
    const margin = () => {
      const p = parseFloat($('#qa-price').value || $('#qa-mrp').value), m = parseFloat($('#qa-mrp').value), c = parseFloat($('#qa-cost').value);
      const parts = [];
      if (p > 0 && m > 0) parts.push(p > m ? '<span class="text-danger">Price is above MRP</span>' : `${(100 * (m - p) / m).toFixed(1)} % below MRP`);
      if (p > 0 && c > 0) parts.push(`margin ₹${(p - c).toFixed(2)} (${(100 * (p - c) / p).toFixed(1)} %)`);
      $('#qa-margin').innerHTML = parts.join(' · ');
    };
    $('#qa-unit').addEventListener('change', () => $('#qa-su').textContent = $('#qa-unit').value === 'kg' ? '(kg)' : '(pcs)');
    $('#qa-su').textContent = $('#qa-unit').value === 'kg' ? '(kg)' : '(pcs)';
    $('#qa-mrp').addEventListener('input', () => { $('#qa-price').placeholder = $('#qa-mrp').value ? '= MRP ' + $('#qa-mrp').value : ''; });
    ['#qa-price', '#qa-mrp', '#qa-cost'].forEach(s => $(s).addEventListener('input', margin));
    // starter-catalogue suggestions: pick one to activate it instead of typing everything
    const drawSugg = () => { $('#qa-sugg').innerHTML = sugg.map((it, i) => `<button type="button" class="list-group-item list-group-item-action py-1 ${i === si ? 'active' : ''}" data-i="${i}">
      <b>${esc(it.name)}</b> <span class="small">${esc(it.sku)}${it.active ? ' · already selling at ₹' + esc(it.price) : ' · starter list'}</span></button>`).join(''); };
    const pick = it => {
      sugg = []; drawSugg();
      if (it.active) { $('#qa-err').textContent = `${it.name} (${it.sku}) is already on sale. To give it this barcode, use "Link to an existing product".`; return; }
      candidate = it.id; $('#qa-name').value = it.name; $('#qa-ta').value = it.name_ta || '';
      if (it.category) $('#qa-cat').value = it.category; $('#qa-unit').value = it.unit_code || 'pcs'; $('#qa-unit').dispatchEvent(new Event('change'));
      if (it.mrp) $('#qa-mrp').value = it.mrp; if (it.price) $('#qa-price').value = it.price; if (it.gst !== '') $('#qa-gst').value = it.gst;
      $('#qa-cand').classList.remove('d-none'); $('#qa-cand').innerHTML = `Using <b>${esc(it.sku)}</b> from the starter list (no duplicate is created). <a href="#" id="qa-uncand">Make a new product instead</a>`;
      $('#qa-uncand').onclick = e => { e.preventDefault(); candidate = ''; $('#qa-cand').classList.add('d-none'); };
      $('#qa-mrp').focus(); margin();
    };
    $('#qa-sugg').addEventListener('mousedown', e => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(sugg[+b.dataset.i]); } });
    $('#qa-name').addEventListener('input', () => {
      candidate = ''; $('#qa-cand').classList.add('d-none'); clearTimeout(t);
      const q = $('#qa-name').value.trim(); if (q.length < 3) { sugg = []; return drawSugg(); }
      t = setTimeout(async () => { const r = await fetch('/api/pos/search/?all=1&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } }); sugg = ((await r.json()).results || []).slice(0, 7); si = -1; drawSugg(); }, 150);
    });
    $('#qa-name').addEventListener('blur', () => setTimeout(() => { sugg = []; drawSugg(); }, 150));
    // Enter = next box; Enter on the last box = save
    root.addEventListener('keydown', e => {
      if (e.target.id === 'qa-name' && sugg.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); si = (si + (e.key === 'ArrowDown' ? 1 : -1) + sugg.length) % sugg.length; return drawSugg(); }
      if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return;
      e.preventDefault(); e.stopPropagation();
      if (e.target.id === 'qa-name' && si >= 0 && sugg[si]) return pick(sugg[si]);
      if (e.ctrlKey) return save();
      const i = order.indexOf('#' + e.target.id);
      if (i >= 0 && i < order.length - 1) { const n = $(order[i + 1]); n.focus(); if (n.select) n.select(); } else save();
    });
    let saving = false;
    async function save() {
      if (saving) return; saving = true; $('#qa-err').textContent = '';
      const body = { code: $('#qa-code').value.trim(), name: $('#qa-name').value, name_ta: $('#qa-ta').value, category: $('#qa-cat').value, unit: $('#qa-unit').value,
        mrp: $('#qa-mrp').value, price: $('#qa-price').value.trim() || $('#qa-mrp').value, gst: $('#qa-gst').value, stock: $('#qa-stock').value, cost: $('#qa-cost').value,
        candidate, stock_required: !!o.stockRequired };
      if ($('#qa-ap')) { body.approver = $('#qa-ap').value; body.pin = $('#qa-pin').value; }
      try {
        const r = await fetch('/api/products/quick-add/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '' }, body: JSON.stringify(body) });
        const d = await r.json();
        if (!d.ok) { $('#qa-err').textContent = d.error; return; }
        localStorage.setItem('qa-last', JSON.stringify({ cat: body.category || (d.item && d.item.category), unit: body.unit, gst: body.gst }));
        o.onSaved && o.onSaved(d.item, d);
      } catch (err) { $('#qa-err').textContent = 'Could not save. Is the store program still running?'; } finally { saving = false; }
    }
    setTimeout(() => { const f = $(o.code ? '#qa-name' : '#qa-code'); f && f.focus(); }, 30);
    return { save };
  }
  window.QuickAdd = { html, bind };
})();
