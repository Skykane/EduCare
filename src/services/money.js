// Exact money math for materials. Amounts are integer centavos; quantities are
// integers scaled by 1,000. BigInt keeps multiplication free of float drift.
const SCALE = 1000;

const strip = (v) => String(v ?? '').trim().replace(/[₱,\s]/g, '');

function parseCents(v) {
  const s = strip(v);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Enter a valid unit price (up to 2 decimal places).');
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Unit price cannot be negative.');
  return cents;
}

function parseQuantity(v) {
  const s = strip(v);
  if (!/^\d+(\.\d{1,3})?$/.test(s)) throw new Error('Enter a valid quantity (up to 3 decimal places).');
  const [whole, frac = ''] = s.split('.');
  const scaled = Number(whole) * SCALE + Number(frac.padEnd(3, '0'));
  if (!Number.isSafeInteger(scaled) || scaled <= 0) throw new Error('Quantity must be greater than zero.');
  return scaled;
}

function subtotalCents(unitPriceCents, quantityScaled) {
  const p = BigInt(unitPriceCents);
  const q = BigInt(quantityScaled);
  const s = BigInt(SCALE);
  return Number((p * q + s / BigInt(2)) / s);
}

function quantityLabel(scaled) {
  return (Number(scaled || 0) / SCALE).toLocaleString('en-PH', { maximumFractionDigits: 3 });
}

function sumCents(rows, key = 'subtotalCents') {
  return rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0);
}

module.exports = { SCALE, parseCents, parseQuantity, subtotalCents, quantityLabel, sumCents };
