// Shared lists and labels used across the app.
module.exports = {
  ROLES: {
    admin: 'Administrator',
    technician: 'Technician',
    requester: 'Requester',
  },

  EQUIPMENT_STATUSES: ['Operational', 'Needs Repair', 'Under Maintenance', 'Out of Service'],

  REQUEST_STATUSES: ['Pending', 'Approved', 'Assigned', 'In Progress', 'On Hold', 'Completed', 'Cancelled', 'Rejected'],
  OPEN_STATUSES: ['Pending', 'Approved', 'Assigned', 'In Progress', 'On Hold'],
  TECH_ACTIVE_STATUSES: ['Assigned', 'In Progress', 'On Hold'],

  PRIORITIES: ['Low', 'Medium', 'High'],
  PRIORITY_RANK: { Low: 1, Medium: 2, High: 3 },

  // Reported severity of the problem (used by the priority score).
  SEVERITIES: { 1: 'Minor', 2: 'Moderate', 3: 'Major', 4: 'Critical' },

  // How important the equipment is to school operations (used by the priority score).
  IMPORTANCE: { 1: 'Low', 2: 'Moderate', 3: 'Important', 4: 'High', 5: 'Critical' },

  AVAILABILITY: ['Available', 'Busy', 'On Leave'],
  REQUEST_TYPES: ['Corrective', 'Preventive'],

  // Preventive maintenance is "Due Soon" this many days before the due date.
  DUE_SOON_DAYS: 7,

  // St. Anthony Center of Science and Technology - High School Classrooms & Facilities
  HIGH_SCHOOL_ROOMS: {
    'Junior High School (Grades 7–10)': [
      'Grade 7 - Room 101',
      'Grade 7 - Room 102',
      'Grade 8 - Room 103',
      'Grade 8 - Room 104',
      'Grade 9 - Room 201',
      'Grade 9 - Room 202',
      'Grade 10 - Room 203',
      'Grade 10 - Room 204',
    ],
    'Senior High School (Grades 11–12)': [
      'Grade 11 - GAS (Room 301)',
      'Grade 12 - GAS (Room 302)',
    ],
    'Laboratories & Campus Facilities': [
      'Computer Laboratory',
      'Science Laboratory',
      'High School Library',
      'Audio-Visual Room (AVR)',
      'Faculty Room',
      "Principal's Office",
      'School Clinic',
      'Server Room',
      'Generator House',
    ],
  },
  HIGH_SCHOOL_LOCATIONS: [
    'Grade 7 - Room 101',
    'Grade 7 - Room 102',
    'Grade 8 - Room 103',
    'Grade 8 - Room 104',
    'Grade 9 - Room 201',
    'Grade 9 - Room 202',
    'Grade 10 - Room 203',
    'Grade 10 - Room 204',
    'Grade 11 - GAS (Room 301)',
    'Grade 12 - GAS (Room 302)',
    'Computer Laboratory',
    'Science Laboratory',
    'High School Library',
    'Audio-Visual Room (AVR)',
    'Faculty Room',
    "Principal's Office",
    'School Clinic',
    'Server Room',
    'Generator House',
  ],
};
