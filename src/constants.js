// Shared lists and labels used across the app.
module.exports = {
  ROLES: {
    admin: 'Administrator',
    technician: 'Maintenance Personnel',
    requester: 'Student / Faculty / Staff',
  },

  EQUIPMENT_STATUSES: ['Operational', 'Needs Repair', 'Under Maintenance', 'Out of Service'],

  // Legacy values (Approved, Assigned, On Hold) stay for older records. New
  // reports use the connected workflow: Reported -> Pending -> In Progress ->
  // Nearing Completion -> Completed.
  REQUEST_STATUSES: [
    'Reported', 'Pending', 'Approved', 'Assigned', 'In Progress', 'On Hold',
    'Nearing Completion', 'Completed', 'Cancelled', 'Rejected',
  ],
  OPEN_STATUSES: ['Reported', 'Pending', 'Approved', 'Assigned', 'In Progress', 'On Hold', 'Nearing Completion'],
  TECH_ACTIVE_STATUSES: ['Pending', 'Assigned', 'In Progress', 'On Hold', 'Nearing Completion'],
  REPAIR_STATUSES: ['Reported', 'Pending', 'In Progress', 'Nearing Completion', 'Completed'],
  REPORTED_STATUSES: ['Reported'],
  ASSIGNABLE_STATUSES: ['Reported', 'Pending', 'Approved'],
  STARTABLE_STATUSES: ['Pending', 'Approved', 'Assigned'],
  NEARING_STATUSES: ['In Progress', 'On Hold'],

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
