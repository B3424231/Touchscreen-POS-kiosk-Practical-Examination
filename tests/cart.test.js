import test from 'node:test';
import assert from 'node:assert/strict';
import { totalCents, parseAmount, money } from '../public/js/cart.js';

test('instructor order quantities and removal calculate in centavos', () => {
  const items = [{ priceCents: 4500, quantity: 2 }, { priceCents: 5000, quantity: 1 }, { priceCents: 3500, quantity: 1 }];
  assert.equal(totalCents(items), 17500);
  items[0].quantity = 3;
  assert.equal(totalCents(items), 22000);
  items[0].quantity = 2;
  assert.equal(totalCents(items.slice(0, 2)), 14000);
  assert.equal(totalCents([]), 0);
});

test('cash parsing preserves centavos without floating point rounding', () => {
  for (const [input, expected] of [['200', 20000], ['140.00', 14000], ['0.29', 29], [' 45.5 ', 4550], ['0001.01', 101], ['1000000', 100000000]]) {
    assert.equal(parseAmount(input), expected);
  }
  assert.equal(money(6000), '₱60.00');
});

test('cash parsing rejects blank, negative, text, exponent, excess decimals and overflow', () => {
  for (const input of ['', ' ', '-1', 'abc', 'NaN', 'Infinity', '1e2', '2.345', '1000000.01', '999999999999999', '10,000', '1.']) {
    assert.throws(() => parseAmount(input), Error, input);
  }
});
