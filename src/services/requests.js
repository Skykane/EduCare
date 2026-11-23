// Shared helpers for repair requests.
const db = require('../db');
const C = require('../constants');
const { computePriority } = require('./priority');
const { isOverdueRequest } = require('./scheduler');

// Adds linked records and the computed priority to a request.
function enrichRequest(r) {
  const equipment = r.equipmentId ? db.find('equipment', r.equipmentId) : null;
  const category = equipment
    ? db.find('categories', equipment.categoryId)
    : r.categoryId
      ? db.find('categories', r.categoryId)
      : null;
  const rec = computePriority(r, equipment);
  const location = r.location || (equipment && equipment.location) || '';
  const status = C.normalizeStatus(r.status, r);
  // First photo sent with the report, shown as the card thumbnail.
  const photo = db.all('attachments').find((a) => a.requestId === r.id && a.stage === 'before') || null;
  return {
    ...r,
    status,
    photo,
    equipment,
    category,
    location,
    requester: db.find('users', r.requesterId),
    technician: r.technicianId ? db.find('users', r.technicianId) : null,
    rec,
    effectivePriority: r.priority || rec.level,
    isOpen: C.OPEN_STATUSES.includes(status),
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
  // A reassigned technician must lose access to the task and its attachments.
  // Historical activity remains visible to the requester and current assignee.
  if (user.role === 'technician') return r.technicianId === user.id;
  return false;
}

// Only the assigned maintenance personnel may perform repair work.
// Administrators triage/assign and verify, but do not perform the repair.
function canWorkOn(user, r) {
  return !!user && user.role === 'technician' && r.technicianId === user.id;
}

module.exports = { enrichRequest, sortByPriority, nextCode, canViewRequest, canWorkOn };
