const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { once } = require('node:events');

(async () => {
  const { createApp } = await import('../server/server.js');
  const evidenceDir = resolve('test-results', `confirmation-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(evidenceDir, { recursive: true });
  const results = { evidenceDir, checks: [], errors: [] };
  let app, browser;
  try {
    app = createApp({ databasePath: ':memory:' });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    browser = await chromium.launch({ channel: process.env.POS_BROWSER_CHANNEL || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => results.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') results.errors.push(message.text()); });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const click = name => page.getByRole('button', { name, exact: true }).click();
    const select = name => page.getByRole('button', { name: new RegExp(`^Add ${name} to order,`) }).click();
    const dialog = page.getByRole('dialog', { name: 'Add to your order?', exact: true });
    await page.goto(base);
    await page.locator('.product-card').first().waitFor();
    await select('Coffee');
    await dialog.waitFor();
    assert.equal(await page.locator('#confirmation-name').innerText(), 'Coffee');
    assert.equal(await page.locator('#confirmation-price').innerText(), '1 × ₱45.00');
    assert.equal(await page.locator('.cart-item').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Cancel');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('#add-confirmation').contains(document.activeElement)), true);
    }
    await page.screenshot({ path: resolve(evidenceDir, 'desktop-confirmation.png') });
    await click('Cancel');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.locator('.cart-item').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focus), 'product-1');
    results.checks.push('Product and price are shown before adding; Cancel leaves the order unchanged; focus is trapped and restored');

    await select('Sandwich');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.locator('.cart-item').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('confirmation-open')), false);
    results.checks.push('Escape cancels and restores scrolling');

    await select('Coffee');
    await page.evaluate(() => {
      const confirm = document.querySelector('#confirmation-form button[value="confirm"]');
      confirm.click(); confirm.click();
    });
    assert.equal(await page.getByLabel('Coffee quantity', { exact: true }).innerText(), '1');
    assert.equal(await page.locator('.order-total > strong').innerText(), '₱45.00');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focus), 'product-1');
    results.checks.push('Confirm adds once even with repeated submit events');

    await select('Coffee');
    assert.ok((await page.locator('#confirmation-existing').innerText()).includes('This will make 2.'));
    await click('Add to Order');
    assert.equal(await page.getByLabel('Coffee quantity', { exact: true }).innerText(), '2');
    await click('Increase Coffee quantity');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.getByLabel('Coffee quantity', { exact: true }).innerText(), '3');
    results.checks.push('Repeated catalog selections confirm the extra item; existing quantity controls remain immediate');

    const stability = await page.evaluate(() => {
      const catalog = document.querySelector('.product-grid');
      const hero = document.querySelector('.page-intro');
      const coffeeRow = document.querySelector('[data-cart-id="1"]');
      const increase = coffeeRow.querySelector('[data-action="increase"]');
      increase.focus({ preventScroll: true });
      for (let i = 0; i < 40; i++) {
        document.querySelector(`[data-action="${i % 2 ? 'decrease' : 'increase'}"][data-id="1"]`).click();
      }
      return { catalog: catalog === document.querySelector('.product-grid'), hero: hero === document.querySelector('.page-intro'), row: coffeeRow === document.querySelector('[data-cart-id="1"]'), focus: document.activeElement === increase };
    });
    assert.deepEqual(stability, { catalog: true, hero: true, row: true, focus: true });
    await click('Remove Coffee');
    assert.equal(await page.locator('.empty-cart').isVisible(), true);
    assert.equal(await page.locator('.selected-badge').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Review Order', exact: true }).isDisabled(), true);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.focus), 'product-1');
    results.checks.push('Quantity changes preserve catalog, row, and keyboard focus; removal restores the empty state');

    await select('Coffee'); await click('Add to Order');
    await page.evaluate(() => {
      const increase = document.querySelector('[data-action="increase"][data-id="1"]');
      for (let i = 1; i < 999; i++) increase.click();
    });
    await select('Coffee');
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.getByLabel('Coffee quantity', { exact: true }).innerText(), '999');
    assert.ok((await page.locator('.toast-message').innerText()).includes('Maximum quantity'));
    results.checks.push('Quantity 999 cannot be exceeded by a catalog selection');

    await page.reload();
    await page.setViewportSize({ width: 1366, height: 768 });
    for (const name of ['Coffee', 'Sandwich', 'Soft Drink']) {
      await select(name); await click('Add to Order');
    }
    let listMetrics = await page.locator('.cart-items').evaluate(list => ({ clientHeight:list.clientHeight, scrollHeight:list.scrollHeight, scrollable:list.classList.contains('is-scrollable') }));
    assert.equal(listMetrics.scrollable, false);
    assert.equal(listMetrics.scrollHeight, listMetrics.clientHeight);
    assert.equal(await page.locator('.cart-scroll-hint').isVisible(), false);
    await select('Cookies'); await click('Add to Order');
    listMetrics = await page.locator('.cart-items').evaluate(list => {
      const box = list.getBoundingClientRect();
      const rows = [...list.children].map(row => {
        const bounds = row.getBoundingClientRect();
        return { top:bounds.top, bottom:bounds.bottom };
      });
      return { top:box.top, bottom:box.bottom, clientHeight:list.clientHeight, scrollHeight:list.scrollHeight, scrollTop:list.scrollTop, rows, scrollable:list.classList.contains('is-scrollable'), tabIndex:list.tabIndex };
    });
    assert.equal(listMetrics.scrollable, true);
    assert.equal(listMetrics.tabIndex, 0);
    assert.ok(listMetrics.scrollHeight > listMetrics.clientHeight);
    assert.ok(listMetrics.rows[2].bottom <= listMetrics.bottom + 1);
    assert.ok(listMetrics.rows[3].bottom > listMetrics.bottom + 1);
    assert.equal(await page.locator('.cart-scroll-hint').isVisible(), true);
    const totalTop = await page.locator('.order-total').evaluate(element => element.getBoundingClientRect().top);
    assert.ok(totalTop >= listMetrics.bottom);
    await page.screenshot({ path: resolve(evidenceDir, 'three-visible-order-items.png') });
    const listBox = await page.locator('.cart-items').boundingBox();
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + listBox.height / 2);
    const pageScrollBefore = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(100);
    assert.ok(await page.locator('.cart-items').evaluate(list => list.scrollTop) > 0);
    assert.equal(await page.evaluate(() => scrollY), pageScrollBefore);
    results.checks.push('Three order rows are visible; a fourth scrolls inside the cart while totals remain fixed');

    await select('Bottled Water'); await click('Add to Order');
    await page.setViewportSize({ width: 1366, height: 950 });
    await click('Review Order');
    let reviewMetrics = await page.locator('.review-items').evaluate(list => ({ clientHeight:list.clientHeight, scrollHeight:list.scrollHeight, scrollable:list.classList.contains('is-scrollable') }));
    assert.equal(reviewMetrics.scrollable, false);
    assert.equal(reviewMetrics.scrollHeight, reviewMetrics.clientHeight);
    assert.equal(await page.locator('.review-scroll-hint').isVisible(), false);
    await click('Back');
    await select('Chocolate'); await click('Add to Order');
    await click('Review Order');
    await page.locator('.review-items').scrollIntoViewIfNeeded();
    reviewMetrics = await page.locator('.review-items').evaluate(list => {
      const box = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll('tbody tr')].map(row => row.getBoundingClientRect().bottom);
      return { bottom:box.bottom, clientHeight:list.clientHeight, scrollHeight:list.scrollHeight, rows, scrollable:list.classList.contains('is-scrollable'), tabIndex:list.tabIndex };
    });
    assert.equal(reviewMetrics.scrollable, true);
    assert.equal(reviewMetrics.tabIndex, 0);
    assert.ok(reviewMetrics.scrollHeight > reviewMetrics.clientHeight);
    assert.ok(reviewMetrics.rows[4] <= reviewMetrics.bottom + 1);
    assert.ok(reviewMetrics.rows[5] > reviewMetrics.bottom + 1);
    assert.equal(await page.locator('.review-scroll-hint').isVisible(), true);
    assert.equal(await page.locator('.review-items th').first().evaluate(element => getComputedStyle(element).position), 'sticky');
    const reviewTotalTop = await page.locator('.sheet > .order-total').evaluate(element => element.getBoundingClientRect().top);
    assert.ok(reviewTotalTop >= reviewMetrics.bottom);
    await page.screenshot({ path: resolve(evidenceDir, 'five-visible-review-items.png'), fullPage: true });
    const reviewBox = await page.locator('.review-items').boundingBox();
    await page.mouse.move(reviewBox.x + reviewBox.width / 2, reviewBox.y + reviewBox.height / 2);
    const reviewPageScroll = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 220);
    await page.waitForTimeout(100);
    assert.ok(await page.locator('.review-items').evaluate(list => list.scrollTop) > 0);
    assert.equal(await page.evaluate(() => scrollY), reviewPageScroll);
    results.checks.push('Five review rows are visible; a sixth scrolls inside the table while headings and total stay fixed');

    await page.reload();
    await page.setViewportSize({ width: 320, height: 800 });
    const chocolate = page.getByRole('button', { name: /^Add Chocolate to order,/ });
    await chocolate.scrollIntoViewIfNeeded();
    const initialScroll = await page.evaluate(() => scrollY);
    await chocolate.click();
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 320 && box.y >= 0 && box.y + box.height <= 800);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), 'hidden');
    for (const button of await dialog.getByRole('button').all()) {
      const size = await button.boundingBox();
      assert.ok(size.width >= 48 && size.height >= 48);
    }
    await page.screenshot({ path: resolve(evidenceDir, 'phone-confirmation.png') });
    await click('Add to Order');
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - initialScroll) <= 1);
    assert.equal(await page.getByLabel('Chocolate quantity', { exact: true }).innerText(), '1');
    results.checks.push('320px dialog fits, locks background scrolling, keeps touch targets, and restores scroll after adding');

    const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await touch.goto(base);
    await touch.getByRole('button', { name: /^Add Bottled Water to order,/ }).tap();
    await touch.getByRole('button', { name: 'Add to Order', exact: true }).tap();
    assert.equal(await touch.getByLabel('Bottled Water quantity', { exact: true }).innerText(), '1');
    results.checks.push('Touch selection and confirmation add the correct item');
    for (const name of ['Coffee', 'Sandwich', 'Soft Drink']) {
      await touch.getByRole('button', { name: new RegExp(`^Add ${name} to order,`) }).tap();
      await touch.getByRole('button', { name: 'Add to Order', exact: true }).tap();
    }
    await touch.locator('.order-panel').scrollIntoViewIfNeeded();
    const phoneList = await touch.locator('.cart-items').evaluate(list => {
      const box = list.getBoundingClientRect();
      const rows = [...list.children].map(row => row.getBoundingClientRect().bottom);
      return { bottom:box.bottom, clientHeight:list.clientHeight, scrollHeight:list.scrollHeight, rows };
    });
    assert.ok(phoneList.scrollHeight > phoneList.clientHeight);
    assert.ok(phoneList.rows[2] <= phoneList.bottom + 1);
    assert.ok(phoneList.rows[3] > phoneList.bottom + 1);
    await touch.screenshot({ path: resolve(evidenceDir, 'phone-three-visible-order-items.png') });
    await touch.locator('.cart-items').evaluate(list => { list.scrollTop = list.scrollHeight; });
    assert.ok(await touch.locator('.cart-items').evaluate(list => list.scrollTop) > 0);
    results.checks.push('Phone order panel also shows three rows and scrolls to the fourth');
    assert.deepEqual(results.errors, []);
    results.status = 'PASS';
    console.log(`PASS ${results.checks.length} confirmation and rendering regressions. Evidence: ${evidenceDir}`);
  } catch (error) {
    results.status = 'FAIL'; results.error = error.stack; throw error;
  } finally {
    await browser?.close();
    if (app?.server.listening) await new Promise(done => app.server.close(done));
    writeFileSync(resolve(evidenceDir, 'results.json'), JSON.stringify(results, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
