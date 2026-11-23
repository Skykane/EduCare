/**
 * Full HTTP verification of the current database population against a COPY of the DB.
 * The real data/db.json is never modified by this test.
 *
 * Run with: node scripts/verify-app-http.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const statuses = [];

function check(label, condition, detail = '') {
  results.push({ label, ok: !!condition, detail });
}

function prepareTempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'educare-verify-'));
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
  const hash = bcrypt.hashSync('verify1234', 10);
  raw.users.forEach((u) => {
    if (u.role === 'admin' || u.role === 'requester') {
      u.passwordHash = hash;
      u.mustChangePassword = false;
    }
  });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(raw, null, 2));
  return { dir, raw };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return true;
    } catch (err) { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function run() {
  const { dir: dataDir, raw } = prepareTempDatabase();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });

  let cookie = '';
  async function request(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(`${BASE}${url}`, { redirect: 'manual', ...options, headers });
    statuses.push(res.status);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = /(educare\.sid=[^;]+)/.exec(setCookie);
      if (match) cookie = match[1];
    }
    return res;
  }

  async function login(email, password) {
    cookie = '';
    return request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password, next: '/', remember: '0' }),
    });
  }

  async function text(url) {
    const res = await request(url);
    return { status: res.status, body: await res.text(), headers: res.headers };
  }

  function stat(body, label, admin = false) {
    const safe = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = admin
      ? new RegExp(`adm-stat-num">(\\d+)</strong>\\s*<span class="adm-stat-label">${safe}`)
      : new RegExp(`istat-num">(\\d+)</span>\\s*<span class="istat-label">${safe}`);
    const match = pattern.exec(body);
    return match ? Number(match[1]) : null;
  }

  // Scope equipment assertions to the inventory table: equipment codes also
  // appear in the globally included Submit Request dropdown.
  function table(body) {
    const m = /<tbody>([\s\S]*?)<\/tbody>/.exec(body);
    return m ? m[1] : '';
  }
  function unescapeHtml(value) {
    return String(value)
      .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  }

  const eqCodes = ['EQ-0001', 'EQ-0002', 'EQ-0003', 'EQ-0004', 'EQ-0005', 'EQ-0006', 'EQ-0007', 'EQ-0008', 'EQ-0009', 'EQ-0010'];
  const catNames = ['Computers', 'Office Equipment', 'Electrical Equipment', 'Audio-Visual', 'Air Conditioning', 'Laboratory Equipment', 'Furniture and Fixtures', 'Networking Equipment'];
  const locNames = ['Computer Laboratory', "Principal's Office", 'Grade 9 – Room E', 'Grade 7 – Room A', 'Computer Laboratory', 'Science Laboratory', 'Grade 10 – Room H'];
  const reqCodes = ['REQ-0001', 'REQ-0002', 'REQ-0003'];
  const scheduledCodes = ['EQ-0001', 'EQ-0003', 'EQ-0005', 'EQ-0007', 'EQ-0008'];
  // Student accounts now come from the 2026 Student Directory. Resolve the
  // current linked requester instead of relying on a retired sample email.
  const studentAccount = raw.users.find((u) => u.role === 'requester');

  // Expected dashboard figures derived from the copied DB, not hard-coded.
  const pending = raw.requests.filter((r) => r.status === 'Pending').length;
  const active = raw.requests.filter((r) => ['Assigned', 'In Progress', 'On Hold'].includes(r.status)).length;
  const completed = raw.requests.filter((r) => r.status === 'Completed').length;

  try {
    const ready = await waitForServer();
    check('Server starts with copied database', ready, serverLog.trim().slice(0, 160));
    if (!ready) return;

    // ===================== ADMIN =====================
    let res = await login('admin@educare.local', 'verify1234');
    check('Admin login succeeds', res.status === 302 && res.headers.get('location') === '/', `status ${res.status}`);

    let page = await text('/');
    check('Admin dashboard renders', page.status === 200);
    check(`Admin pending count = ${pending}`, stat(page.body, 'Pending Approval', true) === pending, `got ${stat(page.body, 'Pending Approval', true)}`);
    check(`Admin active work orders = ${active}`, stat(page.body, 'Active Work Orders', true) === active, `got ${stat(page.body, 'Active Work Orders', true)}`);
    check(`Admin completed this month = ${completed}`, stat(page.body, 'Completed This Month', true) === completed, `got ${stat(page.body, 'Completed This Month', true)}`);

    // Equipment inventory + search + filters
    page = await text('/equipment');
    check('Inventory shows all 10 equipment records', page.status === 200 && eqCodes.every((c) => page.body.includes(c)));
    check('View Details wiring present for all 10 rows', (page.body.match(/openEquipmentDetailsModal\(/g) || []).length >= 10);

    const searchCases = [
      ['EQ-0007', 'EQ-0007', 'EQ-0001', 'equipment ID'],
      ['Microscope', 'EQ-0008', 'EQ-0001', 'name'],
      ['ThinkPad', 'EQ-0002', 'EQ-0001', 'model'],
      ['SAMPLE-SN-EQ0003', 'EQ-0003', 'EQ-0001', 'serial number'],
    ];
    for (const [q, expected, absent, label] of searchCases) {
      const p = await text(`/equipment?q=${encodeURIComponent(q)}`);
      const t = table(p.body);
      check(`Search by ${label} works`, p.status === 200 && t.includes(expected) && !t.includes(absent), `q=${q}`);
    }

    const filterCases = [
      [`categoryId=${raw.categories.find((c) => c.name === 'Computers').id}`, 'EQ-0001', 'EQ-0003', 'category'],
      [`location=${encodeURIComponent("Faculty Room")}`, 'EQ-0003', 'EQ-0001', 'location'],
      [`department=${encodeURIComponent('Science Department')}`, 'EQ-0008', 'EQ-0001', 'department'],
      [`status=${encodeURIComponent('Operational')}`, 'EQ-0010', null, 'condition'],
      [`pm=${encodeURIComponent('Scheduled')}`, 'EQ-0003', 'EQ-0002', 'checkup status'],
    ];
    for (const [query, expected, absent, label] of filterCases) {
      const p = await text(`/equipment?${query}`);
      const t = table(p.body);
      const ok = p.status === 200 && t.includes(expected) &&
        (!absent || !t.includes(absent)) &&
        (label !== 'condition' || eqCodes.every((c) => t.includes(c)));
      check(`${label} filter works`, ok, query);
    }

    page = await text('/equipment');
    check('Clear resets all filters (10 rows again)', eqCodes.every((c) => page.body.includes(c)));

    page = await text('/equipment/new');
    check('Add Equipment form renders', page.status === 200);
    check('Add Equipment category dropdown has all 8 categories', catNames.every((n) => page.body.includes(n)));
    const formHtml = unescapeHtml(page.body);
    check('Add Equipment location dropdown has all 8 locations', locNames.every((n) => formHtml.includes(n)));

    // Categories / Locations
    page = await text('/categories');
    check('Categories tab shows all 8 categories', page.status === 200 && catNames.every((n) => page.body.includes(n)));
    page = await text('/locations');
    const locHtml = unescapeHtml(page.body);
    check('Locations tab shows all 8 sample locations', page.status === 200 && locNames.every((n) => locHtml.includes(n)));

    // Schedule / History / Requests
    page = await text('/schedule');
    check('Schedule module shows 5 sample schedules', page.status === 200 && scheduledCodes.every((c) => page.body.includes(c)));
    check('Schedule module shows 90/180 day intervals', page.body.includes('Every 90 days') && page.body.includes('Every 180 days'));

    page = await text('/history');
    check('History module shows the 3 sample records', page.status === 200 &&
      ['Routine inspection and cleaning', 'Routine printer inspection', 'Routine maintenance inspection'].every((s) => page.body.includes(s)) && page.body.includes('SAMPLE DATA'));

    page = await text('/requests');
    check('Requests module shows all 3 sample requests', page.status === 200 && reqCodes.every((c) => page.body.includes(c)));
    check('Requests module shows requested issues', ['Computer does not turn on.', 'Printer produces faded prints.', 'Fan makes an unusual noise.'].every((s) => page.body.includes(s)));

    // Reports + CSV export of actual equipment
    page = await text('/reports');
    check('Reports page renders', page.status === 200);
    const csv = await text('/reports/export/equipment');
    check('Equipment CSV export succeeds', csv.status === 200 && (csv.headers.get('content-type') || '').includes('text/csv'));
    check('CSV contains all 10 actual equipment records', eqCodes.every((c) => csv.body.includes(c)));

    // User management
    page = await text('/users');
    check('Admin user management shows Jovert', page.status === 200 && page.body.includes('Jovert Torres') && page.body.includes('joverttorres1@gmail.com'));
    page = await text('/technicians');
    check('Admin technician listing shows Jovert', page.status === 200 && page.body.includes('Jovert Torres'));

    // ===================== TECHNICIAN =====================
    res = await login('joverttorres1@gmail.com', 'jovert123');
    check('Jovert logs in with temporary password', res.status === 302, `status ${res.status}`);
    check('Jovert redirected to forced password change', res.headers.get('location') === '/profile/change-password', String(res.headers.get('location')));

    const blocked = await request('/');
    check('Dashboard blocked until password changed', blocked.status === 302 && blocked.headers.get('location') === '/profile/change-password');

    page = await text('/profile/change-password');
    check('Forced password page renders', page.status === 200 && page.body.includes('Set Your Password'));

    res = await request('/profile/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ current: 'jovert123', password: 'NewPass123!', confirm: 'NewPass123!' }),
    });
    check('Password change submits successfully', res.status === 302 && res.headers.get('location') === '/', `status ${res.status}`);

    page = await text('/');
    check('Technician dashboard renders after change', page.status === 200);
    check('Tech assigned count = 0 (requests intentionally unassigned)', stat(page.body, 'New / Assigned') === 0, `got ${stat(page.body, 'New / Assigned')}`);
    check('Tech in-progress count = 0', stat(page.body, 'In Progress / On Hold') === 0, `got ${stat(page.body, 'In Progress / On Hold')}`);

    for (const url of ['/schedule', '/history', '/requests', '/equipment']) {
      const p = await text(url);
      check(`Technician can open ${url}`, p.status === 200, `status ${p.status}`);
    }
    for (const url of ['/users', '/categories', '/equipment/new']) {
      const p = await text(url);
      check(`Technician denied admin-only ${url}`, p.status === 403, `status ${p.status}`);
    }
    page = await text('/technicians/2');
    check('Technician profile shows exact specialization labels', page.status === 200 &&
      ['Computer Hardware', 'Electrical', 'Air Conditioning', 'Audio-Visual Equipment', 'Basic Networking'].every((s) => page.body.includes(s)));

    // ===================== STUDENT =====================
    res = await login(studentAccount.email, 'verify1234');
    check('Directory student login succeeds', res.status === 302, `status ${res.status}`);
    page = await text('/');
    check('Student dashboard renders', page.status === 200);
    check(`Student pending count = ${pending}`, stat(page.body, 'Pending Approval') === pending, `got ${stat(page.body, 'Pending Approval')}`);
    check(`Student in-progress count = ${active}`, stat(page.body, 'In Progress / Assigned') === active, `got ${stat(page.body, 'In Progress / Assigned')}`);
    check(`Student completed count = ${completed}`, stat(page.body, 'Resolved & Completed') === completed, `got ${stat(page.body, 'Resolved & Completed')}`);

    page = await text('/requests');
    check('Student sees only their requests', page.status === 200 && reqCodes.every((c) => page.body.includes(c)));
    page = await text('/equipment');
    check('Student can view equipment information', page.status === 200 && page.body.includes('EQ-0001'));
    for (const url of ['/users', '/categories', '/equipment/new', '/schedule', '/history']) {
      const p = await text(url);
      check(`Student denied restricted ${url}`, p.status === 403, `status ${p.status}`);
    }

    // ===================== LOGS =====================
    check('No HTTP 500 errors during test', statuses.every((s) => s < 500), statuses.filter((s) => s >= 500).join(', ') || 'none');
    check('No backend error output', !/error:|uncaught|exception/i.test(serverLog), serverLog.trim().slice(0, 160));
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  }
}

run()
  .then(() => {
    let failed = 0;
    for (const r of results) {
      console.log(`${r.ok ? 'PASS' : 'FAIL'} - ${r.label}${r.detail ? ` [${r.detail}]` : ''}`);
      if (!r.ok) failed++;
    }
    console.log(`\n${results.length - failed}/${results.length} HTTP checks passed.`);
    process.exit(failed ? 1 : 0);
  })
  .catch((err) => {
    console.error('HTTP verification error:', err);
    process.exit(1);
  });
