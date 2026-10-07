import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(resolve('public/index.html'), 'utf8');
const css = readFileSync(resolve('public/css/style.css'), 'utf8');
const appJs = readFileSync(resolve('public/js/app.js'), 'utf8');

test('index.html provides dedicated accessible toast container', () => {
  assert.ok(html.includes('id="toast-container"'), 'Toast container must exist in index.html');
  assert.ok(html.includes('class="toast-container"'), 'Toast container must have class toast-container');
  assert.ok(html.includes('aria-live="polite"'), 'Toast container must be an accessible polite live region');
  assert.ok(html.includes('id="feedback"'), 'Existing feedback element must remain preserved');
});

test('style.css defines modern top-right pill toast with non-interfering pointer events', () => {
  // Top-right positioning
  assert.ok(css.includes('.toast-container { position:fixed; top:22px; right:28px;'), 'Container must be positioned top-right');
  assert.ok(css.includes('z-index:9999'), 'Container must have elevated z-index');

  // Touchscreen kiosk non-interference requirement
  assert.ok(css.includes('pointer-events:none;'), 'Container and toast must have pointer-events:none to never block kiosk controls');

  // Rounded pill/card design
  assert.ok(css.includes('border-radius:9999px;'), 'Toast must have rounded pill design');
  assert.ok(css.includes('box-shadow:0 10px 25px -4px'), 'Toast must have subtle elevated shadow');

  // Green checkmark icon
  assert.ok(css.includes('.toast-icon { width:24px; height:24px; border-radius:50%; background:#16a34a;'), 'Green checkmark badge must exist');

  // Slide and fade animations
  assert.ok(css.includes('.kiosk-toast.toast-visible'), 'Visible state must be defined');
  assert.ok(css.includes('.kiosk-toast.toast-hiding'), 'Dismissal hiding state must be defined');
  assert.ok(css.includes('cubic-bezier(0.16,1,0.3,1)'), 'Smooth easing curve must be applied');
});

test('app.js integrates showToast with actions, concise messages, and 2-3s auto dismissal', () => {
  // Toast helper export
  assert.ok(appJs.includes('export function showToast(message)'), 'showToast must be defined');
  assert.ok(appJs.includes('window.showToast = showToast'), 'showToast must be exposed on window');

  // 2-3 second auto dismissal (2500ms)
  assert.ok(appJs.includes('2500'), 'Toast must remain visible for 2-3 seconds before dismiss');
  assert.ok(appJs.includes('toast-hiding'), 'Dismissal must trigger smooth exit animation');

  // Required messages
  assert.ok(appJs.includes('Product added — ${product.name}'), 'Adding product must trigger concise "Product added — <name>" toast');
  assert.ok(appJs.includes('Product updated — ${product.name}'), 'Updating product must trigger concise toast');
  assert.ok(appJs.includes('Product removed — ${item?.name || \'Product\'}'), 'Removing item must trigger toast');
  assert.ok(appJs.includes('Payment successful — Transaction saved'), 'Successful payment must trigger success toast');
  assert.ok(appJs.includes('Ready for a new transaction'), 'Resetting transaction must trigger toast');

  // Checkmark icon in toast DOM
  assert.ok(appJs.includes('<span class="toast-icon" aria-hidden="true">'), 'Toast must render checkmark icon');
});
