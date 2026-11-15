// Feature 17: Preventive Maintenance Scheduling.
// Next due date = last preventive maintenance (or acquisition date) + interval in days.
const db = require('../db');
const C = require('../constants');
const { addDays, diffDays, todayISO, dateOnly, calcNextDue, intervalLabel } = require('../helpers');

function openPreventiveTask(equipmentId) {
  return (
    db.where(
      'requests',
      (r) => r.equipmentId === equipmentId && r.type === 'Preventive' && C.OPEN_STATUSES.includes(r.status)
    )[0] || null
  );
}

function scheduleFor(eq, today = todayISO()) {
  const interval = Number(eq.maintenanceIntervalDays);
  if (!interval || interval <= 0) return null;
  const base = eq.lastMaintenanceDate || eq.acquisitionDate || dateOnly(eq.createdAt);
  const nextDue = calcNextDue(base, interval);
  const daysLeft = diffDays(today, nextDue);
  let status = 'Scheduled';
  if (daysLeft < 0) status = 'Overdue';
  else if (daysLeft <= C.DUE_SOON_DAYS) status = 'Due Soon';
  return {
    equipment: eq,
    interval,
    intervalLabel: intervalLabel(interval),
    base,
    basedOn: eq.lastMaintenanceDate ? 'Last maintenance' : 'Acquisition date',
    nextDue,
    daysLeft,
    status,
    openTask: openPreventiveTask(eq.id),
  };
}

function allSchedules(today = todayISO()) {
  return db
    .all('equipment')
    .map((eq) => scheduleFor(eq, today))
    .filter(Boolean)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

module.exports = { scheduleFor, allSchedules, openPreventiveTask };
