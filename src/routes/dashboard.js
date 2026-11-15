// Feature 14: Dashboard.
const express = require('express');
const db = require('../db');
const C = require('../constants');
const { enrichRequest, sortByPriority } = require('../services/requests');
const { allSchedules } = require('../services/preventive');
const { recent } = require('../services/activity');
const { activeTaskCount } = require('../services/assignment');
const { todayISO } = require('../helpers');
const { findOfficialStudent, ensureStudentsDatabase } = require('../services/studentVerification');

const router = express.Router();

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

router.get('/', (req, res) => {
  const user = req.user;
  const today = todayISO();
  const equipment = db.all('equipment');
  const equipmentByStatus = C.EQUIPMENT_STATUSES.map((s) => ({ status: s, count: equipment.filter((e) => e.status === s).length }));
  const schedules = allSchedules(today);
  const pmAlerts = schedules.filter((s) => s.status !== 'Scheduled');
  const thisMonth = monthStart();

  if (user.role === 'admin') {
    const requests = db.all('requests').map(enrichRequest);
    const open = requests.filter((r) => r.isOpen);
    const stats = {
      pending: requests.filter((r) => r.status === 'Pending').length,
      inProgress: requests.filter((r) => C.TECH_ACTIVE_STATUSES.includes(r.status)).length,
      completedMonth: requests.filter((r) => r.status === 'Completed' && r.completedAt >= thisMonth).length,
      overdue: open.filter((r) => r.overdue).length,
      equipment: equipment.length,
      pmDue: pmAlerts.length,
    };
    const queue = sortByPriority(open.filter((r) => r.status === 'Pending')).slice(0, 6);
    const overdueTasks = open.filter((r) => r.overdue);
    const openByPriority = C.PRIORITIES.map((p) => ({ priority: p, count: open.filter((r) => r.effectivePriority === p).length }));
    const workload = db
      .where('users', (u) => u.role === 'technician' && u.active)
      .map((t) => ({ tech: t, active: activeTaskCount(t.id) }))
      .sort((a, b) => b.active - a.active);
    const recentCompleted = db
      .all('maintenanceRecords')
      .slice()
      .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || b.id - a.id)
      .slice(0, 5)
      .map((m) => {
        const eq = db.find('equipment', m.equipmentId);
        const tech = db.find('users', m.technicianId);
        return { ...m, equipment: eq, technician: tech };
      });
    return res.render('dashboard-admin', {
      title: 'Dashboard',
      stats,
      equipmentByStatus,
      totalEquipment: equipment.length,
      queue,
      overdueTasks,
      openByPriority,
      workload,
      pmAlerts: pmAlerts.slice(0, 6),
      recentCompleted,
      activity: recent(8),
    });
  }

  if (user.role === 'technician') {
    const mine = db.where('requests', (r) => r.technicianId === user.id).map(enrichRequest);
    const active = sortByPriority(mine.filter((r) => C.TECH_ACTIVE_STATUSES.includes(r.status)));
    const myCompleted = mine.filter((r) => r.status === 'Completed').slice(0, 5);
    const specs = (user.specializations || []).map((id) => db.find('categories', id)).filter(Boolean);
    const stats = {
      assigned: mine.filter((r) => r.status === 'Assigned').length,
      inProgress: mine.filter((r) => r.status === 'In Progress' || r.status === 'On Hold').length,
      overdue: active.filter((r) => r.overdue).length,
      completedMonth: mine.filter((r) => r.status === 'Completed' && r.completedAt >= thisMonth).length,
    };
    return res.render('dashboard-tech', {
      title: 'Dashboard',
      stats,
      active,
      myCompleted,
      specs,
      equipmentByStatus,
      totalEquipment: equipment.length,
      pmAlerts: pmAlerts.slice(0, 6),
    });
  }

  // Requester
  const mine = db
    .where('requests', (r) => r.requesterId === user.id)
    .map(enrichRequest)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const count = (statuses) => mine.filter((r) => statuses.includes(r.status)).length;
  const summary = {
    pending: count(['Pending']),
    inProgress: count(['Assigned', 'In Progress', 'On Hold']),
    completed: count(['Completed']),
  };
  ensureStudentsDatabase();
  const studentInfo = (user.studentId ? findOfficialStudent(user.studentId) : null) || findOfficialStudent(user.email);
  res.render('dashboard-requester', { title: 'Dashboard', summary, recentRequests: mine.slice(0, 6), total: mine.length, studentInfo });
});

module.exports = router;
