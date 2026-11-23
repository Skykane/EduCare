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

// Canonical labels are owned by constants.js; literals are only a safety net.
const S = {
  PENDING: (C.STATUS && (C.STATUS.PENDING_APPROVAL || C.STATUS.PENDING)) || 'Pending Approval',
  APPROVED: (C.STATUS && (C.STATUS.APPROVED_AWAITING_ASSIGNMENT || C.STATUS.AWAITING_ASSIGNMENT || C.STATUS.APPROVED)) || 'Approved – Awaiting Assignment',
  ASSIGNED: (C.STATUS && C.STATUS.ASSIGNED) || 'Assigned',
  IN_PROGRESS: (C.STATUS && C.STATUS.IN_PROGRESS) || 'In Progress',
  ON_HOLD: (C.STATUS && C.STATUS.ON_HOLD) || 'On Hold',
  COMPLETED: (C.STATUS && C.STATUS.COMPLETED) || 'Completed',
  REJECTED: (C.STATUS && C.STATUS.REJECTED) || 'Rejected',
};
const OPEN_STATUSES = Array.isArray(C.OPEN_STATUSES) && C.OPEN_STATUSES.length
  ? C.OPEN_STATUSES
  : [S.PENDING, S.APPROVED, S.ASSIGNED, S.IN_PROGRESS, S.ON_HOLD];
const TECH_ACTIVE_STATUSES = Array.isArray(C.TECH_ACTIVE_STATUSES) && C.TECH_ACTIVE_STATUSES.length
  ? C.TECH_ACTIVE_STATUSES
  : [S.ASSIGNED, S.IN_PROGRESS, S.ON_HOLD];
const REQUEST_STATUSES = Array.isArray(C.REQUEST_STATUSES) && C.REQUEST_STATUSES.length
  ? C.REQUEST_STATUSES
  : [S.PENDING, S.APPROVED, S.ASSIGNED, S.IN_PROGRESS, S.ON_HOLD, S.COMPLETED, S.REJECTED];

function normalizeStatus(r) {
  if (typeof C.normalizeStatus === 'function') {
    const normalized = C.normalizeStatus(r.status, r);
    if (normalized) return normalized;
  }
  if (r.status === 'Reported') return S.PENDING;
  if (r.status === 'Approved') return S.APPROVED;
  if (r.status === 'Pending') return r.technicianId ? S.ASSIGNED : S.PENDING;
  if (r.status === 'Nearing Completion') return S.IN_PROGRESS;
  if (r.status === 'Cancelled') return S.REJECTED;
  return r.status;
}

// enrichRequest supplies rec/equipment/category/requester/technician/overdue.
function viewRow(r) {
  const status = normalizeStatus(r);
  return { ...enrichRequest(r), status, isOpen: OPEN_STATUSES.includes(status) };
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

function statusSummary(rows) {
  const count = (status) => rows.filter((r) => r.status === status).length;
  const summary = {};
  REQUEST_STATUSES.forEach((status) => { summary[status] = count(status); });
  return {
    ...summary,
    pendingApproval: count(S.PENDING),
    awaitingAssignment: count(S.APPROVED),
    assigned: count(S.ASSIGNED),
    inProgress: count(S.IN_PROGRESS),
    onHold: count(S.ON_HOLD),
    completed: count(S.COMPLETED),
    rejected: count(S.REJECTED),
    // Older templates used these aliases; they now point at the new stages.
    pending: count(S.PENDING),
    approved: count(S.APPROVED),
    total: rows.length,
  };
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
    const requests = db.all('requests').map(viewRow);
    const pendingApproval = sortByPriority(requests.filter((r) => r.status === S.PENDING).slice());
    const awaitingAssignment = sortByPriority(requests.filter((r) => r.status === S.APPROVED).slice());
    const activeTasks = sortByPriority(requests.filter((r) => TECH_ACTIVE_STATUSES.includes(r.status)).slice());
    const completedRequests = requests
      .filter((r) => r.status === S.COMPLETED)
      .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
    const rejectedRequests = requests
      .filter((r) => r.status === S.REJECTED)
      .sort((a, b) => String(b.rejectedAt || '').localeCompare(String(a.rejectedAt || '')));
    const open = requests.filter((r) => r.isOpen);
    const technicians = db
      .where('users', (u) => u.role === 'technician' && u.active)
      .map((t) => ({
        id: t.id,
        name: t.name,
        availability: t.availability,
        activeCount: activeTaskCount(t.id),
        active: !!t.active,
        specializations: (t.specializations || []).map((id) => db.find('categories', id)).filter(Boolean),
      }))
      .sort((a, b) => b.activeCount - a.activeCount || a.name.localeCompare(b.name));

    const stats = {
      // Compact cards: one count for each dashboard section.
      pendingApproval: pendingApproval.length,
      awaitingAssignment: awaitingAssignment.length,
      activeTasks: activeTasks.length,
      completedRequests: completedRequests.length,
      rejectedRequests: rejectedRequests.length,
      inProgress: activeTasks.length,
      completedMonth: completedRequests.filter((r) => r.completedAt >= thisMonth).length,
      pmDue: pmAlerts.length,
      totalReported: requests.length,
      completed: completedRequests.length,
      awaitingVerification: requests.filter((r) => r.verificationStatus === C.AWAITING_VERIFICATION).length,
      verified: requests.filter((r) => r.verificationStatus === 'Verified').length,
      materialsExpensesCents: sumCents(db.all('materials')),
      materialsExpenses: sumCents(db.all('materials')) / 100,
      // Backward-compatible aliases for older templates.
      pending: awaitingAssignment.length,
      nearing: 0,
    };

    const queue = awaitingAssignment.slice(0, 6);
    const overdueTasks = activeTasks
      .filter((r) => r.overdue)
      .sort((a, b) => String(a.targetDate || '').localeCompare(String(b.targetDate || '')));
    const workload = technicians
      .filter((t) => t.active)
      .map((t) => ({ tech: db.find('users', t.id), active: t.activeCount }))
      .sort((a, b) => b.active - a.active);
    // Upcoming preventive maintenance: next inspections plus anything due soon.
    const maintenanceDue = schedules.filter((s) => s.hasHistory && s.daysLeft >= 0).slice(0, 6);

    return res.render('dashboard-admin', {
      title: 'Dashboard',
      stats,
      pendingApproval,
      awaitingAssignment,
      activeTasks,
      completedRequests,
      rejectedRequests,
      technicians,
      statuses: REQUEST_STATUSES,
      equipmentByStatus,
      totalEquipment: equipment.length,
      queue,
      overdueTasks,
      workload,
      maintenanceDue,
      verificationQueue: requests.filter((r) => r.verificationStatus === C.AWAITING_VERIFICATION).slice(0, 6),
      monitorRows: [...open, ...completedRequests]
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
    const mine = db.where('requests', (r) => r.technicianId === user.id).map(viewRow);
    const activeTasks = sortByPriority(mine.filter((r) => TECH_ACTIVE_STATUSES.includes(r.status)).slice());
    const completedTasks = mine
      .filter((r) => r.status === S.COMPLETED)
      .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
    const specs = (user.specializations || []).map((id) => db.find('categories', id)).filter(Boolean);
    const summary = statusSummary(mine);
    const stats = {
      ...summary,
      assigned: summary.assigned,
      inProgress: summary.inProgress,
      overdue: activeTasks.filter((r) => r.overdue).length,
      completedMonth: completedTasks.filter((r) => r.completedAt >= thisMonth).length,
      assignedTasks: activeTasks.length,
      pendingTasks: 0,
      nearingTasks: 0,
      completedTasks: completedTasks.length,
      reworkTasks: mine.filter((r) => r.verificationStatus === 'Rework Required').length,
    };

    return res.render('dashboard-tech', {
      title: 'Dashboard',
      summary,
      stats,
      activeTasks,
      completedTasks,
      availability: user.availability || 'Available',
      availabilityOptions: C.AVAILABILITY,
      specializations: specs,
      specs,
      active: activeTasks,
      currentJob: activeTasks[0] || mine.find((r) => r.verificationStatus === 'Rework Required') || null,
      myCompleted: completedTasks.slice(0, 5),
      recentActivities: recent(6, (a) => a.userId === user.id || db.find('requests', a.requestId)?.technicianId === user.id),
      equipmentByStatus,
      totalEquipment: equipment.length,
      pmAlerts: pmAlerts.slice(0, 6),
    });
  }

  // Requester
  const mine = db
    .where('requests', (r) => r.requesterId === user.id)
    .map(viewRow)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const summary = statusSummary(mine);
  const notifications = db
    .where('notifications', (n) => n.userId === user.id)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || b.id - a.id)
    .slice(0, 10);
  ensureStudentsDatabase();
  const studentInfo = studentDirectory.findById(user.directoryRecordId) ||
    studentDirectory.findByUserId(user.id) ||
    (user.studentId ? findOfficialStudent(user.studentId) : null) ||
    findOfficialStudent(user.email);
  res.render('dashboard-requester', {
    title: 'Dashboard',
    summary,
    requests: mine,
    notifications,
    recentRequests: mine.slice(0, 6),
    total: mine.length,
    studentInfo,
    statuses: REQUEST_STATUSES,
  });
});

module.exports = router;
