/**
 * End-to-end HTTP verification of Grade & Section Management and Student
 * registration. The real server is started against a COPY of data/db.json so
 * no live records are changed.
 *
 * Run with: node scripts/verify-grade-sections.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 3102;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'TestPass123!';
const ADMIN_EMAIL = 'admin@educare.local';

const EMPTY_MESSAGE = 'No sections have been configured yet. Please contact the administrator.';
const SECTION_A = 'TEST SECTION A';
const SECTION_A_RENAMED = 'TEST SECTION A RENAMED';
const SECTION_B = 'TEST SECTION B';
const TEST_MEMBER_ID = 'TEST-GS-0001';
const TAMPER_MEMBER_ID = 'TEST-GS-0002';

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
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const match = /(educare\.sid=[^;]+)/.exec(setCookie);
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
      return { status: res.status, body: await res.text() };
    },
  };
}

function prepareTempData() {
  const source = path.join(ROOT, 'data');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'educare-gs-verify-'));
  const raw = JSON.parse(fs.readFileSync(path.join(source, 'db.json'), 'utf8'));
  // This test starts with no configured sections so it can be rerun after real
  // sections have been added to the live database. All other data is preserved.
  raw.gradeSections = [];
  if (raw.meta && raw.meta.counters) raw.meta.counters.gradeSections = 0;
  const counts = Object.fromEntries(
    ['users', 'categories', 'equipment', 'requests', 'students'].map((c) => [c, (raw[c] || []).length])
  );

  const hash = bcrypt.hashSync('verify1234', 10);
  raw.users.forEach((u) => {
    if (u.email === ADMIN_EMAIL || u.role === 'admin') {
      u.passwordHash = hash;
      u.mustChangePassword = false;
      u.active = true;
      u.approvalStatus = 'approved';
    }
  });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(raw, null, 2));

  for (const name of ['official-students.json', 'grade-sections.json']) {
    const file = path.join(source, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(dir, name));
  }

  const registry = [
    {
      studentId: TEST_MEMBER_ID,
      lrn: 'TEST-LRN-0001',
      fullName: 'Grade Section Test Student',
      email: 'gs.test@student.educare.local',
      gradeLevel: 'Grade 7',
      section: SECTION_A,
      track: 'General',
      status: 'Enrolled',
      schoolYear: '2026-2027',
      address: 'Test address',
    },
    {
      studentId: TAMPER_MEMBER_ID,
      lrn: 'TEST-LRN-0002',
      fullName: 'Tampered Grade Section Student',
      email: 'tampered.section@student.educare.local',
      gradeLevel: 'Grade 7',
      section: SECTION_A,
      track: 'General',
      status: 'Enrolled',
      schoolYear: '2026-2027',
      address: 'Test address',
    },
  ];
  fs.writeFileSync(path.join(dir, 'official-students.json'), JSON.stringify(registry, null, 2));

  return { dir, counts };
}

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return true;
    } catch (err) { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function run() {
  const { dir: dataDir, counts } = prepareTempData();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });

  const admin = createClient();
  const publicClient = createClient();
  const dbNow = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const sectionRows = (grade) => dbNow().gradeSections.filter((r) => r.gradeLevel === grade);
  const findUser = (email) => dbNow().users.find((u) => u.email === email);

  try {
    const ready = await waitForServer();
    check('Server starts with copied database', ready, serverLog.trim().slice(0, 200));
    if (!ready) return;

    // ---------- 1. Empty state BEFORE any section is configured ----------
    let page = await publicClient.text('/register');
    check('Empty registration shows exact empty-state message', page.status === 200 && page.body.includes(EMPTY_MESSAGE));
    check('Empty registration has no configured grade/section options', !page.body.includes('Grade 7 - '));
    check('Empty registration disables the submit button', /id="register-submit"[^>]*\bdisabled\b/.test(page.body));
    check('Empty registration keeps exactly one Grade & Section dropdown', (page.body.match(/name="gradeSection"/g) || []).length === 1);

    // ---------- 2. Administrator management page ----------
    let res = await admin.post('/login', { email: ADMIN_EMAIL, password: 'verify1234', next: '/', remember: '0' });
    check('Administrator login succeeds', res.status === 302 && res.headers.get('location') === '/', `status ${res.status}`);

    page = await admin.text('/settings/grade-sections');
    check('Grade & Section Management page opens', page.status === 200 && page.body.includes('Grade &amp; Section Management'));
    check('Management page lists no sections initially', page.body.includes('No sections have been configured yet.'));

    // Add a real configured section.
    res = await admin.post('/settings/grade-sections/add', { gradeLevel: 'Grade 7', section: SECTION_A });
    check('Administrator can add a grade/section', res.status === 302 && res.headers.get('location') === '/settings/grade-sections', `status ${res.status}`);
    check('Added section is stored in db.json', sectionRows('Grade 7').some((r) => r.section === SECTION_A && r.active === true));
    page = await admin.text('/settings/grade-sections');
    check('Management page renders the configured row', page.status === 200 && page.body.includes(SECTION_A), `status ${page.status}`);

    // Duplicate protection under the same grade (case-insensitive).
    res = await admin.post('/settings/grade-sections/add', { gradeLevel: 'Grade 7', section: 'test section a' });
    page = await admin.text('/settings/grade-sections');
    check('Duplicate section under the same grade is rejected', page.body.includes('already configured for Grade 7'));
    check('Duplicate was not saved', sectionRows('Grade 7').filter((r) => r.section.toUpperCase() === SECTION_A).length === 1);

    // Invalid grade is rejected.
    res = await admin.post('/settings/grade-sections/add', { gradeLevel: 'Grade 13', section: 'Invalid' });
    page = await admin.text('/settings/grade-sections');
    check('Unsupported grade is rejected', page.body.includes('Select a grade from Grade 7 to Grade 12.'));
    check('Unsupported grade was not saved', !dbNow().gradeSections.some((r) => r.gradeLevel === 'Grade 13'));

    // A second section, then deactivate it.
    res = await admin.post('/settings/grade-sections/add', { gradeLevel: 'Grade 8', section: SECTION_B });
    const sectionB = dbNow().gradeSections.find((r) => r.section === SECTION_B && r.gradeLevel === 'Grade 8');
    check('Second section can be added under a different grade', !!sectionB);
    res = await admin.post(`/settings/grade-sections/${sectionB.id}/toggle`);
    check('Administrator can deactivate a section', res.status === 302 && dbNow().gradeSections.find((r) => r.id === sectionB.id).active === false);

    // ---------- 3. Registration dropdown now uses the database ----------
    page = await publicClient.text('/register');
    check('Registration shows configured option in required format', page.body.includes('Grade 7 - ' + SECTION_A));
    check('Registration does not show the empty-state message', !page.body.includes(EMPTY_MESSAGE));
    check('Registration hides the inactive section', !page.body.includes('Grade 8 - ' + SECTION_B));
    check('Registration Grade & Section dropdown is confirmation-only', /id="gradeSection"[^>]*data-has-options="1"/.test(page.body) && /id="gradeSection"[^>]*data-confirmation-only="1"[^>]*\bdisabled\b/.test(page.body));
    check('Registration no longer uses the old "ask an administrator" text', !page.body.includes('Ask an administrator'));
    check('Still exactly one Grade & Section dropdown', (page.body.match(/name="gradeSection"/g) || []).length === 1);

    // ---------- 4. Directory values are authoritative ----------
    // The Grade & Section confirmation dropdown is disabled and ignored by the
    // server. Even a forged POST value cannot override the directory record.
    const beforeTampered = dbNow().users.length;
    res = await publicClient.post('/register', {
      accountType: 'student',
      studentId: TAMPER_MEMBER_ID,
      name: 'Tampered Grade Section Student',
      email: 'tampered.section@student.educare.local',
      gradeSection: optionValue('Grade 8', SECTION_B),
      password: PASSWORD,
      confirm: PASSWORD,
    });
    const tamperedUser = findUser('tampered.section@student.educare.local');
    check('Forged Grade & Section does not block registration', res.status === 200 && !!tamperedUser, `status ${res.status}`);
    check('Forged Grade & Section is ignored by the server', tamperedUser && tamperedUser.gradeLevel === 'Grade 7' && tamperedUser.section === SECTION_A);

    // ---------- 5. Real student registration ----------
    res = await publicClient.post('/register', {
      accountType: 'student',
      studentId: TEST_MEMBER_ID,
      name: 'Grade Section Test Student',
      email: 'gs.test@student.educare.local',
      gradeSection: optionValue('Grade 7', SECTION_A),
      password: PASSWORD,
      confirm: PASSWORD,
    });
    const registered = findUser('gs.test@student.educare.local');
    const studentBody = await res.text();
    check('Student registration succeeds', res.status === 200 && !!registered && studentBody.includes('Account registered successfully as Student!'), `status ${res.status}`);
    check('Student grade is saved correctly', registered && registered.gradeLevel === 'Grade 7');
    check('Student section is saved correctly', registered && registered.section === SECTION_A);
    check('Legacy department field stays compatible', registered && registered.department === `Grade 7 - ${SECTION_A}`);
    check('Verified student account is active and approved', registered && registered.approvalStatus === 'approved' && registered.active === true);

    page = await admin.text('/users?role=requester&q=gs.test');
    check('User Accounts shows the saved grade', page.status === 200 && page.body.includes('Grade 7'));
    check('User Accounts shows the saved section', page.body.includes('Section: ' + SECTION_A));

    // ---------- 6. Admin and Technician registration still work ----------
    page = await publicClient.text('/register');
    check('Registration has no client-editable role field', !page.body.includes('name="role"') && page.body.includes('name="accountType"'));

    const usersBeforeInvalidType = dbNow().users.length;
    res = await publicClient.post('/register', {
      accountType: 'superuser',
      name: 'Invalid Account Type',
      email: 'invalid.type@educare.local',
      password: PASSWORD,
      confirm: PASSWORD,
    });
    const invalidTypeBody = await res.text();
    check(
      'Invalid account type is rejected on the backend',
      res.status === 400
        && invalidTypeBody.includes('Select a valid account type')
        && dbNow().users.length === usersBeforeInvalidType,
      `status ${res.status}`
    );

    res = await publicClient.post('/register', {
      accountType: 'admin',
      // A tampered role value must never override the selected account type.
      role: 'technician',
      name: 'Grade Section Test Admin',
      email: 'gs.test.admin@educare.local',
      department: 'Test Administration',
      password: PASSWORD,
      confirm: PASSWORD,
    });
    const adminBody = await res.text();
    check('Admin registration still works', res.status === 200 && adminBody.includes('Account registered successfully as Administrator!') && findUser('gs.test.admin@educare.local')?.role === 'admin', `status ${res.status}`);

    // A failed technician submit re-renders the form with Technician selected,
    // which lets us verify no duplicate Technician/Department field is shown.
    res = await publicClient.post('/register', {
      accountType: 'technician',
      name: 'Technician Form Check',
      email: 'tech.form.check@educare.local',
      password: 'weak',
      confirm: 'weak',
    });
    const techForm = await res.text();
    check(
      'Technician form shows no duplicate Technician field',
      res.status === 400
        && /id="role-technician"[^>]*\bchecked\b/.test(techForm)
        && !techForm.includes('name="role"')
        && /id="dept-wrap"[^>]*display:none/.test(techForm)
        && !techForm.includes('value="Technician"'),
      `status ${res.status}`
    );

    res = await publicClient.post('/register', {
      accountType: 'technician',
      // A tampered role value must never promote this account to admin.
      role: 'admin',
      name: 'Grade Section Test Technician',
      email: 'gs.test.tech@educare.local',
      password: PASSWORD,
      confirm: PASSWORD,
    });
    const techBody = await res.text();
    check('Technician registration still works', res.status === 200 && techBody.includes('Account registered successfully as Technician!') && findUser('gs.test.tech@educare.local')?.role === 'technician', `status ${res.status}`);
    check('Technician department is assigned from the account type', findUser('gs.test.tech@educare.local')?.department === 'Maintenance & Technical Services');

    // ---------- 7. Edit + activate/deactivate the configured section ----------
    const sectionA = dbNow().gradeSections.find((r) => r.section === SECTION_A);
    res = await admin.post(`/settings/grade-sections/${sectionA.id}/edit`, { gradeLevel: 'Grade 7', section: SECTION_A_RENAMED });
    check('Administrator can edit a section', res.status === 302 && dbNow().gradeSections.some((r) => r.id === sectionA.id && r.section === SECTION_A_RENAMED));
    page = await publicClient.text('/register');
    check(
      'Registration reflects the edited section',
      page.body.includes(`value="${optionValue('Grade 7', SECTION_A_RENAMED)}"`) &&
        !page.body.includes(`value="${optionValue('Grade 7', SECTION_A)}"`)
    );

    res = await admin.post(`/settings/grade-sections/${sectionA.id}/toggle`);
    check('Administrator can deactivate the last active section', res.status === 302 && dbNow().gradeSections.find((r) => r.id === sectionA.id).active === false);
    page = await publicClient.text('/register');
    check('Empty state returns when no active sections remain', page.body.includes(EMPTY_MESSAGE));
    check('Submit is disabled again with no active sections', /id="register-submit"[^>]*\bdisabled\b/.test(page.body));

    res = await admin.post(`/settings/grade-sections/${sectionA.id}/toggle`);
    check('Administrator can reactivate a section', res.status === 302 && dbNow().gradeSections.find((r) => r.id === sectionA.id).active === true);
    page = await publicClient.text('/register');
    check('Reactivated section appears in registration again', page.body.includes('Grade 7 - ' + SECTION_A_RENAMED));

    // ---------- 8. Existing data is preserved ----------
    const after = dbNow();
    check('Existing users were not deleted', after.users.length === counts.users + 4, `${counts.users} -> ${after.users.length}`);
    check('Existing categories were not deleted', after.categories.length === counts.categories);
    check('Existing equipment was not deleted', after.equipment.length === counts.equipment);
    check('Existing repair requests were not deleted', after.requests.length === counts.requests);
    check('Existing student records were not deleted', after.students.length >= counts.students);
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
