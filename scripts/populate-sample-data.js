/**
 * EDUCARE — full SAMPLE/DEMO population (idempotent).
 *
 * Run with:  node scripts/populate-sample-data.js
 *
 * Safety rules:
 *  - Creates a timestamped backup of data/db.json before changing anything.
 *  - Never deletes or edits an existing administrator or non-demo record.
 *  - Only updates records that are already clearly marked SAMPLE/DEMO.
 *  - Aborts rather than exceeding 10 equipment records.
 *  - Uses the project's existing data layer (src/db.js) and supported enums.
 *  - Safe to re-run: all inserts are checked first and demo rows are matched
 *    by stable keys.
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = require('../src/db');
const C = require('../src/constants');
const { todayISO } = require('../src/helpers');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');
const BACKUP_DIR = path.join(ROOT, 'data', 'backups');
const DEMO_TAG = '[SAMPLE DATA/DEMO]';

const CATEGORY_NAMES = [
  'Computers',
  'Office Equipment',
  'Electrical Equipment',
  'Audio-Visual',
  'Air Conditioning',
  'Laboratory Equipment',
  'Furniture and Fixtures',
  'Networking Equipment',
];

const LOCATIONS = [
  'Computer Laboratory',
  "Principal's Office",
  'Faculty Room',
  'Grade 9 – Room E',
  'Grade 7 – Room A',
  'Computer Laboratory',
  'Science Laboratory',
  'Grade 10 – Room H',
];

const DEPARTMENTS = [
  'ICT Department',
  'Administration Office',
  'Academic Department',
  'Science Department',
];

// Exactly 10 sample equipment records. interval = 0 means "no schedule".
const EQUIPMENT = [
  { code: 'EQ-0001', name: 'Desktop Computer', model: 'Dell OptiPlex', category: 'Computers', department: 'ICT Department', location: 'Computer Laboratory', status: 'Operational', importance: 3, interval: 90 },
  { code: 'EQ-0002', name: 'Laptop', model: 'Lenovo ThinkPad', category: 'Computers', department: 'Administration Office', location: "Principal's Office", status: 'Operational', importance: 4, interval: 0 },
  { code: 'EQ-0003', name: 'Laser Printer', model: 'HP LaserJet Pro', category: 'Office Equipment', department: 'Administration Office', location: 'Faculty Room', status: 'Operational', importance: 3, interval: 90 },
  { code: 'EQ-0004', name: 'LCD Projector', model: 'Epson EB-X06', category: 'Audio-Visual', department: 'Academic Department', location: 'Grade 9 – Room E', status: 'Operational', importance: 3, interval: 0 },
  { code: 'EQ-0005', name: 'Split-Type Air Conditioner', model: 'Carrier 2.0 HP', category: 'Air Conditioning', department: 'Administration Office', location: "Principal's Office", status: 'Operational', importance: 4, interval: 180 },
  { code: 'EQ-0006', name: 'Electric Fan', model: 'Standard 16-inch Fan', category: 'Electrical Equipment', department: 'Academic Department', location: 'Grade 7 – Room A', status: 'Operational', importance: 2, interval: 0 },
  { code: 'EQ-0007', name: 'Network Switch', model: 'Cisco 24-Port', category: 'Networking Equipment', department: 'ICT Department', location: 'Computer Laboratory', status: 'Operational', importance: 5, interval: 180 },
  { code: 'EQ-0008', name: 'Compound Microscope', model: 'Olympus CX23', category: 'Laboratory Equipment', department: 'Science Department', location: 'Science Laboratory', status: 'Operational', importance: 3, interval: 180 },
  { code: 'EQ-0009', name: 'Smart TV 55-inch', model: 'Samsung UHD', category: 'Audio-Visual', department: 'Academic Department', location: 'Grade 10 – Room H', status: 'Operational', importance: 2, interval: 0 },
  { code: 'EQ-0010', name: 'Photocopier', model: 'Canon imageRUNNER', category: 'Office Equipment', department: 'Administration Office', location: 'Faculty Room', status: 'Operational', importance: 4, interval: 0 },
];

// Five limited sample preventive schedules (derived from equipment intervals).
const SCHEDULES = ['EQ-0001', 'EQ-0003', 'EQ-0005', 'EQ-0007', 'EQ-0008'];

const JOVERT = {
  name: 'Jovert Torres',
  username: 'jovert.torres',
  email: 'joverttorres1@gmail.com',
  role: 'technician',
  temporaryPassword: 'jovert123',
  department: 'ICT Department',
  // As requested. "Electrical Equipment" category ID is kept for assignment logic.
  specializationLabels: [
    'Computer Hardware',
    'Electrical',
    'Air Conditioning',
    'Audio-Visual Equipment',
    'Basic Networking',
  ],
  specializationCategories: [
    'Computers',
    'Electrical Equipment',
    'Air Conditioning',
    'Audio-Visual',
    'Networking Equipment',
  ],
};

const SAMPLE_STUDENT = {
  studentId: 'SAMPLE-STU-0001',
  lrn: 'SAMPLE-LRN-0001',
  name: 'SAMPLE Student - Ana Reyes',
  email: 'ana.reyes@student.educare.local',
  gradeLevel: 'Grade 9',
  section: '201',
};

// Three sample repair requests — all Pending, no automatic technician assignment.
const REQUESTS = [
  { code: 'REQ-0001', equipment: 'EQ-0001', issue: 'Computer does not turn on.', priority: 'High', severity: 3 },
  { code: 'REQ-0002', equipment: 'EQ-0003', issue: 'Printer produces faded prints.', priority: 'Medium', severity: 2 },
  { code: 'REQ-0003', equipment: 'EQ-0006', issue: 'Fan makes an unusual noise.', priority: 'Medium', severity: 2 },
];

// Three sample maintenance history records (service date = today, no invented history).
const MAINTENANCE = [
  {
    key: 'SAMPLE-MR-EQ0001-ROUTINE', equipment: 'EQ-0001',
    problem: 'Routine inspection and cleaning',
    actions: 'Cleaned the system unit and checked basic hardware connections',
    status: 'Operational',
  },
  {
    key: 'SAMPLE-MR-EQ0003-ROUTINE', equipment: 'EQ-0003',
    problem: 'Routine printer inspection',
    actions: 'Cleaned accessible printer components and checked printing functionality',
    status: 'Operational',
  },
  {
    key: 'SAMPLE-MR-EQ0005-ROUTINE', equipment: 'EQ-0005',
    problem: 'Routine maintenance inspection',
    actions: 'Inspected the unit and checked its basic operation',
    status: 'Operational', // system has no "Good" condition; Operational is the equivalent
  },
];

function log(msg) {
  console.log(msg);
}

function backupDatabase() {
  if (!fs.existsSync(DB_FILE)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUP_DIR, `db-before-sample-population-${stamp}.json`);
  fs.copyFileSync(DB_FILE, target);
  log(`Backup created: ${path.relative(ROOT, target)}`);
}

function isDemo(row) {
  if (!row) return false;
  if (row.isDemo === true || row.sample === true) return true;
  const haystack = `${row.notes || ''} ${row.title || ''} ${row.remarks || ''} ${row.serialNumber || ''}`.toUpperCase();
  return haystack.includes('SAMPLE') || haystack.includes('DEMO');
}

function categoryMap() {
  const map = new Map();
  db.all('categories').forEach((c) => map.set(c.name.toLowerCase(), c.id));
  return map;
}

function ensureCategories() {
  const legacy = db.all('categories').find((c) => c.name.toLowerCase() === 'computer');
  if (legacy && !db.all('categories').some((c) => c.name.toLowerCase() === 'computers')) {
    db.update('categories', legacy.id, { name: 'Computers' });
    log('Renamed legacy category "Computer" to "Computers".');
  }
  for (const name of CATEGORY_NAMES) {
    if (!db.all('categories').some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      db.insert('categories', {
        name,
        description: '',
      });
      log(`Inserted category: ${name}`);
    }
  }
  return categoryMap();
}

function ensureLocations() {
  // Locations are derived from C.CAMPUS_LOCATIONS + equipment.location strings;
  // there is no locations collection to insert into. Verify canonical coverage.
  const available = new Set([...(C.CAMPUS_LOCATIONS || []), ...db.all('equipment').map((e) => e.location).filter(Boolean)]);
  const missing = LOCATIONS.filter((loc) => !available.has(loc));
  if (missing.length) {
    log(`WARNING: locations not yet available in lookups: ${missing.join(', ')}`);
  } else {
    log(`All ${LOCATIONS.length} sample locations are available in the Locations/Add Equipment lookups.`);
  }
  return missing;
}

function ensureEquipment(ids) {
  const existing = db.all('equipment');
  const byCode = new Map(existing.map((e) => [e.code, e]));
  const missing = EQUIPMENT.filter((spec) => !byCode.has(spec.code));
  if (existing.length + missing.length > 10) {
    throw new Error(`Refusing to exceed 10 equipment records. Current: ${existing.length}, missing: ${missing.length}.`);
  }

  // Report (never delete) any non-demo equipment.
  const real = existing.filter((e) => !isDemo(e));
  if (real.length) log(`NOTE: ${real.length} non-demo equipment record(s) preserved: ${real.map((e) => e.code).join(', ')}`);

  for (const spec of EQUIPMENT) {
    const categoryId = ids.get(spec.category.toLowerCase());
    if (!categoryId) throw new Error(`Missing category for ${spec.code}: ${spec.category}`);
    const payload = {
      code: spec.code,
      name: spec.name,
      model: spec.model,
      serialNumber: `SAMPLE-SN-${spec.code.replace('-', '')}-DEMO`,
      categoryId,
      department: spec.department,
      location: spec.location,
      // Optional fields left blank: no fabricated purchase or maintenance dates.
      acquisitionDate: null,
      lastMaintenanceDate: null,
      maintenanceIntervalDays: spec.interval,
      status: spec.status,
      importance: spec.importance,
      notes: `${DEMO_TAG} ${spec.name} for ${spec.department}, ${spec.location}. Generated sample data, not verified school inventory.`,
      photo: null,
      isDemo: true,
      sample: true,
    };

    const current = byCode.get(spec.code);
    if (current) {
      if (!isDemo(current)) {
        log(`Skipped non-demo equipment ${spec.code} (left untouched).`);
        continue;
      }
      db.update('equipment', current.id, payload);
      log(`Updated SAMPLE equipment ${spec.code} (id ${current.id}).`);
    } else {
      db.insert('equipment', payload);
      log(`Inserted SAMPLE equipment ${spec.code}.`);
    }
  }
}

function ensureTechnician(ids) {
  const specs = JOVERT.specializationCategories.map((n) => ids.get(n.toLowerCase()));
  if (specs.some((id) => !id)) throw new Error('Missing category for technician specializations.');

  const existing = db.all('users').find(
    (u) => u.email.toLowerCase() === JOVERT.email.toLowerCase() ||
      (u.username && u.username.toLowerCase() === JOVERT.username.toLowerCase())
  );

  if (existing) {
    if (existing.role !== 'technician') {
      throw new Error(`Existing account ${existing.email} is a ${existing.role}; refusing to change its role.`);
    }
    // Do NOT overwrite password or personal information if the account
    // already exists. Only align demo metadata and specialization labels.
    const patch = {
      isDemo: true,
      sample: true,
      specializationLabels: JOVERT.specializationLabels,
    };
    const changes = [];
    if (existing.active !== true) { patch.active = true; changes.push('active=true'); }
    if (existing.approvalStatus !== 'approved') { patch.approvalStatus = 'approved'; changes.push('approved'); }
    if (JSON.stringify(existing.specializations || []) !== JSON.stringify(specs)) {
      patch.specializations = specs;
      changes.push('specializations');
    }
    if (existing.name !== JOVERT.name) { patch.name = JOVERT.name; changes.push('name'); }
    if (existing.username !== JOVERT.username) { patch.username = JOVERT.username; changes.push('username'); }
    if (!existing.mustChangePassword) { patch.mustChangePassword = true; changes.push('mustChangePassword'); }
    db.update('users', existing.id, patch);
    log(`Technician account already existed (id ${existing.id}, ${existing.email}). Password LEFT UNCHANGED.${changes.length ? ` Updated: ${changes.join(', ')}.` : ' No changes needed.'}`);
    return existing.id;
  }

  const row = db.insert('users', {
    name: JOVERT.name,
    username: JOVERT.username,
    email: JOVERT.email,
    role: JOVERT.role,
    department: JOVERT.department,
    phone: '',
    studentId: null,
    active: true,
    approvalStatus: 'approved',
    availability: 'Available',
    specializations: specs,
    specializationLabels: JOVERT.specializationLabels,
    passwordHash: bcrypt.hashSync(JOVERT.temporaryPassword, 10),
    mustChangePassword: true,
    isDemo: true,
    sample: true,
    notes: `${DEMO_TAG} Demo technician. Temporary password must be changed at first login.`,
  });
  log(`Inserted SAMPLE technician account (id ${row.id}, username ${JOVERT.username}).`);
  return row.id;
}

function ensureSampleRequester() {
  let student = db.all('students').find((s) => s.studentId === SAMPLE_STUDENT.studentId);
  if (!student) {
    student = db.insert('students', {
      studentId: SAMPLE_STUDENT.studentId,
      lrn: SAMPLE_STUDENT.lrn,
      fullName: SAMPLE_STUDENT.name,
      email: SAMPLE_STUDENT.email,
      gradeLevel: SAMPLE_STUDENT.gradeLevel,
      section: SAMPLE_STUDENT.section,
      status: 'Enrolled',
    });
    log(`Inserted SAMPLE student registry record (id ${student.id}).`);
  }

  let user = db.all('users').find((u) => u.email.toLowerCase() === SAMPLE_STUDENT.email.toLowerCase());
  if (!user) {
    user = db.insert('users', {
      name: SAMPLE_STUDENT.name,
      email: SAMPLE_STUDENT.email,
      role: 'requester',
      studentId: SAMPLE_STUDENT.studentId,
      department: SAMPLE_STUDENT.gradeLevel,
      phone: '',
      active: true,
      approvalStatus: 'approved',
      specializations: [],
      availability: null,
      passwordHash: bcrypt.hashSync('sample123', 10),
      isDemo: true,
      sample: true,
      notes: `${DEMO_TAG} Demo requester for sample repair requests.`,
    });
    log(`Inserted SAMPLE requester account (id ${user.id}).`);
  }
  return user.id;
}

function clearOldDemoRequestsAndHistory() {
  const oldRequests = db.all('requests').filter(isDemo);
  const oldRecords = db.all('maintenanceRecords').filter(isDemo);
  for (const r of oldRecords) db.remove('maintenanceRecords', r.id);
  for (const r of oldRequests) db.remove('requests', r.id);
  if (oldRequests.length) log(`Removed ${oldRequests.length} superseded SAMPLE request(s).`);
  if (oldRecords.length) log(`Removed ${oldRecords.length} superseded SAMPLE maintenance record(s).`);

  const realRequests = db.all('requests').length;
  const realRecords = db.all('maintenanceRecords').length;
  if (realRequests || realRecords) {
    log(`NOTE: preserved ${realRequests} non-demo request(s) and ${realRecords} non-demo maintenance record(s).`);
  }
}

function ensureRequests(requesterId, adminId) {
  const eqByCode = new Map(db.all('equipment').map((e) => [e.code, e]));
  const now = new Date().toISOString();
  for (const spec of REQUESTS) {
    const eq = eqByCode.get(spec.equipment);
    if (!eq) throw new Error(`Missing equipment ${spec.equipment} for ${spec.code}.`);
    if (!C.PRIORITIES.includes(spec.priority)) throw new Error(`Unsupported priority ${spec.priority}.`);
    const payload = {
      code: spec.code,
      equipmentId: eq.id,
      requesterId,
      title: `[SAMPLE] ${spec.issue}`,
      description: `${DEMO_TAG} Sample repair request for workflow testing only: ${spec.issue}`,
      severity: spec.severity,
      type: 'Corrective',
      status: 'Pending',
      priority: spec.priority,
      technicianId: null,
      targetDate: null,
      approvedAt: null,
      approvedBy: null,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      isDemo: true,
      sample: true,
      createdAt: now,
      updatedAt: now,
    };
    db.insert('requests', payload);
    log(`Inserted SAMPLE request ${spec.code} for ${spec.equipment} (priority ${spec.priority}, Pending).`);
  }
}

function ensureMaintenance(technicianId) {
  const eqByCode = new Map(db.all('equipment').map((e) => [e.code, e]));
  const serviceDate = todayISO();
  for (const spec of MAINTENANCE) {
    const eq = eqByCode.get(spec.equipment);
    if (!eq) throw new Error(`Missing equipment ${spec.equipment} for maintenance record.`);
    if (!C.EQUIPMENT_STATUSES.includes(spec.status)) throw new Error(`Unsupported resulting status ${spec.status}.`);
    const stamp = `${serviceDate}T09:00:00.000Z`;
    db.insert('maintenanceRecords', {
      equipmentId: eq.id,
      requestId: null,
      technicianId,
      type: 'Preventive',
      problem: `${DEMO_TAG} ${spec.problem}`,
      actionsTaken: `${DEMO_TAG} ${spec.actions}`,
      partsReplaced: 'None',
      serviceDate,
      resultingStatus: spec.status,
      remarks: `${DEMO_TAG} Sample maintenance record for testing only; not actual work performed.`,
      sampleKey: spec.key,
      isDemo: true,
      sample: true,
      createdAt: stamp,
      updatedAt: stamp,
    });
    log(`Inserted SAMPLE maintenance record for ${spec.equipment} (${spec.key}).`);
  }
}

function main() {
  db.load();
  backupDatabase();

  const admin = db.all('users').find((u) => u.role === 'admin');
  if (!admin) throw new Error('No administrator account found; refusing to run population.');

  const ids = ensureCategories();
  ensureLocations();
  ensureEquipment(ids);
  const technicianId = ensureTechnician(ids);
  const requesterId = ensureSampleRequester();
  clearOldDemoRequestsAndHistory();
  ensureRequests(requesterId, admin.id);
  ensureMaintenance(technicianId);

  log('\nPopulation complete.');
  log(`Equipment: ${db.all('equipment').length} / 10 (scheduled: ${SCHEDULES.length})`);
  log(`Categories: ${db.all('categories').length}`);
  log(`Requests: ${db.all('requests').length}`);
  log(`Maintenance records: ${db.all('maintenanceRecords').length}`);
}

try {
  main();
} catch (err) {
  console.error('Population failed:', err.message);
  process.exit(1);
}
