// Structured materials usage. Prices are centavos, quantities are scaled by
// 1,000, and every subtotal/total is recalculated here from stored values.
const db = require('../db');
const { str } = require('../helpers');
const { parseCents, parseQuantity, subtotalCents, sumCents } = require('./money');

function forRequest(requestId) {
  return db
    .where('materials', (m) => m.requestId === Number(requestId))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}

function totals(requestId) {
  const rows = forRequest(requestId);
  return { count: rows.length, subtotalCents: sumCents(rows) };
}

function parseItems(raw) {
  let items = raw;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch (e) { throw new Error('Invalid materials data.'); }
  }
  if (!Array.isArray(items) || !items.length) throw new Error('Add at least one material item.');
  return items;
}

function createBatch({ requestId, userId, attemptId, rawItems, proofs = [], idempotencyKey = '' }) {
  if (idempotencyKey) {
    const existing = db.where('materials', (m) => m.requestId === Number(requestId) &&
      String(m.idempotencyKey || '').startsWith(`${idempotencyKey}:`));
    if (existing.length) return existing;
  }
  return parseItems(rawItems).map((item, index) => {
    const name = str(item.materialName || item.name, 200);
    const purpose = str(item.purpose || item.description, 1000);
    const unit = str(item.unit, 40);
    if (!name) throw new Error('Material name is required.');
    if (!purpose) throw new Error('Purpose / description is required.');
    if (!unit) throw new Error('Unit is required.');
    const unitPriceCents = parseCents(item.unitPrice);
    const quantityScaled = parseQuantity(item.quantity);
    const proof = proofs[index];
    if (!proof) throw new Error('Picture proof is required for every material item.');
    return db.insert('materials', {
      code: `MAT-${String(db.all('materials').length + 1).padStart(4, '0')}`,
      requestId: Number(requestId),
      attemptId: attemptId || null,
      materialName: name,
      unitPriceCents,
      quantityScaled,
      unit,
      purpose,
      subtotalCents: subtotalCents(unitPriceCents, quantityScaled),
      proofAttachmentId: proof.id,
      recordedBy: userId,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:${index}` : null,
      corrections: [],
    });
  });
}

function correct(materialId, requestId, patch, user, reason) {
  const m = db.find('materials', materialId);
  if (!m) throw new Error('Material entry not found.');
  if (Number(m.requestId) !== Number(requestId)) throw new Error('This material entry does not belong to this request.');
  if (!str(reason)) throw new Error('A correction reason is required.');
  if (user.role !== 'admin' && m.recordedBy !== user.id) throw new Error('You cannot correct this material entry.');
  const previous = {
    materialName: m.materialName,
    unitPriceCents: m.unitPriceCents,
    quantityScaled: m.quantityScaled,
    unit: m.unit,
    purpose: m.purpose,
  };
  const next = {
    materialName: str(patch.materialName ?? m.materialName, 200),
    unitPriceCents: patch.unitPrice !== undefined ? parseCents(patch.unitPrice) : m.unitPriceCents,
    quantityScaled: patch.quantity !== undefined ? parseQuantity(patch.quantity) : m.quantityScaled,
    unit: str(patch.unit ?? m.unit, 40),
    purpose: str(patch.purpose ?? m.purpose, 1000),
  };
  if (!next.materialName || !next.unit || !next.purpose) throw new Error('Material name, unit, and purpose are required.');
  const corrections = [...(m.corrections || []), {
    previous,
    reason: str(reason, 1000),
    correctedBy: user.id,
    correctedAt: new Date().toISOString(),
  }];
  return db.update('materials', m.id, {
    ...next,
    subtotalCents: subtotalCents(next.unitPriceCents, next.quantityScaled),
    corrections,
  });
}

module.exports = { forRequest, totals, createBatch, correct, parseItems };
