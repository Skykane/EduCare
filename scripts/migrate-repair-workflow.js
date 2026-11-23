// One-time, idempotent migration for the connected Admin/Maintenance workflow.
// Backs up db.json first and never invents demo records.
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const backupDir = path.join(db.DATA_DIR, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

if (fs.existsSync(db.DB_FILE)) {
  const backup = path.join(backupDir, `db-before-repair-workflow-${stamp}.json`);
  fs.copyFileSync(db.DB_FILE, backup);
  console.log(`Backup created: ${backup}`);
}

db.load();

const counters = { requests: 0, attempts: 0 };
db.transaction(() => {
  for (const r of db.all('requests')) {
    const patch = {};
    if (!r.reportedAt) patch.reportedAt = r.createdAt;
    if (!r.verificationStatus) patch.verificationStatus = 'Not Submitted';
    if (r.verifiedAt === undefined) patch.verifiedAt = null;
    if (r.verifiedBy === undefined) patch.verifiedBy = null;
    if (Object.keys(patch).length) {
      Object.assign(r, patch);
      counters.requests++;
    }
  }

  for (const r of db.all('requests')) {
    if (db.where('repairAttempts', (a) => a.requestId === r.id).length) continue;
    if (!r.startedAt && !r.completedAt) continue;
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

console.log(`Migration complete. Requests updated: ${counters.requests}. Repair attempts derived: ${counters.attempts}.`);
