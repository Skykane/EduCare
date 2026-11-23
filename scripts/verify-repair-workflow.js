/**
 * End-to-end verification for the seven-status Administrator / Maintenance
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

// Canonical stored statuses. The approval label uses an en dash (U+2013).
const STATUS = {
  PENDING: 'Pending Approval',
  APPROVED: 'Approved – Awaiting Assignment',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
};
const ALL_STATUSES = Object.values(STATUS);

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

  // The live fixture has one technician. Add a second one to the temp copy so
  // the reassign path can be exercised with two genuinely different ids.
  const maxUserId = db.users.reduce((m, u) => Math.max(m, Number(u.id) || 0), 0);
  const secondTechId = maxUserId + 1;
  const now = new Date().toISOString();
  db.users.push({
    id: secondTechId,
    name: 'Verify Technician',
    email: 'verify.technician@educare.local',
    role: 'technician',
    active: true,
    availability: 'Available',
    approvalStatus: 'approved',
    mustChangePassword: false,
    passwordHash: hash,
    specializations: [],
    createdAt: now,
    updatedAt: now,
  });
  db.meta.counters.users = secondTechId;
  // The fixture technician starts Busy; every technician must be assignable at
  // the start of the harness. Workflow actions recalculate availability.
  for (const u of db.users) {
    if (u.role === 'technician') u.availability = 'Available';
  }

  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db, null, 2));
  return { dir, dataDir, uploadDir, secondTechId };
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

  const ADMIN = 1;
  const TECH = 2;
  const TECH2 = prep.secondTechId;
  const REQUESTER = 3;

  const admin = makeClient();
  const tech = makeClient();       // first technician (TECH)
  const tech2 = makeClient();      // second technician (TECH2)
  const requester = makeClient();
  const readDb = () => JSON.parse(fs.readFileSync(path.join(prep.dataDir, 'db.json'), 'utf8'));
  const findReq = (id) => readDb().requests.find((r) => r.id === id);
  const findUser = (id) => readDb().users.find((u) => u.id === id);
  const activitiesFor = (id) => readDb().activities.filter((a) => a.requestId === id);
  const hasNotif = (userId, pattern) =>
    readDb().notifications.some((n) => n.userId === userId && pattern.test(n.message));
  const body = async (res) => (await res.text()).slice(0, 500);

  // Every major status transition must be attributed to an actor and timestamp.
  function assertTransition(label, requestId, actorId, from, to, action) {
    const rows = activitiesFor(requestId).filter((a) =>
      a.userId === actorId && a.toStatus === to && !!a.createdAt &&
      (action === undefined || a.action === action) &&
      (from === null || a.fromStatus === from)
    );
    check(label, rows.length > 0, rows.length ? '' : JSON.stringify(
      activitiesFor(requestId).map((a) => ({ action: a.action, userId: a.userId, from: a.fromStatus, to: a.toStatus }))
    ));
  }

  async function submitReport(client, fields, files = []) {
    return client.request('/requests', {
      method: 'POST',
      body: formData(fields, files),
    });
  }

  async function approveRequest(id, extra = {}) {
    return admin.request(`/requests/${id}/approve`, {
      method: 'POST',
      body: formData({ severity: '3', priority: 'auto', note: 'Approved after review', ...extra }),
    });
  }

  const START_PHOTO = [{ name: 'photos', filename: 'start-proof.png' }];
  const COMPLETION_PHOTO = [{ name: 'photos', filename: 'completion.png' }];

  async function startWork(client, id, note, files = START_PHOTO) {
    return client.request(`/requests/${id}/status?action=start`, {
      method: 'POST',
      body: formData({ action: 'start', note }, files),
    });
  }

  async function completeWork(client, id, fields = {}, files = COMPLETION_PHOTO) {
    return client.request(`/requests/${id}/complete`, {
      method: 'POST',
      body: formData({
        problem: 'Power board fuse failure',
        actionsTaken: 'Replaced fuse and re-soldered connector',
        partsReplaced: '2x fuse',
        serviceDate: new Date().toISOString().slice(0, 10),
        resultingStatus: 'Operational',
        remarks: 'Verified boot and charging',
        photoNote: 'final state',
        ...fields,
      }, files),
    });
  }

  try {
    const ready = await waitForServer();
    check('Temporary EduCare server starts with workflow code', ready, log.trim().slice(0, 300));
    if (!ready) return;

    // ---------- 1. Authentication and role dashboards ----------
    check('Administrator login succeeds', (await admin.login('admin@educare.local')).status === 302);
    check('Maintenance personnel login succeeds', (await tech.login('joverttorres1@gmail.com')).status === 302);
    check('Second technician login succeeds', (await tech2.login('verify.technician@educare.local')).status === 302);
    check('Requester login succeeds', (await requester.login('adrian.santos@student.educare.local')).status === 302);

    const adminDash = await (await admin.request('/')).text();
    check('Administrator dashboard shows all five workflow sections', [
      'Pending Approval', 'Awaiting Assignment', 'Active Tasks',
      'Completed Requests', 'Rejected Requests',
    ].every((s) => adminDash.includes(s)));
    check('Administrator dashboard has no obsolete Nearing Completion stage',
      !adminDash.includes('Nearing Completion'));
    const adminNav = require('../src/helpers').navFor('admin');
    check('Administrator navigation has Materials Expenses tab',
      adminNav.some((item) => (item.tabs || []).some((tab) => tab.label === 'Materials Expenses')));
    check('Administrator dashboard shows technician availability',
      adminDash.includes('Technician Availability') && adminDash.includes('Verify Technician'));

    const techDash = await (await tech.request('/')).text();
    check('Maintenance dashboard shows active and completed views', [
      'My Active Tasks', 'In Progress / On Hold', 'Recently Completed',
    ].every((s) => techDash.includes(s)));
    check('Maintenance dashboard has no obsolete Nearing Completion stage',
      !techDash.includes('Nearing Completion'));
    const bottomNav = require('../src/helpers').bottomNavFor('technician');
    check('Maintenance bottom navigation uses History (no duplicate Schedule tab)',
      bottomNav.some((x) => x.href === '/history' && x.label === 'History') &&
      !bottomNav.some((x) => x.href === '/schedule'));

    const requestList = await (await admin.request('/requests')).text();
    check('Requests page exposes all seven status filters and no legacy stage',
      ALL_STATUSES.every((s) => requestList.includes(s)) && !requestList.includes('Nearing Completion'));

    // ---------- 2. Report submission ----------
    const submitPage = await (await requester.request('/requests?openModal=1')).text();
    check('Submit Request form has no equipment selector',
      !submitPage.includes('name="equipmentId"') && !submitPage.includes('Select equipment…'));
    check('Submit Request form collects category and location',
      submitPage.includes('name="categoryId"') && submitPage.includes('name="location"'));
    check('Step 2 has one photo capture area with no duplicated dropzone id',
      submitPage.includes('photo-dropzone dropzone') && !submitPage.includes('id="modal-dropzone"'));
    check('Step 2 keeps Camera, Gallery and photo upload actions',
      ['modal-pick-camera', 'modal-pick-gallery', 'photo-gallery-trigger'].every((id) => submitPage.includes(id)));

    const targetDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const submit = await submitReport(requester, {
      categoryId: '1', location: 'Computer Laboratory', title: 'Laptop will not power on',
      description: 'Reported from the computer lab during class.',
    }, [{ name: 'photos', filename: 'report-proof.png' }]);
    check('Requester report submission redirects to the new request', submit.status === 302,
      `status ${submit.status} :: ${await body(submit)}`);
    let db = readDb();
    const req1 = db.requests.find((r) => r.title === 'Laptop will not power on');
    check('New report is stored exactly as Pending Approval', req1 && req1.status === STATUS.PENDING,
      req1 && req1.status);
    check('New report stores submittedAt and reportedAt', !!(req1 && req1.submittedAt && req1.reportedAt));
    check('New report starts at Not Submitted verification', req1 && req1.verificationStatus === 'Not Submitted');
    check('User submission does not link equipment', req1 && req1.equipmentId == null,
      req1 && req1.equipmentId);
    check('User submission stores category, location and title',
      req1 && req1.categoryId === 1 && req1.location === 'Computer Laboratory' &&
      req1.title === 'Laptop will not power on',
      req1 && `${req1.categoryId} / ${req1.location} / ${req1.title}`);
    check('Report photo is stored as report-stage proof',
      db.attachments.some((a) => a.requestId === req1.id && a.stage === 'report'));
    check('Administrators are notified of the new report',
      hasNotif(ADMIN, /New repair request/));
    assertTransition('Submission is logged with requester actor and target status',
      req1.id, REQUESTER, null, STATUS.PENDING, 'Report submitted');
    const requesterPendingPage = await requester.request(`/requests/${req1.id}`);
    const adminPendingPage = await admin.request(`/requests/${req1.id}`);
    check('Requester can open their pending request details', requesterPendingPage.status === 200);
    check('Admin can open pending request review and approval controls',
      adminPendingPage.status === 200 && (await adminPendingPage.text()).includes('Administrator Approval'));

    const dup = await requester.request('/requests', {
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

    // ---------- 3. Role enforcement before assignment ----------
    const techStart = await tech.request(`/requests/${req1.id}/status?action=start`, {
      method: 'POST',
      body: formData({ action: 'start', note: 'unassigned' }, [{ name: 'photos' }]),
    });
    check('Unassigned technician cannot start a repair', techStart.status === 403,
      `status ${techStart.status}`);
    const techVerify = await tech.request(`/requests/${req1.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ confirm: 'yes' }),
    });
    check('Technician cannot verify a repair', techVerify.status === 403,
      `status ${techVerify.status}`);
    check('Unassigned start/verify attempts did not change status',
      findReq(req1.id).status === STATUS.PENDING);

    // ---------- 4. Approval (review only, no assignment) ----------
    const approve = await admin.request(`/requests/${req1.id}/approve`, {
      method: 'POST',
      // A legacy form may still post a proof file: approval must discard it.
      body: formData(
        { severity: '3', priority: 'auto', note: 'Prioritize lab laptop' },
        [{ name: 'photos', filename: 'legacy-assignment-proof.png' }]
      ),
    });
    check('Administrator approval redirects', approve.status === 302,
      `status ${approve.status} :: ${await body(approve)}`);
    db = readDb();
    const approved = findReq(req1.id);
    check('Approval sets exactly Approved – Awaiting Assignment (en dash)',
      approved.status === STATUS.APPROVED, approved.status);
    check('Approval records approvedAt and approvedBy',
      !!approved.approvedAt && approved.approvedBy === ADMIN);
    check('Approval leaves technicianId null', approved.technicianId == null,
      approved.technicianId);
    check('Approval stores no assignment proof row',
      !db.attachments.some((a) => a.requestId === req1.id && a.stage === 'assignment') &&
      !db.attachments.some((a) => a.originalName === 'legacy-assignment-proof.png'));
    check('Requester is notified that approval awaits assignment',
      hasNotif(REQUESTER, /approved and is awaiting technician assignment/));
    assertTransition('Approval is logged with admin actor and canonical transition',
      req1.id, ADMIN, STATUS.PENDING, STATUS.APPROVED, 'Request approved');
    const adminAwaitingPage = await admin.request(`/requests/${req1.id}`);
    const requesterAwaitingPage = await requester.request(`/requests/${req1.id}`);
    check('Admin can open approved request and assignment controls',
      adminAwaitingPage.status === 200 && (await adminAwaitingPage.text()).includes('Assign Technician'));
    check('Requester can track approved request awaiting assignment', requesterAwaitingPage.status === 200);

    const dupApprove = await approveRequest(req1.id);
    check('A second approval is rejected while awaiting assignment',
      dupApprove.status === 302 && findReq(req1.id).status === STATUS.APPROVED,
      `status ${dupApprove.status}, state ${findReq(req1.id).status}`);

    // ---------- 5. Assignment, duplicate guard and reassign ----------
    const assign = await admin.request(`/requests/${req1.id}/assign`, {
      method: 'POST',
      body: formData({ technicianId: String(TECH), targetDate, note: 'Initial dispatch' }),
    });
    check('Administrator assignment redirects', assign.status === 302,
      `status ${assign.status} :: ${await body(assign)}`);
    db = readDb();
    let assigned = findReq(req1.id);
    check('Assignment sets exactly Assigned', assigned.status === STATUS.ASSIGNED, assigned.status);
    check('Assignment records technicianId, assignedAt and assignedBy',
      assigned.technicianId === TECH && !!assigned.assignedAt && assigned.assignedBy === ADMIN,
      `${assigned.technicianId} / ${assigned.assignedAt} / ${assigned.assignedBy}`);
    check('Technician is notified of the new assignment',
      hasNotif(TECH, new RegExp(req1.code)) && hasNotif(TECH, /New assignment/));
    check('Requester is notified of the assigned technician',
      hasNotif(REQUESTER, /has been assigned to technician/));
    check('Assigned technician availability becomes Busy',
      findUser(TECH).availability === 'Busy', findUser(TECH).availability);
    assertTransition('Assignment is logged with admin actor and canonical transition',
      req1.id, ADMIN, STATUS.APPROVED, STATUS.ASSIGNED, 'Technician assigned');
    const assignedTechPage = await tech.request(`/requests/${req1.id}`);
    const requesterAssignedPage = await requester.request(`/requests/${req1.id}`);
    check('Assigned technician can open the task and start-work controls',
      assignedTechPage.status === 200 && (await assignedTechPage.text()).includes('Start Repair'));
    check('Requester can track the assigned technician', requesterAssignedPage.status === 200 &&
      (await requesterAssignedPage.text()).includes('Assigned to'));

    const dupAssign = await admin.request(`/requests/${req1.id}/assign`, {
      method: 'POST',
      body: formData({ technicianId: String(TECH) }),
    });
    db = readDb();
    check('Duplicate assignment to the same technician is rejected',
      dupAssign.status === 302 && findReq(req1.id).technicianId === TECH &&
      activitiesFor(req1.id).filter((a) => a.action === 'Technician assigned').length === 1,
      `status ${dupAssign.status}, tech ${findReq(req1.id).technicianId}`);

    const reassign = await admin.request(`/requests/${req1.id}/reassign`, {
      method: 'POST',
      body: formData({ technicianId: String(TECH2), reassignReason: 'Balance the workload' }),
    });
    check('Administrator reassign redirects', reassign.status === 302,
      `status ${reassign.status} :: ${await body(reassign)}`);
    db = readDb();
    assigned = findReq(req1.id);
    check('Reassign keeps Assigned and swaps technician',
      assigned.status === STATUS.ASSIGNED && assigned.technicianId === TECH2 &&
      !!assigned.assignedAt && assigned.assignedBy === ADMIN,
      `${assigned.status} / ${assigned.technicianId}`);
    check('Reassign availability recalculated for both technicians',
      findUser(TECH2).availability === 'Busy' && findUser(TECH).availability === 'Available',
      `${findUser(TECH).availability} / ${findUser(TECH2).availability}`);
    check('Old technician, new technician and requester are notified with the reason',
      hasNotif(TECH, /was reassigned to/) && hasNotif(TECH2, /has been reassigned to you/) &&
      hasNotif(REQUESTER, /has been reassigned to .*Balance the workload/));
    assertTransition('Reassign is logged with admin actor and canonical transition',
      req1.id, ADMIN, STATUS.ASSIGNED, STATUS.ASSIGNED, 'Technician reassigned');

    const formerTechDetail = await tech.request(`/requests/${req1.id}`);
    check('Former technician cannot view a task after reassignment', formerTechDetail.status === 403,
      `status ${formerTechDetail.status}`);
    const formerTechPhoto = await tech.request(`/requests/${req1.id}/attachments`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData({ stage: 'before' }, [{ name: 'photos', filename: 'unauthorized.png' }]),
    });
    check('Former technician cannot upload task attachments after reassignment',
      formerTechPhoto.status === 403 &&
      !readDb().attachments.some((a) => a.requestId === req1.id && a.originalName === 'unauthorized.png'),
      `status ${formerTechPhoto.status}`);

    const dupReassign = await admin.request(`/requests/${req1.id}/reassign`, {
      method: 'POST',
      body: formData({ technicianId: String(TECH2), reassignReason: 'Again' }),
    });
    check('Reassigning to the same technician is rejected',
      dupReassign.status === 302 && findReq(req1.id).technicianId === TECH2 &&
      activitiesFor(req1.id).filter((a) => a.action === 'Technician reassigned').length === 1,
      `status ${dupReassign.status}, tech ${findReq(req1.id).technicianId}`);

    // Active-task guards: busy technician cannot be assigned again or self-set Available.
    const busySelf = await tech2.request(`/technicians/${TECH2}/availability`, {
      method: 'POST',
      body: formData({ availability: 'Available', back: `/technicians/${TECH2}` }),
    });
    check('Busy technician cannot self-set availability to Available',
      busySelf.status === 302 && findUser(TECH2).availability === 'Busy',
      `status ${busySelf.status}, availability ${findUser(TECH2).availability}`);

    const busyTarget = await submitReport(requester, { categoryId: '1', location: 'Computer Laboratory', title: 'Busy-guard request', description: 'Temporary request for assignment guard.' });
    check('Busy-guard report submitted', busyTarget.status === 302, `status ${busyTarget.status}`);
    const reqBusy = readDb().requests.find((x) => x.title === 'Busy-guard request');
    check('Busy-guard request approved',
      (await approveRequest(reqBusy.id)).status === 302 && findReq(reqBusy.id).status === STATUS.APPROVED);
    const assignBusy = await admin.request(`/requests/${reqBusy.id}/assign`, {
      method: 'POST',
      body: formData({ technicianId: String(TECH2), targetDate }),
    });
    check('Assignment to technician with active tasks is rejected',
      assignBusy.status === 302 && findReq(reqBusy.id).status === STATUS.APPROVED && !findReq(reqBusy.id).technicianId,
      `status ${assignBusy.status}, state ${findReq(reqBusy.id).status}, tech ${findReq(reqBusy.id).technicianId}`);
    // Clean up the guard request so it doesn't affect later counts.
    await admin.request(`/requests/${reqBusy.id}/reject`, {
      method: 'POST',
      body: formData({ reason: 'Temporary guard request no longer needed.' }),
    });
    check('Busy-guard request cleaned up by rejection',
      findReq(reqBusy.id).status === STATUS.REJECTED, findReq(reqBusy.id).status);

    // Rejecting an assigned-but-not-started request must unassign and free the technician.
    const assignRejectTarget = await submitReport(requester, { categoryId: '1', location: 'Computer Laboratory', title: 'Assigned-reject guard', description: 'Temporary request for reject cleanup.' });
    const reqAR = readDb().requests.find((x) => x.title === 'Assigned-reject guard');
    await approveRequest(reqAR.id);
    await admin.request(`/requests/${reqAR.id}/assign`, {
      method: 'POST',
      body: formData({ technicianId: String(TECH), targetDate }),
    });
    check('Assigned-reject guard is assigned to available technician',
      findReq(reqAR.id).status === STATUS.ASSIGNED && findReq(reqAR.id).technicianId === TECH,
      `${findReq(reqAR.id).status} / ${findReq(reqAR.id).technicianId}`);
    const rejectAssigned = await admin.request(`/requests/${reqAR.id}/reject`, {
      method: 'POST',
      body: formData({ reason: 'Rejected before work started for workflow validation.' }),
    });
    db = readDb();
    const rejectedAssigned = findReq(reqAR.id);
    check('Rejecting assigned request redirects', rejectAssigned.status === 302, `status ${rejectAssigned.status}`);
    check('Rejecting assigned request clears assignment and sets Rejected',
      rejectedAssigned.status === STATUS.REJECTED && !rejectedAssigned.technicianId &&
      !rejectedAssigned.assignedAt && !rejectedAssigned.assignedBy,
      `${rejectedAssigned.status} / ${rejectedAssigned.technicianId}`);
    check('Rejecting assigned request restores technician availability',
      findUser(TECH).availability === 'Available', findUser(TECH).availability);
    check('Withdrawn technician receives notification',
      hasNotif(TECH, new RegExp(`${reqAR.code}.*withdrawn|${reqAR.code}.*rejected`, 'i')) ||
      db.notifications.some((n) => n.userId === TECH && String(n.message).includes(reqAR.code) && /withdrawn|rejected/i.test(n.message)));

    // ---------- 6. Start requires remarks; photo proof is optional ----------
    const badStart = await startWork(tech2, req1.id, '', []);
    check('Start without remarks is rejected',
      badStart.status === 302 && findReq(req1.id).status === STATUS.ASSIGNED,
      `status ${badStart.status}, state ${findReq(req1.id).status}`);
    check('No repair attempt created by rejected start', readDb().repairAttempts.length === 0);

    const start = await startWork(tech2, req1.id, 'Inspected power circuit', []);
    check('Repair start without photo redirects', start.status === 302, `status ${start.status}`);
    db = readDb();
    check('Repair start changes status to In Progress',
      findReq(req1.id).status === STATUS.IN_PROGRESS, findReq(req1.id).status);
    const inProgressTechPage = await tech2.request(`/requests/${req1.id}`);
    check('Assigned technician can open in-progress work and completion controls',
      inProgressTechPage.status === 200 && (await inProgressTechPage.text()).includes('Complete Repair'));
    check('Repair start creates a tracked attempt for the assigned technician',
      db.repairAttempts.length === 1 && !!db.repairAttempts[0].startedAt &&
      db.repairAttempts[0].startedBy === TECH2 && db.repairAttempts[0].requestId === req1.id);
    check('No start attachment is created when no photo is provided',
      !db.attachments.some((a) => a.requestId === req1.id && a.stage === 'start'));
    check('Busy availability persists during active work', findUser(TECH2).availability === 'Busy');
    assertTransition('Start is logged with technician actor and canonical transition',
      req1.id, TECH2, STATUS.ASSIGNED, STATUS.IN_PROGRESS, 'Work started');

    // Equipment scope: unrelated technician cannot change condition/maintenance.
    let scopeEq = readDb().equipment[0];
    if (!scopeEq) {
      const createEq = await admin.request('/equipment', {
        method: 'POST',
        body: formData({ code: 'EQ-SCOPE', name: 'Scope Test Equipment', categoryId: '1', department: 'ICT', location: 'Computer Laboratory', status: 'Operational', importance: '3', maintenanceIntervalDays: '180' }),
      });
      scopeEq = readDb().equipment.find((e) => e.code === 'EQ-SCOPE') || readDb().equipment[0];
    }
    if (scopeEq) {
      const eqStatus = await tech.request(`/equipment/${scopeEq.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status: 'Operational', note: 'should not be allowed' }),
      });
      check('Unrelated technician cannot change equipment condition',
        eqStatus.status === 403, `status ${eqStatus.status}`);
      const eqMaint = await tech.request(`/equipment/${scopeEq.id}/maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ type: 'Preventive', problem: 'x', actionsTaken: 'y', serviceDate: new Date().toISOString().slice(0, 10), resultingStatus: 'Operational' }),
      });
      check('Unrelated technician cannot log equipment maintenance',
        eqMaint.status === 403, `status ${eqMaint.status}`);
    } else {
      check('Unrelated technician cannot change equipment condition', false, 'no equipment available in test DB');
      check('Unrelated technician cannot log equipment maintenance', false, 'no equipment available in test DB');
    }

    // ---------- 7. Materials with exact money math and per-item proof ----------
    const items = [
      { materialName: 'Replacement fuse', unitPrice: '12.34', quantity: '2.5', unit: 'pc', purpose: 'Power board repair', subtotalCents: 1 },
      { materialName: 'Solder wire', unitPrice: '0.33', quantity: '3', unit: 'm', purpose: 'Reconnecting connector' },
    ];
    const badMaterials = await tech2.request(`/requests/${req1.id}/materials`, {
      method: 'POST',
      body: formData({ materials: JSON.stringify(items), idempotencyKey: 'bad' }),
    });
    check('Materials without photo proof are rejected',
      badMaterials.status === 302 && readDb().materials.length === 0,
      `status ${badMaterials.status}, materials ${readDb().materials.length}`);

    const goodMaterials = await tech2.request(`/requests/${req1.id}/materials`, {
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

    const repeatBatch = await tech2.request(`/requests/${req1.id}/materials`, {
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

    // ---------- 8. Hold / resume ----------
    const hold = await tech2.request(`/requests/${req1.id}/status?action=hold`, {
      method: 'POST',
      body: formData({ action: 'hold', note: 'Waiting for replacement fuse' }),
    });
    check('Hold redirects', hold.status === 302, `status ${hold.status}`);
    check('Hold sets exactly On Hold', findReq(req1.id).status === STATUS.ON_HOLD, findReq(req1.id).status);
    check('Requester is notified of the hold reason',
      hasNotif(REQUESTER, /on hold\. Reason: Waiting for replacement fuse/));
    assertTransition('Hold is logged with technician actor and canonical transition',
      req1.id, TECH2, STATUS.IN_PROGRESS, STATUS.ON_HOLD, 'Put on hold');

    const resume = await tech2.request(`/requests/${req1.id}/status?action=resume`, {
      method: 'POST',
      body: formData({ action: 'resume' }),
    });
    check('Resume redirects', resume.status === 302, `status ${resume.status}`);
    check('Resume returns exactly to In Progress', findReq(req1.id).status === STATUS.IN_PROGRESS,
      findReq(req1.id).status);
    assertTransition('Resume is logged with technician actor and canonical transition',
      req1.id, TECH2, STATUS.ON_HOLD, STATUS.IN_PROGRESS, 'Work resumed');

    // ---------- 9. Completion (photos are optional) ----------
    const complete = await completeWork(tech2, req1.id, {}, []);
    check('Completion without final photo redirects', complete.status === 302,
      `status ${complete.status} :: ${await body(complete)}`);
    db = readDb();
    const done = findReq(req1.id);
    check('Completion sets exactly Completed with Awaiting Verification sub-track',
      done.status === STATUS.COMPLETED && done.verificationStatus === 'Awaiting Verification',
      `${done.status} / ${done.verificationStatus}`);
    check('Completion timestamp, maintenance record and notes are stored',
      !!done.completedAt && done.completionNotes === 'Verified boot and charging' &&
      db.maintenanceRecords.some((m) => m.requestId === req1.id &&
        m.actionsTaken === 'Replaced fuse and re-soldered connector'));
    check('No completion attachment is created when no photo is provided',
      !db.attachments.some((a) => a.requestId === req1.id && a.stage === 'completion'));
    const attempt1 = db.repairAttempts.find((a) => a.requestId === req1.id);
    check('Attempt completion and elapsed time are stored',
      !!attempt1.completedAt && new Date(attempt1.completedAt) >= new Date(attempt1.startedAt));
    check('Requester and administrators are notified of completion',
      hasNotif(REQUESTER, /is completed and awaiting verification. Work performed: Replaced fuse/) &&
      hasNotif(ADMIN, /is completed and awaiting verification/));
    check('Technician availability is recalculated after completion',
      findUser(TECH2).availability === 'Available', findUser(TECH2).availability);
    assertTransition('Completion is logged with technician actor and canonical transition',
      req1.id, TECH2, STATUS.IN_PROGRESS, STATUS.COMPLETED, 'Repair completed');

    const state2 = await (await admin.request('/requests/api/state')).json();
    check('Revision increments after workflow writes', state2.revision > state1.revision,
      `${state1.revision} -> ${state2.revision}`);

    // Verification is a sub-track under Completed for the first repair.
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
    const verified = findReq(req1.id);
    check('Verification sets Verified with timestamp and verifier',
      verified.verificationStatus === 'Verified' && !!verified.verifiedAt && verified.verifiedBy === ADMIN);
    check('Verified repair keeps its Completed status', verified.status === STATUS.COMPLETED);
    check('Verification is recorded on the attempt',
      db.repairAttempts.some((a) => a.requestId === req1.id && a.verificationResult === 'Verified'));
    check('Verified repair appears in verified history',
      (await (await admin.request('/history')).text()).includes(verified.code));

    // ---------- 10. Rework (second request, admin submits; completed from On Hold) ----------
    const submit2 = await submitReport(admin, {
      categoryId: '2', location: "Registrar's Office", title: 'Printer paper jam',
      description: 'Paper jams under load in the registrar printer.',
    }, [{ name: 'photos', filename: 'report2.png' }]);
    check('Administrator can also submit a report', submit2.status === 302,
      `status ${submit2.status}`);
    const req2 = readDb().requests.find((r) => r.title === 'Printer paper jam');
    check('Second report starts in Pending Approval', req2 && req2.status === STATUS.PENDING);
    check('Second approval moves to Approved – Awaiting Assignment',
      (await approveRequest(req2.id)).status === 302 && findReq(req2.id).status === STATUS.APPROVED,
      findReq(req2.id).status);
    check('Second assignment goes to the now-available first technician',
      (await admin.request(`/requests/${req2.id}/assign`, {
        method: 'POST', body: formData({ technicianId: String(TECH), targetDate }),
      })).status === 302 && findReq(req2.id).technicianId === TECH);
    check('First technician is Busy again after the second assignment',
      findUser(TECH).availability === 'Busy');
    check('Second repair starts', (await startWork(tech, req2.id, 'Clearing jam')).status === 302 &&
      findReq(req2.id).status === STATUS.IN_PROGRESS);
    db = readDb();
    check('Start photo is saved when provided',
      db.attachments.some((a) => a.requestId === req2.id && a.stage === 'start'));
    check('Second repair records materials',
      (await tech.request(`/requests/${req2.id}/materials`, {
        method: 'POST',
        body: formData({
          materials: JSON.stringify([{ materialName: 'Roller', unitPrice: '10.00', quantity: '1', unit: 'pc', purpose: 'Feed roller' }]),
          idempotencyKey: 'r2',
        }, [{ name: 'materialPhotos', filename: 'roller.png' }]),
      })).status === 302);

    check('Second repair can be put on hold',
      (await tech.request(`/requests/${req2.id}/status?action=hold`, {
        method: 'POST', body: formData({ action: 'hold', note: 'Awaiting roller delivery' }),
      })).status === 302 && findReq(req2.id).status === STATUS.ON_HOLD);

    const completeFromHold = await completeWork(tech, req2.id, {
      problem: 'Jam', actionsTaken: 'Cleaned feed path', remarks: 'Done',
    });
    check('Completion from On Hold is allowed (no Nearing Completion stage)',
      completeFromHold.status === 302 && findReq(req2.id).status === STATUS.COMPLETED,
      `${completeFromHold.status} / ${findReq(req2.id).status}`);
    db = readDb();
    check('Completion photo is saved when provided',
      db.attachments.some((a) => a.requestId === req2.id && a.stage === 'completion'));
    assertTransition('On Hold completion is logged as a canonical transition',
      req2.id, TECH, STATUS.ON_HOLD, STATUS.COMPLETED, 'Repair completed');
    check('Second repair is awaiting verification before any rework',
      findReq(req2.id).verificationStatus === 'Awaiting Verification' &&
      findReq(req2.id).status === STATUS.COMPLETED);

    const rework = await admin.request(`/requests/${req2.id}/rework`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ reason: 'Paper still jams under load' }),
    });
    check('Rework request redirects', rework.status === 302, `status ${rework.status}`);
    db = readDb();
    let rw = findReq(req2.id);
    check('Rework sets Rework Required and returns status to In Progress',
      rw.verificationStatus === 'Rework Required' && rw.status === STATUS.IN_PROGRESS,
      `${rw.status} / ${rw.verificationStatus}`);
    assertTransition('Rework is logged from Completed back to In Progress',
      req2.id, ADMIN, STATUS.COMPLETED, STATUS.IN_PROGRESS, 'Returned for rework');
    const materialsBeforeRework = db.materials.filter((m) => m.requestId === req2.id).length;
    const proofsBeforeRework = db.attachments.filter((a) => a.requestId === req2.id).length;

    const reworkStart = await tech.request(`/requests/${req2.id}/rework/start`, {
      method: 'POST',
      body: formData({ remarks: 'Replacing worn roller' }, [{ name: 'photos', filename: 'rework.png' }]),
    });
    check('Rework start redirects', reworkStart.status === 302, `status ${reworkStart.status}`);
    db = readDb();
    rw = findReq(req2.id);
    check('Rework start creates a new attempt',
      db.repairAttempts.filter((a) => a.requestId === req2.id).length === 2,
      db.repairAttempts.filter((a) => a.requestId === req2.id).length);
    check('Rework start keeps status In Progress and resets verification',
      rw.status === STATUS.IN_PROGRESS && rw.verificationStatus === 'Not Submitted',
      `${rw.status} / ${rw.verificationStatus}`);
    check('Rework preserves existing materials and proof',
      db.materials.filter((m) => m.requestId === req2.id).length === materialsBeforeRework &&
      db.attachments.filter((a) => a.requestId === req2.id).length === proofsBeforeRework + 1);
    check('Rework proof uses the rework stage',
      db.attachments.some((a) => a.requestId === req2.id && a.stage === 'rework'));
    assertTransition('Rework start is logged with technician actor',
      req2.id, TECH, STATUS.IN_PROGRESS, STATUS.IN_PROGRESS, 'Rework started');

    check('Reworked repair can be completed again from In Progress',
      (await completeWork(tech, req2.id, {
        problem: 'Jam', actionsTaken: 'Replaced roller', remarks: 'Fixed',
      })).status === 302 && findReq(req2.id).status === STATUS.COMPLETED);
    assertTransition('Rework completion is logged as a canonical transition',
      req2.id, TECH, STATUS.IN_PROGRESS, STATUS.COMPLETED, 'Repair completed');
    check('Reworked repair can be verified again',
      (await admin.request(`/requests/${req2.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ confirm: 'yes', remarks: 'Second check passed' }),
      })).status === 302 && findReq(req2.id).verificationStatus === 'Verified');
    check('Technician availability is recalculated after all work is verified',
      findUser(TECH).availability === 'Available', findUser(TECH).availability);

    // ---------- 11. Admin completed section and activity timeline ----------
    const adminDash2 = await (await admin.request('/')).text();
    const dashMissing = [req1.code, 'Verified boot and charging', 'Completion photos', 'Full history']
      .filter((s) => !adminDash2.includes(s));
    check('Admin dashboard lists the completed report with proof and history links',
      dashMissing.length === 0, dashMissing.join(' | '));
    const timelineRes = await admin.request(`/requests/${req1.id}/timeline`);
    const timeline = await timelineRes.json();
    check('Timeline endpoint returns 200 JSON', timelineRes.status === 200 && Array.isArray(timeline.timeline));
    check('Timeline includes attempts, materials and verification decisions',
      ['Repair attempt', 'Material:', 'Completion verified'].every((s) =>
        timeline.timeline.some((t) => t.title.includes(s))));
    check('Timeline carries the current revision', Number.isInteger(timeline.revision));

    // ---------- 12. Materials expenses page ----------
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

    // ---------- 13. Rejection path with reason ----------
    const submit3 = await submitReport(requester, {
      categoryId: '3', location: 'Science Laboratory', title: 'Faulty wall outlet',
      description: 'Outlet sparks when the microscope is plugged in.',
    }, [{ name: 'photos', filename: 'report3.png' }]);
    const req3 = readDb().requests.find((r) => r.title === 'Faulty wall outlet');
    check('Third report submits for the rejection path', submit3.status === 302 && !!req3);
    check('Third report is approved but left awaiting assignment',
      (await approveRequest(req3.id)).status === 302 &&
      findReq(req3.id).status === STATUS.APPROVED && findReq(req3.id).technicianId == null);

    // Before-photo delete is only allowed while Pending and by uploader.
    const req3Att = readDb().attachments.find((a) => a.requestId === req3.id && a.stage === 'before');
    if (req3Att) {
      const delAfterApprove = await requester.request(`/requests/${req3.id}/attachments/${req3Att.id}/delete`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      check('Requester cannot delete before-photo after approval',
        delAfterApprove.status === 403 && readDb().attachments.some((a) => a.id === req3Att.id),
        `status ${delAfterApprove.status}`);
    } else {
      check('Requester cannot delete before-photo after approval', false, 'missing before-photo attachment');
    }

    const submitDel = await submitReport(requester, {
      categoryId: '3', location: 'Science Laboratory', title: 'Pending delete guard',
      description: 'Temp request for attachment delete rule.',
    }, [{ name: 'photos', filename: 'delete-me.png' }]);
    const reqDel = readDb().requests.find((r) => r.title === 'Pending delete guard');
    const delAtt = reqDel && readDb().attachments.find((a) => a.requestId === reqDel.id && a.stage === 'before');
    if (reqDel && delAtt) {
      const delOwnPending = await requester.request(`/requests/${reqDel.id}/attachments/${delAtt.id}/delete`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      check('Requester can delete own before-photo while Pending',
        delOwnPending.status === 200 && !readDb().attachments.some((a) => a.id === delAtt.id),
        `status ${delOwnPending.status}`);
      await requester.request(`/requests/${reqDel.id}/cancel`, {
        method: 'POST',
        body: formData({ reason: 'Temporary delete-guard request withdrawn.' }),
      });
    } else {
      check('Requester can delete own before-photo while Pending', false, 'missing pending-delete guard request/attachment');
    }

    const missingReason = await admin.request(`/requests/${req3.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ reason: 'bad' }),
    });
    check('Rejection without a sufficient reason is rejected',
      missingReason.status === 302 && findReq(req3.id).status === STATUS.APPROVED &&
      !findReq(req3.id).rejectedAt,
      `status ${missingReason.status}, state ${findReq(req3.id).status}`);

    const REJECT_REASON = 'Out of maintenance scope and requires replacement purchase';
    const reject = await admin.request(`/requests/${req3.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ reason: REJECT_REASON }),
    });
    check('Rejection redirects', reject.status === 302, `status ${reject.status}`);
    db = readDb();
    const rejected = findReq(req3.id);
    check('Rejection sets exactly Rejected with reason, timestamp and actor',
      rejected.status === STATUS.REJECTED && rejected.rejectionReason === REJECT_REASON &&
      !!rejected.rejectedAt && rejected.rejectedBy === ADMIN,
      `${rejected.status} / ${rejected.rejectionReason} / ${rejected.rejectedBy}`);
    check('Requester notification contains the rejection reason',
      hasNotif(REQUESTER, new RegExp(REJECT_REASON)));
    check('Rejection sent one reason-bearing notification, not a duplicate',
      db.notifications.filter((n) => n.userId === REQUESTER && /declined by the Administrator/.test(n.message)).length === 1);
    assertTransition('Rejection is logged with admin actor and canonical transition',
      req3.id, ADMIN, STATUS.APPROVED, STATUS.REJECTED, 'Request rejected by Admin');
    const dashRejected = await (await admin.request('/')).text();
    check('Admin Rejected Requests section shows the reason',
      dashRejected.includes('Rejected Requests') && dashRejected.includes(REJECT_REASON));

    // ---------- 14. Pure helpers and canonical constants ----------
    const C = require('../src/constants');
    const helpers = require('../src/helpers');
    const icons = require('../src/icons');
    const money = require('../src/services/money');
    const finalDb = readDb();
    check('All requests are on workflowVersion 2',
      (finalDb.requests || []).every((r) => r.workflowVersion === 2),
      JSON.stringify([...new Set((finalDb.requests || []).map((r) => r.workflowVersion))]));
    check('Technicians availability consistent with active assignments',
      (finalDb.users || []).filter((u) => u.role === 'technician').every((u) => {
        const active = (finalDb.requests || []).filter((r) => Number(r.technicianId) === Number(u.id) && C.TECH_ACTIVE_STATUSES.includes(C.normalizeStatus(r.status, r))).length;
        return active > 0 ? u.availability === 'Busy' : u.availability === 'Available' || u.availability === 'On Leave';
      }));
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
    check('Constants expose exactly the seven canonical statuses',
      JSON.stringify(C.REQUEST_STATUSES) === JSON.stringify(ALL_STATUSES));
    check('normalizeStatus rewrites every legacy label',
      C.normalizeStatus('Reported') === STATUS.PENDING &&
      C.normalizeStatus('Approved') === STATUS.APPROVED &&
      C.normalizeStatus('Pending') === STATUS.PENDING &&
      C.normalizeStatus('Pending', { technicianId: TECH }) === STATUS.ASSIGNED &&
      C.normalizeStatus('Nearing Completion') === STATUS.IN_PROGRESS &&
      C.normalizeStatus('Cancelled') === STATUS.REJECTED);
    check('Status badge and icon helpers know all seven labels',
      ALL_STATUSES.every((s) => helpers.statusColor(s) && icons.statusIcon(s) !== 'alert-circle'));

    // ---------- 15. Migration is idempotent and rewrites legacy statuses ----------
    const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'educare-migrate-'));
    const migData = path.join(migDir, 'data');
    fs.mkdirSync(migData, { recursive: true });
    const migFile = path.join(migData, 'db.json');
    fs.copyFileSync(path.join(ROOT, 'data', 'db.json'), migFile);
    const seeded = JSON.parse(fs.readFileSync(migFile, 'utf8'));
    const legacyReported = seeded.requests.find((r) => r.status === 'Reported');
    check('Migration fixture contains a legacy Reported request', !!legacyReported);
    const legacyApprovedId = seeded.meta.counters.requests + 1;
    const legacyStamp = new Date().toISOString();
    seeded.requests.push({
      id: legacyApprovedId,
      code: 'REQ-LEGACY-01',
      requesterId: REQUESTER,
      categoryId: 1,
      location: 'Faculty Room',
      title: 'Legacy approved request',
      description: 'Seeded by the verification harness.',
      severity: 2,
      type: 'Corrective',
      status: 'Approved',
      workflowVersion: 1,
      technicianId: null,
      createdAt: legacyStamp,
      startedAt: null,
      completedAt: null,
    });
    seeded.meta.counters.requests = legacyApprovedId;
    const legacyActivityId = seeded.meta.counters.activities + 1;
    seeded.activities.push({
      id: legacyActivityId,
      requestId: legacyApprovedId,
      userId: ADMIN,
      action: 'Request approved',
      details: 'Legacy approval',
      fromStatus: 'Reported',
      toStatus: 'Approved',
      createdAt: legacyStamp,
    });
    seeded.meta.counters.activities = legacyActivityId;
    fs.writeFileSync(migFile, JSON.stringify(seeded, null, 2));

    const before = JSON.parse(fs.readFileSync(migFile, 'utf8'));
    const runMigration = () => spawnSync(process.execPath, ['scripts/migrate-repair-workflow.js'], {
      cwd: ROOT, env: { ...process.env, DATA_DIR: migData }, encoding: 'utf8',
    });
    const mig1 = runMigration();
    const after1 = JSON.parse(fs.readFileSync(migFile, 'utf8'));
    check('Migration script succeeds', mig1.status === 0, mig1.stderr || mig1.stdout);
    check('Migration creates a backup', fs.readdirSync(path.join(migData, 'backups')).some((f) => f.includes('db-before-repair-workflow')));
    check('Migration preserves every existing request', after1.requests.length === before.requests.length,
      `${before.requests.length} -> ${after1.requests.length}`);
    check('Migration rewrites legacy Reported to Pending Approval',
      after1.requests.find((r) => r.id === legacyReported.id).status === STATUS.PENDING,
      after1.requests.find((r) => r.id === legacyReported.id).status);
    check('Migration rewrites legacy Approved to Approved – Awaiting Assignment',
      after1.requests.find((r) => r.id === legacyApprovedId).status === STATUS.APPROVED,
      after1.requests.find((r) => r.id === legacyApprovedId).status);
    check('Migration normalizes activity from/to statuses',
      (() => {
        const a = after1.activities.find((x) => x.id === legacyActivityId);
        return a && a.fromStatus === STATUS.PENDING && a.toStatus === STATUS.APPROVED;
      })(),
      JSON.stringify(after1.activities.find((x) => x.id === legacyActivityId)));
    check('Migration fills reportedAt on legacy requests', after1.requests.every((r) => !!r.reportedAt));
    check('Migration sets verification status on legacy requests',
      after1.requests.every((r) => !!r.verificationStatus));
    check('Migration derives attempts only from started/completed records',
      after1.repairAttempts.length === before.requests.filter((r) => r.startedAt || r.completedAt).length,
      after1.repairAttempts.length);
    check('Migration invents no materials or demo records', after1.materials.length === (before.materials || []).length);
    const mig2 = runMigration();
    const after2 = JSON.parse(fs.readFileSync(migFile, 'utf8'));
    check('Migration is idempotent (no-op with no status or revision changes)',
      mig2.status === 0 && /No changes made/.test(mig2.stdout) &&
      after2.meta.revision === after1.meta.revision &&
      JSON.stringify(after2.requests) === JSON.stringify(after1.requests) &&
      after2.repairAttempts.length === after1.repairAttempts.length,
      `${mig2.stdout.trim()} :: revision ${after1.meta.revision} -> ${after2.meta.revision}`);
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
