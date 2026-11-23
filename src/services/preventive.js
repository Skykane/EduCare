// Feature 17: Preventive Maintenance Scheduling.
// Next due date = last RECORDED preventive maintenance + interval in days.
// Acquisition/created dates are never used as maintenance history.
const db = require('../db');
const C = require('../constants');
const { diffDays, todayISO, calcNextDue, intervalLabel, isISODate } = require('../helpers');

function openPreventiveTask(equipmentId) {
  return (
    db.where(
      'requests',
      (r) => r.equipmentId === equipmentId && r.type === 'Preventive' && C.OPEN_STATUSES.includes(r.status)
    )[0] || null
  );
}

// Uses only completed, recorded preventive maintenance. Corrective repair
// requests are deliberately excluded so preventive cycles stay accurate.
function lastRecordedMaintenance(eq) {
  const candidates = [];
  if (isISODate(eq.lastMaintenanceDate)) candidates.push(eq.lastMaintenanceDate);
  db.where(
    'maintenanceRecords',
    (m) => m.equipmentId === eq.id && m.type === 'Preventive' && isISODate(m.serviceDate)
  ).forEach((m) => candidates.push(m.serviceDate));
  return candidates.length ? candidates.sort().pop() : null;
}

function scheduleFor(eq, today = todayISO()) {
  const interval = Number(eq.maintenanceIntervalDays);
  if (!interval || interval <= 0) return null;

  const base = lastRecordedMaintenance(eq);
  const openTask = openPreventiveTask(eq.id);

  // A configured interval is not the same as a completed checkup. When no real
  // history exists, report that state instead of inventing a historical date.
  if (!base) {
    return {
      equipment: eq,
      interval,
      intervalLabel: intervalLabel(interval),
      base: null,
      basedOn: 'No maintenance recorded',
      hasHistory: false,
      nextDue: null,
      daysLeft: null,
      status: 'No maintenance recorded',
      openTask,
    };
  }

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
    basedOn: 'Recorded maintenance',
    hasHistory: true,
    nextDue,
    daysLeft,
    status,
    openTask,
  };
}

function allSchedules(today = todayISO()) {
  return db
    .all('equipment')
    .map((eq) => scheduleFor(eq, today))
    .filter(Boolean)
    .sort((a, b) => {
      if (!a.nextDue && b.nextDue) return 1;
      if (a.nextDue && !b.nextDue) return -1;
      return a.daysLeft - b.daysLeft;
    });
}

module.exports = { scheduleFor, allSchedules, openPreventiveTask, lastRecordedMaintenance };
