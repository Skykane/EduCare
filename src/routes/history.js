// Feature 3: Maintenance History (with search and filters, feature 11).
const express = require('express');
const db = require('../db');
const C = require('../constants');
const { requireRole } = require('../auth');
const { str, int, isISODate } = require('../helpers');

const router = express.Router();
router.use(requireRole('admin', 'technician'));

router.get('/', (req, res) => {
  const f = {
    q: str(req.query.q, 100),
    equipmentId: int(req.query.equipmentId),
    categoryId: int(req.query.categoryId),
    location: str(req.query.location, 150),
    technicianId: int(req.query.technicianId),
    type: C.REQUEST_TYPES.includes(req.query.type) ? req.query.type : '',
    from: isISODate(req.query.from) ? req.query.from : '',
    to: isISODate(req.query.to) ? req.query.to : '',
  };
  // Technicians only see the repairs they did themselves.
  const techOnly = req.user.role === 'technician' ? req.user.id : null;
  const q = f.q.toLowerCase();
  const rows = db
    .all('maintenanceRecords')
    .map((m) => {
      const equipment = db.find('equipment', m.equipmentId);
      return {
        ...m,
        equipment,
        category: equipment ? db.find('categories', equipment.categoryId) : null,
        technician: m.technicianId ? db.find('users', m.technicianId) : null,
        request: m.requestId ? db.find('requests', m.requestId) : null,
      };
    })
    .filter(
      (m) =>
        (!q || [m.problem, m.actionsTaken, m.partsReplaced, m.remarks, m.equipment && m.equipment.name, m.equipment && m.equipment.code].some((v) => (v || '').toLowerCase().includes(q))) &&
        (!f.equipmentId || m.equipmentId === f.equipmentId) &&
        (!f.categoryId || (m.equipment && m.equipment.categoryId === f.categoryId)) &&
        (!f.location || (m.equipment && m.equipment.location === f.location)) &&
        (!techOnly || m.technicianId === techOnly) &&
        (!f.technicianId || m.technicianId === f.technicianId) &&
        (!f.type || m.type === f.type) &&
        (!f.from || m.serviceDate >= f.from) &&
        (!f.to || m.serviceDate <= f.to)
    )
    .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || b.id - a.id);

  res.render('history', {
    title: techOnly ? 'Repair History' : 'Maintenance History',
    rows,
    f,
    equipment: db.all('equipment').slice().sort((a, b) => a.code.localeCompare(b.code)),
    categories: db.all('categories'),
    locations: [...new Set(db.all('equipment').map((e) => e.location).filter(Boolean))].sort(),
    technicians: db.where('users', (u) => u.role === 'technician'),
  });
});

module.exports = router;
