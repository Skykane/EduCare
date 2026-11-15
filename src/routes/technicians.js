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

function techSummary(t) {
  const tasks = db.where('requests', (r) => r.technicianId === t.id).map(enrichRequest);
  const completed = tasks.filter((r) => r.status === 'Completed');
  const durations = completed.filter((r) => r.assignedAt && r.completedAt).map((r) => (new Date(r.completedAt) - new Date(r.assignedAt)) / 86400000);
  return {
    tech: t,
    specializations: (t.specializations || []).map((id) => db.find('categories', id)).filter(Boolean),
    active: tasks.filter((r) => C.TECH_ACTIVE_STATUSES.includes(r.status)),
    overdue: tasks.filter((r) => r.overdue).length,
    completedCount: completed.length,
    avgDays: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
    tasks,
  };
}

router.get('/', requireRole('admin'), (req, res) => {
  const list = db
    .where('users', (u) => u.role === 'technician')
    .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name))
    .map(techSummary);
  res.render('technicians/index', { title: 'Technicians', list });
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
  if (availability !== t.availability) {
    db.update('users', t.id, { availability });
    activity.log({ userId: req.user.id, action: 'Availability changed', details: `${t.name}: ${t.availability || '—'} → ${availability}` });
    if (req.user.id === t.id) {
      notify(adminIds(), { message: `${t.name} is now ${availability}.`, link: `/technicians/${t.id}`, exceptUserId: req.user.id });
    }
  }
  flash(req, 'success', `Availability set to ${availability}.`);
  res.redirect(back);
});

module.exports = router;
