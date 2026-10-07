const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const requirements = [
  'Application successfully runs', 'Touchscreen-oriented UI is used',
  'Large item buttons/cards are provided', 'At least six products are available',
  'Product prices are displayed', 'Products can be selected by clicking/tapping',
  'Quantity can be increased', 'Quantity can be decreased', 'An item can be removed',
  'Item subtotal is correct', 'Total is calculated correctly', 'Order Summary is provided',
  'User can go back and modify the order', 'At least three payment methods are available',
  'Cash payment works', 'Insufficient Cash payment is rejected', 'Change is calculated correctly',
  'QR payment can be simulated', 'Card payment can be simulated',
  'Payment Successful screen is shown', 'A unique transaction reference is provided',
  'View Receipt works', 'Receipt contains correct transaction details',
  'Receipt displays correct payment method', 'New Transaction resets the application',
  'Meaningful user feedback is provided'
];
const expected = [
  'Application starts normally', 'Touch-friendly interface', 'Large tappable product controls',
  '6+ products visible', 'Every product shows price', 'Product enters cart',
  'Quantity and totals update', 'Quantity and totals update', 'Product removed and total updates',
  'Price × quantity is correct', 'Sum of subtotals is correct', 'Correct order summary displayed',
  'Cart preserved and editable', 'Cash, QR, Card available', 'Valid Cash transaction succeeds',
  'Invalid payment cannot proceed', 'Paid − Total is correct', 'QR flow completes',
  'Card flow completes', 'Confirmation displayed', 'Different reference per transaction',
  'Receipt opens', 'Receipt matches transaction', 'Correct selected method shown',
  'Active transaction fully reset', 'Clear success/error feedback'
];
const catalog = [['Coffee',4500],['Sandwich',5000],['Soft Drink',3500],['Cookies',2500],['Bottled Water',2000],['Chocolate',2500]];
const peso = cents => `₱${(cents / 100).toFixed(2)}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDir = resolve('test-results', `acceptance-${stamp}`);
const databasePath = resolve(evidenceDir, 'acceptance.db');
mkdirSync(evidenceDir, { recursive: true });
const result = { startedAt: new Date().toISOString(), evidenceDir, databasePath, requirements: [], regression: [], pageErrors: [], consoleErrors: [], serverLog: '', payments: [], status: 'RUNNING' };
let serverProcess, browser, context, db, base;

function save() {
  writeFileSync(resolve(evidenceDir, 'results.json'), JSON.stringify(result, null, 2));
  writeFileSync(resolve(evidenceDir, 'server.log'), result.serverLog);
  writeFileSync(resolve('test-results', 'latest-acceptance.json'), JSON.stringify({ evidenceDir, resultsFile: resolve(evidenceDir, 'results.json') }, null, 2));
}

async function startServer() {
  // This executes the exact Node entrypoint used by npm start, in a real process.
  serverProcess = spawn(process.execPath, ['server/server.js'], { cwd: resolve('.'), windowsHide: true, env: { ...process.env, PORT: '0', POS_DB_PATH: databasePath } });
  let currentOutput = '';
  base = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start within 10 seconds.')), 10000);
    serverProcess.stdout.on('data', chunk => {
      currentOutput += chunk; result.serverLog += chunk;
      const url = currentOutput.match(/ready at (http:\/\/localhost:\d+)/)?.[1];
      if (url) { clearTimeout(timer); done(url); }
    });
    serverProcess.stderr.on('data', chunk => { result.serverLog += chunk; });
    serverProcess.on('error', error => { clearTimeout(timer); reject(error); });
    serverProcess.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited at startup: ${code}`)); });
  });
  result.startCommand = 'node server/server.js (same entrypoint as npm start), PORT=0, isolated POS_DB_PATH';
  result.testUrl = base;
  db = new DatabaseSync(databasePath, { readOnly: true });
}

async function stopServer() {
  db?.close(); db = null;
  if (serverProcess && serverProcess.exitCode === null && serverProcess.signalCode === null) {
    const exited = once(serverProcess, 'exit');
    serverProcess.kill();
    await exited;
  }
}

const rows = () => db.prepare('SELECT * FROM transactions ORDER BY id').all();
const count = () => db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count;
const itemCount = () => db.prepare('SELECT COUNT(*) AS count FROM transaction_items').get().count;
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const product = async (page, name, tap = false) => {
  await page.getByRole('button', { name: new RegExp(`^Add ${name} to order,`) })[tap ? 'tap' : 'click']();
  await page.getByRole('button', { name: 'Add to Order', exact: true })[tap ? 'tap' : 'click']();
};
const heading = (page, name) => page.getByRole('heading', { name, exact: true }).waitFor();
const shot = (page, file) => page.screenshot({ path: resolve(evidenceDir, file), fullPage: true });
async function visibleText(page, selector, expectedText) {
  await page.waitForFunction(({ selector, expectedText }) => document.querySelector(selector)?.innerText.includes(expectedText), { selector, expectedText });
  assert.ok((await page.locator(selector).innerText()).includes(expectedText));
}
async function order(page, softDrink = false) {
  await product(page, 'Coffee'); await product(page, 'Coffee'); await product(page, 'Sandwich');
  if (softDrink) await product(page, 'Soft Drink');
  await visibleText(page, '.order-total', softDrink ? '₱175.00' : '₱140.00');
}
async function methods(page) {
  await click(page, 'Review Order'); await heading(page, 'Review your order');
  await click(page, 'Continue to Payment'); await heading(page, 'How would you like to pay?');
}
async function cashScreen(page) { await methods(page); await click(page, 'Cash'); await heading(page, 'Pay with cash'); }
async function reference(page) { return page.locator('.reference').innerText(); }
async function cashPay(page, paid = '200') {
  await page.getByLabel('Amount Paid', { exact: true }).fill(paid); await click(page, 'Pay Now');
  await heading(page, 'Payment Successful');
  const ref = await reference(page);
  const sale = db.prepare('SELECT * FROM transactions WHERE transaction_number = ?').get(ref);
  assert.ok(sale); result.payments.push(sale);
  return sale;
}
async function openReceipt(page) { await click(page, 'View Receipt'); await heading(page, 'Your digital receipt'); }
async function reset(page) { await click(page, 'New Transaction'); await heading(page, 'What can we get you?'); }
async function empty(page) {
  await visibleText(page, '.empty-cart', 'Your order is empty.');
  await visibleText(page, '.order-total', '₱0.00');
  assert.equal(await page.locator('.cart-item, .reference, .receipt, .selected-badge, #amount-paid').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Review Order', exact: true }).isDisabled(), true);
}
async function tableRows(page) { return page.locator('tbody tr').evaluateAll(trs => trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText))); }
const summaryRows = [['Coffee','2','₱45.00','₱90.00'],['Sandwich','1','₱50.00','₱50.00']];

async function measure(page) {
  return page.locator('button').evaluateAll(buttons => buttons.filter(button => !button.disabled && button.getClientRects().length).map(button => {
    const b = button.getBoundingClientRect();
    return { name: button.getAttribute('aria-label') || button.textContent.trim(), width: b.width, height: b.height };
  }));
}
async function assertTouch(page) {
  const measurements = await measure(page);
  for (const target of measurements) assert.ok(target.width >= 48 && target.height >= 48, JSON.stringify(target));
  return measurements;
}

async function check(number, fn) {
  const record = { number, requirement: requirements[number - 1], expected: expected[number - 1], status: 'NOT VERIFIED', startedAt: new Date().toISOString() };
  result.requirements.push(record);
  const page = await context.newPage();
  page.on('pageerror', error => result.pageErrors.push({ test: number, message: error.message }));
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push({ test: number, message: message.text() }); });
  try {
    const response = await page.goto(base);
    assert.equal(response.status(), 200);
    await heading(page, 'What can we get you?');
    Object.assign(record, await fn(page));
    record.screenshot = `test-${String(number).padStart(2,'0')}.png`;
    await shot(page, record.screenshot);
    record.status = 'PASS';
  } catch (error) {
    record.status = 'FAIL'; record.actual = error.message; record.error = error.stack;
    record.screenshot = `failed-${String(number).padStart(2,'0')}.png`;
    await shot(page, record.screenshot).catch(() => {});
  } finally {
    record.finishedAt = new Date().toISOString(); save(); await page.close();
    console.log(`${record.status} ${String(number).padStart(2,'0')}: ${record.requirement}`);
  }
}

(async () => {
  try {
    await startServer();
    browser = await chromium.launch({ headless: true, channel: process.env.POS_BROWSER_CHANNEL || 'msedge' });
    result.browserVersion = browser.version();
    context = await browser.newContext({ viewport: { width: 1366, height: 900 }, hasTouch: true, reducedMotion: 'reduce' });

    await check(1, async page => {
      const health = await (await fetch(`${base}/api/health`)).json(); assert.equal(health.status, 'ok');
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 6);
      const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({ name:r.name, size:r.transferSize })));
      for (const asset of ['/css/style.css','/js/app.js','/js/cart.js','/images/products.svg']) assert.equal((await fetch(base + asset)).status, 200);
      assert.equal(result.pageErrors.length, 0);
      return { actual: 'CLI server started; HTTP 200; nonblank kiosk; health ok; six SQLite products; required assets loaded; no fatal JS errors.', observations: { health, resources } };
    });
    await check(2, async page => {
      await product(page, 'Coffee', true);
      await page.getByRole('button', { name:'Increase Coffee quantity', exact:true }).tap();
      await page.getByRole('button', { name:'Review Order', exact:true }).tap();
      await page.getByRole('button', { name:'Continue to Payment', exact:true }).tap();
      await page.getByRole('button', { name:'Cash', exact:true }).tap();
      await page.getByRole('button', { name:'Exact · ₱90.00', exact:true }).tap();
      await page.getByRole('button', { name:'Pay Now', exact:true }).tap();
      await heading(page, 'Payment Successful'); await page.getByRole('button', { name:'View Receipt', exact:true }).tap();
      await heading(page, 'Your digital receipt'); await visibleText(page,'.receipt','₱90.00');
      const targets = await assertTouch(page);
      return { actual:'Completed Coffee ×2, review, cash quick amount and receipt using touch events with no typing or keyboard shortcuts.', observations:{ targets, inputFieldsOnReceipt:await page.locator('input').count() } };
    });
    await check(3, async page => {
      const targets = await assertTouch(page);
      const cards = await page.locator('.product-card').evaluateAll(cards => cards.map(card => {
        const b=card.getBoundingClientRect(), n=card.querySelector('.product-name'), p=card.querySelector('.product-price');
        return { name:n.innerText, price:p.innerText, width:b.width,height:b.height, nameSize:getComputedStyle(n).fontSize,priceSize:getComputedStyle(p).fontSize, left:b.left,right:b.right,top:b.top,bottom:b.bottom };
      }));
      for(let i=0;i<cards.length;i++) for(let j=i+1;j<cards.length;j++) {
        const a=cards[i], b=cards[j]; assert.ok(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top, 'Overlapping product cards');
      }
      return { actual:'Six separated product cards; visible names/prices; each product target exceeds 48 × 48 px.',observations:{cards,targets} };
    });
    await check(4, async page => {
      assert.equal(await page.locator('.product-card').count(),6);
      for(const [name] of catalog) {
        const card=page.getByRole('button',{name:new RegExp(`^Add ${name} to order,`)});
        assert.ok(await card.isVisible()); assert.ok(await card.isEnabled());
        await product(page, name); assert.equal(await page.getByRole('button',{name:`Remove ${name}`,exact:true}).count(),1);
      }
      assert.equal(await page.locator('.cart-item').count(),6); await visibleText(page,'.order-total','₱200.00');
      return { actual:'All six products were visible, enabled, individually clicked, and added to the cart; one each totals ₱200.00.', observations:{names:catalog.map(c=>c[0])} };
    });
    await check(5, async page => {
      const rendered=[];
      for(const [name,cents] of catalog) {
        const card=page.getByRole('button',{name:new RegExp(`^Add ${name} to order,`)});
        assert.ok((await card.innerText()).includes(name)); assert.ok((await card.innerText()).includes(peso(cents)));
        assert.ok(await card.locator('.product-price').isVisible()); rendered.push([name,peso(cents)]);
      }
      return { actual:'Every product displayed its required name and correct price before selection.',observations:{rendered} };
    });
    await check(6, async page => {
      const feedback=[];
      for(const [name,cents] of catalog) {
        await product(page,name); await visibleText(page,'#feedback',`${name} added.`);
        const row=page.locator('.cart-item').filter({has:page.getByRole('button',{name:`Remove ${name}`,exact:true})});
        assert.ok((await row.innerText()).includes(`${peso(cents)} each`));
        assert.equal(await page.getByLabel(`${name} quantity`,{exact:true}).innerText(),'1');
        feedback.push(await page.locator('#feedback').innerText());
      }
      await visibleText(page,'.order-total','₱200.00');
      return { actual:'Each of six clicked products immediately produced its correct cart row, price, quantity 1 and added feedback.',observations:{feedback} };
    });
    await check(7, async page => {
      await order(page,true); await click(page,'Increase Coffee quantity');
      assert.equal(await page.getByLabel('Coffee quantity',{exact:true}).innerText(),'3');
      await visibleText(page,'.order-panel','₱135.00'); await visibleText(page,'.order-total','₱220.00');
      return { actual:'Coffee increased from 2 to 3; subtotal ₱135.00 and order total ₱220.00.' };
    });
    await check(8, async page => {
      await order(page,true); await click(page,'Increase Coffee quantity'); await click(page,'Decrease Coffee quantity');
      assert.equal(await page.getByLabel('Coffee quantity',{exact:true}).innerText(),'2');
      await visibleText(page,'.order-panel','₱90.00'); await visibleText(page,'.order-total','₱175.00');
      await product(page,'Bottled Water'); await click(page,'Decrease Bottled Water quantity');
      assert.equal(await page.getByLabel('Bottled Water quantity',{exact:true}).count(),0); await visibleText(page,'.order-total','₱175.00');
      return { actual:'Coffee decreased 3→2; subtotal ₱90.00 and total ₱175.00. Decreasing quantity 1 removed Water; no negative quantity remained.' };
    });
    await check(9, async page => {
      await order(page,true); await click(page,'Remove Soft Drink');
      assert.equal(await page.getByRole('button',{name:'Remove Soft Drink',exact:true}).count(),0);
      assert.equal(await page.locator('.cart-item').count(),2); await visibleText(page,'.order-total','₱140.00');
      return { actual:'Soft Drink removed entirely; Coffee ×2 and Sandwich ×1 retained; total ₱140.00.' };
    });
    await check(10, async page => {
      await order(page,true);
      const values=[];
      for(const [name,qty,cents] of [['Coffee',2,4500],['Sandwich',1,5000],['Soft Drink',1,3500]]) {
        const row=page.locator('.cart-item').filter({has:page.getByRole('button',{name:`Remove ${name}`,exact:true})});
        assert.equal(await row.locator('.cart-title > strong').innerText(),peso(qty*cents));
        values.push({name,quantity:qty,unitPrice: cents,subtotal:qty*cents});
      }
      return { actual:'Coffee 2×₱45=₱90; Sandwich 1×₱50=₱50; Soft Drink 1×₱35=₱35.',observations:{values} };
    });
    await check(11, async page => {
      const observed=[];
      await product(page,'Coffee'); await visibleText(page,'.order-total','₱45.00');observed.push(4500);
      await product(page,'Coffee'); await product(page,'Sandwich'); await product(page,'Soft Drink');await visibleText(page,'.order-total','₱175.00');observed.push(17500);
      await click(page,'Increase Coffee quantity');await visibleText(page,'.order-total','₱220.00');observed.push(22000);
      await click(page,'Decrease Coffee quantity');await visibleText(page,'.order-total','₱175.00');observed.push(17500);
      await click(page,'Remove Soft Drink');await visibleText(page,'.order-total','₱140.00');observed.push(14000);
      return { actual:'Live total correctly changed ₱45 → ₱175 → ₱220 → ₱175 → ₱140 after add, increase, decrease and removal.',observations:{observedCents:observed} };
    });
    await check(12, async page => {
      await order(page); await click(page,'Review Order'); await heading(page,'Review your order');
      assert.deepEqual(await tableRows(page),summaryRows); await visibleText(page,'.order-total','₱140.00');
      return { actual:'Summary showed Coffee ×2 at ₱45/₱90 and Sandwich ×1 at ₱50/₱50; total ₱140.00.',observations:{rows:await tableRows(page)} };
    });
    await check(13, async page => {
      await order(page); await click(page,'Review Order'); await click(page,'Back'); await heading(page,'What can we get you?');
      assert.equal(await page.getByLabel('Coffee quantity',{exact:true}).innerText(),'2');await visibleText(page,'.order-total','₱140.00');
      await click(page,'Increase Coffee quantity');await visibleText(page,'.order-total','₱185.00');await click(page,'Review Order');
      assert.deepEqual(await tableRows(page),[['Coffee','3','₱45.00','₱135.00'],['Sandwich','1','₱50.00','₱50.00']]);
      await click(page,'Back'); await click(page,'Decrease Coffee quantity'); await click(page,'Review Order');
      assert.deepEqual(await tableRows(page),summaryRows);await visibleText(page,'.order-total','₱140.00');
      return { actual:'Back preserved Coffee ×2/Sandwich ×1. Increasing Coffee updated the next summary to ₱185; decreasing restored ₱140.',observations:{modifiedTotalCents:18500,restoredTotalCents:14000} };
    });
    await check(14, async page => {
      await order(page);await methods(page);const targets=await assertTouch(page);
      for(const [method,title] of [['Cash','Pay with cash'],['QR Payment','Pay with QR'],['Credit/Debit Card','Pay with your card']]) {
        await click(page,method);await heading(page,title);await click(page,'Back to payment methods');
      }
      return { actual:'All three payment options were visible, touch sized and clicked to their correct payment screen.',observations:{targets} };
    });
    await check(15, async page => {
      await order(page);await cashScreen(page);const before=count();const sale=await cashPay(page);
      assert.equal(sale.total_cents,14000);assert.equal(sale.amount_paid_cents,20000);assert.equal(sale.change_cents,6000);assert.equal(sale.payment_method,'Cash');assert.equal(count(),before+1);
      return { actual:'₱140 cash sale paid with ₱200 succeeded, stored Cash method, and gave ₱60 change.',observations:{sale} };
    });
    await check(16, async page => {
      await order(page);await cashScreen(page);const before=count(),itemsBefore=itemCount(),rejected=[];
      for(const amount of ['100','','-1','abc']) {
        await page.getByLabel('Amount Paid',{exact:true}).fill(amount);await click(page,'Pay Now');
        await visibleText(page,'#payment-error',amount==='100'?'Insufficient payment. Please enter at least ₱140.00.':'Please enter a valid amount');
        await heading(page,'Pay with cash');assert.equal(count(),before);assert.equal(itemCount(),itemsBefore);
        assert.equal(await page.getByRole('button',{name:'View Receipt',exact:true}).count(),0);assert.equal(await page.locator('.receipt').count(),0);
        rejected.push({amount,error:await page.locator('#payment-error').innerText(),sales:count(),items:itemCount()});
      }
      return { actual:'₱100, blank, negative and nonnumeric inputs were rejected inline; remained on Cash; no receipt, sale or item writes.',observations:{before,itemsBefore,rejected} };
    });
    await check(17, async page => {
      await order(page);await cashScreen(page);const excess=await cashPay(page,'200');assert.equal(excess.change_cents,6000);await visibleText(page,'.success-page','₱60.00');
      await shot(page,'test-17-overpayment.png');await openReceipt(page);await reset(page);
      await order(page);await cashScreen(page);const exact=await cashPay(page,'140');assert.equal(exact.change_cents,0);assert.equal(exact.amount_paid_cents,14000);await visibleText(page,'.success-page','₱0.00');
      return { actual:'₱200−₱140=₱60 change; a separate exact ₱140 payment stored and displayed ₱0 change.',observations:{excess,exact} };
    });
    await check(18, async page => {
      await order(page);await methods(page);await click(page,'QR Payment');await heading(page,'Pay with QR');
      await visibleText(page,'.due-summary','₱140.00');await visibleText(page,'.qr-placeholder','DEMO QR PLACEHOLDER');assert.ok(await page.locator('.qr-placeholder').isVisible());
      await visibleText(page,'.payment-instruction','Scan the QR code using your supported payment application.');await shot(page,'test-18-qr-screen.png');
      await click(page,'Confirm Payment');await heading(page,'Payment Successful');const ref=await reference(page),sale=db.prepare('SELECT * FROM transactions WHERE transaction_number=?').get(ref);
      assert.equal(sale.payment_method,'QR Payment');assert.equal(sale.amount_paid_cents,14000);assert.equal(sale.change_cents,0);await openReceipt(page);await visibleText(page,'.receipt','QR Payment');
      return { actual:'₱140 due, visible demo QR placeholder/instruction and confirmation; saved QR Payment ₱140 paid, ₱0 change; receipt matched.',observations:{sale} };
    });
    await check(19, async page => {
      await order(page);await methods(page);await click(page,'Credit/Debit Card');await heading(page,'Pay with your card');
      await visibleText(page,'.payment-instruction','Please tap, insert, or swipe your card.');await click(page,'Process Payment');
      await page.getByRole('button',{name:/Processing payment/}).waitFor();assert.ok(await page.getByRole('button',{name:/Processing payment/}).isDisabled());
      await shot(page,'test-19-processing.png');await heading(page,'Payment Successful');const ref=await reference(page),sale=db.prepare('SELECT * FROM transactions WHERE transaction_number=?').get(ref);
      assert.equal(sale.payment_method,'Credit/Debit Card');assert.equal(sale.amount_paid_cents,14000);assert.equal(sale.change_cents,0);await openReceipt(page);await visibleText(page,'.receipt','Credit/Debit Card');
      return { actual:'Tap/insert/swipe instruction, visible processing and success; saved card sale ₱140 paid, ₱0 change; receipt matched.',observations:{sale} };
    });
    await check(20, async page => {
      await order(page);await cashScreen(page);const sale=await cashPay(page);
      const details=await page.locator('.detail-row').evaluateAll(rows=>rows.map(r=>r.innerText));
      for(const value of ['₱140.00','₱200.00','₱60.00','Cash',sale.transaction_number])await visibleText(page,'.success-page',value);
      assert.ok(await page.getByRole('button',{name:'View Receipt',exact:true}).isVisible());
      return { actual:'Explicit Payment Successful screen displayed total, amount paid, change, Cash, saved reference and View Receipt before receipt.',observations:{details,reference:sale.transaction_number} };
    });
    await check(21, async page => {
      const refs=[];
      for(let i=0;i<2;i++) {
        await order(page);await cashScreen(page);refs.push((await cashPay(page)).transaction_number);await openReceipt(page);await reset(page);
      }
      assert.notEqual(refs[0],refs[1]);const saved=rows();assert.equal(new Set(saved.map(s=>s.transaction_number)).size,saved.length);
      return { actual:'Two separately completed cash sales had different references; every stored reference was unique.',observations:{references:refs,databaseSales:saved.length} };
    });
    await check(22, async page => {
      await order(page);await cashScreen(page);const sale=await cashPay(page);await openReceipt(page);
      assert.ok(await page.getByRole('article',{name:'Digital receipt',exact:true}).isVisible());assert.equal(await reference(page),sale.transaction_number);
      return { actual:'View Receipt navigated from success to a visible digital receipt with the same saved reference.',observations:{reference:sale.transaction_number} };
    });
    await check(23, async page => {
      await order(page);const crossScreen={selection:await page.locator('.order-total strong').innerText()};
      await click(page,'Review Order');crossScreen.summary=await page.locator('.order-total strong').innerText();
      await click(page,'Continue to Payment');crossScreen.methods=await page.locator('.due-summary strong').innerText();
      await click(page,'Cash');crossScreen.payment=await page.locator('.due-summary strong').innerText();
      const sale=await cashPay(page);crossScreen.success=await page.locator('.detail-row.large strong').innerText();const ref=await reference(page);
      await openReceipt(page);crossScreen.receipt=await page.locator('.order-total strong').innerText();crossScreen.sqlite=peso(sale.total_cents);
      assert.ok(Object.values(crossScreen).every(total=>total==='₱140.00'));assert.equal(await reference(page),ref);assert.deepEqual(await tableRows(page),summaryRows);
      const date=new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}).format(new Date(sale.created_at));
      await visibleText(page,'.receipt-meta',date);for(const value of ['Campus Store POS','₱140.00','₱200.00','₱60.00','Cash','Payment Successful'])await visibleText(page,'.receipt',value);
      const items=db.prepare('SELECT * FROM transaction_items WHERE transaction_id=? ORDER BY product_id').all(sale.id);
      assert.deepEqual(items.map(i=>[i.product_name,i.quantity,i.unit_price_cents,i.subtotal_cents]),[['Coffee',2,4500,9000],['Sandwich',1,5000,5000]]);
      return { actual:'Receipt product/qty/unit/subtotal, total ₱140, paid ₱200, change ₱60, Cash, reference, date/time and successful status matched SQLite. All six screen totals matched.',observations:{crossScreen,sale,items,displayedDate:date} };
    });
    await check(24, async page => {
      const verified=[];
      for(const method of ['Cash','QR Payment','Credit/Debit Card']) {
        await order(page);await methods(page);await click(page,method);
        if(method==='Cash')await cashPay(page);
        else {await click(page,method==='QR Payment'?'Confirm Payment':'Process Payment');await heading(page,'Payment Successful');}
        const ref=await reference(page);await openReceipt(page);
        const receiptMethod=await page.locator('.receipt .detail-row').filter({hasText:'Payment method'}).locator('strong').innerText();
        assert.equal(receiptMethod,method);assert.equal(db.prepare('SELECT payment_method FROM transactions WHERE transaction_number=?').get(ref).payment_method,method);
        verified.push({method,receiptMethod,reference:ref});await shot(page,`test-24-${method==='Cash'?'cash':method==='QR Payment'?'qr':'card'}.png`);await reset(page);
      }
      return { actual:'Independent Cash, QR Payment and Credit/Debit Card receipts each displayed the selected method and matching database value; no stale method.',observations:{verified} };
    });
    await check(25, async page => {
      await order(page);await cashScreen(page);await page.getByLabel('Amount Paid',{exact:true}).fill('100');await click(page,'Pay Now');await visibleText(page,'#payment-error','Insufficient payment');
      const sale=await cashPay(page);await openReceipt(page);const before=rows();await reset(page);await empty(page);
      assert.equal(await page.locator('#feedback').innerText(),'Ready for a new transaction.');assert.deepEqual(rows(),before);
      await product(page,'Sandwich');await methods(page);assert.equal(await page.getByRole('heading',{name:'How would you like to pay?',exact:true}).count(),1);
      await click(page,'Cash');assert.equal(await page.getByLabel('Amount Paid',{exact:true}).inputValue(),'');assert.equal(await page.locator('#change-preview').innerText(),'—');assert.equal(await page.locator('#payment-error').innerText(),'');
      await click(page,'Back to payment methods');await click(page,'Back to order');await click(page,'Back');await click(page,'Remove Sandwich');await empty(page);
      return { actual:'New Transaction cleared prior cart/qty/total/payment/reference/receipt/error; next cash input blank with no old change; all completed database rows preserved.',observations:{savedReference:sale.transaction_number,historyBefore:before.length,historyAfter:count()} };
    });
    await check(26, async page => {
      await empty(page);const messages={empty:await page.locator('.empty-cart').innerText()};
      await product(page,'Soft Drink');await visibleText(page,'#feedback','Soft Drink added.');messages.added=await page.locator('#feedback').innerText();
      await click(page,'Remove Soft Drink');await visibleText(page,'#feedback','Soft Drink removed.');messages.removed=await page.locator('#feedback').innerText();
      await order(page);await cashScreen(page);await page.getByLabel('Amount Paid',{exact:true}).fill('abc');await click(page,'Pay Now');await visibleText(page,'#payment-error','Please enter a valid amount');messages.invalid=await page.locator('#payment-error').innerText();
      await page.getByLabel('Amount Paid',{exact:true}).fill('100');await click(page,'Pay Now');await visibleText(page,'#payment-error','Insufficient payment');messages.insufficient=await page.locator('#payment-error').innerText();
      await click(page,'Back to payment methods');await click(page,'Credit/Debit Card');await click(page,'Process Payment');await page.getByRole('button',{name:/Processing payment/}).waitFor();messages.processing=await page.getByRole('button',{name:/Processing payment/}).innerText();
      await heading(page,'Payment Successful');await visibleText(page,'#feedback','Payment successful. Transaction saved.');messages.success=await page.locator('#feedback').innerText();await openReceipt(page);await visibleText(page,'.receipt-status','Transaction completed successfully.');messages.completed=await page.locator('.receipt-status').innerText();
      return { actual:'Visible, relevant empty-cart, added, removed, invalid, insufficient, processing, success and completed feedback verified through the UI.',observations:{messages} };
    });

    // Supplemental acceptance evidence verifies persisted data and a real process restart.
    const products=db.prepare('SELECT id,name,price_cents FROM products ORDER BY id').all();
    assert.deepEqual(products.map(p=>[p.name,p.price_cents]),catalog);
    const sales=rows(), items=db.prepare('SELECT * FROM transaction_items ORDER BY id').all();
    for(const sale of sales) {
      const purchased=items.filter(i=>i.transaction_id===sale.id);assert.ok(purchased.length);
      assert.equal(purchased.reduce((sum,i)=>sum+i.subtotal_cents,0),sale.total_cents);
      assert.equal(sale.amount_paid_cents-sale.total_cents,sale.change_cents);assert.equal(sale.status,'completed');assert.ok(Number.isFinite(Date.parse(sale.created_at)));
      for(const item of purchased)assert.equal(item.unit_price_cents*item.quantity,item.subtotal_cents);
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    result.database={products,transactions:sales,items,integrity:'ok',foreignKeyViolations:0};
    writeFileSync(resolve(evidenceDir,'database-verification.json'),JSON.stringify(result.database,null,2));
    result.regression.push({name:'Stored line totals, relationships, change, timestamp, status and references',status:'PASS',transactions:sales.length,itemRows:items.length});
    await stopServer();await startServer();
    assert.deepEqual(rows(),sales);assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count,6);
    const page=await context.newPage();await page.goto(base);await heading(page,'What can we get you?');await empty(page);
    await shot(page,'restart-preserved-history.png');
    result.regression.push({name:'Actual CLI server stop/restart preserves complete transaction rows and six seeds',status:'PASS'});
    for(const viewport of [{width:1366,height:900},{width:1024,height:768},{width:768,height:1024},{width:390,height:844},{width:360,height:800}]) {
      await page.setViewportSize(viewport);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await assertTouch(page);await shot(page,`responsive-${viewport.width}.png`);
    }
    await page.close();result.regression.push({name:'Five responsive viewports and measured touch targets',status:'PASS'});
    assert.deepEqual(result.pageErrors,[]);assert.deepEqual(result.consoleErrors,[]);
    result.summary={total:26,passed:result.requirements.filter(r=>r.status==='PASS').length,failed:result.requirements.filter(r=>r.status==='FAIL').length,notVerified:result.requirements.filter(r=>r.status==='NOT VERIFIED').length,blocked:result.requirements.filter(r=>r.status==='BLOCKED').length};
    result.summary.passRate=result.summary.passed/26*100;
    result.status=result.summary.passed===26?'PASS':'FAIL — CORRECTIONS REQUIRED';
    result.finishedAt=new Date().toISOString();save();
    console.log(`Final acceptance: ${result.status}; ${result.summary.passed}/26; evidence: ${evidenceDir}`);
    if(result.status!=='PASS')process.exitCode=1;
  } catch(error) {result.status='FAILED';result.error=error.stack;save();throw error;}
  finally {await browser?.close();await stopServer();save();}
})().catch(error=>{console.error(error);process.exitCode=1;});
