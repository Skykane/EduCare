// Feature 1: Technician Account Management (profiles, specializations, availability, tasks).
const express = require('express');
const db = require('../db');
const C = require('../constants');
const { requireRole, flash, forbidden } = require('../auth');
const { str, safeLocalPath } = require('../helpers');
const { enrichRequest, sortByPriority } = require('../services/requests');
const activity = require('../services/activity');
const { notify, adminIds } = require('../services/notify');

const router = express.Router();

function normalizeStatus(r) {
  if (typeof C.normalizeStatus === 'function') {
    const normalized = C.normalizeStatus(r.status, r);
    if (normalized) return normalized;
  }
  if (r.status === 'Pending') return r.technicianId ? 'Assigned' : 'Pending Approval';
  if (r.status === 'Nearing Completion') return 'In Progress';
  if (r.status === 'Cancelled') return 'Rejected';
  return r.status;
}

function techSummary(t) {
  const tasks = db.where('requests', (r) => r.technicianId === t.id).map(enrichRequest).map((r) => ({
    ...r,
    status: normalizeStatus(r),
  }));
  const completed = tasks.filter((r) => r.status === 'Completed');
  const active = tasks.filter((r) => C.TECH_ACTIVE_STATUSES.includes(r.status));
  const durations = completed.filter((r) => r.assignedAt && r.completedAt).map((r) => (new Date(r.completedAt) - new Date(r.assignedAt)) / 86400000);
  return {
    tech: t,
    id: t.id,
    name: t.name,
    availability: t.availability,
    activeCount: active.length,
    // Seeded demo technicians carry exact specialization labels. Use those when
    // present; otherwise fall back to names derived from the selected categories.
    specializations: (t.specializationLabels && t.specializationLabels.length)
      ? t.specializationLabels.map((name) => ({ name }))
      : (t.specializations || []).map((id) => db.find('categories', id)).filter(Boolean),
    active,
    overdue: tasks.filter((r) => r.overdue).length,
    completedCount: completed.length,
    avgDays: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    tasks,
  };
}

router.get('/', requireRole('admin'), (req, res) => {
  const list = db
    .where('users', (u) => u.role === 'technician')
    .map(techSummary)
    .sort((a, b) => b.activeCount - a.activeCount || a.name.localeCompare(b.name));
  res.render('technicians/index', { title: 'Technicians', list, statuses: C.REQUEST_STATUSES });
});

router.get('/:id', (req, res) => {
  const t = db.find('users', req.params.id);
  if (!t || t.role !== 'technician') return res.status(404).render('error', { title: 'Not found', message: 'Technician not found.' });
  if (req.user.role !== 'admin' && req.user.id !== t.id) return forbidden(res);
  const s = techSummary(t);
  res.render('technicians/show', {
    title: t.name,
    s,
    active: sortByPriority(s.active),
    history: s.tasks.filter((r) => !C.TECH_ACTIVE_STATUSES.includes(r.status)).sort((a, b) => (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt)),
  });
});

router.post('/:id/availability', (req, res) => {
  const t = db.find('users', req.params.id);
  if (!t || t.role !== 'technician') return res.status(404).render('error', { title: 'Not found', message: 'Technician not found.' });
  if (req.user.role !== 'admin' && req.user.id !== t.id) return forbidden(res);
  const b = req.body || {};
  const availability = str(b.availability, 20);
  const back = safeLocalPath(b.back, `/technicians/${t.id}`);
  if (!C.AVAILABILITY.includes(availability)) {
    flash(req, 'error', 'Invalid availability.');
    return res.redirect(back);
  }
  const active = activeTaskCount(t.id);
  if (availability === 'Available' && active > 0) {
    flash(req, 'error', `${t.name} still has ${active} active task(s) and cannot be marked Available.`);
    return res.redirect(back);
  }
  if (availability !== t.availability) {
    db.update('users', t.id, { availability });
    // Reconcile with active assignments. "On Leave" is a manual override, but
    // workflow changes will re-sync based on active tasks.
    if (availability !== 'On Leave') syncTechnicianAvailability(t.id);
    activity.log({ userId: req.user.id, action: 'Availability changed', details: `${t.name}: ${t.availability || '—'} → ${availability}` });
    if (req.user.id === t.id) {
      notify(adminIds(), { message: `${t.name} is now ${availability}.`, link: `/technicians/${t.id}`, exceptUserId: req.user.id });
    } else {
      notify([t.id], { message: `Your availability was set to ${availability} by ${req.user.name}.`, link: `/technicians/${t.id}`, exceptUserId: req.user.id });
    }
  } else if (availability !== 'On Leave') {
    syncTechnicianAvailability(t.id);
  }
  const finalTech = db.find('users', t.id) || t;
  flash(req, 'success', `Availability set to ${finalTech.availability || availability}.`);
  res.redirect(back);
});

module.exports = router;
