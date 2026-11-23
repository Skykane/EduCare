// Shared lists and labels used across the app.
//
// Canonical repair-request vocabulary. These seven exact strings are the only
// statuses new code may write. Legacy values survive only as aliases for old
// records and are rewritten by scripts/migrate-repair-workflow.js.
// NOTE: the approval label uses an en dash (U+2013), not a hyphen.
const STATUS = {
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED_AWAITING_ASSIGNMENT: 'Approved – Awaiting Assignment',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
};

const REQUEST_STATUSES = [
  STATUS.PENDING_APPROVAL,
  STATUS.APPROVED_AWAITING_ASSIGNMENT,
  STATUS.ASSIGNED,
  STATUS.IN_PROGRESS,
  STATUS.ON_HOLD,
  STATUS.COMPLETED,
  STATUS.REJECTED,
];

// Legacy -> canonical mapping. `Pending` is context-sensitive and handled in
// normalizeStatus (it meant "assigned" in older builds when a technician was
// already linked, otherwise it meant "awaiting approval").
const STATUS_ALIASES = {
  Reported: STATUS.PENDING_APPROVAL,
  Approved: STATUS.APPROVED_AWAITING_ASSIGNMENT,
  'Approved - Awaiting Assignment': STATUS.APPROVED_AWAITING_ASSIGNMENT,
  'Nearing Completion': STATUS.IN_PROGRESS,
  Cancelled: STATUS.REJECTED,
  Canceled: STATUS.REJECTED,
};

const LEGACY_REQUEST_STATUSES = [
  'Reported', 'Pending', 'Approved', 'Assigned', 'In Progress', 'On Hold',
  'Nearing Completion', 'Completed', 'Cancelled', 'Rejected',
];

const STATUS_ALIAS_LOOKUP = {};
for (const [from, to] of Object.entries(STATUS_ALIASES)) {
  STATUS_ALIAS_LOOKUP[from.trim().toLocaleLowerCase()] = to;
}
for (const value of REQUEST_STATUSES) {
  STATUS_ALIAS_LOOKUP[value.toLocaleLowerCase()] = value;
}

// Display/storage normalizer. Unknown values are preserved verbatim so that
// verification and equipment statuses are never rewritten by this helper.
function normalizeStatus(status, request) {
  if (status === undefined || status === null) return status;
  const raw = String(status).trim();
  if (!raw) return status;
  const key = raw.toLocaleLowerCase();
  if (REQUEST_STATUSES.includes(raw)) return raw;
  if (key === 'pending') {
    const hasTechnician = !!request && request.technicianId !== undefined && request.technicianId !== null && request.technicianId !== '';
    return hasTechnician ? STATUS.ASSIGNED : STATUS.PENDING_APPROVAL;
  }
  if (Object.prototype.hasOwnProperty.call(STATUS_ALIAS_LOOKUP, key)) return STATUS_ALIAS_LOOKUP[key];
  return raw;
}

module.exports = {
  ROLES: {
    admin: 'Administrator',
    technician: 'Maintenance Personnel',
    requester: 'Student / Faculty / Staff',
  },

  EQUIPMENT_STATUSES: ['Operational', 'Needs Repair', 'Under Maintenance', 'Out of Service'],

  STATUS,
  STATUS_ALIASES,
  LEGACY_REQUEST_STATUSES,
  normalizeStatus,
  REQUEST_STATUSES,
  OPEN_STATUSES: REQUEST_STATUSES.filter((s) => s !== STATUS.COMPLETED && s !== STATUS.REJECTED),
  TECH_ACTIVE_STATUSES: [STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.ON_HOLD],
  REPAIR_STATUSES: [STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.ON_HOLD, STATUS.COMPLETED],
  REPORTED_STATUSES: [STATUS.PENDING_APPROVAL],
  ASSIGNABLE_STATUSES: [STATUS.APPROVED_AWAITING_ASSIGNMENT],
  STARTABLE_STATUSES: [STATUS.ASSIGNED],

  // Verification is a separate track; Completed remains the repair status.
  VERIFICATION_STATUSES: ['Not Submitted', 'Awaiting Verification', 'Verified', 'Rework Required'],
  AWAITING_VERIFICATION: 'Awaiting Verification',

  // Proof stages supported by attachments (in addition to legacy before/after).
  PROOF_STAGES: [
    'before', 'after', 'report', 'assignment', 'start', 'progress',
    'nearing', 'completion', 'material', 'rework',
  ],

  PRIORITIES: ['Low', 'Medium', 'High'],
  PRIORITY_RANK: { Low: 1, Medium: 2, High: 3 },

  // Reported severity of the problem (used by the priority score).
  SEVERITIES: { 1: 'Minor', 2: 'Moderate', 3: 'Major', 4: 'Critical' },

  // How important the equipment is to school operations (used by the priority score).
  IMPORTANCE: { 1: 'Low', 2: 'Moderate', 3: 'Important', 4: 'High', 5: 'Critical' },

  AVAILABILITY: ['Available', 'Busy', 'On Leave'],
  REQUEST_TYPES: ['Corrective', 'Preventive'],

  // EduCare is a high-school system. Student accounts stop at Grade 12.
  STUDENT_GRADE_LEVELS: ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'],

  // Preventive maintenance is "Due Soon" this many days before the due date.
  DUE_SOON_DAYS: 7,

  // Official grade/section combinations (source-aligned with gradeSections service/DB).
  OFFICIAL_GRADE_SECTIONS: [
    { gradeLevel: 'Grade 7',  section: 'Room A', group: 'Junior High School (Grades 7–10)' },
    { gradeLevel: 'Grade 7',  section: 'Room B', group: 'Junior High School (Grades 7–10)' },
    { gradeLevel: 'Grade 8',  section: 'Room C', group: 'Junior High School (Grades 7–10)' },
    { gradeLevel: 'Grade 8',  section: 'Room D', group: 'Junior High School (Grades 7–10)' },
    { gradeLevel: 'Grade 9',  section: 'Room E', group: 'Junior High School (Grades 7–10)' },
    { gradeLevel: 'Grade 9',  section: 'Room F', group: 'Junior High School (Grades 7–10)' },
    { gradeLevel: 'Grade 10', section: 'Room G', group: 'Junior High School (Grades 7–10)' },
    { gradeLevel: 'Grade 10', section: 'Room H', group: 'Junior High School (Grades 7–10)' },
    { gradeLevel: 'Grade 11', section: 'ICT',    group: 'Senior High School (Grades 11–12)' },
    { gradeLevel: 'Grade 11', section: 'STEM',   group: 'Senior High School (Grades 11–12)' },
    { gradeLevel: 'Grade 12', section: 'ICT',    group: 'Senior High School (Grades 11–12)' },
    { gradeLevel: 'Grade 12', section: 'STEM',   group: 'Senior High School (Grades 11–12)' },
  ],

  // Campus classrooms and facilities used as location options.
  CAMPUS_ROOMS: {
    'Junior High School (Grades 7–10)': [
      'Grade 7 – Room A',
      'Grade 7 – Room B',
      'Grade 8 – Room C',
      'Grade 8 – Room D',
      'Grade 9 – Room E',
      'Grade 9 – Room F',
      'Grade 10 – Room G',
      'Grade 10 – Room H',
    ],
    'Senior High School (Grades 11–12)': [
      'Grade 11 – ICT',
      'Grade 11 – STEM',
      'Grade 12 – ICT',
      'Grade 12 – STEM',
    ],
    'Laboratories & School Facilities': [
      'Computer Laboratory',
      'Science Laboratory',
      'High School Library',
      'Faculty Room',
      "Principal's Office",
      'School Clinic',
      "Registrar's Office",
    ],
  },
  CAMPUS_LOCATIONS: [
    'Grade 7 – Room A',
    'Grade 7 – Room B',
    'Grade 8 – Room C',
    'Grade 8 – Room D',
    'Grade 9 – Room E',
    'Grade 9 – Room F',
    'Grade 10 – Room G',
    'Grade 10 – Room H',
    'Grade 11 – ICT',
    'Grade 11 – STEM',
    'Grade 12 – ICT',
    'Grade 12 – STEM',
    'Computer Laboratory',
    'Science Laboratory',
    'High School Library',
    'Faculty Room',
    "Principal's Office",
    'School Clinic',
    "Registrar's Office",
  ],
};
