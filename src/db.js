// Small JSON-file database. Every change is written to disk right away
// (write to a temp file, then rename) so records survive restarts.
// Multi-step workflow changes use db.transaction(fn) so a whole repair action
// is committed with a single atomic write (and rolled back in memory on error).
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const COLLECTIONS = [
  'users',
  'categories',
  'equipment',
  'requests',
  'activities',
  'attachments',
  'maintenanceRecords',
  'notifications',
  'students',
  'outgoingEmails',
  'gradeSections',
  'materials',
  'repairAttempts',
];

let data = null;
let inTransaction = false;

function emptyData() {
  const d = { meta: { counters: {}, revision: 0 } };
  for (const c of COLLECTIONS) {
    d[c] = [];
    d.meta.counters[c] = 0;
  }
  return d;
}

function load() {
  if (fs.existsSync(DB_FILE)) {
    data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    data.meta = data.meta || { counters: {} };
    data.meta.counters = data.meta.counters || {};
    if (typeof data.meta.revision !== 'number') data.meta.revision = 0;
    for (const c of COLLECTIONS) {
      if (!Array.isArray(data[c])) data[c] = [];
      if (typeof data.meta.counters[c] !== 'number') {
        data.meta.counters[c] = data[c].reduce((m, r) => Math.max(m, r.id || 0), 0);
      }
    }
  } else {
    data = emptyData();
  }
  return data;
}

function save() {
  if (inTransaction) return; // the outer transaction commits once
  fs.mkdirSync(DATA_DIR, { recursive: true });
  data.meta.revision = (data.meta.revision || 0) + 1;
  const json = JSON.stringify(data, null, 2);
  // Include the pid so two server processes cannot race on the same temp file.
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    // Windows can briefly lock files (antivirus, indexer). Fall back to a direct write.
    fs.writeFileSync(DB_FILE, json);
    try { fs.unlinkSync(tmp); } catch (e) { /* already gone */ }
  }
}

function ensure() {
  if (!data) load();
}

/**
 * Run a synchronous block as one database commit.
 * insert/update/remove inside the block do not write to disk; the outer block
 * writes once on success and restores the in-memory snapshot on failure.
 */
function transaction(fn) {
  ensure();
  if (inTransaction) throw new Error('Nested database transactions are not supported');
  const snapshot = JSON.parse(JSON.stringify(data));
  inTransaction = true;
  try {
    const result = fn();
    inTransaction = false;
    save();
    return result;
  } catch (err) {
    data = snapshot;
    inTransaction = false;
    throw err;
  }
}

function revision() {
  ensure();
  return data.meta.revision || 0;
}

function reset() {
  data = emptyData();
  save();
}

function all(collection) {
  ensure();
  return data[collection];
}

function find(collection, id) {
  ensure();
  const n = Number(id);
  return data[collection].find((r) => r.id === n) || null;
}

function where(collection, fn) {
  ensure();
  return data[collection].filter(fn);
}

function insert(collection, record) {
  ensure();
  const now = new Date().toISOString();
  data.meta.counters[collection] = (data.meta.counters[collection] || 0) + 1;
  const row = { id: data.meta.counters[collection], createdAt: now, updatedAt: now, ...record };
  data[collection].push(row);
  save();
  return row;
}

function update(collection, id, patch) {
  const row = find(collection, id);
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: new Date().toISOString() });
  save();
  return row;
}

function remove(collection, id) {
  ensure();
  const n = Number(id);
  const before = data[collection].length;
  data[collection] = data[collection].filter((r) => r.id !== n);
  if (data[collection].length !== before) save();
}

module.exports = {
  load, save, reset, all, find, where, insert, update, remove,
  transaction, revision, DATA_DIR, DB_FILE,
};
