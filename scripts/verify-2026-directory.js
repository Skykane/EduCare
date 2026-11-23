/**
 * End-to-end verification for the 2026 Student Directory, Grade & Section
 * options, Admin directory management, and the Student registration workflow.
 *
 * The real server is started against an isolated COPY of data/db.json, so live
 * data is never changed. Run with: node scripts/verify-2026-directory.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const { SECTION_PAIRS, STUDENT_SEED, applyToDirectory } = require('./seed-2026-directory');

const ROOT = path.join(__dirname, '..');
const PORT = 3103;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_EMAIL = 'admin@educare.local';
const PASSWORD = 'TestPass123!';
const TEST_STUDENT_PASSWORD = 'Student2026!';
const IRISH_EMAIL = 'irish.patac@student.educare.local';

const results = [];
function check(label, condition, detail = '') {
  results.push({ label, ok: !!condition, detail });
}

function optionValue(grade, section) {
  return `${encodeURIComponent(grade)}|${encodeURIComponent(section)}`;
}

function createClient() {
  let cookie = '';
  return {
    async request(url, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(`${BASE}${url}`, { redirect: 'manual', ...options, headers });
      const cookies = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie')].filter(Boolean);
      for (const raw of cookies) {
        const match = /(educare\.sid=[^;]+)/.exec(raw);
        if (match) cookie = match[1];
      }
      return res;
    },
    async post(url, fields) {
      return this.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
    },
    async text(url) {
      const res = await this.request(url);
      return { status: res.status, location: res.headers.get('location'), body: await res.text() };
    },
  };
}

function prepareTempData() {
  const source = path.join(ROOT, 'data');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'educare-directory-verify-'));
  fs.copyFileSync(path.join(source, 'db.json'), path.join(dir, 'db.json'));
  for (const name of ['official-students.json', 'grade-sections.json', 'email-settings.json']) {
    const file = path.join(source, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, name));
  }
  // Keep the external registry empty: db.students is the single source of truth.
  fs.writeFileSync(path.join(dir, 'official-students.json'), '[]');

  // The live DB may already contain the Irish test account used by this
  // harness. Remove it from the throwaway copy so the registration scenario
  // always starts unregistered; live data is never touched.
  const copied = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  copied.users = (copied.users || []).filter((u) =>
    !(u && u.role === 'requester' && (
      String(u.studentId || '').toUpperCase() === 'STU-2026-0013' ||
      String(u.email || '').toLowerCase() === IRISH_EMAIL ||
      Number(u.directoryRecordId) === 13
    ))
  );
  for (const student of copied.students || []) {
    if (student && student.studentId === 'STU-2026-0013') {
      delete student.userId;
      delete student.accountEmail;
    }
  }
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(copied, null, 2));

  const seeded = applyToDirectory(dir);
  const hash = bcrypt.hashSync(PASSWORD, 10);
  for (const user of seeded.users) {
    user.passwordHash = hash;
    user.mustChangePassword = false;
    user.active = true;
    if (user.role !== 'requester') user.approvalStatus = 'approved';
  }
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(seeded, null, 2));
  return dir;
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return true;
    } catch (err) { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function run() {
  const dataDir = prepareTempData();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });

  const admin = createClient();
  const guest = createClient();
  const student = createClient();
  const dbNow = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const before = dbNow();

  try {
    const ready = await waitForServer();
    check('Server starts with isolated seeded database', ready, serverLog.trim().slice(0, 300));
    if (!ready) return;

    // ---------- 1. Grade & Section options ----------
    let db = dbNow();
    check('Exactly 12 Grade & Section records', db.gradeSections.length === 12, String(db.gradeSections.length));
    const sectionKeys = db.gradeSections.map((r) => `${r.gradeLevel}|${r.section}`);
    const expectedSectionKeys = SECTION_PAIRS.map(([g, s]) => `${g}|${s}`);
    check('Grade & Section pairs are exact', JSON.stringify(sectionKeys.slice().sort()) === JSON.stringify(expectedSectionKeys.slice().sort()));
    check('Grade & Section pairs are unique', new Set(sectionKeys).size === 12);
    check('All Grade & Section records are active', db.gradeSections.every((r) => r.active === true));
    check('Only Grades 7-12 are configured', db.gradeSections.every((r) => /^Grade (7|8|9|10|11|12)$/.test(r.gradeLevel)));

    let res = await admin.post('/login', { email: ADMIN_EMAIL, password: PASSWORD, next: '/', remember: '0' });
    check('Administrator login succeeds', res.status === 302 && res.headers.get('location') === '/', `status ${res.status}`);

    let page = await guest.text('/register');
    check('Registration renders all 12 active options', SECTION_PAIRS.every(([g, s]) => page.body.includes(`value="${optionValue(g, s)}"`)));
    check('Registration has one confirmation-only dropdown', (page.body.match(/name="gradeSection"/g) || []).length === 1 && /id="gradeSection"[^>]*data-confirmation-only="1"[^>]*\bdisabled\b/.test(page.body));
    check('Registration contains no hardcoded student directory records', !STUDENT_SEED.some(([id]) => page.body.includes(id)));
    check('Registration has the five required fields', ['name="studentId"', 'name="name"', 'name="email"', 'name="password"', 'name="confirm"'].every((n) => page.body.includes(n)));

    const registerTemplate = fs.readFileSync(path.join(ROOT, 'views', 'register.ejs'), 'utf8');
    check('Registration requires directory verification before submit', /isStudent && !studentVerified/.test(registerTemplate));
    check('Registration auto-fills Grade & Section from API response', /student\.gradeLevel[\s\S]*student\.section[\s\S]*gradeSectionInput\.value/.test(registerTemplate));

    // ---------- 2. Exact Student Directory ----------
    db = dbNow();
    check('Exactly 13 Student Directory records', db.students.length === 13, String(db.students.length));
    check('Student records match the requested directory', JSON.stringify(
      db.students.map((s) => [s.studentId, s.fullName, s.gradeLevel, s.section]).sort()
    ) === JSON.stringify(STUDENT_SEED.slice().sort()));
    check('Student IDs are unique', new Set(db.students.map((s) => s.studentId)).size === 13);
    check('All records use Academic Year 2026', db.students.every((s) => s.schoolYear === '2026'));
    check('All records are Active', db.students.every((s) => s.status === 'Active' && s.active === true));
    check('No DEMO text in Student IDs or names', !db.students.some((s) => /DEMO/i.test(s.studentId) || /DEMO/i.test(s.fullName)));
    check('Existing sample student id was repurposed', db.students.some((s) => s.id === 1 && s.studentId === 'STU-2026-0001' && s.fullName === 'Adrian Santos'));
    check('Existing requester account is linked to Adrian', db.users.some((u) => u.id === 3 && u.name === 'Adrian Santos' && u.studentId === 'STU-2026-0001' && u.directoryRecordId === 1));

    page = await admin.text('/students');
    check('Admin Student Directory page opens', page.status === 200 && page.body.includes('class="students-page"'));
    check('Admin page lists all 13 Student IDs', STUDENT_SEED.every(([id]) => page.body.includes(id)));
    check('Admin page shows the new nav tab', page.body.includes('href="/students"') && page.body.includes('Student Directory'));

    // ---------- 3. Admin search/filter/view ----------
    page = await admin.text('/students?q=Irish');
    check('Admin search finds Irish by name', page.status === 200 && page.body.includes('STU-2026-0013') && !page.body.includes('STU-2026-0001'));
    page = await admin.text('/students?gradeLevel=Grade%208&section=Room%20C');
    check('Admin grade/section filter returns exact records', page.body.includes('STU-2026-0003') && page.body.includes('STU-2026-0013') && !page.body.includes('STU-2026-0001'));
    const irishRecord = dbNow().students.find((s) => s.studentId === 'STU-2026-0013');
    page = await admin.text(`/students/${irishRecord.id}`);
    check('Admin detail view shows complete record', ['STU-2026-0013', 'Irish Kane Joyce Patac', 'Grade 8', 'Room C', '2026', 'Active'].every((v) => page.body.includes(v)));

    // ---------- 4. Public verification endpoint error scenarios ----------
    const verify = async (studentId, fullName) => {
      const r = await guest.post('/api/student-verify', { studentId, fullName });
      return { status: r.status, data: await r.json() };
    };
    let vr = await verify('STU-2026-9999', 'Nobody Here');
    check('API rejects unknown Student ID', vr.status === 200 && vr.data.ok === false && /not found/i.test(vr.data.message), JSON.stringify(vr.data));
    vr = await verify('STU-2026-0013', 'Wrong Name');
    check('API rejects incorrect Full Name', vr.data.ok === false && /does not match/i.test(vr.data.message), JSON.stringify(vr.data));
    vr = await verify('STU-2026-0013', 'Irish Kane Joyce Patac');
    check('API verifies valid Student ID and returns Grade/Section', vr.data.ok === true && vr.data.student.gradeLevel === 'Grade 8' && vr.data.student.section === 'Room C' && vr.data.student.schoolYear === '2026', JSON.stringify(vr.data));
    vr = await verify('STU-2026-0001', 'Adrian Santos');
    check('API identifies already-registered Student ID', vr.data.ok === false && vr.data.registered === true, JSON.stringify(vr.data));

    // ---------- 5. Registration rejects invalid submissions ----------
    const baseRegister = {
      accountType: 'student',
      studentId: 'STU-2026-0013',
      name: 'Irish Kane Joyce Patac',
      email: IRISH_EMAIL,
      password: TEST_STUDENT_PASSWORD,
      confirm: TEST_STUDENT_PASSWORD,
    };
    const register = async (fields) => {
      const r = await guest.post('/register', fields);
      return { status: r.status, body: await r.text() };
    };

    let usersBefore = dbNow().users.length;
    let rr = await register({ ...baseRegister, studentId: '' });
    check('Registration rejects missing Student ID', rr.status !== 200 && rr.body.includes('Student ID is required') && dbNow().users.length === usersBefore, `status ${rr.status}`);
    rr = await register({ ...baseRegister, studentId: 'STU-2026-9999' });
    check('Registration rejects unknown Student ID', rr.body.includes('Student ID not found') && dbNow().users.length === usersBefore);
    rr = await register({ ...baseRegister, name: 'Wrong Name' });
    check('Registration rejects incorrect Full Name', rr.body.includes('Full Name does not match') && dbNow().users.length === usersBefore);
    rr = await register({ ...baseRegister, studentId: 'STU-2026-0001', name: 'Adrian Santos', email: 'another.adrian@student.educare.local' });
    check('Registration rejects already-registered Student ID', rr.body.includes('already associated with an account') && dbNow().users.length === usersBefore);
    rr = await register({ ...baseRegister, confirm: 'Different123!' });
    check('Registration rejects password mismatch', rr.body.includes('Passwords do not match') && dbNow().users.length === usersBefore);
    rr = await register({ ...baseRegister, email: ADMIN_EMAIL });
    check('Registration rejects duplicate email', rr.body.includes('email address is already registered') && dbNow().users.length === usersBefore);

    // ---------- 6. Valid Student registration, login and profile ----------
    rr = await register({ ...baseRegister, gradeSection: optionValue('Grade 11', 'ICT'), gradeLevel: 'Grade 11', section: 'ICT' });
    check('Valid student registration succeeds', rr.status === 200 && rr.body.includes('Account registered successfully as Student!'), `status ${rr.status}`);
    check('Student notice says account is ready to use', rr.body.includes('You can log in now'));

    db = dbNow();
    const newUser = db.users.find((u) => u.email === IRISH_EMAIL);
    check('Student account is active and approved', newUser && newUser.active === true && newUser.approvalStatus === 'approved' && newUser.role === 'requester');
    check('Student account is linked to directory record', newUser && newUser.directoryRecordId === irishRecord.id && newUser.studentId === 'STU-2026-0013');
    check('Student identity comes from the directory', newUser && newUser.name === 'Irish Kane Joyce Patac' && newUser.gradeLevel === 'Grade 8' && newUser.section === 'Room C');
    check('Forged grade/section form values were ignored', newUser && newUser.gradeLevel === 'Grade 8' && newUser.section === 'Room C');
    check('Password is bcrypt-hashed, not stored in plaintext', newUser && bcrypt.compareSync(TEST_STUDENT_PASSWORD, newUser.passwordHash) && !JSON.stringify(db).includes(TEST_STUDENT_PASSWORD));
    check('Directory record links back to the account', db.students.find((s) => s.id === irishRecord.id).userId === newUser.id && db.students.find((s) => s.id === irishRecord.id).accountEmail === IRISH_EMAIL);

    vr = await verify('STU-2026-0013', 'Irish Kane Joyce Patac');
    check('API now blocks duplicate registration for this ID', vr.data.ok === false && vr.data.registered === true);

    res = await student.post('/login', { email: IRISH_EMAIL, password: TEST_STUDENT_PASSWORD, next: '/', remember: '0' });
    check('New student can log in by email immediately', res.status === 302 && res.headers.get('location') === '/', `status ${res.status}`);
    page = await student.text('/profile');
    check('Profile shows all required directory-derived values', ['Irish Kane Joyce Patac', 'STU-2026-0013', 'Grade 8', 'Room C', IRISH_EMAIL, 'Account Status', 'Account Role', 'Student'].every((v) => page.body.includes(v)), `status ${page.status}`);
    page = await student.text('/');
    check('Student dashboard shows directory values', page.body.includes('STU-2026-0013') && page.body.includes('Irish Kane Joyce Patac') && page.body.includes('Grade 8') && page.body.includes('Room C'));

    // ---------- 7. Admin edits propagate everywhere ----------
    res = await admin.post(`/students/${irishRecord.id}`, {
      studentId: 'STU-2026-0013',
      fullName: 'Irish K. J. Patac',
      gradeSection: optionValue('Grade 8', 'Room D'),
      schoolYear: '2026',
      status: 'Active',
    });
    check('Admin can edit a Student Directory record', res.status === 302, `status ${res.status}`);
    db = dbNow();
    const edited = db.students.find((s) => s.id === irishRecord.id);
    check('Edited directory values are saved', edited.fullName === 'Irish K. J. Patac' && edited.section === 'Room D');
    const editedUser = db.users.find((u) => u.id === newUser.id);
    check('Edit propagates to the linked account', editedUser.name === 'Irish K. J. Patac' && editedUser.section === 'Room D' && editedUser.department === 'Grade 8 - Room D');
    page = await student.text('/profile');
    check('Edit propagates to the Student Profile', page.body.includes('Irish K. J. Patac') && page.body.includes('Room D'));
    page = await admin.text('/users?q=Irish');
    check('Edit propagates to User Accounts', page.body.includes('Irish K. J. Patac'));

    // ---------- 8. Admin add/toggle blocks and restores access ----------
    res = await admin.post('/students', {
      studentId: 'STU-2026-0099',
      fullName: 'Test Directory Student',
      gradeSection: optionValue('Grade 7', 'Room A'),
      schoolYear: '2026',
      status: 'Active',
    });
    check('Admin can add a Student Directory record', res.status === 302 && dbNow().students.some((s) => s.studentId === 'STU-2026-0099'), `status ${res.status}`);
    const added = dbNow().students.find((s) => s.studentId === 'STU-2026-0099');
    res = await admin.post(`/students/${added.id}/toggle`);
    check('Admin can deactivate a record', res.status === 302 && dbNow().students.find((s) => s.id === added.id).status === 'Inactive');
    res = await admin.post(`/students/${irishRecord.id}/toggle`);
    check('Admin can deactivate a linked student', res.status === 302 && dbNow().students.find((s) => s.id === irishRecord.id).status === 'Inactive');

    vr = await verify('STU-2026-0013', 'Irish K. J. Patac');
    check('Inactive record cannot register', vr.data.ok === false && /Inactive/.test(vr.data.message), JSON.stringify(vr.data));
    page = await student.text('/profile');
    check('Inactive record invalidates the existing student session', page.status === 302 && String(page.location || '').startsWith('/login'), `status ${page.status} ${page.location || ''}`);
    rr = await register({ ...baseRegister, name: 'Irish K. J. Patac', email: 'inactive.retry@student.educare.local' });
    check('Inactive record blocks new registration', rr.body.includes('This student record is Inactive'));

    res = await admin.post(`/students/${irishRecord.id}/toggle`);
    check('Admin can reactivate a record', res.status === 302 && dbNow().students.find((s) => s.id === irishRecord.id).status === 'Active');
    res = await student.post('/login', { email: IRISH_EMAIL, password: TEST_STUDENT_PASSWORD, next: '/', remember: '0' });
    check('Reactivated student can log in again', res.status === 302 && res.headers.get('location') === '/', `status ${res.status}`);

    // ---------- 9. Student repair request, status and history ----------
    const equipment = dbNow().equipment[0];
    res = await student.post('/requests', {
      equipmentId: equipment.id,
      title: 'Directory verification test request',
      description: 'Verifies that a registered student can submit and track a repair request.',
      photoNote: '',
    });
    const submitted = dbNow().requests.find((r) => r.title === 'Directory verification test request');
    check('Student can submit a repair request', res.status === 302 && !!submitted && submitted.requesterId === newUser.id, `status ${res.status}`);
    page = await student.text('/requests');
    check('Student request list shows the new request', page.status === 200 && submitted && page.body.includes(submitted.code));
    page = await student.text(`/requests/${submitted.id}`);
    check('Student request detail shows status and activity history', page.body.includes('Pending') && page.body.includes('Activity History'));

    res = await admin.post(`/requests/${submitted.id}/approve`, { severity: '2', priority: 'auto', note: 'Approved during directory verification' });
    check('Admin can approve the student request', res.status === 302 && dbNow().requests.find((r) => r.id === submitted.id).status === 'Approved', `status ${res.status}`);
    page = await student.text('/requests');
    check('Student sees updated status in request list', page.body.includes(submitted.code) && page.body.includes('Approved'));
    page = await student.text(`/requests/${submitted.id}`);
    check('Student status history reflects approval', page.body.includes('Activity History') && /Request approved/i.test(page.body));

    // ---------- 10. Existing data preservation ----------
    const after = dbNow();
    const stableUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, role: u.role });
    check('Admin account preserved', JSON.stringify(stableUser(after.users.find((u) => u.id === 1))) === JSON.stringify(stableUser(before.users.find((u) => u.id === 1))));
    check('Technician account preserved', JSON.stringify(stableUser(after.users.find((u) => u.id === 2))) === JSON.stringify(stableUser(before.users.find((u) => u.id === 2))));
    check('Categories preserved', after.categories.length === before.categories.length);
    check('Equipment records preserved', after.equipment.length === before.equipment.length && before.equipment.every((e) => after.equipment.some((x) => x.id === e.id)));
    check('Existing repair requests preserved', before.requests.every((r) => after.requests.some((x) => x.id === r.id)));
    check('Maintenance records preserved', after.maintenanceRecords.length === before.maintenanceRecords.length);
    check('Grade & Section records unchanged by directory tests', after.gradeSections.length === 12);
  } catch (err) {
    check('Verification ran without exceptions', false, err && err.stack ? err.stack : String(err));
  } finally {
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill();
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  results.forEach((r) => {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.detail && !r.ok ? '  [' + r.detail + ']' : ''}`);
  });
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

run();
