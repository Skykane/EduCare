// Feature 14: Dashboard.
const express = require('express');
const db = require('../db');
const C = require('../constants');
const { enrichRequest, sortByPriority } = require('../services/requests');
const { allSchedules } = require('../services/preventive');
const { recent } = require('../services/activity');
const { activeTaskCount } = require('../services/assignment');
const { todayISO, formatDuration } = require('../helpers');
const { totals: materialTotalsForRequest } = require('../services/materials');
const { totalElapsedMs } = require('../services/repairAttempts');
const { sumCents } = require('../services/money');
const { findOfficialStudent, ensureStudentsDatabase } = require('../services/studentVerification');
const studentDirectory = require('../services/studentDirectory');

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
  const pmAlerts = schedules.filter((s) => s.status === 'Overdue' || s.status === 'Due Soon');
  const thisMonth = monthStart();

  if (user.role === 'admin') {
    const requests = db.all('requests').map(enrichRequest);
    const open = requests.filter((r) => r.isOpen);
    const stats = {
      // "Reported" awaits admin triage; "Pending" is already assigned to a technician.
      pendingApproval: requests.filter((r) => r.status === 'Reported').length,
      pending: requests.filter((r) => r.status === 'Pending').length,
      inProgress: requests.filter((r) => ['Assigned', 'In Progress', 'On Hold', 'Nearing Completion'].includes(r.status)).length,
      completedMonth: requests.filter((r) => r.status === 'Completed' && r.completedAt >= thisMonth).length,
      pmDue: pmAlerts.length,
      // Connected workflow cards.
      totalReported: requests.filter((r) => r.status !== 'Cancelled').length,
      nearing: requests.filter((r) => r.status === 'Nearing Completion').length,
      completed: requests.filter((r) => r.status === 'Completed').length,
      awaitingVerification: requests.filter((r) => r.verificationStatus === C.AWAITING_VERIFICATION).length,
      verified: requests.filter((r) => r.verificationStatus === 'Verified').length,
      materialsExpensesCents: sumCents(db.all('materials')),
      materialsExpenses: sumCents(db.all('materials')) / 100,
    };
    const queue = sortByPriority(open.filter((r) => r.status === 'Pending')).slice(0, 6);
    const overdueTasks = open
      .filter((r) => r.overdue)
      .sort((a, b) => String(a.targetDate || '').localeCompare(String(b.targetDate || '')));
    const workload = db
      .where('users', (u) => u.role === 'technician' && u.active)
      .map((t) => ({ tech: t, active: activeTaskCount(t.id) }))
      .sort((a, b) => b.active - a.active);
    // Upcoming preventive maintenance: next inspections plus anything due soon.
    const maintenanceDue = schedules.filter((s) => s.hasHistory && s.daysLeft >= 0).slice(0, 6);
    return res.render('dashboard-admin', {
      title: 'Dashboard',
      stats,
      equipmentByStatus,
      totalEquipment: equipment.length,
      queue,
      overdueTasks,
      workload,
      maintenanceDue,
      verificationQueue: requests.filter((r) => r.verificationStatus === C.AWAITING_VERIFICATION).slice(0, 6),
      monitorRows: requests
        .filter((r) => C.OPEN_STATUSES.includes(r.status) || r.status === 'Completed')
        .slice(0, 8)
        .map((r) => ({
          ...r,
          materialsTotalCents: materialTotalsForRequest(r.id).subtotalCents,
          elapsedLabel: formatDuration(totalElapsedMs(r.id)),
        })),
      activity: recent(8),
    });
  }

  if (user.role === 'technician') {
    const mine = db.where('requests', (r) => r.technicianId === user.id).map(enrichRequest);
    const active = sortByPriority(mine.filter((r) => C.TECH_ACTIVE_STATUSES.includes(r.status)));
    const myCompleted = mine.filter((r) => r.status === 'Completed').slice(0, 5);
    const specs = (user.specializations || []).map((id) => db.find('categories', id)).filter(Boolean);
    const stats = {
      assigned: mine.filter((r) => r.status === 'Assigned' || r.status === 'Pending').length,
      inProgress: mine.filter((r) => r.status === 'In Progress' || r.status === 'On Hold').length,
      overdue: active.filter((r) => r.overdue).length,
      completedMonth: mine.filter((r) => r.status === 'Completed' && r.completedAt >= thisMonth).length,
      // Connected maintenance cards.
      assignedTasks: mine.filter((r) => C.OPEN_STATUSES.includes(r.status)).length,
      pendingTasks: mine.filter((r) => r.status === 'Pending').length,
      nearingTasks: mine.filter((r) => r.status === 'Nearing Completion').length,
      completedTasks: mine.filter((r) => r.status === 'Completed').length,
      reworkTasks: mine.filter((r) => r.verificationStatus === 'Rework Required').length,
    };
    const currentJob = active[0] || mine.find((r) => r.verificationStatus === 'Rework Required') || null;
    return res.render('dashboard-tech', {
      title: 'Dashboard',
      stats,
      active,
      currentJob,
      recentActivities: recent(6, (a) => a.userId === user.id || db.find('requests', a.requestId)?.technicianId === user.id),
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
    inProgress: count(['Assigned', 'In Progress', 'On Hold', 'Nearing Completion']),
    completed: count(['Completed']),
  };
  ensureStudentsDatabase();
  const studentInfo = studentDirectory.findById(user.directoryRecordId) ||
    studentDirectory.findByUserId(user.id) ||
    (user.studentId ? findOfficialStudent(user.studentId) : null) ||
    findOfficialStudent(user.email);
  res.render('dashboard-requester', { title: 'Dashboard', summary, recentRequests: mine.slice(0, 6), total: mine.length, studentInfo });
});

module.exports = router;
