// Feature 17: Preventive Maintenance Scheduling.
const express = require('express');
const db = require('../db');
const { requireRole, flash } = require('../auth');
const { str, fmtDate, todayISO } = require('../helpers');
const { allSchedules, scheduleFor } = require('../services/preventive');
const { runAutomatedChecks } = require('../services/scheduler');
const { nextCode } = require('../services/requests');
const activity = require('../services/activity');

const router = express.Router();
router.use(requireRole('admin', 'technician'));

router.get('/', (req, res) => {
  const status = ['Overdue', 'Due Soon', 'Scheduled'].includes(req.query.status) ? req.query.status : '';
  const schedules = allSchedules();
  const counts = {
    Overdue: schedules.filter((s) => s.status === 'Overdue').length,
    'Due Soon': schedules.filter((s) => s.status === 'Due Soon').length,
    Scheduled: schedules.filter((s) => s.status === 'Scheduled').length,
  };
  const unscheduled = db.where('equipment', (e) => !Number(e.maintenanceIntervalDays));
  res.render('schedule', {
    title: req.user.role === 'technician' ? 'Maintenance Schedule' : 'Preventive Maintenance Schedule',
    rows: status ? schedules.filter((s) => s.status === status) : schedules,
    counts,
    status,
    unscheduled,
  });
});

router.post('/check', requireRole('admin'), (req, res) => {
  const sent = runAutomatedChecks();
  flash(req, 'success', sent ? `Reminder check done: ${sent} new reminder(s) sent.` : 'Reminder check done: no new reminders needed.');
  res.redirect('/schedule');
});

// Turn a due inspection into a preventive maintenance task that can be assigned.
router.post('/:equipmentId/task', requireRole('admin'), (req, res) => {
  const eq = db.find('equipment', req.params.equipmentId);
  if (!eq) return res.status(404).render('error', { title: 'Not found', message: 'Equipment not found.' });
  const s = scheduleFor(eq);
  if (!s) {
    flash(req, 'error', 'This equipment has no maintenance interval set.');
    return res.redirect('/schedule');
  }
  if (s.openTask) {
    flash(req, 'warning', `A preventive task (${s.openTask.code}) is already open for this equipment.`);
    return res.redirect(`/requests/${s.openTask.id}`);
  }
  const r = db.insert('requests', {
    code: nextCode('requests', 'REQ'),
    equipmentId: eq.id,
    requesterId: req.user.id,
    title: `Preventive maintenance: ${eq.name}`,
    description: `Scheduled preventive maintenance every ${s.interval} day(s). Due ${fmtDate(s.nextDue)} (${s.basedOn.toLowerCase()}: ${fmtDate(s.base)}). ${str((req.body || {}).note, 500)}`.trim(),
    severity: s.status === 'Overdue' ? 3 : 2,
    type: 'Preventive',
    status: 'Pending',
    priority: null,
    technicianId: null,
    targetDate: s.nextDue >= todayISO() ? s.nextDue : null,
    assignedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
  });
  activity.log({ requestId: r.id, equipmentId: eq.id, userId: req.user.id, action: 'Preventive task created', details: r.title, toStatus: 'Pending' });
  flash(req, 'success', `Preventive task ${r.code} created. Assign a technician below.`);
  res.redirect(`/requests/${r.id}#assign`);
});

module.exports = router;
