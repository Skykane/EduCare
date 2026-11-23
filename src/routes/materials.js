// Administrator materials expense monitoring. All figures come from stored
// material rows; subtotals are never trusted from a client.
const express = require('express');
const db = require('../db');
const { requireRole } = require('../auth');
const { str, isISODate, manilaDateKey, formatMoney, formatDuration } = require('../helpers');
const { totalElapsedMs } = require('../services/repairAttempts');
const { sumCents } = require('../services/money');

const router = express.Router();
router.use(requireRole('admin'));

function rangeBounds(filter, from, to) {
  const nowKey = manilaDateKey(new Date().toISOString());
  const [y, m, d] = nowKey.split('-').map(Number);
  const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (filter === 'today') return [nowKey, nowKey];
  if (filter === 'week') {
    const start = new Date(y, m - 1, d - 6);
    return [day(start), nowKey];
  }
  if (filter === 'month') return [`${y}-${String(m).padStart(2, '0')}-01`, nowKey];
  if (filter === 'year') return [`${y}-01-01`, nowKey];
  if (filter === 'custom' && isISODate(from) && isISODate(to)) return [from, to];
  return [null, null];
}

function enrich(row) {
  const request = db.find('requests', row.requestId);
  const equipment = request && request.equipmentId ? db.find('equipment', request.equipmentId) : null;
  const categoryId = (request && request.categoryId) || (equipment && equipment.categoryId);
  const category = categoryId ? db.find('categories', categoryId) : null;
  return {
    ...row,
    request,
    equipment,
    category,
    recordedByUser: db.find('users', row.recordedBy),
    proof: db.find('attachments', row.proofAttachmentId),
    priceLabel: formatMoney(row.unitPriceCents),
    subtotalLabel: formatMoney(row.subtotalCents),
    dateLabel: row.createdAt,
  };
}

function render(res, rows, f, extra = {}) {
  res.render('materials/index', {
    title: 'Materials Expenses',
    rows,
    f,
    totalLabel: formatMoney(sumCents(rows)),
    ...extra,
  });
}

router.get('/', (req, res) => {
  const f = {
    range: ['today', 'week', 'month', 'year', 'custom'].includes(req.query.range) ? req.query.range : 'all',
    from: isISODate(req.query.from) ? req.query.from : '',
    to: isISODate(req.query.to) ? req.query.to : '',
    q: str(req.query.q, 100),
  };
  const [from, to] = rangeBounds(f.range, f.from, f.to);
  const q = f.q.toLowerCase();
  let rows = db.all('materials').filter((m) => {
    const key = manilaDateKey(m.createdAt);
    if (from && key < from) return false;
    if (to && key > to) return false;
    if (!q) return true;
    const request = db.find('requests', m.requestId);
    return [m.materialName, m.purpose, m.code, request && request.code].some((v) => String(v || '').toLowerCase().includes(q));
  });
  rows = rows.map(enrich).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  render(res, rows, f);
});

router.get('/:requestId', (req, res) => {
  const request = db.find('requests', req.params.requestId);
  if (!request) return res.status(404).render('error', { title: 'Not found', message: 'Repair record not found.' });
  const equipment = db.find('equipment', request.equipmentId);
  const rows = db.where('materials', (m) => m.requestId === request.id).map(enrich);
  const f = { range: 'all', from: '', to: '', q: '' };
  render(res, rows, f, {
    detail: {
      request,
      equipment,
      technician: db.find('users', request.technicianId),
      elapsedLabel: formatDuration(totalElapsedMs(request.id)),
      record: db.where('maintenanceRecords', (m) => m.requestId === request.id)[0] || null,
    },
  });
});

module.exports = router;
