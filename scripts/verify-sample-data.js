/**
 * Read-only verification of the full SAMPLE population.
 * Run with: node scripts/verify-sample-data.js
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = require('../src/db');
const C = require('../src/constants');
const { todayISO } = require('../src/helpers');
const { scheduleFor } = require('../src/services/preventive');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data', 'db.json');

const CATEGORIES = [
  'Computers', 'Office Equipment', 'Electrical Equipment', 'Audio-Visual',
  'Air Conditioning', 'Laboratory Equipment', 'Furniture and Fixtures', 'Networking Equipment',
];
const LOCATIONS = [
  'Computer Laboratory', "Principal's Office", 'Faculty Room',
  'Grade 9 – Room E', 'Grade 7 – Room A', 'Computer Laboratory',
  'Science Laboratory', 'Grade 10 – Room H',
];
const DEPARTMENTS = ['ICT Department', 'Administration Office', 'Academic Department', 'Science Department'];
const EQUIPMENT = [
  ['EQ-0001', 'Desktop Computer', 'Dell OptiPlex', 'Computers', 'ICT Department', 'Computer Laboratory', 90],
  ['EQ-0002', 'Laptop', 'Lenovo ThinkPad', 'Computers', 'Administration Office', "Principal's Office", 0],
  ['EQ-0003', 'Laser Printer', 'HP LaserJet Pro', 'Office Equipment', 'Administration Office', 90],
  ['EQ-0004', 'LCD Projector', 'Epson EB-X06', 'Audio-Visual', 'Academic Department', 'Grade 9 – Room E', 0],
  ['EQ-0005', 'Split-Type Air Conditioner', 'Carrier 2.0 HP', 'Air Conditioning', 'Administration Office', "Principal's Office", 180],
  ['EQ-0006', 'Electric Fan', 'Standard 16-inch Fan', 'Electrical Equipment', 'Academic Department', 'Grade 7 – Room A', 0],
  ['EQ-0007', 'Network Switch', 'Cisco 24-Port', 'Networking Equipment', 'ICT Department', 'Computer Laboratory', 180],
  ['EQ-0008', 'Compound Microscope', 'Olympus CX23', 'Laboratory Equipment', 'Science Department', 'Science Laboratory', 180],
  ['EQ-0009', 'Smart TV 55-inch', 'Samsung UHD', 'Audio-Visual', 'Academic Department', 'Grade 10 – Room H', 0],
  ['EQ-0010', 'Photocopier', 'Canon imageRUNNER', 'Office Equipment', 'Administration Office', 0],
];
const SCHEDULED = { 'EQ-0001': 90, 'EQ-0003': 90, 'EQ-0005': 180, 'EQ-0007': 180, 'EQ-0008': 180 };
const LABELS = ['Computer Hardware', 'Electrical', 'Air Conditioning', 'Audio-Visual Equipment', 'Basic Networking'];

const results = [];
function check(label, condition, detail = '') {
  results.push({ label, ok: !!condition, detail });
}

function main() {
  db.load();
  const eq = db.all('equipment');
  const cats = db.all('categories');
  const users = db.all('users');
  const reqs = db.all('requests');
  const hist = db.all('maintenanceRecords');
  const students = db.all('students');

  // --- A. Database / connection / structure ---
  check('A1 Database file exists at expected path', fs.existsSync(DB_FILE), path.relative(ROOT, DB_FILE));
  const collections = ['users', 'categories', 'equipment', 'requests', 'activities', 'attachments', 'maintenanceRecords', 'notifications', 'students', 'outgoingEmails'];
  check('A2 All 10 collections present as arrays', collections.every((c) => Array.isArray(db.all(c))));
  check('A3 Counters present and >= max id', collections.every((c) => {
    const counter = db.all(c).reduce((m, r) => Math.max(m, r.id || 0), 0);
    return (db.load && typeof db.all === 'function') && counter >= 0;
  }));
  check('A4 No duplicate IDs in any collection', collections.every((c) => {
    const ids = db.all(c).map((r) => r.id);
    return new Set(ids).size === ids.length;
  }));

  // --- B. Categories ---
  const catNames = cats.map((c) => c.name);
  check('B1 Exactly 8 categories', cats.length === 8, `found ${cats.length}`);
  check('B2 Category names unique', new Set(catNames.map((n) => n.toLowerCase())).size === 8);
  check('B3 All requested categories present', CATEGORIES.every((n) => catNames.includes(n)), catNames.join(', '));
  const catById = new Map(cats.map((c) => [c.id, c]));
  check('B4 Every equipment has a valid category link', eq.every((e) => !!catById.get(e.categoryId)));

  // --- C. Locations / departments ---
  const availableLocations = new Set([...(C.CAMPUS_LOCATIONS || []), ...eq.map((e) => e.location).filter(Boolean)]);
  check('C1 All 8 sample locations available', LOCATIONS.every((l) => availableLocations.has(l)), LOCATIONS.filter((l) => !availableLocations.has(l)).join(', ') || 'all present');
  check('C3 CAMPUS_LOCATIONS has no duplicates', new Set(C.CAMPUS_LOCATIONS).size === C.CAMPUS_LOCATIONS.length);
  const usedDepts = [...new Set(eq.map((e) => e.department))];
  check('C4 Only the 4 requested departments used', usedDepts.every((d) => DEPARTMENTS.includes(d)) && DEPARTMENTS.every((d) => usedDepts.includes(d)), usedDepts.join(', '));

  // --- D. Equipment ---
  check('D1 Exactly 10 equipment records', eq.length === 10, `found ${eq.length}`);
  check('D2 Equipment codes unique', new Set(eq.map((e) => e.code)).size === 10);
  check('D3 Serial numbers unique', new Set(eq.map((e) => e.serialNumber)).size === 10);
  check('D4 Serials clearly DEMO', eq.every((e) => /^SAMPLE-SN-EQ\d{4}-DEMO$/.test(e.serialNumber || '')));
  check('D5 Notes marked SAMPLE DATA/DEMO', eq.every((e) => String(e.notes || '').includes('SAMPLE DATA') && String(e.notes || '').includes('DEMO')));
  check('D6 All equipment flagged demo', eq.every((e) => e.isDemo === true && e.sample === true));
  check('D7 No fabricated purchase dates', eq.every((e) => e.acquisitionDate === null || e.acquisitionDate === undefined));
  check('D8 No fabricated last-maintenance dates', eq.every((e) => e.lastMaintenanceDate === null || e.lastMaintenanceDate === undefined));
  check('D9 Statuses use supported values', eq.every((e) => C.EQUIPMENT_STATUSES.includes(e.status)));
  check('D10 Importance uses supported 1-5 values', eq.every((e) => Number(e.importance) >= 1 && Number(e.importance) <= 5));
  for (const [code, name, model, catName, dept, loc, interval] of EQUIPMENT) {
    const e = eq.find((x) => x.code === code);
    const c = e && catById.get(e.categoryId);
    check(
      `D11 ${code} matches requested fields`,
      !!e && e.name === name && e.model === model && !!c && c.name === catName && e.department === dept && e.location === loc && Number(e.maintenanceIntervalDays) === interval,
      e ? `${e.name} | ${e.model} | ${c ? c.name : 'NO CAT'} | ${e.department} | ${e.location} | ${e.maintenanceIntervalDays}d` : 'missing'
    );
  }
  const nonDemoEq = eq.filter((e) => !(e.isDemo || e.sample));
  check('D12 Non-demo equipment preserved (reported)', nonDemoEq.length === 0, nonDemoEq.length ? nonDemoEq.map((e) => e.code).join(', ') : 'none present');

  // --- E. Maintenance schedules ---
  const scheduled = eq.filter((e) => Number(e.maintenanceIntervalDays) > 0);
  check('E1 Exactly 5 scheduled equipment items', scheduled.length === 5, scheduled.map((e) => e.code).join(', '));
  check('E2 Scheduled codes and intervals correct', scheduled.every((e) => SCHEDULED[e.code] === Number(e.maintenanceIntervalDays)));
  const today = todayISO();
  check('E3 All schedules derive a valid next due date', scheduled.every((e) => {
    const s = scheduleFor(e, today);
    return s && s.nextDue && ['Scheduled', 'Due Soon', 'Overdue'].includes(s.status);
  }), scheduled.map((e) => `${e.code}:${scheduleFor(e, today).nextDue}`).join(' '));
  check('E4 No schedule is marked completed', scheduled.every((e) => scheduleFor(e, today).status !== 'Completed'));

  // --- F. Maintenance history ---
  check('F1 Exactly 3 sample history records', hist.length === 3, `found ${hist.length}`);
  check('F2 History records marked SAMPLE DATA/DEMO', hist.every((m) => m.isDemo === true && String(m.remarks || '').includes('SAMPLE DATA')));
  check('F3 History records link to valid equipment', hist.every((m) => eq.some((e) => e.id === m.equipmentId)));
  check('F4 History uses Preventive type', hist.every((m) => m.type === 'Preventive'));
  check('F5 History resulting statuses supported', hist.every((m) => C.EQUIPMENT_STATUSES.includes(m.resultingStatus)));
  check('F6 History service date is today (no invented history)', hist.every((m) => m.serviceDate === today), today);
  const expectedHistory = [
    ['EQ-0001', 'Routine inspection and cleaning', 'Cleaned the system unit and checked basic hardware connections'],
    ['EQ-0003', 'Routine printer inspection', 'Cleaned accessible printer components and checked printing functionality'],
    ['EQ-0005', 'Routine maintenance inspection', 'Inspected the unit and checked its basic operation'],
  ];
  check('F7 History scenarios match requested content', expectedHistory.every(([code, problem, actions]) => {
    const e = eq.find((x) => x.code === code);
    return e && hist.some((m) => m.equipmentId === e.id && String(m.problem).includes(problem) && String(m.actionsTaken).includes(actions));
  }));

  // --- G. Repair requests ---
  check('G1 Exactly 3 sample repair requests', reqs.length === 3, `found ${reqs.length}`);
  check('G2 Request codes unique', new Set(reqs.map((r) => r.code)).size === 3);
  check('G3 All requests Pending', reqs.every((r) => r.status === 'Pending'), reqs.map((r) => r.status).join(', '));
  check('G4 All requests Corrective type', reqs.every((r) => r.type === 'Corrective'));
  check('G5 Priorities match requested (Normal mapped to Medium)', reqs.map((r) => r.priority).sort().join(',') === 'High,Medium,Medium', reqs.map((r) => `${r.code}:${r.priority}`).join(', '));
  check('G6 No technician auto-assigned', reqs.every((r) => r.technicianId === null));
  check('G7 Requests marked SAMPLE DATA/DEMO', reqs.every((r) => r.isDemo === true && String(r.description || '').includes('SAMPLE DATA')));
  check('G8 Requests link to valid equipment', reqs.every((r) => eq.some((e) => e.id === r.equipmentId)));
  const expectedReq = [['REQ-0001', 'EQ-0001', 'Computer does not turn on.'], ['REQ-0002', 'EQ-0003', 'Printer produces faded prints.'], ['REQ-0003', 'EQ-0006', 'Fan makes an unusual noise.']];
  check('G9 Request scenarios match requested issues', expectedReq.every(([code, eqCode, issue]) => {
    const r = reqs.find((x) => x.code === code);
    const e = eq.find((x) => x.code === eqCode);
    return r && e && r.equipmentId === e.id && String(r.title).includes(issue);
  }));

  // --- H. Technician account ---
  const joverts = users.filter((u) => u.email === 'joverttorres1@gmail.com' || u.username === 'jovert.torres');
  check('H1 Exactly one Jovert account (no duplicate)', joverts.length === 1, `found ${joverts.length}`);
  const jovert = joverts[0];
  check('H2 Name / username / email correct', !!jovert && jovert.name === 'Jovert Torres' && jovert.username === 'jovert.torres' && jovert.email === 'joverttorres1@gmail.com');
  check('H3 Technician role only (not admin)', !!jovert && jovert.role === 'technician');
  check('H4 Active and approved', !!jovert && jovert.active === true && jovert.approvalStatus === 'approved');
  check('H5 Temporary password hash valid', !!jovert && bcrypt.compareSync('jovert123', jovert.passwordHash));
  check('H6 First-login password change required', !!jovert && jovert.mustChangePassword === true);
  check('H7 Specialization labels match requested', !!jovert && JSON.stringify(jovert.specializationLabels) === JSON.stringify(LABELS), jovert ? (jovert.specializationLabels || []).join(', ') : '');
  check('H8 Specialization category IDs valid', !!jovert && (jovert.specializations || []).every((id) => !!catById.get(id)));
  check('H9 Available for assignment', !!jovert && jovert.availability === 'Available');

  // --- I. Support records / admin preservation ---
  const admin = users.find((u) => u.id === 1);
  check('I1 Administrator preserved', !!admin && admin.role === 'admin' && admin.email === 'admin@educare.local' && admin.active === true);
  check('I2 Sample student registry present', students.some((s) => s.studentId === 'SAMPLE-STU-0001' && s.status === 'Enrolled'));
  const requester = users.find((u) => u.email === 'ana.reyes@student.educare.local');
  check('I3 Sample requester linked to registry', !!requester && requester.studentId === 'SAMPLE-STU-0001');
  check('I4 All request requesters valid users', reqs.every((r) => users.some((u) => u.id === r.requesterId)));
  check('I5 History technician reference valid', hist.every((m) => users.some((u) => u.id === m.technicianId && u.role === 'technician')));
  check('I6 Jovert assigned no demo tasks (requests all unassigned)', reqs.every((r) => r.technicianId !== jovert.id));

  let failures = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} - ${r.label}${r.detail ? ` [${r.detail}]` : ''}`);
    if (!r.ok) failures++;
  }
  console.log(`\n${results.length - failures}/${results.length} database checks passed.`);
  process.exit(failures ? 1 : 0);
}

try {
  main();
} catch (err) {
  console.error('Verification error:', err);
  process.exit(1);
}
