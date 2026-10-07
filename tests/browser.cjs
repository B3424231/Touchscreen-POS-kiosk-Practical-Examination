const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { once } = require('node:events');

(async () => {
  const { createApp } = await import('../server/server.js');
  const run = new Date().toISOString().replace(/[:.]/g, '-');
  const evidenceDir = resolve('test-results', run);
  mkdirSync(evidenceDir, { recursive: true });
  const databasePath = resolve(evidenceDir, 'browser.db');
  let app = createApp({ databasePath });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ channel: process.env.POS_BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const results = { run, browser: browser.version(), base, databasePath, evidenceDir, instructor: [], regression: [], consoleErrors: errors };
  const save = () => {
    writeFileSync(resolve(evidenceDir, 'results.json'), JSON.stringify(results, null, 2));
    writeFileSync(resolve('test-results', 'latest.json'), JSON.stringify({ evidenceDir, resultsFile: resolve(evidenceDir, 'results.json') }, null, 2));
  };
  const count = () => app.db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count;
  const click = (role, name) => page.getByRole(role, { name, exact: true }).click();
  const button = name => click('button', name);
  const heading = async text => { await page.getByRole('heading', { name: text, exact: true }).waitFor(); };
  const text = async (selector, expected) => {
    await page.waitForFunction(({ selector, expected }) => document.querySelector(selector)?.innerText.includes(expected), { selector, expected });
    assert.ok((await page.locator(selector).innerText()).includes(expected), `${selector} should contain ${expected}`);
  };
  const shot = filename => page.screenshot({ path: resolve(evidenceDir, filename), fullPage: true });
  const product = async name => { await page.getByRole('button', { name: new RegExp(`^Add ${name} to order,`) }).click(); };
  const reference = async () => page.locator('.reference').innerText();
  const references = [];
  async function check(number, name, fn, regression = false) {
    const result = { number, name, status: 'FAILED' };
    (regression ? results.regression : results.instructor).push(result);
    try { await fn(); result.status = 'VERIFIED'; console.log(`PASS ${regression ? 'Regression' : 'Instructor'} ${number}: ${name}`); }
    catch (error) { result.error = error.stack; await shot(`failure-${number}.png`); save(); throw error; }
    save();
  }
  async function newOrder() {
    await button('View Receipt'); await heading('Your digital receipt');
    await button('New Transaction'); await heading('What can we get you?');
  }
  async function choosePayment(method) {
    await button('Review Order'); await button('Continue to Payment'); await button(method);
  }
  try {
    await page.goto(base);
    await check(1, 'Startup and six touch products', async () => {
      await heading('What can we get you?');
      assert.equal(await page.locator('.product-card').count(), 6);
      for (const [name, price] of [['Coffee','45.00'],['Sandwich','50.00'],['Soft Drink','35.00'],['Cookies','25.00'],['Bottled Water','20.00'],['Chocolate','25.00']]) {
        const card = page.getByRole('button', { name: new RegExp(`^Add ${name} to order,`) });
        assert.ok((await card.innerText()).includes(`₱${price}`));
        const box = await card.boundingBox(); assert.ok(box.height >= 48 && box.width >= 48);
      }
      assert.equal(await page.getByRole('button', { name: 'Review Order', exact: true }).isDisabled(), true);
      await text('.order-total', '₱0.00'); await shot('01-startup-desktop.png');
    });
    await check(2, 'Coffee x2, Sandwich x1, Soft Drink x1 = PHP175', async () => {
      await product('Coffee'); await product('Coffee'); await product('Sandwich'); await product('Soft Drink');
      await text('.order-panel', '₱90.00'); await text('.order-panel', '₱50.00'); await text('.order-panel', '₱35.00'); await text('.order-total', '₱175.00');
    });
    await check(3, 'Quantity increases to PHP220 and decreases to PHP175', async () => {
      await button('Increase Coffee quantity'); await text('.order-total', '₱220.00'); await text('.order-panel', '₱135.00');
      await button('Decrease Coffee quantity'); await text('.order-total', '₱175.00');
      await product('Bottled Water'); await button('Decrease Bottled Water quantity');
      assert.equal(await page.getByRole('button', { name: 'Decrease Bottled Water quantity', exact: true }).count(), 0);
      await text('.order-total', '₱175.00');
    });
    await check(4, 'Remove Soft Drink = PHP140', async () => {
      await button('Remove Soft Drink'); await text('.order-total', '₱140.00');
      assert.equal(await page.getByRole('button', { name: 'Remove Soft Drink', exact: true }).count(), 0);
    });
    await check(5, 'Order summary matches cart', async () => {
      await button('Review Order'); await heading('Review your order');
      const rows = await page.locator('tbody tr').allTextContents();
      assert.deepEqual(rows, ['Coffee2₱45.00₱90.00', 'Sandwich1₱50.00₱50.00']);
      await text('.order-total', '₱140.00'); await shot('05-order-summary.png');
    });
    await check(6, 'Back preserves items, quantities and total', async () => {
      await button('Back'); await heading('What can we get you?');
      assert.equal(await page.getByLabel('Coffee quantity', { exact: true }).innerText(), '2');
      assert.equal(await page.getByLabel('Sandwich quantity', { exact: true }).innerText(), '1');
      await text('.order-total', '₱140.00'); await button('Review Order');
    });
    await check(7, 'Three large payment options', async () => {
      await button('Continue to Payment'); await heading('How would you like to pay?');
      for (const method of ['Cash', 'QR Payment', 'Credit/Debit Card']) {
        const target = page.getByRole('button', { name: method, exact: true });
        const box = await target.boundingBox(); assert.ok(box.width >= 48 && box.height >= 48);
      }
      await text('.due-summary', '₱140.00'); await shot('07-payment-methods.png');
    });
    await check(8, 'Insufficient cash rejected without database write', async () => {
      await button('Cash'); await heading('Pay with cash');
      await page.getByLabel('Amount Paid', { exact: true }).fill('100'); await button('Pay Now');
      await text('#payment-error', 'Insufficient payment. Please enter at least ₱140.00.');
      assert.equal(count(), 0); await heading('Pay with cash');
      await shot('08-insufficient-cash.png');
    });
    await check(9, 'Successful cash PHP200 and exact PHP140', async () => {
      await page.getByLabel('Amount Paid', { exact: true }).fill('200'); await text('#change-preview', '₱60.00');
      await button('Pay Now'); await heading('Payment Successful');
      const saved = app.db.prepare('SELECT total_cents, amount_paid_cents, change_cents FROM transactions').get();
      assert.deepEqual({ ...saved }, { total_cents: 14000, amount_paid_cents: 20000, change_cents: 6000 });
      references.push(await reference());
      // Exact cash is verified in the regression flow after receipt checks.
    });
    await check(10, 'Confirmation shows matching committed payment details', async () => {
      await text('.success-page', '₱140.00'); await text('.success-page', '₱200.00'); await text('.success-page', '₱60.00'); await text('.success-page', 'Cash');
      assert.match(references[0], /^TXN-\d{8}-/); assert.equal(await page.getByRole('button', { name: 'View Receipt', exact: true }).count(), 1);
      await shot('10-payment-success.png');
    });
    await check(11, 'Receipt matches items, totals, method and reference', async () => {
      await button('View Receipt'); await heading('Your digital receipt');
      assert.equal(await reference(), references[0]);
      assert.deepEqual(await page.locator('tbody tr').allTextContents(), ['Coffee2₱45.00₱90.00', 'Sandwich1₱50.00₱50.00']);
      for (const expected of ['₱140.00', '₱200.00', '₱60.00', 'Cash', 'Payment Successful', 'Date & time']) await text('.receipt', expected);
      await shot('11-cash-receipt.png');
    });
    await check(12, 'QR simulation has placeholder, confirmation and zero change', async () => {
      await button('New Transaction'); await product('Coffee'); await product('Bottled Water'); await choosePayment('QR Payment');
      await heading('Pay with QR'); await text('.due-summary', '₱65.00'); await text('.qr-placeholder', 'DEMO QR PLACEHOLDER'); await shot('12-qr-payment.png');
      await button('Confirm Payment'); await heading('Payment Successful'); references.push(await reference());
      await button('View Receipt'); await text('.receipt', 'QR Payment'); await text('.receipt', '₱65.00'); await text('.receipt', '₱0.00');
      const saved = app.db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT 1').get();
      assert.equal(saved.amount_paid_cents, 6500); assert.equal(saved.change_cents, 0); assert.equal(saved.payment_method, 'QR Payment');
    });
    await check(13, 'Card processing simulation saves exact payment', async () => {
      await button('New Transaction'); await product('Sandwich'); await choosePayment('Credit/Debit Card');
      await heading('Pay with your card'); await text('.payment-instruction', 'Please tap, insert, or swipe your card.');
      await button('Process Payment'); await page.getByRole('button', { name: /Processing payment/ }).waitFor();
      assert.equal(await page.getByRole('button', { name: /Processing payment/ }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Back to payment methods', exact: true }).isDisabled(), true);
      await shot('13-card-processing.png'); await heading('Payment Successful'); references.push(await reference());
      await button('View Receipt'); await text('.receipt', 'Credit/Debit Card'); await text('.receipt', '₱50.00'); await text('.receipt', '₱0.00');
    });
    await check(14, 'New transaction clears active data and preserves completed history', async () => {
      const before = count(); await button('New Transaction'); await heading('What can we get you?');
      await text('.empty-cart', 'Your order is empty.'); await text('.order-total', '₱0.00');
      assert.equal(await page.locator('.cart-item').count(), 0);
      assert.equal(await page.locator('.reference').count(), 0); assert.equal(count(), before);
      await product('Coffee'); await choosePayment('Cash');
      assert.equal(await page.getByLabel('Amount Paid', { exact: true }).inputValue(), '');
      assert.equal(await page.locator('#payment-error').innerText(), '');
      await button('Back to payment methods'); await button('Back to order'); await button('Back'); await button('Remove Coffee');
    });
    await check(15, 'Separate completed transactions have unique references', async () => {
      assert.equal(new Set(references).size, 3);
      const rows = app.db.prepare('SELECT transaction_number FROM transactions').all();
      assert.equal(new Set(rows.map(r => r.transaction_number)).size, rows.length);
      assert.equal(rows.length, 3);
    });
    await check('R1', 'Blank, text, negative and extra-decimal cash validation', async () => {
      await product('Coffee'); await product('Coffee'); await product('Sandwich'); await choosePayment('Cash');
      for (const value of ['', 'abc', '-1', '140.001']) {
        await page.getByLabel('Amount Paid', { exact: true }).fill(value); await button('Pay Now');
        await text('#payment-error', 'Please enter a valid amount'); assert.equal(count(), 3); await heading('Pay with cash');
      }
      await page.getByLabel('Amount Paid', { exact: true }).fill('140'); await button('Pay Now'); await heading('Payment Successful');
      await text('.success-page', '₱0.00');
      const exact = app.db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT 1').get();
      assert.equal(exact.total_cents, 14000); assert.equal(exact.amount_paid_cents, 14000); assert.equal(exact.change_cents, 0);
      results.instructor.find(r => r.number === 9).exactPayment = 'VERIFIED: PHP140 paid, PHP0 change';
      await newOrder();
    }, true);
    await check('R2', 'Responsive layout, large visible controls and focus', async () => {
      for (const viewport of [{width:1366,height:900}, {width:1024,height:768}, {width:768,height:1024}, {width:390,height:844}, {width:360,height:800}]) {
        await page.setViewportSize(viewport);
        // Edge reports its new viewport before responsive styles settle.
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, `overflow at ${viewport.width}`);
        const sizes = await page.locator('button').evaluateAll(buttons => buttons.filter(b => !b.disabled).map(b => ({ label:b.getAttribute('aria-label') || b.textContent.trim(), height:b.getBoundingClientRect().height, width:b.getBoundingClientRect().width })));
        for (const size of sizes) assert.ok(size.height >= 48 && size.width >= 48, JSON.stringify(size));
        await shot(`responsive-${viewport.width}.png`);
      }
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BUTTON');
      assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid');
      await page.setViewportSize({width:1366,height:900});
    }, true);
    await check('R3', 'SQLite values, snapshots, keys and integrity', async () => {
      const sales = app.db.prepare('SELECT * FROM transactions ORDER BY id').all();
      for (const sale of sales) {
        const items = app.db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(sale.id);
        assert.equal(items.reduce((sum,i) => sum + i.subtotal_cents, 0), sale.total_cents);
        assert.equal(sale.amount_paid_cents - sale.total_cents, sale.change_cents);
        assert.equal(sale.status, 'completed');
        for (const item of items) assert.equal(item.unit_price_cents * item.quantity, item.subtotal_cents);
      }
      assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(app.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      results.database = { products: app.db.prepare('SELECT * FROM products').all(), transactions: sales, items: app.db.prepare('SELECT * FROM transaction_items').all(), integrity: 'ok', foreignKeyViolations: 0 };
    }, true);
    await check('R4', 'Actual server restart retains sales and six seeds', async () => {
      const before = count(); const saved = app.db.prepare('SELECT transaction_number FROM transactions ORDER BY id').all();
      await new Promise(done => app.server.close(done));
      app = createApp({ databasePath }); app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
      base = `http://127.0.0.1:${app.server.address().port}`; await page.goto(base); await heading('What can we get you?');
      assert.equal(count(), before); assert.deepEqual(app.db.prepare('SELECT transaction_number FROM transactions ORDER BY id').all(), saved);
      assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 6);
    }, true);
    await check('R5', 'Unavailable catalog shows recoverable inline error', async () => {
      await page.route('**/api/products', route => route.abort());
      await page.reload(); await heading('The store is temporarily unavailable');
      await page.unroute('**/api/products'); await button('Try Again'); await heading('What can we get you?');
      // Aborted network failures are expected in this deliberate fault test.
      const unexpected = errors.filter(message => !/net::ERR_FAILED/.test(message));
      assert.deepEqual(unexpected, []);
      results.expectedNetworkErrors = errors.splice(0);
    }, true);
    await check('R6', 'Lost payment response retry does not duplicate the sale', async () => {
      await product('Cookies'); await choosePayment('Cash');
      await page.getByLabel('Amount Paid', { exact: true }).fill('50');
      const before = count();
      await page.route('**/api/transactions', async route => {
        await route.fetch(); await route.abort();
      });
      await button('Pay Now'); await text('#payment-error', 'Payment confirmation is unavailable');
      assert.equal(count(), before + 1);
      assert.equal(await page.getByLabel('Amount Paid', { exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Back to payment methods', exact: true }).isDisabled(), true);
      await page.unroute('**/api/transactions'); await button('Retry payment confirmation'); await heading('Payment Successful');
      assert.equal(count(), before + 1); await newOrder();
      results.expectedNetworkErrors.push(...errors.splice(0));
    }, true);
    await check('R7', 'Mobile summary, payment, cash, QR, card, success and receipt layouts', async () => {
      await page.setViewportSize({ width: 360, height: 800 });
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const verifyScreen = async filename => {
        await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, filename);
        const sizes = await page.locator('button:not(:disabled)').evaluateAll(buttons => buttons.map(b => ({ height: b.getBoundingClientRect().height, width: b.getBoundingClientRect().width, text: b.textContent })));
        for (const size of sizes) assert.ok(size.height >= 48 && size.width >= 48, JSON.stringify(size));
        await shot(filename);
      };
      await product('Coffee'); await product('Coffee'); await product('Sandwich');
      await verifyScreen('mobile-cart.png');
      await button('Review Order'); await verifyScreen('mobile-summary.png');
      await button('Continue to Payment'); await verifyScreen('mobile-methods.png');
      await button('Cash'); await verifyScreen('mobile-cash.png');
      await button('Back to payment methods'); await button('QR Payment'); await verifyScreen('mobile-qr.png');
      await button('Back to payment methods'); await button('Credit/Debit Card'); await verifyScreen('mobile-card.png');
      await button('Process Payment'); await heading('Payment Successful'); await verifyScreen('mobile-success.png');
      await button('View Receipt'); await verifyScreen('mobile-receipt.png'); await button('New Transaction');
    }, true);
    results.finalTransactionCount = count();
    results.finalItemCount = app.db.prepare('SELECT COUNT(*) AS count FROM transaction_items').get().count;
    results.database.transactions = app.db.prepare('SELECT * FROM transactions ORDER BY id').all();
    results.database.items = app.db.prepare('SELECT * FROM transaction_items ORDER BY id').all();
    assert.deepEqual(errors, []);
    results.status = 'VERIFIED'; save();
    console.log(`Evidence: ${evidenceDir}`);
  } catch (error) { results.status = 'FAILED'; results.error = error.stack; save(); throw error; }
  finally { await browser.close(); if (app.server.listening) await new Promise(done => app.server.close(done)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
