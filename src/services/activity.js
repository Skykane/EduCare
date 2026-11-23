// Feature 6: Repair Request and Activity History.
// Every important action is stored with who did it and when.
const db = require('../db');
const C = require('../constants');

function log({ requestId = null, equipmentId = null, userId = null, action, details = '', fromStatus = null, toStatus = null }) {
  // History is never deleted or rewritten after the fact; normalize only the
  // status labels written here so old aliases cannot re-enter new activity.
  const request = requestId ? db.find('requests', requestId) : null;
  return db.insert('activities', {
    requestId,
    equipmentId,
    userId,
    action,
    details,
    fromStatus: fromStatus === null ? null : C.normalizeStatus(fromStatus, request),
    toStatus: toStatus === null ? null : C.normalizeStatus(toStatus, request),
  });
}

function forRequest(requestId) {
  return db
    .where('activities', (a) => a.requestId === requestId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
}

function forEquipment(equipmentId) {
  return db
    .where('activities', (a) => a.equipmentId === equipmentId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
}

function recent(limit = 10, filter = () => true) {
  return db
    .where('activities', filter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .slice(0, limit);
}

module.exports = { log, forRequest, forEquipment, recent };
