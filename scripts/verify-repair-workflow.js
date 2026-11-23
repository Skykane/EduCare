/**
 * End-to-end verification for the connected Administrator / Maintenance
 * repair workflow. Runs against a temporary DB and upload directory, so the
 * live data in data/db.json is never modified.
 *
 * Run with: node scripts/verify-repair-workflow.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = 3110;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];

// Minimal valid PNG (signature + IHDR). Upload middleware checks real bytes.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

function check(label, ok, detail = '') {
  results.push({ label, ok: !!ok, detail: String(detail).slice(0, 300) });
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return true;
    } catch (e) { /* not ready */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function prepare() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'educare-repair-'));
  const dataDir = path.join(dir, 'data');
  const uploadDir = path.join(dir, 'uploads');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
  const cleared = ['requests', 'activities', 'attachments', 'maintenanceRecords',
    'materials', 'repairAttempts', 'notifications', 'outgoingEmails'];
  for (const c of cleared) {
    db[c] = [];
    db.meta.counters[c] = 0;
  }
  db.meta.revision = 0;
  // Deterministic credentials for the harness; live hashes are untouched.
  const hash = bcrypt.hashSync('verify123', 10);
  for (const u of db.users) {
    u.passwordHash = hash;
    u.mustChangePassword = false;
    u.active = true;
    u.approvalStatus = 'approved';
  }
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db, null, 2));
  return { dir, dataDir, uploadDir };
}

function makeClient() {
  let cookie = '';
  return {
    async request(url, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(BASE + url, { redirect: 'manual', ...options, headers });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const m = /(educare\.sid=[^;]+)/.exec(setCookie);
        if (m) cookie = m[1];
      }
      return res;
    },
    async login(email) {
      return this.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, password: 'verify123', next: '/', remember: '0' }),
      });
    },
  };
}

function formData(fields = {}, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null) fd.append(k, String(v));
  }
  for (const f of files) {
    fd.append(f.name, new Blob([PNG], { type: 'image/png' }), f.filename || `${f.name}.png`);
  }
  return fd;
}

(async () => {
  const prep = prepare();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: prep.dataDir, UPLOAD_DIR: prep.uploadDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  const admin = makeClient();
  const tech = makeClient();
  const readDb = () => JSON.parse(fs.readFileSync(path.join(prep.dataDir, 'db.json'), 'utf8'));
  const findReq = (id) => readDb().requests.find((r) => r.id === id);
  const body = async (res) => (await res.text()).slice(0, 500);

  try {
    const ready = await waitForServer();
    check('Temporary EduCare server starts with workflow code', ready, log.trim().slice(0, 300));
    if (!ready) return;

    // ---------- Authentication and role labels ----------
    const adminLogin = await admin.login('admin@educare.local');
    check('Administrator login succeeds', adminLogin.status === 302, `status ${adminLogin.status}`);
    const techLogin = await tech.login('joverttorres1@gmail.com');
    check('Maintenance personnel login succeeds', techLogin.status === 302, `status ${techLogin.status}`);

    const adminDash = await (await admin.request('/')).text();
    check('Administrator dashboard shows all 8 workflow cards', [
      'Total Reported Issues', 'Pending Repairs', 'In Progress Repairs',
      'Nearing Completion', 'Completed Repairs', 'Awaiting Verification',
      'Verified Repairs', 'Total Materials Expenses',
    ].every((s) => adminDash.includes(s)));
    check('Administrator navigation has Materials Expenses tab', adminDash.includes('Materials Expenses'));

    const techDash = await (await tech.request('/')).text();
    check('Maintenance dashboard shows workflow summary', [
      'Assigned Tasks', 'Pending Tasks', 'In Progress Tasks',
      'Nearing Completion Tasks', 'Completed Tasks',
    ].every((s) => techDash.includes(s)));
    const bottomNav = require('../src/helpers').bottomNavFor('technician');
    check('Maintenance bottom navigation uses History (no duplicate Schedule tab)',
      bottomNav.some((x) => x.href === '/history' && x.label === 'History') &&
      !bottomNav.some((x) => x.href === '/schedule'));

    // ---------- Report submission and duplicate prevention ----------
    const submitPage = await (await admin.request('/requests?openModal=1')).text();
    check('Submit Request form has no equipment selector',
      !submitPage.includes('name="equipmentId"') && !submitPage.includes('Select equipment…'));
    check('Submit Request form collects category and location',
      submitPage.includes('name="categoryId"') && submitPage.includes('name="location"'));
    check('Step 2 has no duplicate dashed photo capture area',
      !submitPage.includes('Tap to take a photo') && !submitPage.includes('id="modal-dropzone"'));
    check('Step 2 keeps Camera, Gallery and Clear actions',
      ['modal-pick-camera', 'modal-pick-gallery', 'modal-photos-clear'].every((id) => submitPage.includes(id)));

    const targetDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const submit = await admin.request('/requests', {
      method: 'POST',
      body: formData({
        categoryId: '1', location: 'Computer Laboratory', title: 'Laptop will not power on',
        description: 'Reported from the computer lab during class.',
      }, [{ name: 'photos', filename: 'report-proof.png' }]),
    });
    check('Report submission redirects to the new request', submit.status === 302, `status ${submit.status}`);
    let db = readDb();
    const req1 = db.requests[0];
    check('New report uses Reported status', req1 && req1.status === 'Reported', req1 && req1.status);
    check('New report stores server reportedAt timestamp', !!(req1 && req1.reportedAt));
    check('New report starts at Not Submitted verification', req1 && req1.verificationStatus === 'Not Submitted');
    check('User submission does not link equipment', req1 && req1.equipmentId == null,
      req1 && req1.equipmentId);
    check('User submission stores category and location',
      req1 && req1.categoryId === 1 && req1.location === 'Computer Laboratory',
      req1 && `${req1.categoryId} / ${req1.location}`);
    check('Report photo is stored as report-stage proof',
      db.attachments.some((a) => a.requestId === req1.id && a.stage === 'report'));

    const dup = await admin.request('/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ categoryId: '1', location: 'Computer Laboratory', title: 'Laptop will not power on' }),
    });
    db = readDb();
    check('Duplicate open report is blocked', dup.status === 400 && db.requests.length === 1,
      `status ${dup.status}, requests ${db.requests.length}`);

    const state1 = await (await admin.request('/requests/api/state')).json();
    check('State endpoint exposes a numeric revision', Number.isInteger(state1.revision), state1.revision);
    check('State endpoint returns a server timestamp', !!state1.serverTime);

    // ---------- Role enforcement ----------
    const techStart = await tech.request(`/requests/${req1.id}/status`, {
      method: 'POST',
      body: formData({ action: 'start', note: 'unassigned' }, [{ name: 'photos' }]),
    });
    check('Unassigned maintenance personnel cannot start a repair', techStart.status === 403,
      `status ${techStart.status}`);
    const techVerify = await tech.request(`/requests/${req1.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ confirm: 'yes' }),
    });
    check('Maintenance personnel cannot verify a repair', techVerify.status === 403,
      `status ${techVerify.status}`);

    // ---------- Approval + assignment with proof ----------
    const approve = await admin.request(`/requests/${req1.id}/approve`, {
      method: 'POST',
      body: formData(
        { severity: '3', priority: 'auto', technicianId: '2', targetDate, note: 'Prioritize lab laptop' },
        [{ name: 'photos', filename: 'assignment-proof.png' }]
      ),
    });
    check('Administrator approval redirects', approve.status === 302, `status ${approve.status}`);
    db = readDb();
    const approved = db.requests.find((r) => r.id === req1.id);
    check('Assignment keeps new-flow status Pending', approved.status === 'Pending', approved.status);
    check('Assignment records technician and timestamp', approved.technicianId === 2 && !!approved.assignedAt);
    check('Assignment proof is saved', db.attachments.some((a) => a.requestId === req1.id && a.stage === 'assignment'));

    // ---------- Repair start requires remarks + proof ----------
    const badStart = await tech.request(`/requests/${req1.id}/status`, {
      method: 'POST',
      body: formData({ action: 'start', note: 'started without proof' }),
    });
    check('Start without picture proof is rejected', badStart.status === 302 && findReq(req1.id).status === 'Pending',
      `status ${badStart.status}, state ${findReq(req1.id).status}`);
    check('No repair attempt created by rejected start', readDb().repairAttempts.length === 0);

    const start = await tech.request(`/requests/${req1.id}/status`, {
      method: 'POST',
      body: formData({ action: 'start', note: 'Inspected power circuit' }, [{ name: 'photos', filename: 'start-proof.png' }]),
    });
    check('Repair start redirects', start.status === 302, `status ${start.status}`);
    db = readDb();
    check('Repair start changes status to In Progress', db.requests.find((r) => r.id === req1.id).status === 'In Progress');
    check('Repair start creates a tracked attempt', db.repairAttempts.length === 1 && !!db.repairAttempts[0].startedAt);
    check('Start proof is saved', db.attachments.some((a) => a.requestId === req1.id && a.stage === 'start'));

    // ---------- Materials with exact money math and per-item proof ----------
    const items = [
      { materialName: 'Replacement fuse', unitPrice: '12.34', quantity: '2.5', unit: 'pc', purpose: 'Power board repair', subtotalCents: 1 },
      { materialName: 'Solder wire', unitPrice: '0.33', quantity: '3', unit: 'm', purpose: 'Reconnecting connector' },
    ];
    const badMaterials = await tech.request(`/requests/${req1.id}/materials`, {
      method: 'POST',
      body: formData({ materials: JSON.stringify(items), idempotencyKey: 'bad' }),
    });
    check('Materials without photo proof are rejected',
      badMaterials.status === 302 && readDb().materials.length === 0,
      `status ${badMaterials.status}, materials ${readDb().materials.length}`);

    const goodMaterials = await tech.request(`/requests/${req1.id}/materials`, {
      method: 'POST',
      body: formData(
        { materials: JSON.stringify(items), idempotencyKey: 'batch-1' },
        [{ name: 'materialPhotos', filename: 'fuse.png' }, { name: 'materialPhotos', filename: 'solder.png' }]
      ),
    });
    check('Materials save redirects', goodMaterials.status === 302, `status ${goodMaterials.status}`);
    db = readDb();
    const mats = db.materials.filter((m) => m.requestId === req1.id);
    check('Both material items are stored', mats.length === 2, mats.length);
    check('Client-submitted subtotal is ignored', mats[0].subtotalCents === 3085, mats[0] && mats[0].subtotalCents);
    check('Unit price is stored as integer centavos', mats[0].unitPriceCents === 1234, mats[0] && mats[0].unitPriceCents);
    check('Quantity is stored scaled by 1,000', mats[0].quantityScaled === 2500, mats[0] && mats[0].quantityScaled);
    check('Second item subtotal is exact', mats[1].subtotalCents === 99, mats[1] && mats[1].subtotalCents);
    check('Material proof is linked per item',
      mats.every((m) => db.attachments.some((a) => a.id === m.proofAttachmentId && a.stage === 'material')));

    const repeatBatch = await tech.request(`/requests/${req1.id}/materials`, {
      method: 'POST',
      body: formData(
        { materials: JSON.stringify(items), idempotencyKey: 'batch-1' },
        [{ name: 'materialPhotos', filename: 'fuse2.png' }, { name: 'materialPhotos', filename: 'solder2.png' }]
      ),
    });
    check('Duplicate idempotency key does not duplicate materials',
      repeatBatch.status === 302 && readDb().materials.length === 2, `materials ${readDb().materials.length}`);

    const detailPage = await (await admin.request(`/requests/${req1.id}`)).text();
    check('Repair detail shows recalculated materials total', detailPage.includes('₱31.84'), 'expected ₱31.84');

    // ---------- Nearing completion ----------
    const badNearing = await tech.request(`/requests/${req1.id}/nearing-completion`, {
      method: 'POST', body: formData({ remarks: 'almost done' }),
    });
    check('Nearing completion without proof is rejected',
      badNearing.status === 302 && findReq(req1.id).status === 'In Progress');
    const nearing = await tech.request(`/requests/${req1.id}/nearing-completion`, {
      method: 'POST',
      body: formData({ remarks: 'Final testing in progress' }, [{ name: 'photos', filename: 'nearing.png' }]),
    });
    check('Nearing completion redirects', nearing.status === 302, `status ${nearing.status}`);
    db = readDb();
    check('Status becomes Nearing Completion', db.requests.find((r) => r.id === req1.id).status === 'Nearing Completion');
    check('Nearing proof is saved', db.attachments.some((a) => a.requestId === req1.id && a.stage === 'nearing'));

    // ---------- Completion ----------
    const badComplete = await tech.request(`/requests/${req1.id}/complete`, {
      method: 'POST',
      body: formData({ problem: 'No power', actionsTaken: 'Replaced fuse', remarks: 'done', serviceDate: new Date().toISOString().slice(0, 10) }),
    });
    check('Completion without final proof is rejected',
      badComplete.status === 302 && findReq(req1.id).status === 'Nearing Completion');

    const today = new Date().toISOString().slice(0, 10);
    const complete = await tech.request(`/requests/${req1.id}/complete`, {
      method: 'POST',
      body: formData({
        problem: 'Power board fuse failure',
        actionsTaken: 'Replaced fuse and re-soldered connector',
        partsReplaced: '2x fuse', serviceDate: today, resultingStatus: 'Operational',
        remarks: 'Verified boot and charging', photoNote: 'final state',
      }, [{ name: 'photos', filename: 'completion.png' }]),
    });
    check('Completion redirects', complete.status === 302, `status ${complete.status}`);
    db = readDb();
    const done = db.requests.find((r) => r.id === req1.id);
    check('Completed repair moves to Awaiting Verification',
      done.status === 'Completed' && done.verificationStatus === 'Awaiting Verification',
      `${done.status} / ${done.verificationStatus}`);
    check('Completion timestamp and maintenance record are stored',
      !!done.completedAt && db.maintenanceRecords.some((m) => m.requestId === req1.id));
    check('Final proof is saved', db.attachments.some((a) => a.requestId === req1.id && a.stage === 'completion'));
    const attempt1 = db.repairAttempts.find((a) => a.requestId === req1.id);
    check('Attempt completion and elapsed time are stored',
      !!attempt1.completedAt && new Date(attempt1.completedAt) >= new Date(attempt1.startedAt));
    check('Administrators are notified of pending verification',
      db.notifications.some((n) => /awaiting your verification/i.test(n.message)));

    const state2 = await (await admin.request('/requests/api/state')).json();
    check('Revision increments after workflow writes', state2.revision > state1.revision,
      `${state1.revision} -> ${state2.revision}`);

    // ---------- Verification ----------
    const noConfirm = await admin.request(`/requests/${req1.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ remarks: 'forgot confirmation' }),
    });
    check('Verification requires explicit confirmation',
      noConfirm.status === 302 && findReq(req1.id).verificationStatus === 'Awaiting Verification');
    const verify = await admin.request(`/requests/${req1.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ confirm: 'yes', remarks: 'Checked and approved' }),
    });
    check('Verification redirects', verify.status === 302, `status ${verify.status}`);
    db = readDb();
    const verified = db.requests.find((r) => r.id === req1.id);
    check('Verification sets Verified with timestamp and verifier',
      verified.verificationStatus === 'Verified' && !!verified.verifiedAt && verified.verifiedBy === 1);
    check('Verification is recorded on the attempt',
      db.repairAttempts.some((a) => a.requestId === req1.id && a.verificationResult === 'Verified'));
    check('Verified repair appears in verified history',
      (await (await admin.request('/history')).text()).includes(verified.code));

    // ---------- Rework keeps history and creates a new attempt ----------
    await admin.request('/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ categoryId: '2', location: "Registrar's Office", title: 'Printer paper jam' }),
    });
    const req2 = readDb().requests.find((r) => r.title === 'Printer paper jam');
    await admin.request(`/requests/${req2.id}/approve`, {
      method: 'POST',
      body: formData({ severity: '2', technicianId: '2', targetDate }, [{ name: 'photos' }]),
    });
    await tech.request(`/requests/${req2.id}/status`, {
      method: 'POST',
      body: formData({ action: 'start', note: 'Clearing jam' }, [{ name: 'photos' }]),
    });
    await tech.request(`/requests/${req2.id}/materials`, {
      method: 'POST',
      body: formData({ materials: JSON.stringify([{ materialName: 'Roller', unitPrice: '10.00', quantity: '1', unit: 'pc', purpose: 'Feed roller' }]), idempotencyKey: 'r2' },
        [{ name: 'materialPhotos' }]),
    });
    await tech.request(`/requests/${req2.id}/nearing-completion`, {
      method: 'POST', body: formData({ remarks: 'Testing feed' }, [{ name: 'photos' }]),
    });
    await tech.request(`/requests/${req2.id}/complete`, {
      method: 'POST',
      body: formData({ problem: 'Jam', actionsTaken: 'Cleaned feed path', remarks: 'Done', serviceDate: today }, [{ name: 'photos' }]),
    });
    check('Second repair reaches Awaiting Verification',
      readDb().requests.find((r) => r.id === req2.id).verificationStatus === 'Awaiting Verification');

    const rework = await admin.request(`/requests/${req2.id}/rework`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ reason: 'Paper still jams under load' }),
    });
    check('Rework request redirects', rework.status === 302, `status ${rework.status}`);
    db = readDb();
    let rw = db.requests.find((r) => r.id === req2.id);
    check('Rework sets Rework Required and returns to In Progress',
      rw.verificationStatus === 'Rework Required' && rw.status === 'In Progress',
      `${rw.status} / ${rw.verificationStatus}`);
    const materialsBeforeRework = db.materials.filter((m) => m.requestId === req2.id).length;
    const proofsBeforeRework = db.attachments.filter((a) => a.requestId === req2.id).length;

    const reworkStart = await tech.request(`/requests/${req2.id}/rework/start`, {
      method: 'POST',
      body: formData({ remarks: 'Replacing worn roller' }, [{ name: 'photos', filename: 'rework.png' }]),
    });
    check('Rework start redirects', reworkStart.status === 302, `status ${reworkStart.status}`);
    db = readDb();
    rw = db.requests.find((r) => r.id === req2.id);
    check('Rework start creates a new attempt',
      db.repairAttempts.filter((a) => a.requestId === req2.id).length === 2,
      db.repairAttempts.filter((a) => a.requestId === req2.id).length);
    check('Rework start returns status to In Progress with verification reset',
      rw.status === 'In Progress' && rw.verificationStatus === 'Not Submitted',
      `${rw.status} / ${rw.verificationStatus}`);
    check('Rework preserves existing materials and proof',
      db.materials.filter((m) => m.requestId === req2.id).length === materialsBeforeRework &&
      db.attachments.filter((a) => a.requestId === req2.id).length === proofsBeforeRework + 1);
    check('Rework proof uses the rework stage',
      db.attachments.some((a) => a.requestId === req2.id && a.stage === 'rework'));

    await tech.request(`/requests/${req2.id}/nearing-completion`, {
      method: 'POST', body: formData({ remarks: 'Retesting' }, [{ name: 'photos' }]),
    });
    await tech.request(`/requests/${req2.id}/complete`, {
      method: 'POST',
      body: formData({ problem: 'Jam', actionsTaken: 'Replaced roller', remarks: 'Fixed', serviceDate: today }, [{ name: 'photos' }]),
    });
    await admin.request(`/requests/${req2.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ confirm: 'yes', remarks: 'Second check passed' }),
    });
    check('Reworked repair can be completed and verified again',
      readDb().requests.find((r) => r.id === req2.id).verificationStatus === 'Verified');

    // ---------- Materials expenses and filters ----------
    const expensesRes = await admin.request('/materials');
    const expenses = await expensesRes.text();
    check('Materials Expenses page returns 200', expensesRes.status === 200,
      `status ${expensesRes.status} :: ${log.trim().slice(-1800)}`);
    check('Materials Expenses page renders', expenses.includes('Overall Materials Expenses') && expenses.includes('₱41.84'),
      'expected ₱41.84 = ₱31.84 + ₱10.00');
    check('Materials Expenses exposes all period filters',
      ['Today', 'Weekly (last 7 days)', 'Monthly', 'Yearly', 'Custom range'].every((s) => expenses.includes(s)));
    const todayFilter = await (await admin.request('/materials?range=today')).text();
    check('Today filter returns recorded materials', todayFilter.includes('Replacement fuse'));
    const oldFilter = await (await admin.request('/materials?range=custom&from=2000-01-01&to=2000-01-02')).text();
    check('Custom range excludes out-of-range records', oldFilter.includes('No material records found'));
    const expenseDetail = await (await admin.request(`/materials/${req1.id}`)).text();
    check('Materials detail shows repair, personnel and elapsed time',
      expenseDetail.includes('Elapsed Repair Time') && expenseDetail.includes('Assigned Personnel'));
    const techExpenses = await tech.request('/materials');
    check('Materials Expenses is Administrator-only', techExpenses.status === 403, `status ${techExpenses.status}`);

    // ---------- Timeline and automatic refresh ----------
    const timelineRes = await admin.request(`/requests/${req1.id}/timeline`);
    const timeline = await timelineRes.json();
    check('Timeline endpoint returns 200 JSON', timelineRes.status === 200 && Array.isArray(timeline.timeline));
    check('Timeline includes attempts, materials and verification decisions',
      ['Repair attempt', 'Material:', 'Completion verified'].every((s) =>
        timeline.timeline.some((t) => t.title.includes(s))));
    check('Timeline carries the current revision', Number.isInteger(timeline.revision));

    // ---------- Pure helpers (deterministic formatting / math) ----------
    const helpers = require('../src/helpers');
    const money = require('../src/services/money');
    check('Asia/Manila display converts UTC dates',
      /Nov 24, 2026/.test(helpers.fmtManila('2026-11-23T16:30:00.000Z')),
      helpers.fmtManila('2026-11-23T16:30:00.000Z'));
    check('Money parser rejects more than 2 decimals', (() => {
      try { money.parseCents('1.234'); return false; } catch (e) { return true; }
    })());
    check('Quantity parser rejects zero', (() => {
      try { money.parseQuantity('0'); return false; } catch (e) { return true; }
    })());
    check('Subtotal uses exact scaled integer math', money.subtotalCents(1234, 2500) === 3085);
    check('Duration formatter renders days/hours/minutes',
      helpers.formatDuration((2 * 1440 + 3 * 60 + 4) * 60000) === '2 days 3 hours 4 minutes');

    // ---------- Migration is idempotent and preserves legacy records ----------
    const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'educare-migrate-'));
    const migData = path.join(migDir, 'data');
    fs.mkdirSync(migData, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'data', 'db.json'), path.join(migData, 'db.json'));
    const before = JSON.parse(fs.readFileSync(path.join(migData, 'db.json'), 'utf8'));
    const runMigration = () => spawnSync(process.execPath, ['scripts/migrate-repair-workflow.js'], {
      cwd: ROOT, env: { ...process.env, DATA_DIR: migData }, encoding: 'utf8',
    });
    const mig1 = runMigration();
    const after1 = JSON.parse(fs.readFileSync(path.join(migData, 'db.json'), 'utf8'));
    check('Migration script succeeds', mig1.status === 0, mig1.stderr || mig1.stdout);
    check('Migration creates a backup', fs.readdirSync(path.join(migData, 'backups')).some((f) => f.includes('db-before-repair-workflow')));
    check('Migration preserves every existing request', after1.requests.length === before.requests.length,
      `${before.requests.length} -> ${after1.requests.length}`);
    check('Migration fills reportedAt on legacy requests', after1.requests.every((r) => !!r.reportedAt));
    check('Migration sets verification status on legacy requests',
      after1.requests.every((r) => !!r.verificationStatus));
    check('Migration derives attempts only from started/completed records',
      after1.repairAttempts.length === before.requests.filter((r) => r.startedAt || r.completedAt).length,
      after1.repairAttempts.length);
    check('Migration invents no materials or demo records', after1.materials.length === (before.materials || []).length);
    const mig2 = runMigration();
    const after2 = JSON.parse(fs.readFileSync(path.join(migData, 'db.json'), 'utf8'));
    check('Migration is idempotent',
      mig2.status === 0 && after2.repairAttempts.length === after1.repairAttempts.length &&
      after2.requests.length === after1.requests.length);
    fs.rmSync(migDir, { recursive: true, force: true });

  } catch (err) {
    check('Harness completed without exception', false, err.stack || err.message);
  } finally {
    child.kill('SIGTERM');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed }, null, 2));
  fs.rmSync(prep.dir, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
})();
