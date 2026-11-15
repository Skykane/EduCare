// Feature 7: Maintenance Reports (view, print, and CSV export).
const express = require('express');
const db = require('../db');
const C = require('../constants');
const { requireRole } = require('../auth');
const { isISODate, dateOnly, toCSV, fmtDate, todayISO } = require('../helpers');
const { enrichRequest } = require('../services/requests');

const router = express.Router();
router.use(requireRole('admin'));

function readRange(query) {
  return {
    from: isISODate(query.from) ? query.from : '',
    to: isISODate(query.to) ? query.to : '',
  };
}

const inRange = (f, value) => {
  if (!value) return false;
  const d = dateOnly(value);
  return (!f.from || d >= f.from) && (!f.to || d <= f.to);
};

const avg = (nums) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 86400000;

function buildReport(f) {
  const requests = db
    .all('requests')
    .filter((r) => inRange(f, r.createdAt))
    .map(enrichRequest)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const equipment = db.all('equipment').map((e) => ({ ...e, category: db.find('categories', e.categoryId) }));
  const records = db
    .all('maintenanceRecords')
    .filter((m) => inRange(f, m.serviceDate))
    .map((m) => ({
      ...m,
      equipment: db.find('equipment', m.equipmentId),
      technician: m.technicianId ? db.find('users', m.technicianId) : null,
      request: m.requestId ? db.find('requests', m.requestId) : null,
    }))
    .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate));

  const completed = requests.filter((r) => r.status === 'Completed' && r.completedAt);
  const requestSummary = {
    total: requests.length,
    byStatus: C.REQUEST_STATUSES.map((s) => ({ label: s, count: requests.filter((r) => r.status === s).length })),
    byPriority: C.PRIORITIES.map((p) => ({ label: p, count: requests.filter((r) => r.effectivePriority === p).length })),
    byType: C.REQUEST_TYPES.map((t) => ({ label: t, count: requests.filter((r) => r.type === t).length })),
    byCategory: db
      .all('categories')
      .map((c) => {
        const list = requests.filter((r) => r.equipment && r.equipment.categoryId === c.id);
        return { label: c.name, count: list.length, completed: list.filter((r) => r.status === 'Completed').length };
      })
      .filter((c) => c.count),
    avgResolutionDays: avg(completed.map((r) => daysBetween(r.createdAt, r.completedAt))),
  };

  const conditions = {
    byStatus: C.EQUIPMENT_STATUSES.map((s) => ({ label: s, count: equipment.filter((e) => e.status === s).length })),
    byCategory: db.all('categories').map((c) => {
      const list = equipment.filter((e) => e.categoryId === c.id);
      return { label: c.name, total: list.length, counts: C.EQUIPMENT_STATUSES.map((s) => list.filter((e) => e.status === s).length) };
    }),
    attention: equipment.filter((e) => e.status !== 'Operational').sort((a, b) => a.code.localeCompare(b.code)),
    total: equipment.length,
  };

  const workload = db
    .where('users', (u) => u.role === 'technician')
    .map((t) => {
      const all = db.where('requests', (r) => r.technicianId === t.id).map(enrichRequest);
      const doneInRange = all.filter((r) => r.status === 'Completed' && inRange(f, r.completedAt));
      return {
        tech: t,
        assignedInRange: all.filter((r) => inRange(f, r.assignedAt || r.createdAt)).length,
        active: all.filter((r) => C.TECH_ACTIVE_STATUSES.includes(r.status)).length,
        completed: doneInRange.length,
        overdue: all.filter((r) => r.overdue).length,
        avgDays: avg(doneInRange.filter((r) => r.assignedAt).map((r) => daysBetween(r.assignedAt, r.completedAt))),
      };
    })
    .sort((a, b) => b.active - a.active || b.completed - a.completed);

  return {
    requests,
    requestSummary,
    conditions,
    records,
    recordsByType: C.REQUEST_TYPES.map((t) => ({ label: t, count: records.filter((m) => m.type === t).length })),
    workload,
  };
}

router.get('/', (req, res) => {
  const f = readRange(req.query);
  res.render('reports', { title: 'Maintenance Reports', f, rep: buildReport(f), generatedAt: new Date().toISOString() });
});

router.get('/export/:type', (req, res) => {
  const f = readRange(req.query);
  const rep = buildReport(f);
  const name = (n) => (n ? n.name : '');
  let headers;
  let rows;
  switch (req.params.type) {
    case 'requests':
      headers = ['Request ID', 'Date Submitted', 'Equipment ID', 'Equipment', 'Category', 'Location', 'Title', 'Type', 'Severity', 'Priority', 'Priority Score', 'Status', 'Requester', 'Technician', 'Target Date', 'Completed'];
      rows = rep.requests.map((r) => [r.code, fmtDate(r.createdAt), r.equipment && r.equipment.code, r.equipment && r.equipment.name, r.category && r.category.name, r.equipment && r.equipment.location, r.title, r.type, C.SEVERITIES[r.severity], r.effectivePriority, r.rec.score, r.status, name(r.requester), name(r.technician), r.targetDate ? fmtDate(r.targetDate) : '', r.completedAt ? fmtDate(r.completedAt) : '']);
      break;
    case 'equipment':
      headers = ['Equipment ID', 'Name', 'Model', 'Serial Number', 'Category', 'Department', 'Location', 'Acquisition Date', 'Condition', 'Importance', 'Last Maintenance'];
      rows = db.all('equipment').map((e) => [e.code, e.name, e.model, e.serialNumber, name(db.find('categories', e.categoryId)), e.department, e.location, e.acquisitionDate ? fmtDate(e.acquisitionDate) : '', e.status, C.IMPORTANCE[e.importance], e.lastMaintenanceDate ? fmtDate(e.lastMaintenanceDate) : '']);
      break;
    case 'maintenance':
      headers = ['Service Date', 'Equipment ID', 'Equipment', 'Type', 'Request', 'Technician', 'Problem', 'Actions Performed', 'Parts Replaced', 'Resulting Condition', 'Remarks'];
      rows = rep.records.map((m) => [fmtDate(m.serviceDate), m.equipment && m.equipment.code, m.equipment && m.equipment.name, m.type, m.request ? m.request.code : '', name(m.technician), m.problem, m.actionsTaken, m.partsReplaced, m.resultingStatus, m.remarks]);
      break;
    case 'workload':
      headers = ['Technician', 'Availability', 'Assigned (period)', 'Active Now', 'Completed (period)', 'Overdue Now', 'Avg. Days to Complete'];
      rows = rep.workload.map((w) => [w.tech.name, w.tech.availability, w.assignedInRange, w.active, w.completed, w.overdue, w.avgDays === null ? '' : w.avgDays.toFixed(1)]);
      break;
    default:
      return res.status(404).render('error', { title: 'Not found', message: 'Unknown report type.' });
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="educare-${req.params.type}-${todayISO()}.csv"`);
  res.send(toCSV(headers, rows));
});

module.exports = router;
