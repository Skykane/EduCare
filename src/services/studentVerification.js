// Service to verify member IDs against the institution's official member registry.
// Registry records are loaded from an external JSON file so real data can be
// entered without editing code. No sample members are generated here.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const studentDirectory = require('./studentDirectory');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const REGISTRY_FILE = process.env.OFFICIAL_STUDENTS_FILE || path.join(DATA_DIR, 'official-students.json');

function normalizeId(str) {
  return studentDirectory.normalizeStudentId(str);
}

function normalizeFullName(str) {
  return studentDirectory.normalizeName(str);
}

// Full names are matched after trimming/collapsing whitespace and ignoring
// letter case. The stored directory spelling is always what gets displayed.
function fullNameMatches(left, right) {
  return studentDirectory.nameKey(left) === studentDirectory.nameKey(right);
}

// Reads the official member registry from disk on every call so updates to the
// file take effect immediately. A missing or empty file means no members yet.
function getOfficialMembers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Could not read official student registry (${REGISTRY_FILE}):`, err.message);
    }
    return [];
  }
}

/**
 * Keeps the students collection in sync with the official registry and links
 * requester accounts to their member record when their email matches.
 */
function ensureStudentsDatabase() {
  const official = getOfficialMembers();
  if (!official.length) return;

  const current = db.all('students') || [];
  if (!current.length) {
    for (const s of official) {
      db.insert('students', s);
    }
  } else {
    // Sync any missing fields into existing records and add newly listed members.
    for (const ref of official) {
      const existing = current.find((s) => normalizeId(s.studentId) === normalizeId(ref.studentId));
      if (existing) {
        const patch = {};
        if (!existing.address && ref.address) patch.address = ref.address;
        if (!existing.schoolYear && ref.schoolYear) patch.schoolYear = ref.schoolYear;
        if (!existing.gradeLevel && ref.gradeLevel) patch.gradeLevel = ref.gradeLevel;
        if (!existing.section && ref.section) patch.section = ref.section;
        if (Object.keys(patch).length > 0) {
          db.update('students', existing.id, patch);
        }
      } else {
        db.insert('students', ref);
      }
    }
  }

  // Link existing requester accounts by email when no member ID is set yet.
  const users = db.all('users');
  for (const u of users) {
    if (u.role !== 'requester' || u.accountKind === 'teacher' || u.studentId || !u.email) continue;
    const match = official.find(
      (s) => String(s.email || '').toLowerCase() === String(u.email).toLowerCase()
    );
    if (!match) continue;
    const patch = { studentId: match.studentId };
    if (!u.address && match.address) patch.address = match.address;
    db.update('users', u.id, patch);
    Object.assign(u, patch);
  }
}

/**
 * Find an official member by ID or LRN.
 */
function findOfficialStudent(identifier) {
  ensureStudentsDatabase();
  const norm = normalizeId(identifier);
  if (!norm) return null;
  const list = db.all('students') || [];
  return (
    list.find((s) => {
      const sId = normalizeId(s.studentId);
      const sLrn = normalizeId(s.lrn);
      return sId === norm || sLrn === norm;
    }) || null
  );
}

/**
 * Verifies a Student ID (optionally with the entered full name) against the
 * Admin-managed Student Directory. The directory is the same `students`
 * collection used everywhere else in EduCare.
 *
 * Returns { allowed: boolean, reason?: string, student?: object }
 */
function verifyStudentRegistration(identifier, fullName) {
  ensureStudentsDatabase();
  const norm = normalizeId(identifier);
  if (!norm) {
    return {
      allowed: false,
      reason: 'Student ID is required. Enter the Student ID from the school directory.',
      student: null,
    };
  }

  const student = findOfficialStudent(norm);
  if (!student) {
    return {
      allowed: false,
      reason: 'Student ID not found. This ID does not exist in the Student Directory.',
      student: null,
    };
  }

  // A name is supplied by public registration. Session/login checks call this
  // with only the ID, so name checking stays optional for those callers.
  if (fullName !== undefined && fullName !== null) {
    const entered = normalizeFullName(fullName);
    const stored = normalizeFullName(student.fullName || student.name);
    if (!entered) {
      return {
        allowed: false,
        reason: 'Full Name is required for student registration.',
        student,
      };
    }
    if (!fullNameMatches(entered, stored)) {
      return {
        allowed: false,
        reason: 'Full Name does not match the Student Directory record for this Student ID.',
        student,
      };
    }
  }

  const status = studentDirectory.statusOf(student);
  const legacyActive = status === 'Enrolled' || status === 'Registered';
  if (status !== 'Active' && !legacyActive) {
    return {
      allowed: false,
      reason: `This student record is ${status}. Only active Student Directory records can register or sign in.`,
      student,
    };
  }

  return {
    allowed: true,
    student,
  };
}

module.exports = {
  normalizeId,
  normalizeFullName,
  fullNameMatches,
  findOfficialStudent,
  verifyStudentRegistration,
  ensureStudentsDatabase,
  getOfficialMembers,
};
