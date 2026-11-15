// Feature 15: Automated Repair Request Prioritization.
//
// Score (0–100) = equipment importance (max 40)
//               + reported severity   (max 40)
//               + waiting time        (max 20, reached after 14 days)
// Recommended level: 70+ = High, 40–69 = Medium, below 40 = Low.
const C = require('../constants');

const WEIGHTS = { importance: 40, severity: 40, waiting: 20 };
const MAX_WAIT_DAYS = 14;
const HIGH_AT = 70;
const MEDIUM_AT = 40;

function waitingDays(request, now = new Date()) {
  const start = new Date(request.createdAt);
  const end = request.completedAt || request.cancelledAt ? new Date(request.completedAt || request.cancelledAt) : now;
  return Math.max(0, (end - start) / 86400000);
}

function levelFor(score) {
  if (score >= HIGH_AT) return 'High';
  if (score >= MEDIUM_AT) return 'Medium';
  return 'Low';
}

function computePriority(request, equipment, now = new Date()) {
  const importance = Math.min(5, Math.max(1, Number(equipment && equipment.importance) || 3));
  const hasSeverity = request.severity != null && request.severity !== '' && Number(request.severity) >= 1;
  const severity = hasSeverity ? Math.min(4, Math.max(1, Number(request.severity))) : null;
  const days = waitingDays(request, now);

  const importancePts = Math.round((importance / 5) * WEIGHTS.importance);
  const severityPts = severity ? Math.round((severity / 4) * WEIGHTS.severity) : 0;
  const waitingPts = Math.round((Math.min(days, MAX_WAIT_DAYS) / MAX_WAIT_DAYS) * WEIGHTS.waiting);
  const score = importancePts + severityPts + waitingPts;

  return {
    score,
    level: levelFor(score),
    breakdown: {
      importance: { label: C.IMPORTANCE[importance], value: importance, points: importancePts, max: WEIGHTS.importance },
      severity: { label: severity ? C.SEVERITIES[severity] : 'Pending Assessment', value: severity || 0, points: severityPts, max: WEIGHTS.severity },
      waiting: { label: `${days.toFixed(1)} day(s)`, value: days, points: waitingPts, max: WEIGHTS.waiting },
    },
  };
}

module.exports = { computePriority, levelFor, HIGH_AT, MEDIUM_AT, WEIGHTS, MAX_WAIT_DAYS };
