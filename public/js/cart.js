export const MAX_QUANTITY = 999;
export const MAX_AMOUNT = 100_000_000;
const currencyFormatter = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

export function totalCents(items) {
  return items.reduce((total, item) => total + item.priceCents * item.quantity, 0);
}

export function money(cents) {
  return currencyFormatter.format(cents / 100);
}

export function parseAmount(text) {
  const value = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Please enter a valid amount using up to two decimal places.');
  const [pesos, centavos = ''] = value.split('.');
  const cents = Number(pesos) * 100 + Number(centavos.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT) throw new Error('Please enter an amount of ₱1,000,000.00 or less.');
  return cents;
}
