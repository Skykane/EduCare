// Service to verify Student ID against the school's official student database.
// St. Anthony Center of Science and Technology, Inc. - High School Student Registry
const db = require('../db');

function normalizeId(str) {
  if (!str) return '';
  return String(str).trim().toUpperCase();
}

// Initial official registered high school student roster
const OFFICIAL_HIGH_SCHOOL_STUDENTS = [
  {
    studentId: '2024-00101',
    lrn: '109283746501',
    fullName: 'Nicole Santos',
    email: 'nicole@educare.com',
    gradeLevel: 'Grade 12',
    section: 'STEM A',
    track: 'Academic - STEM',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '142 San Agustin St., Brgy. De La Paz, Pasig City',
  },
  {
    studentId: '2024-00102',
    lrn: '109283746502',
    fullName: 'Jessie Reyes',
    email: 'jessie@gmail.com',
    gradeLevel: 'Grade 11',
    section: 'TVL-ICT',
    track: 'TVL - Information & Communications Tech',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: 'Blk 5 Lot 18, Dahlia St., Phase 2, Binangonan, Rizal',
  },
  {
    studentId: '2024-00103',
    lrn: '109283746503',
    fullName: 'Ana Garcia',
    email: 'ana@educare.local',
    gradeLevel: 'Grade 12',
    section: 'TVL-ICT',
    track: 'TVL - Information & Communications Tech',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '77 F. Manalo St., Brgy. Bambang, Pasig City',
  },
  {
    studentId: '2024-00104',
    lrn: '109283746504',
    fullName: 'Jose Ramos',
    email: 'jose@educare.local',
    gradeLevel: 'Grade 11',
    section: 'STEM B',
    track: 'Academic - STEM',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '23 Mabini St., Brgy. Kapasigan, Pasig City',
  },
  {
    studentId: '2024-00105',
    lrn: '109283746505',
    fullName: 'Mark Angelo Dalisay',
    email: 'mark.dalisay@sacst.edu.ph',
    gradeLevel: 'Grade 12',
    section: 'STEM A',
    track: 'Academic - STEM',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '88 J.P. Rizal St., Brgy. San Roque, Antipolo City',
  },
  {
    studentId: '2024-00106',
    lrn: '109283746506',
    fullName: 'Maria Kristina Cruz',
    email: 'kristina.cruz@sacst.edu.ph',
    gradeLevel: 'Grade 11',
    section: 'ABM 1',
    track: 'Academic - Accountancy & Business',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '12 Emerald Ave., Ortigas Center, Pasig City',
  },
  {
    studentId: '2024-00107',
    lrn: '109283746507',
    fullName: 'Christian Paul Reyes',
    email: 'paul.reyes@sacst.edu.ph',
    gradeLevel: 'Grade 12',
    section: 'TVL-ICT',
    track: 'TVL - Information & Communications Tech',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '45 Mercedes Ave., San Miguel, Pasig City',
  },
  {
    studentId: '2024-00108',
    lrn: '109283746508',
    fullName: 'Patricia May Mendoza',
    email: 'patricia.m@sacst.edu.ph',
    gradeLevel: 'Grade 11',
    section: 'HUMSS A',
    track: 'Academic - Humanities & Social Sciences',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '109 A. Mabini St., Maybunga, Pasig City',
  },
  {
    studentId: '2024-00109',
    lrn: '109283746509',
    fullName: 'John David Bautista',
    email: 'david.b@sacst.edu.ph',
    gradeLevel: 'Grade 10',
    section: 'St. Anthony',
    track: 'Junior High School',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '56 C. Raymundo Ave., Rosario, Pasig City',
  },
  {
    studentId: '2024-00110',
    lrn: '109283746510',
    fullName: 'Bea Althea Soriano',
    email: 'bea.soriano@sacst.edu.ph',
    gradeLevel: 'Grade 12',
    section: 'STEM B',
    track: 'Academic - STEM',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '34 Shaw Blvd., Kapitolyo, Pasig City',
  },
  {
    studentId: '2024-00111',
    lrn: '109283746511',
    fullName: 'Daniel Padilla',
    email: 'daniel.p@sacst.edu.ph',
    gradeLevel: 'Grade 11',
    section: 'TVL-ICT',
    track: 'TVL - Information & Communications Tech',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '19 Caruncho Ave., Malinao, Pasig City',
  },
  {
    studentId: '2024-00112',
    lrn: '109283746512',
    fullName: 'Angel Locsin',
    email: 'angel.l@sacst.edu.ph',
    gradeLevel: 'Grade 12',
    section: 'HUMSS B',
    track: 'Academic - Humanities & Social Sciences',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '82 Ortigas Ave. Ext., Cainta, Rizal',
  },
  {
    studentId: '2024-00113',
    lrn: '109283746513',
    fullName: 'Joshua Garcia',
    email: 'joshua.g@sacst.edu.ph',
    gradeLevel: 'Grade 11',
    section: 'STEM A',
    track: 'Academic - STEM',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '15 Marcos Highway, Santolan, Pasig City',
  },
  {
    studentId: '2024-00114',
    lrn: '109283746514',
    fullName: 'Kathryn Bernardo',
    email: 'kathryn.b@sacst.edu.ph',
    gradeLevel: 'Grade 12',
    section: 'ABM 1',
    track: 'Academic - Accountancy & Business',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '27 Amang Rodriguez Ave., Manggahan, Pasig City',
  },
  {
    studentId: '2024-00115',
    lrn: '109283746515',
    fullName: 'Alden Richards',
    email: 'alden.r@sacst.edu.ph',
    gradeLevel: 'Grade 10',
    section: 'St. Lorenzo Ruiz',
    track: 'Junior High School',
    status: 'Enrolled',
    schoolYear: '2024-2025',
    address: '63 Sandoval Ave., Pinagbuhatan, Pasig City',
  },
  // Inactive / Withdrawn record for testing denial of non-enrolled status
  {
    studentId: '2023-00099',
    lrn: '109283746599',
    fullName: 'Sample Withdrawn Student',
    email: 'withdrawn@sacst.edu.ph',
    gradeLevel: 'Grade 10',
    section: 'Transferred',
    track: 'Junior High School',
    status: 'Withdrawn',
    schoolYear: '2023-2024',
    address: '99 Transferred St., City',
  },
];

/**
 * Ensures the official students collection in db.json is populated.
 */
function ensureStudentsDatabase() {
  const current = db.all('students');
  if (!current || current.length === 0) {
    for (const s of OFFICIAL_HIGH_SCHOOL_STUDENTS) {
      db.insert('students', s);
    }
  } else {
    // Sync any missing fields like address or schoolYear into existing records
    for (const ref of OFFICIAL_HIGH_SCHOOL_STUDENTS) {
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

  // Ensure existing requester accounts have their studentId linked and initial address
  const emailToId = {
    'nicole@educare.com': '2024-00101',
    'jessie@gmail.com': '2024-00102',
    'ana@educare.local': '2024-00103',
    'jose@educare.local': '2024-00104',
  };

  const users = db.all('users');
  for (const u of users) {
    if (u.role === 'requester') {
      const assignedId = u.studentId || emailToId[u.email.toLowerCase()];
      if (assignedId) {
        const stud = (db.all('students') || []).find((s) => normalizeId(s.studentId) === normalizeId(assignedId));
        const patch = {};
        if (!u.studentId) patch.studentId = assignedId;
        if (!u.address && stud && stud.address) patch.address = stud.address;
        if (Object.keys(patch).length > 0) {
          db.update('users', u.id, patch);
          Object.assign(u, patch);
        }
      }
    }
  }
}

/**
 * Find an official student by Student ID or LRN.
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
 * Verifies if a given Student ID or LRN belongs to an officially registered and enrolled student.
 * Returns { allowed: boolean, reason?: string, student?: object }
 */
function verifyStudentRegistration(identifier) {
  ensureStudentsDatabase();
  const norm = normalizeId(identifier);
  if (!norm) {
    return {
      allowed: false,
      reason: 'Access Denied: Student ID is required. Only officially registered students of this high school can access the system.',
      student: null,
    };
  }

  const student = findOfficialStudent(norm);
  if (!student) {
    return {
      allowed: false,
      reason: 'Access Denied: You are not an officially registered student of this high school. Your Student ID was not found in the official school database.',
      student: null,
    };
  }

  if (student.status !== 'Enrolled' && student.status !== 'Registered') {
    return {
      allowed: false,
      reason: `Access Denied: Student registration is currently marked as "${student.status}". Only officially enrolled students are permitted.`,
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
  findOfficialStudent,
  verifyStudentRegistration,
  ensureStudentsDatabase,
  OFFICIAL_HIGH_SCHOOL_STUDENTS,
};
