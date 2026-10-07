import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../server/server.js';

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'it415-pos-'));
  const databasePath = join(dir, 'test.db');
  const app = createApp({ databasePath });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  return { ...app, base, databasePath, async close() {
    if (app.server.listening) await new Promise(done => app.server.close(done));
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(dir.includes('it415-pos-'));
    rmSync(dir, { recursive: true, force: true });
  } };
}

const cashOrder = () => ({ requestId: randomUUID(), items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 1 }], expectedTotalCents: 14000, paymentMethod: 'Cash', amountPaidCents: 20000 });
async function post(app, body, headers = {}) {
  const response = await fetch(`${app.base}/api/transactions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
const saleCount = app => app.db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count;

test('startup serves all six products and only public assets', async () => {
  const app = await fixture();
  try {
    const response = await fetch(`${app.base}/api/products`);
    assert.equal(response.status, 200);
    const products = (await response.json()).products;
    assert.deepEqual(products.map(p => [p.name, p.priceCents]), [['Coffee',4500],['Sandwich',5000],['Soft Drink',3500],['Cookies',2500],['Bottled Water',2000],['Chocolate',2500]]);
    for (const path of ['/', '/css/style.css', '/js/app.js', '/js/cart.js', '/images/products.svg', '/favicon.svg', '/api/health']) assert.equal((await fetch(`${app.base}${path}`)).status, 200, path);
    for (const path of ['/database/pos.db', '/server/database.js', '/package.json', '/.agents/skills/full-webapp-lifecycle/SKILL.md', '/not-found']) assert.equal((await fetch(`${app.base}${path}`)).status, 404, path);
    assert.ok(response.headers.get('content-security-policy').includes("script-src 'self'"));
  } finally { await app.close(); }
});

test('cash sale uses server prices, stores linked items and accurate receipt data', async () => {
  const app = await fixture();
  try {
    const input = cashOrder();
    input.totalCents = 1;
    input.items[0].priceCents = 1;
    const result = await post(app, input);
    assert.equal(result.status, 201);
    const sale = result.data.transaction;
    assert.equal(sale.totalCents, 14000);
    assert.equal(sale.amountPaidCents, 20000);
    assert.equal(sale.changeCents, 6000);
    assert.equal(sale.paymentMethod, 'Cash');
    assert.equal(sale.status, 'completed');
    assert.ok(Number.isFinite(Date.parse(sale.createdAt)));
    assert.match(sale.transactionNumber, /^TXN-\d{8}-[0-9A-F-]+$/);
    assert.deepEqual(sale.items.map(i => [i.name, i.quantity, i.unitPriceCents, i.subtotalCents]), [['Coffee',2,4500,9000],['Sandwich',1,5000,5000]]);
    assert.equal(app.db.prepare('SELECT total_cents FROM transactions WHERE id = ?').get(sale.id).total_cents, 14000);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM transaction_items WHERE transaction_id = ?').get(sale.id).count, 2);
    assert.deepEqual(app.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(app.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { await app.close(); }
});

test('blank, invalid, negative and insufficient cash never save sales or items', async () => {
  const app = await fixture();
  try {
    for (const paid of [undefined, '', '20000', null, -1, 10000, 0, 14000.5, 100000001]) {
      const result = await post(app, { ...cashOrder(), amountPaidCents: paid });
      assert.equal(result.status, 400, String(paid));
      assert.ok(result.data.error);
    }
    assert.equal(saleCount(app), 0);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM transaction_items').get().count, 0);
    const exact = await post(app, { ...cashOrder(), amountPaidCents: 14000 });
    assert.equal(exact.status, 201);
    assert.equal(exact.data.transaction.changeCents, 0);
  } finally { await app.close(); }
});

test('invalid carts, product IDs, quantities, methods and malformed JSON are rejected', async () => {
  const app = await fixture();
  try {
    const invalid = [null, [], {}, { ...cashOrder(), items: [] }, { ...cashOrder(), items: [{productId:1,quantity:-1}] }, { ...cashOrder(), items: [{productId:1,quantity:0}] }, { ...cashOrder(), items: [{productId:1,quantity:1.5}] }, { ...cashOrder(), items: [{productId:1,quantity:1000}] }, { ...cashOrder(), items: [{productId:999,quantity:1}] }, { ...cashOrder(), items: [{productId:'1 OR 1=1',quantity:1}] }, { ...cashOrder(), items: [{productId:1,quantity:1},{productId:1,quantity:1}] }, { ...cashOrder(), paymentMethod:'invalid' }, { ...cashOrder(), requestId:'invalid' }, '{broken'];
    for (const input of invalid) assert.equal((await post(app, input)).status, 400, JSON.stringify(input));
    app.db.prepare('UPDATE products SET is_active = 0 WHERE id = 1').run();
    assert.equal((await post(app, cashOrder())).status, 400);
    assert.equal(saleCount(app), 0);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM transaction_items').get().count, 0);
  } finally { await app.close(); }
});

test('QR and card simulations use exact total and zero change', async () => {
  const app = await fixture();
  try {
    const references = new Set();
    for (const paymentMethod of ['QR Payment', 'Credit/Debit Card']) {
      const result = await post(app, { ...cashOrder(), paymentMethod, amountPaidCents: 1 });
      assert.equal(result.status, 201);
      const sale = result.data.transaction;
      assert.equal(sale.totalCents, 14000);
      assert.equal(sale.amountPaidCents, 14000);
      assert.equal(sale.changeCents, 0);
      assert.equal(sale.paymentMethod, paymentMethod);
      references.add(sale.transactionNumber);
    }
    assert.equal(references.size, 2);
  } finally { await app.close(); }
});

test('double submission is idempotent and modified replay is rejected', async () => {
  const app = await fixture();
  try {
    const input = cashOrder();
    const responses = await Promise.all([post(app, input), post(app, input)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
    assert.equal(responses[0].data.transaction.transactionNumber, responses[1].data.transaction.transactionNumber);
    assert.equal(saleCount(app), 1);
    assert.equal((await post(app, { ...input, amountPaidCents: 30000 })).status, 409);
    assert.equal(saleCount(app), 1);
  } finally { await app.close(); }
});

test('mid-save database failure rolls back both the sale and its items', async () => {
  const app = await fixture();
  try {
    app.db.exec("CREATE TRIGGER test_failure BEFORE INSERT ON transaction_items WHEN NEW.product_id = 2 BEGIN SELECT RAISE(ABORT, 'test item insert failure'); END;");
    assert.equal((await post(app, cashOrder())).status, 500);
    assert.equal(saleCount(app), 0);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS count FROM transaction_items').get().count, 0);
    app.db.exec('DROP TRIGGER test_failure');
    assert.equal((await post(app, cashOrder())).status, 201);
  } finally { await app.close(); }
});

test('completed sale persists after server restart without duplicate seeds', async () => {
  const app = await fixture();
  let reopened;
  try {
    const saved = (await post(app, cashOrder())).data.transaction;
    app.server.close(); await once(app.server, 'close');
    reopened = createApp({ databasePath: app.databasePath });
    reopened.server.listen(0, '127.0.0.1'); await once(reopened.server, 'listening');
    const stored = reopened.db.prepare('SELECT transaction_number, total_cents FROM transactions WHERE id = ?').get(saved.id);
    assert.equal(stored.transaction_number, saved.transactionNumber);
    assert.equal(stored.total_cents, 14000);
    assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 6);
    assert.equal(reopened.db.prepare('SELECT COUNT(*) AS count FROM transaction_items').get().count, 2);
  } finally {
    if (reopened) { reopened.server.close(); await once(reopened.server, 'close'); }
    await app.close();
  }
});

test('API rejects cross-origin writes, unsupported content types and oversized bodies', async () => {
  const app = await fixture();
  try {
    assert.equal((await post(app, cashOrder(), { Origin: 'https://example.com' })).status, 403);
    assert.equal((await post(app, cashOrder(), { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post(app, 'x'.repeat(17000))).status, 413);
    assert.equal(saleCount(app), 0);
  } finally { await app.close(); }
});

test('changed catalog price rejects a stale checkout before saving a different total', async () => {
  const app = await fixture();
  try {
    app.db.prepare('UPDATE products SET price_cents = 4600 WHERE id = 1').run();
    const result = await post(app, cashOrder());
    assert.equal(result.status, 409);
    assert.ok(result.data.error.includes('Product prices have changed'));
    assert.equal(saleCount(app), 0);
    assert.equal((await post(app, { ...cashOrder(), expectedTotalCents: 14200 })).status, 201);
  } finally { await app.close(); }
});
