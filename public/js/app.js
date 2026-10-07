import { totalCents, money, parseAmount, MAX_QUANTITY } from './cart.js';

const app = document.querySelector('#app');
const progress = document.querySelector('#progress');
const feedback = document.querySelector('#feedback');
const state = { products: [], cart: [], screen: 'selection', method: null, paid: '', error: '', processing: false, transaction: null, requestId: null, uncertain: false };
const illustrations = { 1: 'coffee', 2: 'sandwich', 3: 'soft-drink', 4: 'cookies', 5: 'water', 6: 'chocolate' };
const productNotes = { 1: 'Your daily pick-me-up', 2: 'A little lunch break', 3: 'Bring on the bubbles', 4: 'A bite of happiness', 5: 'Refresh & recharge', 6: 'Make the day sweeter' };
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const icon = (name, className = '') => `<svg class="${className}" aria-hidden="true"><use href="/images/products.svg#${name}"></use></svg>`;
const total = () => totalCents(state.cart);
const count = () => state.cart.reduce((sum, item) => sum + item.quantity, 0);
const backButton = (action, label) => `<button class="back-button" data-action="${action}" ${state.processing || state.uncertain ? 'disabled' : ''}><span aria-hidden="true">←</span>${label}</button>`;
const due = () => `<div class="due-summary"><span>Amount to pay</span><strong>${money(total())}</strong></div>`;
let feedbackTimer;

function notify(message) {
  clearTimeout(feedbackTimer);
  feedback.textContent = message;
  feedbackTimer = setTimeout(() => { feedback.textContent = ''; }, 5000);
}

const toastContainer = document.querySelector('#toast-container');
let activeToast = null;
let toastDismissTimer = null;
const confirmation = document.querySelector('#add-confirmation');
let pendingProductId = null;
let confirmationTrigger = null;
let currentProgressStep = -1;

export function showToast(message) {
  if (!toastContainer) return;
  clearTimeout(toastDismissTimer);

  if (activeToast && activeToast.isConnected) {
    const textEl = activeToast.querySelector('.toast-message');
    if (textEl) textEl.textContent = message;
    // Updating an existing notice must not force layout or restart an animation.
    activeToast.classList.remove('toast-hiding');
    activeToast.classList.add('toast-visible');
  } else {
    toastContainer.innerHTML = '';
    const toast = document.createElement('div');
    toast.className = 'kiosk-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `<span class="toast-icon" aria-hidden="true"><svg viewBox="0 0 20 20" aria-hidden="true"><polyline points="4.5 10.5 8 14 15.5 6.5"></polyline></svg></span><span class="toast-message">${escape(message)}</span>`;
    toastContainer.appendChild(toast);
    activeToast = toast;
    requestAnimationFrame(() => {
      toast.classList.add('toast-visible');
    });
  }

  toastDismissTimer = setTimeout(() => {
    if (activeToast && activeToast.isConnected) {
      activeToast.classList.remove('toast-visible');
      activeToast.classList.add('toast-hiding');
      const toastToRemove = activeToast;
      activeToast = null;
      setTimeout(() => {
        toastToRemove.remove();
      }, 250);
    }
  }, 2500);
}

if (typeof window !== 'undefined') {
  window.showToast = showToast;
}

function navigate(screen) {
  state.screen = screen;
  state.error = '';
  render();
  app.querySelector('h1')?.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function drawProgress() {
  const steps = ['Choose items', 'Review order', 'Payment', 'Receipt'];
  const current = { selection: 0, summary: 1, methods: 2, cash: 2, qr: 2, card: 2, success: 2, receipt: 3 }[state.screen];
  if (current === currentProgressStep) return;
  currentProgressStep = current;
  progress.innerHTML = steps.map((step, index) => `${index ? '<span class="progress-line" aria-hidden="true"></span>' : ''}<span class="progress-step ${index === current ? 'current' : index < current ? 'done' : ''}" ${index === current ? 'aria-current="step"' : ''}><span class="step-number" aria-hidden="true">${index < current ? '✓' : index + 1}</span>${step}</span>`).join('');
}

function cartItem(item) {
  return `<div class="cart-item" data-cart-id="${item.id}"><div class="cart-title"><div class="cart-product"><span class="cart-art tone-${item.id}">${icon(illustrations[item.id] || 'bag')}</span><div><strong>${escape(item.name)}</strong><small>${money(item.priceCents)} each</small></div></div><strong>${money(item.priceCents * item.quantity)}</strong></div><div class="cart-controls"><div class="quantity-control"><button data-action="decrease" data-id="${item.id}" data-focus="decrease-${item.id}" aria-label="Decrease ${escape(item.name)} quantity">−</button><span aria-label="${escape(item.name)} quantity">${item.quantity}</span><button data-action="increase" data-id="${item.id}" data-focus="increase-${item.id}" aria-label="Increase ${escape(item.name)} quantity" ${item.quantity >= MAX_QUANTITY ? 'disabled' : ''}>+</button></div><button class="remove" data-action="remove" data-id="${item.id}" data-focus="remove-${item.id}" aria-label="Remove ${escape(item.name)}">Remove</button></div></div>`;
}

function orderTable(items, receipt = false) {
  return `<table class="summary-table" aria-label="${receipt ? 'Purchased items' : 'Order items'}"><thead><tr><th scope="col">Product</th><th scope="col">Qty</th><th scope="col">Unit price</th><th scope="col">Subtotal</th></tr></thead><tbody>${items.map(item => `<tr><td><span class="table-product">${receipt ? '' : `<span class="table-art tone-${item.id}">${icon(illustrations[item.id] || 'bag')}</span>`}<span>${escape(item.name)}</span></span></td><td>${item.quantity}</td><td>${money(receipt ? item.unitPriceCents : item.priceCents)}</td><td>${money(receipt ? item.subtotalCents : item.priceCents * item.quantity)}</td></tr>`).join('')}</tbody></table>`;
}

function selection() {
  return `<div class="page-intro"><div class="hero-copy"><p class="eyebrow"><span aria-hidden="true">✳</span> GOOD FOOD. GOOD MOOD.</p><h1 tabindex="-1">What can we get you?</h1><p>A quick bite, a little boost. Tap into your favorites.</p><span class="hero-caption">YOUR CAMPUS DAY, A LITTLE BRIGHTER <span aria-hidden="true">↗</span></span></div><div class="hero-art" aria-hidden="true"><div class="hero-orbit"></div><span class="hero-star star-one">✳</span><span class="hero-star star-two">✦</span><div class="hero-coffee">${icon('coffee')}</div><div class="hero-sandwich">${icon('sandwich')}</div><span class="hero-sticker">small break.<br><em>big energy.</em></span></div></div>
  <div class="selection-layout"><section aria-label="Products"><div class="catalog-heading"><div><p class="eyebrow">THE CAMPUS EDIT</p><h2>All the good stuff<span>.</span></h2></div><span class="catalog-count">${String(state.products.length).padStart(2, '0')} essentials</span></div><div class="product-grid">${state.products.map(product => {
    const selected = state.cart.find(item => item.id === product.id)?.quantity || 0;
    return `<button class="product-card ${selected ? 'is-selected' : ''}" data-action="add" data-id="${product.id}" data-focus="product-${product.id}" aria-label="Add ${escape(product.name)} to order, ${money(product.priceCents)}"><span class="product-art tone-${product.id}"><span class="art-orbit" aria-hidden="true"></span>${icon(illustrations[product.id] || 'bag')}</span>${selected ? `<span class="selected-badge">${selected} in your order</span>` : ''}<span class="product-meta"><span class="product-name">${escape(product.name)}</span><span class="product-description">${escape(productNotes[product.id] || 'A campus essential')}</span><span class="product-bottom"><span class="product-price">${money(product.priceCents)}</span><span class="add-mark" aria-hidden="true">+</span></span></span></button>`;
  }).join('')}</div><p class="catalog-note"><span aria-hidden="true">✳</span>Little favorites. Student-friendly prices.</p></section>
  <aside class="order-panel" aria-label="Current order"><div class="panel-heading"><div class="order-heading-label"><span class="order-bag">${icon('bag')}</span><h2>Your order</h2></div><span class="item-count">${count()} ${count() === 1 ? 'item' : 'items'}</span></div><div class="order-panel-body">
  <div class="cart-items ${state.cart.length > 3 ? 'is-scrollable' : ''}" role="region" aria-label="Order items${state.cart.length > 3 ? '. Scroll to see more products.' : ''}" tabindex="${state.cart.length > 3 ? '0' : '-1'}" ${state.cart.length ? '' : 'hidden'}>${state.cart.map(cartItem).join('')}</div><p class="cart-scroll-hint" ${state.cart.length > 3 ? '' : 'hidden'}><span aria-hidden="true">↕</span> Scroll to see more items</p><div class="empty-cart" ${state.cart.length ? 'hidden' : ''}><div class="empty-icon">${icon('bag')}<span aria-hidden="true">✦</span></div><strong>Good things go in here.</strong><p>Your order is empty. Tap a product to add it here.</p></div>
  <div class="order-total"><span>Total<span class="total-caption">A little treat, all yours.</span></span><strong>${money(total())}</strong></div><button class="primary full-width" data-action="review" ${state.cart.length ? '' : 'disabled'}>Review Order <span aria-hidden="true">→</span></button><p class="panel-footnote">Review your items before you pay.</p></div><div class="order-panel-footer"><span aria-hidden="true">♡</span> Made for your campus day.</div></aside></div>`;
}

function summary() {
  const needsScroll = state.cart.length > 5;
  return `<section class="center-page">${backButton('selection', 'Back to items')}<div class="center-intro"><span class="section-stamp" aria-hidden="true">✳</span><p class="eyebrow">Just the way you like it</p><h1 tabindex="-1">Review your order</h1><p>One last look before checkout.</p></div><div class="sheet"><div class="sheet-heading"><span>YOUR LITTLE PICK-ME-UP</span><span>${count()} ${count() === 1 ? 'item' : 'items'}</span></div><div class="review-items ${needsScroll ? 'is-scrollable' : ''}" role="region" aria-label="Order summary items${needsScroll ? '. Scroll to see more products.' : ''}" tabindex="${needsScroll ? '0' : '-1'}">${orderTable(state.cart)}</div><p class="review-scroll-hint" ${needsScroll ? '' : 'hidden'}><span aria-hidden="true">↕</span> Scroll to see more items</p><div class="order-total"><span>Order total</span><strong>${money(total())}</strong></div></div><div class="actions"><button class="secondary" data-action="selection">Back</button><button class="primary" data-action="methods">Continue to Payment <span aria-hidden="true">→</span></button></div></section>`;
}

function methods() {
  const options = [['Cash', 'cash', 'Pay with cash'], ['QR Payment', 'qr', 'Simulated QR payment'], ['Credit/Debit Card', 'card', 'Simulated card payment']];
  return `<section class="center-page">${backButton('summary', 'Back to order')}<div class="center-intro"><span class="section-stamp" aria-hidden="true">✳</span><p class="eyebrow">Your order is ready</p><h1 tabindex="-1">How would you like to pay?</h1><p>Choose a payment method to continue.</p></div>${due()}<div class="payment-methods">${options.map(([method, image, description], index) => `<button class="payment-option payment-${image}" data-action="choose-payment" data-method="${method}" aria-label="${method}"><span class="payment-option-top" aria-hidden="true"><span>0${index + 1}</span><span>↗</span></span><span class="payment-icon">${icon(image)}</span><strong>${method}</strong><small>${description}</small></button>`).join('')}</div><p class="simulation-note">Practice kiosk: all payments are simulated. No money is collected.</p></section>`;
}

function payment() {
  const type = state.screen;
  const disabled = state.processing || state.uncertain ? 'disabled' : '';
  const title = { cash: 'Pay with cash', qr: 'Pay with QR', card: 'Pay with your card' }[type];
  let controls;
  if (type === 'cash') {
    const suggestions = [...new Set([total(), Math.ceil(total() / 10000) * 10000, Math.ceil(total() / 50000) * 50000])];
    controls = `<form id="cash-form" novalidate><label for="amount-paid">Amount Paid</label><div class="amount-input"><span aria-hidden="true">₱</span><input id="amount-paid" name="amountPaid" type="text" inputmode="decimal" autocomplete="off" maxlength="12" placeholder="0.00" value="${escape(state.paid)}" aria-describedby="cash-hint payment-error" aria-invalid="${Boolean(state.error)}" ${disabled}></div><p id="cash-hint" class="input-hint">Enter the cash amount, or choose a quick amount.</p><div class="quick-amounts">${suggestions.map((amount, index) => `<button type="button" data-action="quick-amount" data-amount="${amount}" ${disabled}>${index === 0 ? 'Exact · ' : ''}${money(amount)}</button>`).join('')}</div><div class="change-preview"><span>Change</span><strong id="change-preview">${changePreview()}</strong></div>${errorBlock()}<button type="submit" class="primary full-width" ${state.processing ? 'disabled' : ''}>${payLabel('Pay Now')}</button></form>`;
  } else if (type === 'qr') {
    controls = `<div class="qr-placeholder">${icon('qr')}<strong>DEMO QR PLACEHOLDER</strong><small>No real payment link</small></div><p class="payment-instruction">Scan the QR code using your supported payment application.</p><p class="simulation-note">This placeholder is for demonstration. Select Confirm Payment to simulate payment.</p>${errorBlock()}<button class="primary full-width" data-action="pay" ${state.processing ? 'disabled' : ''}>${payLabel('Confirm Payment')}</button>`;
  } else {
    controls = `<div class="card-illustration" aria-hidden="true"><div class="demo-card"><span>Campus Store<span>✳</span></span>${icon('card')}<span class="demo-card-bottom">A little tap. A good day.<b>DEMO</b></span></div></div><p class="payment-instruction">Please tap, insert, or swipe your card.</p><p class="simulation-note">Demo only. No card details are needed or collected.</p>${errorBlock()}<button class="primary full-width" data-action="pay" ${state.processing ? 'disabled' : ''}>${payLabel('Process Payment')}</button>`;
  }
  return `<section class="center-page">${backButton('methods', 'Back to payment methods')}<div class="center-intro"><p class="eyebrow">Almost there</p><h1 tabindex="-1">${title}</h1><p>${type === 'cash' ? "We'll calculate your change for you." : 'A simple step to finish your order.'}</p></div><div class="sheet payment-sheet">${due()}${controls}</div></section>`;
}

function payLabel(text) { return state.processing ? '<span class="spinner" aria-hidden="true"></span>Processing payment…' : state.uncertain ? 'Retry payment confirmation' : text; }
function errorBlock() { return `<p class="error-message" id="payment-error" role="alert">${escape(state.error)}</p>`; }
function changePreview() {
  try { const paid = parseAmount(state.paid); return paid >= total() ? money(paid - total()) : '—'; } catch { return '—'; }
}

function details(sale) {
  return `<div class="detail-row large"><span>Total amount</span><strong>${money(sale.totalCents)}</strong></div><div class="detail-row"><span>Payment method</span><strong>${escape(sale.paymentMethod)}</strong></div><div class="detail-row"><span>Amount paid</span><strong>${money(sale.amountPaidCents)}</strong></div><div class="detail-row"><span>Change</span><strong>${money(sale.changeCents)}</strong></div>`;
}

function success() {
  const sale = state.transaction;
  return `<section class="success-page"><div class="success-icon">${icon('check')}</div><p class="eyebrow">All set!</p><h1 tabindex="-1">Payment Successful</h1><p>Thank you! Your transaction is complete.</p><div class="sheet"><div class="reference-block"><span>Transaction number</span><strong class="reference">${escape(sale.transactionNumber)}</strong></div>${details(sale)}</div><button class="primary" data-action="receipt">View Receipt <span aria-hidden="true">→</span></button></section>`;
}

function receipt() {
  const sale = state.transaction;
  const date = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(sale.createdAt));
  return `<section class="receipt-page"><div class="center-intro"><p class="eyebrow">Thanks for stopping by</p><h1 tabindex="-1">Your digital receipt</h1><p>A little something for your campus day.</p></div><article class="receipt" aria-label="Digital receipt"><header class="receipt-header"><h2>Campus Store POS</h2><p>IT415 · Touchscreen self-service kiosk</p></header><div class="receipt-meta"><div><span>Transaction number</span><strong class="reference">${escape(sale.transactionNumber)}</strong></div><div><span>Date &amp; time (Philippine time)</span><strong>${escape(date)}</strong></div></div>${orderTable(sale.items, true)}<div class="order-total"><span>Total</span><strong>${money(sale.totalCents)}</strong></div><div class="detail-row"><span>Payment method</span><strong>${escape(sale.paymentMethod)}</strong></div><div class="detail-row"><span>Amount paid</span><strong>${money(sale.amountPaidCents)}</strong></div><div class="detail-row"><span>Change</span><strong>${money(sale.changeCents)}</strong></div><div class="receipt-status"><strong>✓ Payment Successful</strong><p>Transaction completed successfully. See you again!</p><p>Simulated payment · No money collected</p></div></article><button class="primary" data-action="new">New Transaction <span aria-hidden="true">→</span></button></section>`;
}

function render() {
  const focused = document.activeElement?.dataset.focus;
  drawProgress();
  app.setAttribute('aria-busy', String(state.processing));
  app.innerHTML = ({ selection, summary, methods, cash: payment, qr: payment, card: payment, success, receipt })[state.screen]();
  if (focused) app.querySelector(`[data-focus="${focused}"]`)?.focus({ preventScroll: true });
}

function updateCart(id) {
  // Preserve the catalog, illustrations, other rows, and scroll position.
  const item = state.cart.find(item => item.id === id);
  const card = app.querySelector(`.product-card[data-id="${id}"]`);
  card.classList.toggle('is-selected', Boolean(item));
  let badge = card.querySelector('.selected-badge');
  if (item) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'selected-badge';
      card.appendChild(badge);
    }
    badge.textContent = `${item.quantity} in your order`;
  } else badge?.remove();

  const items = app.querySelector('.cart-items');
  const row = items.querySelector(`[data-cart-id="${id}"]`);
  const focused = document.activeElement;
  let focusTarget;
  if (!item) {
    if (row?.contains(focused)) {
      focusTarget = (row.nextElementSibling || row.previousElementSibling)?.querySelector('button') || card;
    }
    row?.remove();
  } else if (!row) {
    items.insertAdjacentHTML('beforeend', cartItem(item));
  } else {
    row.querySelector('.quantity-control span').textContent = item.quantity;
    row.querySelector('.cart-title > strong').textContent = money(item.priceCents * item.quantity);
    const increase = row.querySelector('[data-action="increase"]');
    increase.disabled = item.quantity >= MAX_QUANTITY;
    if (increase.disabled && focused === increase) focusTarget = row.querySelector('[data-action="decrease"]');
  }
  items.hidden = !state.cart.length;
  const needsScroll = state.cart.length > 3;
  items.classList.toggle('is-scrollable', needsScroll);
  items.tabIndex = needsScroll ? 0 : -1;
  items.setAttribute('aria-label', `Order items${needsScroll ? '. Scroll to see more products.' : ''}`);
  app.querySelector('.cart-scroll-hint').hidden = !needsScroll;
  app.querySelector('.empty-cart').hidden = Boolean(state.cart.length);
  const itemCount = count();
  app.querySelector('.item-count').textContent = `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  app.querySelector('.order-total > strong').textContent = money(total());
  app.querySelector('[data-action="review"]').disabled = !state.cart.length;
  focusTarget?.focus({ preventScroll: true });
}

function requestAddition(id, trigger) {
  if (confirmation.open || state.screen !== 'selection' || state.processing || state.uncertain) return;
  const product = state.products.find(item => item.id === id);
  if (!product) return;
  const quantity = state.cart.find(item => item.id === id)?.quantity || 0;
  if (quantity >= MAX_QUANTITY) {
    notify('Maximum quantity is 999 for each product.');
    showToast('Maximum quantity is 999 for each product.');
    return;
  }
  pendingProductId = id;
  confirmationTrigger = trigger;
  document.querySelector('#confirmation-name').textContent = product.name;
  document.querySelector('#confirmation-price').textContent = `1 × ${money(product.priceCents)}`;
  document.querySelector('#confirmation-existing').textContent = quantity ? `Already in your order: ${quantity}. This will make ${quantity + 1}.` : 'One item, ready to brighten your day.';
  document.querySelector('#confirmation-art').className = `confirmation-art tone-${id}`;
  document.querySelector('#confirmation-image').setAttribute('href', `/images/products.svg#${illustrations[id] || 'bag'}`);
  document.documentElement.classList.add('confirmation-open');
  confirmation.showModal();
}

function finishAddition(confirmed) {
  if (pendingProductId === null) return;
  const id = pendingProductId;
  const trigger = confirmationTrigger;
  // Clear pending state before closing so repeated submits cannot add twice.
  pendingProductId = null;
  confirmationTrigger = null;
  confirmation.close();
  document.documentElement.classList.remove('confirmation-open');
  trigger?.focus({ preventScroll: true });
  if (confirmed && state.screen === 'selection' && !state.processing && !state.uncertain) changeQuantity(id, 1);
}

document.querySelector('#confirmation-form').addEventListener('submit', event => {
  event.preventDefault();
  finishAddition(event.submitter?.value === 'confirm');
});
confirmation.addEventListener('cancel', event => {
  event.preventDefault();
  finishAddition(false);
});
confirmation.addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const buttons = confirmation.querySelectorAll('button:not(:disabled)');
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
});

function changeQuantity(id, delta) {
  const product = state.products.find(item => item.id === id);
  if (!product) return;
  const item = state.cart.find(item => item.id === id);
  if (!item && delta > 0) state.cart.push({ ...product, quantity: 1 });
  else if (item) {
    if (item.quantity + delta > MAX_QUANTITY) return notify('Maximum quantity is 999 for each product.');
    item.quantity += delta;
    if (item.quantity <= 0) state.cart = state.cart.filter(item => item.id !== id);
  }
  state.requestId = null;
  updateCart(id);
  if (delta > 0) {
    notify(`${product.name} added.`);
    showToast(`Product added — ${product.name}`);
  } else {
    notify(`${product.name} quantity updated.`);
    showToast(`Product updated — ${product.name}`);
  }
}

async function pay() {
  if (state.processing) return;
  if (!state.cart.length) return notify('Your cart is empty.');
  let amountPaidCents;
  if (state.method === 'Cash') {
    try {
      amountPaidCents = parseAmount(state.paid);
      if (amountPaidCents < total()) throw new Error(`Insufficient payment. Please enter at least ${money(total())}.`);
    } catch (error) {
      state.error = error.message;
      render();
      document.querySelector('#amount-paid')?.focus();
      return;
    }
  }
  state.error = '';
  state.processing = true;
  state.requestId ||= crypto.randomUUID();
  render();
  notify('Processing payment…');
  // Card processing is deliberately visible. All payment methods are simulations.
  if (state.method === 'Credit/Debit Card') await new Promise(resolve => setTimeout(resolve, 900));
  try {
    const response = await fetch('/api/transactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: state.requestId, items: state.cart.map(item => ({ productId: item.id, quantity: item.quantity })), expectedTotalCents: total(), paymentMethod: state.method, amountPaidCents }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok) {
      state.uncertain = false;
      state.requestId = null;
      throw new Error(data.error || 'Unable to complete payment. Please try again.');
    }
    state.transaction = data.transaction;
    state.processing = false;
    state.uncertain = false;
    navigate('success');
    notify('Payment successful. Transaction saved.');
    showToast('Payment successful — Transaction saved');
  } catch (error) {
    state.processing = false;
    if (error instanceof TypeError || error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof SyntaxError) {
      state.uncertain = true;
      state.error = 'Payment confirmation is unavailable. Check the local server, then retry confirmation. Your order and payment are kept to prevent a duplicate sale.';
    } else state.error = error.message;
    render();
  }
}

app.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled || state.processing) return;
  const { action, id, method, amount } = button.dataset;
  if (action === 'add') requestAddition(Number(id), button);
  else if (action === 'increase') changeQuantity(Number(id), 1);
  else if (action === 'decrease') changeQuantity(Number(id), -1);
  else if (action === 'remove') {
    const item = state.cart.find(item => item.id === Number(id));
    state.cart = state.cart.filter(item => item.id !== Number(id));
    state.requestId = null;
    updateCart(Number(id));
    notify(`${item?.name || 'Product'} removed.`);
    showToast(`Product removed — ${item?.name || 'Product'}`);
  } else if (action === 'review') {
    if (!state.cart.length) return notify('Your cart is empty.');
    navigate('summary');
  } else if (['selection', 'summary', 'methods'].includes(action)) {
    if (state.uncertain) return;
    state.method = null; state.paid = ''; state.requestId = null;
    navigate(action);
  } else if (action === 'choose-payment') {
    state.method = method; state.paid = ''; state.requestId = null; state.uncertain = false;
    navigate({ Cash: 'cash', 'QR Payment': 'qr', 'Credit/Debit Card': 'card' }[method]);
  } else if (action === 'quick-amount') {
    state.paid = (Number(amount) / 100).toFixed(2); state.error = '';
    render(); document.querySelector('#amount-paid')?.focus();
  } else if (action === 'pay') pay();
  else if (action === 'receipt') navigate('receipt');
  else if (action === 'new') {
    Object.assign(state, { cart: [], screen: 'selection', method: null, paid: '', error: '', processing: false, transaction: null, requestId: null, uncertain: false });
    clearTimeout(feedbackTimer); feedback.textContent = '';
    if (activeToast) { activeToast.remove(); activeToast = null; }
    navigate('selection');
    notify('Ready for a new transaction.');
    showToast('Ready for a new transaction');
  }
});

app.addEventListener('submit', event => {
  if (event.target.id === 'cash-form') { event.preventDefault(); pay(); }
});

app.addEventListener('input', event => {
  if (event.target.id !== 'amount-paid') return;
  state.paid = event.target.value;
  state.error = '';
  event.target.setAttribute('aria-invalid', 'false');
  document.querySelector('#payment-error').textContent = '';
  document.querySelector('#change-preview').textContent = changePreview();
});

async function load() {
  try {
    const response = await fetch('/api/products', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Unable to load products.');
    const data = await response.json();
    state.products = data.products;
    if (!state.products.length) throw new Error('No products are available. Please contact the store.');
    render();
  } catch {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '<section class="loading-panel"><h1 tabindex="-1">The store is temporarily unavailable</h1><p>Please check that the local server is running and try again.</p><button class="primary" id="retry-products">Try Again</button></section>';
    document.querySelector('#retry-products').addEventListener('click', load, { once: true });
  }
}

load();
