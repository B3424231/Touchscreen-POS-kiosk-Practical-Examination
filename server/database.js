import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const PAYMENT_METHODS = ['Cash', 'QR Payment', 'Credit/Debit Card'];
export const MAX_AMOUNT = 100_000_000;

export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      price_cents INTEGER NOT NULL CHECK(price_cents > 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY,
      transaction_number TEXT NOT NULL UNIQUE,
      request_id TEXT NOT NULL UNIQUE,
      request_fingerprint TEXT NOT NULL,
      total_cents INTEGER NOT NULL CHECK(total_cents > 0),
      payment_method TEXT NOT NULL CHECK(payment_method IN ('Cash', 'QR Payment', 'Credit/Debit Card')),
      amount_paid_cents INTEGER NOT NULL CHECK(amount_paid_cents >= total_cents),
      change_cents INTEGER NOT NULL CHECK(change_cents = amount_paid_cents - total_cents),
      status TEXT NOT NULL CHECK(status = 'completed'),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS transaction_items (
      id INTEGER PRIMARY KEY,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      product_name TEXT NOT NULL,
      unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents > 0),
      quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 999),
      subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents = unit_price_cents * quantity),
      UNIQUE(transaction_id, product_id)
    ) STRICT;
  `);
  const insert = db.prepare('INSERT INTO products (id, name, price_cents, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING');
  const timestamp = new Date().toISOString();
  const catalog = [[1, 'Coffee', 4500], [2, 'Sandwich', 5000], [3, 'Soft Drink', 3500], [4, 'Cookies', 2500], [5, 'Bottled Water', 2000], [6, 'Chocolate', 2500]];
  db.exec('BEGIN');
  try {
    for (const product of catalog) insert.run(...product, timestamp);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  return db;
}

export function getProducts(db) {
  return db.prepare('SELECT id, name, price_cents AS priceCents FROM products WHERE is_active = 1 ORDER BY id').all();
}

function readTransaction(db, id) {
  const sale = db.prepare(`SELECT id, transaction_number AS transactionNumber,
    total_cents AS totalCents, payment_method AS paymentMethod,
    amount_paid_cents AS amountPaidCents, change_cents AS changeCents,
    status, created_at AS createdAt FROM transactions WHERE id = ?`).get(id);
  sale.items = db.prepare(`SELECT product_id AS productId, product_name AS name,
    unit_price_cents AS unitPriceCents, quantity, subtotal_cents AS subtotalCents
    FROM transaction_items WHERE transaction_id = ? ORDER BY product_id`).all(id);
  return sale;
}

export function completeSale(db, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('Please send a valid order.');
  const { requestId, items, paymentMethod, amountPaidCents, expectedTotalCents } = input;
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new ValidationError('A valid transaction request is required.');
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) throw new ValidationError('Your cart is empty or invalid.');
  if (!PAYMENT_METHODS.includes(paymentMethod)) throw new ValidationError('Please select a valid payment method.');
  const ids = new Set();
  for (const item of items) {
    if (!item || !Number.isSafeInteger(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999 || ids.has(item.productId)) {
      throw new ValidationError('Invalid quantity or duplicate product. Use quantities from 1 to 999.');
    }
    ids.add(item.productId);
  }
  const normalizedItems = items.map(({ productId, quantity }) => ({ productId, quantity })).sort((a, b) => a.productId - b.productId);
  const fingerprint = JSON.stringify({ items: normalizedItems, paymentMethod, expectedTotalCents, amountPaidCents: paymentMethod === 'Cash' ? amountPaidCents : null });
  // An atomic sale and a reusable request ID make a double tap or network retry safe.
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare('SELECT id, request_fingerprint FROM transactions WHERE request_id = ?').get(requestId);
    if (previous) {
      if (previous.request_fingerprint !== fingerprint) throw new ValidationError('This payment request has already been used. Start a new transaction.', 409);
      const sale = readTransaction(db, previous.id);
      db.exec('COMMIT');
      return { sale, created: false };
    }
    const productQuery = db.prepare('SELECT id, name, price_cents FROM products WHERE id = ? AND is_active = 1');
    const purchased = normalizedItems.map(item => {
      const product = productQuery.get(item.productId);
      if (!product) throw new ValidationError('A selected product is unavailable. Please review your order.');
      return { ...item, name: product.name, unitPriceCents: product.price_cents, subtotalCents: product.price_cents * item.quantity };
    });
    const total = purchased.reduce((sum, item) => sum + item.subtotalCents, 0);
    if (!Number.isSafeInteger(total) || total > MAX_AMOUNT) throw new ValidationError('This order exceeds the supported amount.');
    if (!Number.isSafeInteger(expectedTotalCents) || expectedTotalCents !== total) {
      throw new ValidationError('Product prices have changed. Reload the kiosk and review a new order before paying.', 409);
    }
    const paid = paymentMethod === 'Cash' ? amountPaidCents : total;
    if (!Number.isSafeInteger(paid) || paid < 0 || paid > MAX_AMOUNT) throw new ValidationError('Please enter a valid payment amount.');
    if (paid < total) throw new ValidationError(`Insufficient payment. Please enter at least ₱${(total / 100).toFixed(2)}.`);
    const timestamp = new Date().toISOString();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replaceAll('-', '');
    const reference = `TXN-${date}-${randomUUID().toUpperCase()}`;
    const result = db.prepare(`INSERT INTO transactions
      (transaction_number, request_id, request_fingerprint, total_cents, payment_method, amount_paid_cents, change_cents, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`).run(reference, requestId, fingerprint, total, paymentMethod, paid, paid - total, timestamp);
    const id = Number(result.lastInsertRowid);
    const insertItem = db.prepare(`INSERT INTO transaction_items
      (transaction_id, product_id, product_name, unit_price_cents, quantity, subtotal_cents) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const item of purchased) insertItem.run(id, item.productId, item.name, item.unitPriceCents, item.quantity, item.subtotalCents);
    const sale = readTransaction(db, id);
    db.exec('COMMIT');
    return { sale, created: true };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
