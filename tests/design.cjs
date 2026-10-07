const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { once } = require('node:events');

// Exercise edge cases that are easy to miss when checking a visual redesign.
(async () => {
  const { createApp } = await import('../server/server.js');
  const evidenceDir = resolve('test-results', `design-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(evidenceDir, { recursive: true });
  const results = { evidenceDir, checks: [], errors: [] };
  let app, browser;
  try {
    app = createApp({ databasePath: ':memory:' });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    browser = await chromium.launch({ channel: process.env.POS_BROWSER_CHANNEL || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 320, height: 800 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => results.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') results.errors.push(message.text()); });
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);
    await page.getByRole('heading', { name: 'What can we get you?', exact: true }).waitFor();
    const button = name => page.getByRole('button', { name, exact: true }).click();
    const fit = async label => {
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
      assert.ok(dimensions.width <= dimensions.viewport, `${label}: ${JSON.stringify(dimensions)}`);
      const clipped = await page.locator('.summary-table, .order-total, .cart-title, .quick-amounts').evaluateAll(elements => elements
        .filter(el => el.scrollWidth > el.clientWidth + 1)
        .map(el => ({ element: el.className, width: el.clientWidth, contents: el.scrollWidth })));
      assert.deepEqual(clipped, [], `${label}: clipped content`);
      results.checks.push(label);
    };
    await fit('320px catalog fits');
    const message = 'Payment successful — Transaction saved. Your campus order is ready. <b>Plain text</b>';
    await page.evaluate(message => window.showToast(message), message);
    await page.locator('.toast-visible').waitFor();
    const toast = await page.locator('.kiosk-toast').boundingBox();
    assert.ok(toast.x >= 0 && toast.x + toast.width <= 320);
    assert.equal(await page.locator('.toast-message').innerText(), message);
    assert.equal(await page.locator('.toast-message b').count(), 0);
    await page.screenshot({ path: resolve(evidenceDir, 'mobile-long-toast.png'), fullPage: true });
    await page.locator('.kiosk-toast').waitFor({ state: 'detached', timeout: 4000 });
    results.checks.push('Long toast wraps, renders text safely, and dismisses');

    // Use real click handlers to reach the maximum supported per-product quantity.
    await page.evaluate(() => {
      for (let id = 1; id <= 6; id++) {
        document.querySelector(`button[data-action="add"][data-id="${id}"]`).click();
        document.querySelector('#confirmation-form button[value="confirm"]').click();
        for (let quantity = 1; quantity < 999; quantity++) {
          document.querySelector(`button[data-action="increase"][data-id="${id}"]`).click();
        }
      }
    });
    for (const name of ['Coffee', 'Sandwich', 'Soft Drink', 'Cookies', 'Bottled Water', 'Chocolate']) {
      assert.equal(await page.getByLabel(`${name} quantity`, { exact: true }).innerText(), '999');
      assert.equal(await page.getByRole('button', { name: `Increase ${name} quantity`, exact: true }).isDisabled(), true);
    }
    await fit('320px maximum quantity cart fits');
    await button('Review Order');
    await fit('320px maximum quantity summary fits');
    await page.screenshot({ path: resolve(evidenceDir, 'mobile-large-summary.png'), fullPage: true });
    await button('Continue to Payment');
    await fit('320px large total payment methods fit');
    await button('Cash');
    await page.getByLabel('Amount Paid', { exact: true }).fill('1000000');
    await fit('320px maximum cash amount and quick amounts fit');
    await button('Pay Now');
    await page.getByRole('heading', { name: 'Payment Successful', exact: true }).waitFor();
    await fit('320px large amount confirmation fits');
    await button('View Receipt');
    await fit('320px maximum quantity receipt fits');
    await page.screenshot({ path: resolve(evidenceDir, 'mobile-large-receipt.png'), fullPage: true });
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 1);
    assert.deepEqual(results.errors, []);
    results.status = 'PASS';
    console.log(`PASS ${results.checks.length} design edge checks. Evidence: ${evidenceDir}`);
  } catch (error) {
    results.status = 'FAIL'; results.error = error.stack;
    throw error;
  } finally {
    await browser?.close();
    if (app?.server.listening) await new Promise(done => app.server.close(done));
    writeFileSync(resolve(evidenceDir, 'results.json'), JSON.stringify(results, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
