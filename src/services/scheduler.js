// Automatic reminders (features 13 and 17). Runs on startup and every hour.
const db = require('../db');
const C = require('../constants');
const { notify, adminIds } = require('./notify');
const { allSchedules } = require('./preventive');
const { todayISO, fmtDate } = require('../helpers');

function isOverdueRequest(r, today = todayISO()) {
  return !!r.targetDate && C.OPEN_STATUSES.includes(r.status) && r.targetDate < today;
}

function runAutomatedChecks() {
  const today = todayISO();
  const admins = adminIds();
  let sent = 0;

  // Preventive maintenance due soon / overdue. Equipment without recorded
  // maintenance has no due date, so it must not generate reminder messages.
  for (const s of allSchedules(today)) {
    if (!['Overdue', 'Due Soon'].includes(s.status) || s.openTask) continue;
    const eq = s.equipment;
    const msg =
      s.status === 'Overdue'
        ? `Preventive maintenance OVERDUE for ${eq.code} ${eq.name} (was due ${fmtDate(s.nextDue)}).`
        : `Preventive maintenance due soon for ${eq.code} ${eq.name} on ${fmtDate(s.nextDue)}.`;
    sent += notify(admins, {
      message: msg,
      link: '/schedule',
      type: s.status === 'Overdue' ? 'danger' : 'warning',
      dedupeKey: `pm-${s.status}-${eq.id}-${s.nextDue}`,
    });
  }

  // Repair tasks past their target date.
  for (const r of db.where('requests', (r) => isOverdueRequest(r, today))) {
    sent += notify([r.technicianId, ...admins], {
      message: `Task ${r.code} is overdue (target date ${fmtDate(r.targetDate)}).`,
      link: `/requests/${r.id}`,
      type: 'danger',
      dedupeKey: `req-overdue-${r.id}-${r.targetDate}`,
    });
  }

  return sent;
}

function startScheduler() {
  try {
    runAutomatedChecks();
  } catch (err) {
    console.error('Reminder check failed:', err);
  }
  const timer = setInterval(() => {
    try {
      runAutomatedChecks();
    } catch (err) {
      console.error('Reminder check failed:', err);
    }
  }, 60 * 60 * 1000);
  timer.unref();
}

module.exports = { runAutomatedChecks, startScheduler, isOverdueRequest };
