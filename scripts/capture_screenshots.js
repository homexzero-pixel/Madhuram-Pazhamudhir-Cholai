// Captures the screenshots used in docs/ from a running PRACTICE server.
// Developer tool: needs Node.js and Playwright.  node scripts/capture_screenshots.js http://127.0.0.1:8770 out-folder
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || 'http://127.0.0.1:8770';
const out = process.argv[3] || 'docs/img/raw';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function session(user) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${user} ${p.url()} ${e.message}`));
    await p.goto(base + '/accounts/login/');
    await p.fill('#u', user); await p.fill('#p', 'practice123'); await p.click('form button');
    await p.waitForLoadState('networkidle');
    return p;
  }
  const shot = async (p, name, opts) => { await p.waitForTimeout(250); await p.screenshot(Object.assign({ path: path.join(out, name + '.png') }, opts || {})); };
  const scan = async (p, code) => { await p.fill('#scan', code); await p.press('#scan', 'Enter'); await p.waitForTimeout(400); };

  // ---------------- login
  const anon = await (await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 })).newPage();
  await anon.goto(base + '/accounts/login/'); await shot(anon, '01-login');

  // ---------------- cashier at the counter
  const c = await session('cashier');
  await c.goto(base + '/billing/'); await c.waitForTimeout(600);
  await c.evaluate(async () => {  // start from an empty bill
    const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
    await fetch('/api/pos/cancel/', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf }, body: JSON.stringify({ reason: 'screenshot run' }) });
  });
  await c.reload(); await c.waitForTimeout(600);
  await shot(c, '02-billing-empty');
  await scan(c, '8901000000019'); await scan(c, 'TRYRICE');
  await scan(c, 'TRYAPPLE'); await c.waitForSelector('#w'); await c.fill('#w', '0.375'); await c.waitForTimeout(150);
  await shot(c, '03-weight-dialog');
  await c.press('#w', 'Enter'); await c.waitForTimeout(500);
  await scan(c, '0.640*112');  // pomegranate by PLU with the weight typed first: practice 5% offer applies
  await shot(c, '04-bill');
  await scan(c, '8909999999994');
  await shot(c, '05-unknown-barcode');
  await c.keyboard.press('Escape'); await c.waitForTimeout(500);
  await c.keyboard.press('F2'); await c.waitForSelector('#sq'); await c.fill('#sq', 'பொன்னி'); await c.waitForTimeout(700);
  await shot(c, '06-search-tamil');
  await c.keyboard.press('Escape'); await c.waitForTimeout(500);
  await c.keyboard.press('ArrowUp'); await c.keyboard.press('ArrowUp'); await c.keyboard.press('F5'); await c.waitForSelector('#pv');
  await c.fill('#pv', '70'); await c.fill('#pr', 'Shelf label shows ₹70');
  await shot(c, '07-price-change-approval');
  await c.fill('#pa', 'manager'); await c.fill('#pp', '1234'); await c.click('#pv-ok'); await c.waitForTimeout(600);
  await c.keyboard.press('F12'); await c.waitForSelector('#p-cash');
  await c.fill('#p-upi', '100'); await c.fill('#r-upi', 'UPI-REF-381'); await c.fill('#p-cash', '300'); await c.dispatchEvent('#p-cash', 'input');
  await shot(c, '08-payment-split');
  await c.press('#p-cash', 'Enter'); await c.waitForTimeout(1500);
  await shot(c, '09-sale-saved');
  const receipt = await c.getAttribute('#last-print', 'href');
  const saleId = receipt.split('/')[2];
  for (const [w, name] of [['80', '10-receipt-80mm'], ['58', '11-receipt-58mm']]) {
    const r = await c.context().newPage(); await r.goto(`${base}/sales/${saleId}/receipt/?w=${w}`);
    await r.locator('.receipt').screenshot({ path: path.join(out, name + '.png') }); await r.close();
  }
  { const r = await c.context().newPage(); await r.setViewportSize({ width: 900, height: 1100 }); await r.goto(`${base}/sales/${saleId}/receipt/?w=a4`);
    await r.locator('.a4').screenshot({ path: path.join(out, '12-invoice-a4.png') }); await r.close(); }
  await scan(c, 'TRYOIL1L'); await c.keyboard.press('F8'); await c.waitForSelector('#hl'); await c.fill('#hl', 'Lakshmi – coming back'); await c.press('#hl', 'Enter');
  await c.waitForTimeout(500); await c.keyboard.press('F9'); await c.waitForTimeout(400);
  await shot(c, '13-recall-held');
  await c.keyboard.press('Escape');

  // ---------------- manager: return, cash closing
  const m = await session('manager');
  await m.goto(`${base}/sales/${saleId}/`);
  const firstQty = m.locator('input[name^="qty_"]').first(); await firstQty.fill('1');
  await m.fill('#reason', 'Pack torn'); await shot(m, '14-return-form', { fullPage: true });
  m.once('dialog', d => d.accept()); await m.click('form[action$="/return/"] button.btn-danger'); await m.waitForLoadState('networkidle');
  await shot(m, '15-credit-note');
  await m.goto(base + '/cash/'); await m.fill('#amt', '2000'); await m.fill('#rsn', 'Deposit to bank'); await m.fill('#ref', 'SLIP-1182');
  await m.selectOption('#kind', 'bank_deposit'); await m.click('form[action$="/cash/move/"] button'); await m.waitForLoadState('networkidle');
  await m.fill('#n500', '2'); await m.fill('#n100', '5'); await m.dispatchEvent('#n100', 'input');
  await shot(m, '16-cash-closing', { fullPage: true });
  const shifts = m.locator('a[href^="/cash/shift/"]'); await shifts.nth(1).click(); await m.waitForLoadState('networkidle');
  await shot(m, '17-shift-detail', { fullPage: true });

  // ---------------- owner
  const o = await session('owner');
  const page = async (url, name, full) => { await o.goto(base + url); await o.waitForLoadState('networkidle'); await shot(o, name, full ? { fullPage: true } : undefined); };
  await page('/reports/dashboard/', '20-owner-dashboard', true);
  await page('/products/?status=candidate&q=ponni', '21-products-candidates');
  await o.goto(base + '/products/?q=TRYJUICE'); await o.click('table a >> nth=0'); await o.waitForLoadState('networkidle'); await shot(o, '22-product-detail', { fullPage: true });
  const csvPath = path.join(out, 'import-sample.csv');
  fs.writeFileSync(csvPath, 'SKU,Barcode,English name,Selling price,MRP,GST treatment\nMPC00003,08901725121112,Ponni rice · Brand A · 500 g,38,40,exempt\n' +
    'MPC00004,8901725999992,Toor dal · Brand B · 250 g,60,55,unset\nMPC00005,08901725121112,Toor dal · Brand C · 250 g,58,62,unset\n');
  await o.goto(base + '/products/import/'); await o.setInputFiles('#file', csvPath); await o.click('form[enctype] button'); await o.waitForLoadState('networkidle');
  await shot(o, '23-import-preview', { fullPage: true });
  await o.goto(base + '/purchases/grn/new/?item=' + (await (await o.request.get(base + '/api/pos/search/?all=1&q=TRYJUICE', { headers: { Accept: 'application/json' } })).json()).results[0].id);
  await o.selectOption('#sup', { index: 4 }); await o.fill('#inv', 'FMCG-7781'); await o.fill('#invd', new Date().toISOString().slice(0, 10)); await o.fill('#invt', '672');
  await o.fill('input[name="l0-qty"]', '2'); await o.fill('input[name="l0-free_qty"]', '1'); await o.fill('input[name="l0-unit_cost"]', '336');
  await shot(o, '24-goods-receipt-form', { fullPage: true });
  await o.click('form button.btn-success'); await o.waitForLoadState('networkidle');
  await shot(o, '25-goods-receipt', { fullPage: true });
  await page('/inventory/?view=expiry', '26-near-expiry');
  await page('/inventory/?view=low', '27-low-stock');
  await o.goto(base + '/inventory/counts/'); await o.selectOption('#cat', { label: 'Fresh produce › Fruit' }); await o.fill('#t', 'Evening fruit count');
  await o.click('form button.btn-success'); await o.waitForLoadState('networkidle');
  const counts = o.locator('td input[name^="c"]'); await counts.nth(0).fill('20'); await o.locator('td input[name^="r"]').nth(0).fill('2 kg spoiled, not written off');
  await shot(o, '28-stocktake', { fullPage: true });
  await page('/reports/view/?report=categories', '29-report-categories', true);
  await o.click('table tbody a >> nth=0'); await o.waitForLoadState('networkidle'); await shot(o, '30-report-drilldown', true);
  await page('/reports/view/?report=daily', '31-report-daily', true);
  await page('/reports/view/?report=tax', '32-report-tax', true);
  await page('/reports/view/?report=shifts', '33-report-shifts', true);
  await page('/cash/settlements/', '34-settlements', true);
  await o.goto(base + '/settings/edit/hardware/'); const ex = (await o.locator('code').first().textContent()).trim();
  await page('/settings/edit/hardware/?test=' + ex, '35-hardware-scale', true);
  await o.goto(base + '/settings/backups/'); await o.click('form[action$="/now/"] button'); await o.waitForLoadState('networkidle');
  await o.click('form[action$="/verify/"] button >> nth=0'); await o.waitForLoadState('networkidle'); await shot(o, '36-backups', true);
  await page('/settings/staff/', '37-staff-roles', true);
  await page('/settings/audit/', '38-audit-log');
  await page('/customers/offers/', '39-offers');
  await page('/settings/edit/store/', '40-store-settings', true);
  await page('/products/practice-barcodes/', '41-practice-barcodes', true);

  console.log(JSON.stringify({ errors }));
  await browser.close();
})();
