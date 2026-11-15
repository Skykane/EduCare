// Shared helpers for repair requests.
const db = require('../db');
const C = require('../constants');
const { computePriority } = require('./priority');
const { isOverdueRequest } = require('./scheduler');

// Adds linked records and the computed priority to a request.
function enrichRequest(r) {
  const equipment = db.find('equipment', r.equipmentId);
  const category = equipment ? db.find('categories', equipment.categoryId) : null;
  const rec = computePriority(r, equipment);
  // First photo sent with the report, shown as the card thumbnail.
  const photo = db.all('attachments').find((a) => a.requestId === r.id && a.stage === 'before') || null;
  return {
    ...r,
    photo,
    equipment,
    category,
    requester: db.find('users', r.requesterId),
    technician: r.technicianId ? db.find('users', r.technicianId) : null,
    rec,
    effectivePriority: r.priority || rec.level,
    isOpen: C.OPEN_STATUSES.includes(r.status),
    overdue: isOverdueRequest(r),
  };
}

// Open requests first, then highest priority, then highest score, then oldest.
function sortByPriority(list) {
  return list.sort(
    (a, b) =>
      b.isOpen - a.isOpen ||
      C.PRIORITY_RANK[b.effectivePriority] - C.PRIORITY_RANK[a.effectivePriority] ||
      b.rec.score - a.rec.score ||
      a.createdAt.localeCompare(b.createdAt)
  );
}

function nextCode(collection, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  const max = db.all(collection).reduce((m, r) => {
    const match = re.exec(r.code || '');
    return match ? Math.max(m, parseInt(match[1], 10)) : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

// Who may open a request's page.
function canViewRequest(user, r) {
  if (!user || !r) return false;
  if (user.role === 'admin') return true;
  if (r.requesterId === user.id) return true;
  if (user.role === 'technician') {
    if (r.technicianId === user.id) return true;
    // Technicians keep access to tasks they worked on before a reassignment.
    return db.where('activities', (a) => a.requestId === r.id && a.userId === user.id).length > 0;
  }
  return false;
}

// Who may update a request's work status (start, hold, complete).
function canWorkOn(user, r) {
  return !!user && (user.role === 'admin' || (user.role === 'technician' && r.technicianId === user.id));
}

module.exports = { enrichRequest, sortByPriority, nextCode, canViewRequest, canWorkOn };
