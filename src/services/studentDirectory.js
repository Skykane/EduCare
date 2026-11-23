// Admin-managed Student Directory.
//
// This is the single source of truth for student identity, grade level and
// section. Records live in the main `students` collection in data/db.json, the
// same collection used by public registration, the student dashboard, the
// profile page and session verification. No separate frontend/student database
// is maintained.
const db = require('../db');
const C = require('../constants');
const gradeSections = require('./gradeSections');

const DEFAULT_SCHOOL_YEAR = '2026';
const STATUSES = ['Active', 'Inactive'];
const DEMO_RE = /\bDEMO\b/i;
const STUDENT_ID_RE = /^[A-Z0-9][A-Z0-9._-]{2,49}$/;

function normalizeStudentId(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function normalizeName(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function nameKey(value) {
  return normalizeName(value).toLocaleLowerCase();
}

function clean(value, max = 250) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function statusOf(row) {
  if (!row) return 'Inactive';
  if (row.status === 'Active' || row.status === 'Inactive') return row.status;
  return row.active === false ? 'Inactive' : 'Active';
}

function isActive(row) {
  return statusOf(row) === 'Active';
}

function findById(id) {
  return db.find('students', id);
}

function findByStudentId(studentId) {
  const needle = normalizeStudentId(studentId);
  if (!needle) return null;
  return db.all('students').find((s) => normalizeStudentId(s.studentId) === needle) || null;
}

function findByUserId(userId) {
  if (!userId) return null;
  return db.all('students').find((s) => Number(s.userId) === Number(userId)) || null;
}

function list(filters = {}) {
  const f = filters || {};
  const q = clean(f.q, 100).toLocaleLowerCase();
  const grade = clean(f.gradeLevel, 20);
  const section = clean(f.section, 50).toLocaleLowerCase();
  const status = STATUSES.includes(f.status) ? f.status : '';

  const rows = db.all('students').filter((s) => {
    if (grade && clean(s.gradeLevel, 20) !== grade) return false;
    if (section && clean(s.section, 50).toLocaleLowerCase() !== section) return false;
    if (status && statusOf(s) !== status) return false;
    if (q) {
      const haystack = [
        s.studentId,
        s.fullName,
        s.name,
        s.gradeLevel,
        s.section,
        s.schoolYear,
        s.lrn,
      ]
        .map((v) => String(v == null ? '' : v).toLocaleLowerCase())
        .join(' ');
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return rows.sort((a, b) => {
    const ga = C.STUDENT_GRADE_LEVELS.indexOf(clean(a.gradeLevel, 20));
    const gb = C.STUDENT_GRADE_LEVELS.indexOf(clean(b.gradeLevel, 20));
    if (ga !== gb) return ga - gb;
    const sa = normalizeStudentId(a.studentId);
    const sb = normalizeStudentId(b.studentId);
    return sa.localeCompare(sb, undefined, { numeric: true });
  });
}

// Filters for the admin directory selects. Only configured active sections are
// offered, so directory records cannot drift away from the registration setup.
function filterOptions() {
  return {
    grades: C.STUDENT_GRADE_LEVELS.slice(),
    sections: [...new Set(gradeSections.getGradeSectionOptions().map((o) => o.section))].sort((a, b) =>
      a.localeCompare(b)
    ),
    sectionOptions: gradeSections.getGradeSectionOptions(),
    groupedSectionOptions: gradeSections.getGroupedGradeSectionOptions(),
  };
}

function parseGradeSection(raw) {
  const parsed = gradeSections.parseOptionValue(raw);
  if (parsed) return parsed;
  // Admin forms submit the same combined value used by registration. Legacy
  // separate fields are accepted so saved form state and older links still work.
  return null;
}

function validateRecord(input, excludeId = null) {
  const b = input || {};
  const studentId = normalizeStudentId(b.studentId);
  const fullName = normalizeName(b.fullName || b.name);
  const parsed = parseGradeSection(b.gradeSection);
  const gradeLevel = clean(parsed ? parsed.gradeLevel : b.gradeLevel, 20);
  const section = clean(parsed ? parsed.section : b.section, 50);
  const schoolYear = clean(b.schoolYear || DEFAULT_SCHOOL_YEAR, 20);
  const status = STATUSES.includes(b.status) ? b.status : 'Active';

  if (!studentId) return { error: 'Student ID is required.' };
  if (!STUDENT_ID_RE.test(studentId)) {
    return { error: 'Student ID must be 3-50 letters, numbers, dots, hyphens or underscores.' };
  }
  if (DEMO_RE.test(studentId)) {
    return { error: 'Student ID cannot contain DEMO placeholder text.' };
  }
  if (!fullName) return { error: 'Full name is required.' };
  if (fullName.length > 120) return { error: 'Full name must be 120 characters or fewer.' };
  if (DEMO_RE.test(fullName)) {
    return { error: 'Full name cannot contain DEMO placeholder text.' };
  }
  if (!C.STUDENT_GRADE_LEVELS.includes(gradeLevel)) {
    return { error: 'Select a grade from Grade 7 to Grade 12.' };
  }
  if (!section) return { error: 'Select a Grade & Section option.' };
  if (!gradeSections.getSectionsForGrade(gradeLevel).includes(section)) {
    return { error: `Select an active section configured for ${gradeLevel}.` };
  }
  if (!/^\d{4}(-\d{4})?$/.test(schoolYear)) {
    return { error: 'Academic Year must be a year such as 2026.' };
  }

  const duplicate = findByStudentId(studentId);
  if (duplicate && (excludeId == null || Number(duplicate.id) !== Number(excludeId))) {
    return { error: `Student ID ${studentId} already exists in the Student Directory.` };
  }

  return {
    value: {
      studentId,
      fullName,
      gradeLevel,
      section,
      schoolYear,
      status,
      active: status === 'Active',
      lrn: clean(b.lrn, 50),
      track: clean(b.track, 80),
      email: clean(b.email, 200).toLocaleLowerCase(),
      address: clean(b.address, 250),
    },
  };
}

function recordFromInput(value) {
  return {
    studentId: value.studentId,
    fullName: value.fullName,
    gradeLevel: value.gradeLevel,
    section: value.section,
    schoolYear: value.schoolYear,
    status: value.status,
    active: value.active,
    lrn: value.lrn,
    track: value.track,
    email: value.email,
    address: value.address,
  };
}

// Keep every place that displays student information in agreement with the
// directory. Requests are linked by user ID, so they need no rewrite.
function syncLinkedUser(student, previous = null) {
  if (!student) return [];
  const oldId = normalizeStudentId(previous && previous.studentId);
  const newId = normalizeStudentId(student.studentId);
  const linked = db.all('users').filter((u) => {
    const byId = oldId && normalizeStudentId(u.studentId) === oldId;
    const byNewId = newId && normalizeStudentId(u.studentId) === newId;
    const byRecord = Number(u.directoryRecordId) === Number(student.id);
    return byId || byNewId || byRecord;
  });

  return linked.map((u) => {
    const patch = {
      studentId: newId,
      name: student.fullName,
      directoryRecordId: student.id,
      gradeLevel: student.gradeLevel,
      section: student.section,
      department: `${student.gradeLevel} – ${student.section}`,
    };
    if (student.address) patch.address = student.address;
    return db.update('users', u.id, patch);
  });
}

function add(input) {
  const checked = validateRecord(input);
  if (checked.error) return { ok: false, error: checked.error };
  const row = db.insert('students', recordFromInput(checked.value));
  return { ok: true, row };
}

function update(id, input) {
  const existing = findById(id);
  if (!existing) return { ok: false, error: 'That student record no longer exists.' };
  const checked = validateRecord(input, existing.id);
  if (checked.error) return { ok: false, error: checked.error };

  const nextId = normalizeStudentId(checked.value.studentId);
  const previousId = normalizeStudentId(existing.studentId);
  if (nextId !== previousId) {
    const conflict = db.all('users').find(
      (u) => normalizeStudentId(u.studentId) === nextId && Number(u.directoryRecordId) !== Number(existing.id)
    );
    if (conflict) {
      return { ok: false, error: `Student ID ${nextId} is already linked to another account.` };
    }
  }

  const row = db.update('students', existing.id, recordFromInput(checked.value));
  syncLinkedUser(row, existing);
  return { ok: true, row };
}

function setActive(id, active) {
  const existing = findById(id);
  if (!existing) return { ok: false, error: 'That student record no longer exists.' };
  const status = active ? 'Active' : 'Inactive';
  const row = db.update('students', existing.id, { status, active: !!active });
  return { ok: true, row };
}

function linkAccount(id, user) {
  const student = findById(id);
  if (!student || !user) return null;
  return db.update('students', student.id, {
    userId: user.id,
    accountEmail: clean(user.email, 200).toLocaleLowerCase(),
  });
}

function isStudentIdRegistered(studentId, excludeUserId = null) {
  const needle = normalizeStudentId(studentId);
  if (!needle) return false;
  return db.all('users').some(
    (u) =>
      normalizeStudentId(u.studentId) === needle &&
      (excludeUserId == null || Number(u.id) !== Number(excludeUserId))
  );
}

function accountFor(student) {
  if (!student) return null;
  return (
    db.all('users').find((u) => Number(u.directoryRecordId) === Number(student.id)) ||
    (student.userId ? db.find('users', student.userId) : null) ||
    db.all('users').find((u) => normalizeStudentId(u.studentId) === normalizeStudentId(student.studentId)) ||
    null
  );
}

module.exports = {
  DEFAULT_SCHOOL_YEAR,
  STATUSES,
  normalizeStudentId,
  normalizeName,
  nameKey,
  statusOf,
  isActive,
  findById,
  findByStudentId,
  findByUserId,
  list,
  filterOptions,
  validateRecord,
  add,
  update,
  setActive,
  linkAccount,
  isStudentIdRegistered,
  accountFor,
  syncLinkedUser,
};
