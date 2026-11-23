// One-time, idempotent migration for the connected Admin/Maintenance workflow.
// Backs up db.json first, migrates request/activity statuses to the seven
// canonical labels in a single transaction, and never invents or deletes records.
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const C = require('../src/constants');

const backupDir = path.join(db.DATA_DIR, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

if (fs.existsSync(db.DB_FILE)) {
  const backup = path.join(backupDir, `db-before-repair-workflow-${stamp}.json`);
  fs.copyFileSync(db.DB_FILE, backup);
  console.log(`Backup created: ${backup}`);
} else {
  console.log(`No database file at ${db.DB_FILE}; nothing to back up.`);
}

db.load();

function requestPatch(r) {
  const patch = {};
  if (!r.reportedAt) patch.reportedAt = r.createdAt;
  if (!r.verificationStatus) patch.verificationStatus = 'Not Submitted';
  if (r.verifiedAt === undefined) patch.verifiedAt = null;
  if (r.verifiedBy === undefined) patch.verifiedBy = null;
  const nextStatus = C.normalizeStatus(r.status, r);
  if (nextStatus !== r.status) {
    patch.status = nextStatus;
    // Keep the original value for auditability; written only on the first
    // migration so reruns cannot duplicate or lose history.
    if (r.legacyStatus === undefined) patch.legacyStatus = r.status;
  }
  return patch;
}

function activityPatch(a) {
  const request = a.requestId ? db.find('requests', a.requestId) : null;
  const patch = {};
  if (a.fromStatus !== undefined && a.fromStatus !== null) {
    const from = C.normalizeStatus(a.fromStatus, request);
    if (from !== a.fromStatus) patch.fromStatus = from;
  }
  if (a.toStatus !== undefined && a.toStatus !== null) {
    const to = C.normalizeStatus(a.toStatus, request);
    if (to !== a.toStatus) patch.toStatus = to;
  }
  return patch;
}

function needsAttempt(r) {
  return !!((r.startedAt || r.completedAt) &&
    !db.where('repairAttempts', (a) => a.requestId === r.id).length);
}

// A rerun must be a true no-op, including the database revision counter.
const pending = db.all('requests').some((r) => Object.keys(requestPatch(r)).length || needsAttempt(r)) ||
  db.all('activities').some((a) => Object.keys(activityPatch(a)).length);

if (!pending) {
  console.log('Migration already up to date. No changes made.');
} else {
  const counters = { requests: 0, statuses: 0, activities: 0, attempts: 0 };
  db.transaction(() => {
    // Requests first: activity normalization needs the (now canonical) record
    // to resolve the context-sensitive legacy value `Pending`.
    for (const r of db.all('requests')) {
      const patch = requestPatch(r);
      if (patch.status !== undefined) counters.statuses++;
      if (Object.keys(patch).length) {
        db.update('requests', r.id, patch);
        counters.requests++;
      }
    }

    for (const a of db.all('activities')) {
      const patch = activityPatch(a);
      if (Object.keys(patch).length) {
        db.update('activities', a.id, patch);
        counters.activities++;
      }
    }

    for (const r of db.all('requests')) {
      if (!needsAttempt(r)) continue;
      const completion = db
        .where('activities', (a) => a.requestId === r.id && /completed/i.test(a.action || ''))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const attempt = db.insert('repairAttempts', {
        code: 'ATT-PENDING',
        requestId: r.id,
        attemptNumber: 1,
        startedAt: r.startedAt || r.assignedAt || r.createdAt,
        startedBy: r.technicianId || null,
        completedAt: r.completedAt || null,
        completionRemarks: completion ? String(completion.details || '').slice(0, 1000) : '',
        verificationResult: 'Not Submitted',
        migrated: true,
      });
      db.update('repairAttempts', attempt.id, { code: `ATT-${String(attempt.id).padStart(4, '0')}` });
      counters.attempts++;
    }
  });

  console.log(
    `Migration complete. Requests updated: ${counters.requests}. ` +
    `Statuses normalized: ${counters.statuses}. Activities normalized: ${counters.activities}. ` +
    `Repair attempts derived: ${counters.attempts}.`
  );
}
