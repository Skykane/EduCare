// Seeds the official 2026 Student Directory into the shared data/db.json
// collection. Exported so verification harnesses can seed isolated copies of
// the database; running it directly applies the seed to process.env.DATA_DIR
// (default: the live data directory).
const fs = require('fs');
const path = require('path');

const SECTION_PAIRS = [
  ['Grade 7', 'Room A'],
  ['Grade 7', 'Room B'],
  ['Grade 8', 'Room C'],
  ['Grade 8', 'Room D'],
  ['Grade 9', 'Room E'],
  ['Grade 9', 'Room F'],
  ['Grade 10', 'Room G'],
  ['Grade 10', 'Room H'],
  ['Grade 11', 'ICT'],
  ['Grade 11', 'STEM'],
  ['Grade 12', 'ICT'],
  ['Grade 12', 'STEM'],
];

const STUDENT_SEED = [
  ['STU-2026-0001', 'Adrian Santos', 'Grade 7', 'Room A'],
  ['STU-2026-0002', 'Bianca Reyes', 'Grade 7', 'Room B'],
  ['STU-2026-0003', 'Carlo Mendoza', 'Grade 8', 'Room C'],
  ['STU-2026-0004', 'Dana Garcia', 'Grade 8', 'Room D'],
  ['STU-2026-0005', 'Ethan Cruz', 'Grade 9', 'Room E'],
  ['STU-2026-0006', 'Faith Navarro', 'Grade 9', 'Room F'],
  ['STU-2026-0007', 'Gabriel Torres', 'Grade 10', 'Room G'],
  ['STU-2026-0008', 'Hannah Flores', 'Grade 10', 'Room H'],
  ['STU-2026-0009', 'Ian Castillo', 'Grade 11', 'ICT'],
  ['STU-2026-0010', 'Jasmine Ramos', 'Grade 11', 'STEM'],
  ['STU-2026-0011', 'Kyle Bautista', 'Grade 12', 'ICT'],
  ['STU-2026-0012', 'Lara Villanueva', 'Grade 12', 'STEM'],
  ['STU-2026-0013', 'Irish Kane Joyce Patac', 'Grade 8', 'Room C'],
];

const LEGACY_STUDENT_IDS = {
  'SAMPLE-STU-0001': 'STU-2026-0001',
};

const SAMPLE_USER_EMAIL = 'ana.reyes@student.educare.local';
const ADRIAN_EMAIL = 'adrian.santos@student.educare.local';

function normalized(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function sectionKey(grade, section) {
  return normalized(grade) + '|' + normalized(section);
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
}

function seedDatabase(db) {
  const now = new Date().toISOString();
  db.meta = db.meta || {};
  db.meta.counters = db.meta.counters || {};

  // ---------- Grade & Section options ----------
  const oldSections = new Map(
    (db.gradeSections || []).map((row) => [sectionKey(row.gradeLevel, row.section), row])
  );
  db.gradeSections = SECTION_PAIRS.map(([gradeLevel, section], index) => {
    const old = oldSections.get(sectionKey(gradeLevel, section));
    return {
      id: index + 1,
      createdAt: (old && old.createdAt) || now,
      updatedAt: now,
      gradeLevel,
      section,
      active: true,
    };
  });
  db.meta.counters.gradeSections = db.gradeSections.length;

  // ---------- Student Directory records ----------
  const oldStudents = new Map(
    (db.students || []).map((row) => [normalized(LEGACY_STUDENT_IDS[row.studentId] || row.studentId), row])
  );
  db.students = STUDENT_SEED.map(([studentId, fullName, gradeLevel, section], index) => {
    const old = oldStudents.get(normalized(studentId));
    const record = {
      id: old && Number.isInteger(old.id) ? old.id : index + 1,
      createdAt: (old && old.createdAt) || now,
      updatedAt: now,
      studentId,
      fullName,
      gradeLevel,
      section,
      schoolYear: '2026',
      status: 'Active',
      active: true,
      lrn: `LRN-2026-${String(index + 1).padStart(4, '0')}`,
      track: section === 'ICT' || section === 'STEM' ? section : 'General',
      // Preserve an explicitly cleared directory email (for example a student
      // who will supply their own login email) instead of regenerating one.
      email: old && Object.prototype.hasOwnProperty.call(old, 'email')
        ? old.email
        : `${slug(fullName)}@student.educare.local`,
      address: old && old.address && !/sample|demo/i.test(old.address) ? old.address : '',
    };
    if (old && old.userId) record.userId = old.userId;
    if (old && Object.prototype.hasOwnProperty.call(old, 'accountEmail')) {
      record.accountEmail = old.accountEmail;
    }
    return record;
  });
  db.meta.counters.students = Math.max(...db.students.map((s) => s.id));

  // ---------- Repurpose the existing sample requester account ----------
  const legacyUser = (db.users || []).find(
    (u) =>
      u.role === 'requester' &&
      (u.id === 3 ||
        normalized(u.studentId) === 'SAMPLE-STU-0001' ||
        String(u.email || '').toLowerCase() === SAMPLE_USER_EMAIL)
  );
  const adrian = db.students.find((s) => s.studentId === 'STU-2026-0001');
  if (legacyUser && adrian) {
    legacyUser.name = 'Adrian Santos';
    legacyUser.email = ADRIAN_EMAIL;
    legacyUser.studentId = adrian.studentId;
    legacyUser.directoryRecordId = adrian.id;
    legacyUser.gradeLevel = adrian.gradeLevel;
    legacyUser.section = adrian.section;
    legacyUser.department = `${adrian.gradeLevel} – ${adrian.section}`;
    legacyUser.active = true;
    legacyUser.approvalStatus = 'approved';
    delete legacyUser.isDemo;
    delete legacyUser.sample;
    delete legacyUser.notes;
    delete legacyUser.studentEmail;
    adrian.userId = legacyUser.id;
    adrian.accountEmail = legacyUser.email;
  }

  // Any other linked accounts get their identity synchronized from the directory.
  for (const user of db.users || []) {
    if (!user || (user.role && user.role !== 'requester')) continue;
    const record = db.students.find(
      (s) =>
        Number(s.userId) === Number(user.id) ||
        Number(user.directoryRecordId) === Number(s.id) ||
        normalized(s.studentId) === normalized(user.studentId)
    );
    if (!record) continue;
    user.studentId = record.studentId;
    user.directoryRecordId = record.id;
    user.name = record.fullName;
    user.gradeLevel = record.gradeLevel;
    user.section = record.section;
    user.department = `${record.gradeLevel} – ${record.section}`;
    user.active = true;
    user.approvalStatus = 'approved';
    record.userId = user.id;
    record.accountEmail = user.email;
  }

  return db;
}

function applyToDirectory(dataDir) {
  const dbFile = path.join(dataDir, 'db.json');
  const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  const seeded = seedDatabase(raw);
  fs.writeFileSync(dbFile, JSON.stringify(seeded, null, 2));
  return seeded;
}

module.exports = { SECTION_PAIRS, STUDENT_SEED, seedDatabase, applyToDirectory };

if (require.main === module) {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const seeded = applyToDirectory(dataDir);
  console.log(
    `Seeded ${seeded.students.length} Student Directory records and ${seeded.gradeSections.length} Grade & Section options into ${path.join(dataDir, 'db.json')}`
  );
}
