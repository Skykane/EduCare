// Repair attempts, elapsed time, and the combined repair timeline.
const db = require('../db');

function nextCode() {
  const max = db.all('repairAttempts').reduce((m, a) => {
    const match = /^ATT-(\d+)$/.exec(a.code || '');
    return match ? Math.max(m, parseInt(match[1], 10)) : m;
  }, 0);
  return `ATT-${String(max + 1).padStart(4, '0')}`;
}

function current(requestId) {
  return (
    db
      .where('repairAttempts', (a) => a.requestId === Number(requestId) && !a.completedAt)
      .sort((a, b) => b.id - a.id)[0] || null
  );
}

function forRequest(requestId) {
  return db
    .where('repairAttempts', (a) => a.requestId === Number(requestId))
    .sort((a, b) => a.attemptNumber - b.attemptNumber);
}

function start(requestId, userId, options = {}) {
  const existing = current(requestId);
  if (existing) return existing;
  const number = forRequest(requestId).length + 1;
  return db.insert('repairAttempts', {
    code: nextCode(),
    requestId: Number(requestId),
    attemptNumber: number,
    startedAt: options.startedAt || new Date().toISOString(),
    startedBy: userId,
    completedAt: null,
    completionRemarks: '',
    verificationResult: 'Not Submitted',
  });
}

function complete(requestId, remarks, options = {}) {
  const attempt = current(requestId) || start(requestId, options.userId, { startedAt: options.startedAt });
  return db.update('repairAttempts', attempt.id, {
    completedAt: options.completedAt || new Date().toISOString(),
    completionRemarks: String(remarks || '').trim(),
    verificationResult: options.verificationResult || 'Awaiting Verification',
  });
}

function setVerification(requestId, result, details = {}) {
  const attempts = forRequest(requestId);
  const attempt = [...attempts].reverse().find((a) => a.completedAt) || attempts[attempts.length - 1];
  if (!attempt) return null;
  return db.update('repairAttempts', attempt.id, {
    verificationResult: result,
    verificationReason: details.reason || null,
    verifiedBy: details.verifiedBy || null,
    verifiedAt: details.verifiedAt || null,
  });
}

function elapsedMs(attempt) {
  if (!attempt || !attempt.startedAt || !attempt.completedAt) return 0;
  return Math.max(0, new Date(attempt.completedAt) - new Date(attempt.startedAt));
}

function totalElapsedMs(requestId) {
  return forRequest(requestId).reduce((sum, a) => sum + elapsedMs(a), 0);
}

function timeline(requestId) {
  const rid = Number(requestId);
  const items = [];
  for (const a of db.where('activities', (x) => x.requestId === rid)) {
    items.push({
      kind: 'activity',
      at: a.createdAt,
      title: a.action,
      details: a.details,
      user: a.userId,
      previousStatus: a.fromStatus || null,
      newStatus: a.toStatus || null,
      proof: db.where('attachments', (p) => p.requestId === rid && p.note === `activity:${a.id}`),
      data: a,
    });
  }
  for (const a of forRequest(rid)) {
    items.push({
      kind: 'attempt',
      at: a.startedAt,
      title: `Repair attempt ${a.attemptNumber} started`,
      details: a.code,
      user: a.startedBy,
      data: a,
    });
    if (a.completedAt) {
      items.push({
        kind: 'attempt',
        at: a.completedAt,
        title: `Repair attempt ${a.attemptNumber} completed`,
        details: a.completionRemarks,
        user: null,
        data: a,
      });
    }
  }
  for (const m of db.where('materials', (x) => x.requestId === rid)) {
    items.push({ kind: 'material', at: m.createdAt, title: `Material: ${m.materialName}`, details: m.purpose, user: m.recordedBy, data: m });
  }
  return items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || (b.data.id || 0) - (a.data.id || 0));
}

module.exports = { start, complete, current, forRequest, setVerification, elapsedMs, totalElapsedMs, timeline, nextCode };
