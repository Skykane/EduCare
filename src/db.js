// Small JSON-file database. Every change is written to disk right away
// (write to a temp file, then rename) so records survive restarts.
// Multi-step workflow changes use db.transaction(fn) so a whole repair action
// is committed with a single atomic write (and rolled back in memory on error).
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const LOCK_FILE = `${DB_FILE}.lock`;

function wait(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withDbLock(fn) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let fd;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      fd = fs.openSync(LOCK_FILE, 'wx');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST' || attempt === 29) throw err;
      wait(50);
    }
  }
  try {
    return fn();
  } finally {
    fs.closeSync(fd);
    try { fs.unlinkSync(LOCK_FILE); } catch (e) { /* already gone */ }
  }
}

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
  withDbLock(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    data.meta.revision = (data.meta.revision || 0) + 1;
    const json = JSON.stringify(data, null, 2);
    const tmp = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
    let fd = fs.openSync(tmp, 'wx');
    try {
      fs.writeFileSync(fd, json);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    let renamed = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.renameSync(tmp, DB_FILE);
        renamed = true;
        break;
      } catch (err) {
        if (attempt === 4) {
          try { fs.unlinkSync(tmp); } catch (e) { /* already gone */ }
          throw err;
        }
        wait(40);
      }
    }
    if (!renamed) throw new Error('Could not commit database write.');
  });
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
  transaction, revision, withDbLock, DATA_DIR, DB_FILE,
};
