// Feature 6: Repair Request and Activity History.
// Every important action is stored with who did it and when.
const db = require('../db');

function log({ requestId = null, equipmentId = null, userId = null, action, details = '', fromStatus = null, toStatus = null }) {
  return db.insert('activities', { requestId, equipmentId, userId, action, details, fromStatus, toStatus });
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
