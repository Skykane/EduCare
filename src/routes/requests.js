// Features 4, 6, 8, 10, 11, 12, 15, 16: repair requests from submission to completion.
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const C = require('../constants');
const { requireRole, flash, forbidden } = require('../auth');
const { str, int, isISODate, todayISO, fmtDate, fmtManila, formatDuration, formatMoney } = require('../helpers');
const { enrichRequest, sortByPriority, nextCode, canViewRequest, canWorkOn } = require('../services/requests');
const assignmentService = require('../services/assignment');
const { recommendTechnicians, activeTaskCount, HIGH_WORKLOAD_AT } = assignmentService;
// Availability is recalculated whenever a workflow change touches assignments.
const syncAvailability = (technicianId) => {
  if (technicianId && typeof assignmentService.syncTechnicianAvailability === 'function') {
    assignmentService.syncTechnicianAvailability(technicianId);
  }
};
const activity = require('../services/activity');
const { notify, adminIds } = require('../services/notify');
const { photos, workflowPhotos, saveAttachments, removeFiles, UPLOAD_DIR } = require('../upload');
const W = require('../services/workflow');
const attempts = require('../services/repairAttempts');
const materials = require('../services/materials');
const { sumCents } = require('../services/money');

const router = express.Router();

// Canonical workflow labels come from constants.js. The literal fallbacks only
// matter while an older constants file is in place; they are the exact strings
// required by the consolidated workflow (en dash in the approval label).
const S = {
  PENDING: (C.STATUS && (C.STATUS.PENDING_APPROVAL || C.STATUS.PENDING)) || 'Pending Approval',
  APPROVED: (C.STATUS && (C.STATUS.APPROVED_AWAITING_ASSIGNMENT || C.STATUS.AWAITING_ASSIGNMENT || C.STATUS.APPROVED)) || 'Approved – Awaiting Assignment',
  ASSIGNED: (C.STATUS && C.STATUS.ASSIGNED) || 'Assigned',
  IN_PROGRESS: (C.STATUS && C.STATUS.IN_PROGRESS) || 'In Progress',
  ON_HOLD: (C.STATUS && C.STATUS.ON_HOLD) || 'On Hold',
  COMPLETED: (C.STATUS && C.STATUS.COMPLETED) || 'Completed',
  REJECTED: (C.STATUS && C.STATUS.REJECTED) || 'Rejected',
};
const OPEN_STATUSES = Array.isArray(C.OPEN_STATUSES) && C.OPEN_STATUSES.length
  ? C.OPEN_STATUSES
  : [S.PENDING, S.APPROVED, S.ASSIGNED, S.IN_PROGRESS, S.ON_HOLD];
const TECH_ACTIVE_STATUSES = Array.isArray(C.TECH_ACTIVE_STATUSES) && C.TECH_ACTIVE_STATUSES.length
  ? C.TECH_ACTIVE_STATUSES
  : [S.ASSIGNED, S.IN_PROGRESS, S.ON_HOLD];
const ASSIGNABLE_STATUSES = Array.isArray(C.ASSIGNABLE_STATUSES) && C.ASSIGNABLE_STATUSES.length
  ? C.ASSIGNABLE_STATUSES
  : [S.APPROVED];
const STARTABLE_STATUSES = Array.isArray(C.STARTABLE_STATUSES) && C.STARTABLE_STATUSES.length
  ? C.STARTABLE_STATUSES
  : [S.ASSIGNED];
const REQUEST_STATUSES = Array.isArray(C.REQUEST_STATUSES) && C.REQUEST_STATUSES.length
  ? C.REQUEST_STATUSES
  : [S.PENDING, S.APPROVED, S.ASSIGNED, S.IN_PROGRESS, S.ON_HOLD, S.COMPLETED, S.REJECTED];

// Display/navigation guard for records written before the migration. The
// migration rewrites them, but a normalized read keeps every route predictable.
function statusOf(r) {
  if (!r) return '';
  if (typeof C.normalizeStatus === 'function') {
    const normalized = C.normalizeStatus(r.status, r);
    if (normalized) return normalized;
  }
  const s = r.status;
  if (s === 'Reported') return S.PENDING;
  if (s === 'Approved') return S.APPROVED;
  if (s === 'Pending') return r.technicianId ? S.ASSIGNED : S.PENDING;
  if (s === 'Nearing Completion') return S.IN_PROGRESS;
  if (s === 'Cancelled') return S.REJECTED;
  return s || '';
}

// Legacy records stay on the old approval flow even after migration backfills
// reportedAt/verificationStatus. Only newly submitted reports use strict workflow.
const isNewFlow = (r) => r.workflowVersion === 2;

function workflowError(res, req, err, r, anchor = '') {
  if (req.files) {
    const all = Array.isArray(req.files) ? req.files : Object.values(req.files).flat();
    removeFiles(all);
  }
  flash(req, 'error', err.message || 'The action could not be completed.');
  res.redirect(`/requests/${r.id}${anchor}`);
}

function reportLink(r) {
  return `/requests/${r.id}`;
}

const notFound = (res) => res.status(404).render('error', { title: 'Not found', message: 'Repair request not found.' });

function loadRequest(req, res) {
  const r = db.find('requests', req.params.id);
  if (!r) {
    notFound(res);
    return null;
  }
  if (!canViewRequest(req.user, r) ||
      (req.user.role === 'technician' && r.technicianId !== req.user.id)) {
    forbidden(res, 'You can only view repair requests that you submitted or that are assigned to you.');
    return null;
  }
  return r;
}

// Change a request's status and record the actor, time and transition.
// Notifications are intentionally sent by the individual workflow endpoints so
// each event produces one specific message instead of a generic duplicate.
function changeStatus(r, toStatus, user, { action, details = '', extra = {} } = {}) {
  const from = statusOf(r);
  const patch = { status: toStatus, ...extra };
  db.update('requests', r.id, patch);
  Object.assign(r, patch);
  activity.log({
    requestId: r.id,
    equipmentId: r.equipmentId,
    userId: user && user.id,
    action,
    details,
    fromStatus: from,
    toStatus,
  });
  return r;
}

function notifyRequester(r, message, type = 'info', extra = {}) {
  return notify([r.requesterId], { message, link: `/requests/${r.id}`, type, ...extra });
}

function setEquipmentStatus(equipmentId, status, user, details) {
  const eq = db.find('equipment', equipmentId);
  if (!eq || eq.status === status) return;
  const from = eq.status;
  db.update('equipment', eq.id, { status });
  activity.log({ equipmentId: eq.id, userId: user.id, action: 'Condition changed', details, fromStatus: from, toStatus: status });
}

// ---------- List with search and filters ----------
router.get('/', (req, res) => {
  const user = req.user;
  const f = {
    q: str(req.query.q, 100),
    status: str(req.query.status, 40),
    priority: str(req.query.priority, 20),
    type: str(req.query.type, 20),
    categoryId: int(req.query.categoryId),
    location: str(req.query.location, 150),
    technicianId: int(req.query.technicianId),
    from: isISODate(req.query.from) ? req.query.from : '',
    to: isISODate(req.query.to) ? req.query.to : '',
    overdue: req.query.overdue === '1' ? '1' : '',
    sort: ['priority', 'newest', 'oldest', 'target'].includes(req.query.sort) ? req.query.sort : 'priority',
  };

  let base;
  if (user.role === 'admin') base = db.all('requests');
  else if (user.role === 'technician') base = db.where('requests', (r) => r.technicianId === user.id);
  else base = db.where('requests', (r) => r.requesterId === user.id);

  const q = f.q.toLowerCase();
  let rows = base.map((r) => {
    const row = enrichRequest(r);
    const status = statusOf(r);
    return { ...row, status, isOpen: OPEN_STATUSES.includes(status) };
  }).filter((r) => {
    if (q && ![r.code, r.title, r.description, r.location, r.equipment && r.equipment.name, r.equipment && r.equipment.code, r.category && r.category.name].some((v) => (v || '').toLowerCase().includes(q))) return false;
    if (f.status === 'open') { if (!r.isOpen) return false; }
    else if (f.status === 'active') { if (!TECH_ACTIVE_STATUSES.includes(r.status)) return false; }
    else if (f.status && r.status !== f.status) return false;
    if (f.priority && r.effectivePriority !== f.priority) return false;
    if (f.type && r.type !== f.type) return false;
    if (f.categoryId && (!r.category || r.category.id !== f.categoryId)) return false;
    if (f.location && r.location !== f.location) return false;
    if (f.technicianId && r.technicianId !== f.technicianId) return false;
    const day = r.createdAt.slice(0, 10);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (f.overdue && !r.overdue) return false;
    return true;
  });

  if (f.sort === 'newest') rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else if (f.sort === 'oldest') rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  else if (f.sort === 'target') rows.sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999'));
  else sortByPriority(rows);

  const activeTechs = db.where('users', (u) => u.role === 'technician' && u.active);
  res.render('requests/index', {
    title: user.role === 'requester' ? 'My Requests' : user.role === 'technician' ? 'My Tasks' : 'Repair Requests',
    rows,
    f,
    categories: db.all('categories'),
    locations: [...new Set([
      ...(C.CAMPUS_LOCATIONS || []),
      ...db.all('equipment').map((e) => e.location).filter(Boolean),
      ...db.all('requests').map((r) => r.location).filter(Boolean),
    ])].sort(),
    technicians: activeTechs,
    availableTechnicians: activeTechs
      .filter((t) => t.availability === 'Available')
      .map((t) => ({ ...t, activeCount: activeTaskCount(t.id) })),
    highWorkloadAt: HIGH_WORKLOAD_AT,
    statuses: REQUEST_STATUSES,
    today: todayISO(),
  });
});

// ---------- Submit a request (feature 8) ----------
function renderNew(res, values, errors = [], status = 200) {
  const allEq = db.all('equipment').slice().sort((a, b) => a.code.localeCompare(b.code));
  res.status(status).render('requests/new', {
    title: 'Submit Request',
    values,
    errors,
    equipment: allEq,
    categories: db.all('categories'),
    locations: [...new Set([...(C.CAMPUS_LOCATIONS || []), ...allEq.map((e) => e.location).filter(Boolean)])].sort(),
  });
}

router.get('/new', (req, res) => {
  if (req.user.role === 'technician') {
    return forbidden(res, 'Technicians cannot submit repair requests.');
  }
  const location = req.query.location ? `&location=${encodeURIComponent(req.query.location)}` : '';
  const categoryId = req.query.categoryId ? `&categoryId=${encodeURIComponent(req.query.categoryId)}` : '';
  res.redirect(`/requests?openModal=1${location}${categoryId}`);
});

router.post('/', photos('photos', 1), (req, res) => {
  if (req.user.role === 'technician') {
    return forbidden(res, 'Technicians cannot submit repair requests.');
  }
  const b = req.body || {};
  const severityInput = Array.isArray(b.severity) ? b.severity[0] : b.severity;
  const values = {
    equipmentId: int(b.equipmentId) || null,
    categoryId: int(b.categoryId) || null,
    location: str(b.location, 150),
    title: str(b.title, 150),
    description: str(b.description, 3000),
    severity: severityInput ? Math.min(3, Math.max(1, int(severityInput))) : 2,
    photoNote: str(b.photoNote, 1000),
  };
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  const eq = values.equipmentId ? db.find('equipment', values.equipmentId) : null;
  const category = values.categoryId ? db.find('categories', values.categoryId) : null;
  if (values.equipmentId && !eq) errors.push('Please choose a valid equipment item.');
  if (!eq) {
    if (!values.location) errors.push('Please choose the room or location.');
    if (!values.categoryId || !category) errors.push('Please choose a category.');
  }
  if (!values.title) errors.push('Please enter a short summary of the problem.');
  const duplicate = eq
    ? db.where('requests', (x) =>
        x.equipmentId === eq.id && x.requesterId === req.user.id && OPEN_STATUSES.includes(statusOf(x))
      )[0]
    : db.where('requests', (x) =>
        !x.equipmentId && x.requesterId === req.user.id && x.location === values.location &&
        x.categoryId === values.categoryId && String(x.title || '').toLowerCase() === values.title.toLowerCase() &&
        OPEN_STATUSES.includes(statusOf(x))
      )[0];
  if (duplicate) errors.push(`You already have an open report for this issue (${duplicate.code}).`);
  if (errors.length) {
    if (!req.uploadError && req.files && req.files.length) errors.push('Please attach your photos again.');
    removeFiles(req.files);
    return renderNew(res, values, errors, 400);
  }

  const now = new Date().toISOString();
  let r;
  db.transaction(() => {
    r = db.insert('requests', {
      code: nextCode('requests', 'REQ'),
      equipmentId: eq ? eq.id : null,
      categoryId: eq ? eq.categoryId : values.categoryId,
      location: eq ? eq.location : values.location,
      requesterId: req.user.id,
      title: values.title,
      description: values.description,
      severity: values.severity,
      type: 'Corrective',
      status: S.PENDING,
      workflowVersion: 2,
      submittedAt: now,
      reportedAt: now,
      verificationStatus: 'Not Submitted',
      verifiedAt: null,
      verifiedBy: null,
      priority: null,
      technicianId: null,
      targetDate: null,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    });
    activity.log({ requestId: r.id, equipmentId: eq ? eq.id : null, userId: req.user.id, action: 'Report submitted', details: r.title, toStatus: S.PENDING });
    saveAttachments(req.files, { requestId: r.id, userId: req.user.id, stage: 'report', note: values.photoNote });
    if (eq && eq.status === 'Operational') setEquipmentStatus(eq.id, 'Needs Repair', req.user, `Reported in ${r.code}`);
  });

  const rec = enrichRequest(r).rec;
  const sevLabel = r.severity ? `severity: ${C.SEVERITIES[r.severity]}, recommended priority: ${rec.level}` : `recommended priority: ${rec.level}`;
  const place = eq
    ? `${eq.code} ${eq.name}`
    : [r.location, category ? category.name : ''].filter(Boolean).join(' · ') || 'general repair';
  notify(adminIds(), {
    message: `New repair request ${r.code} for ${place} (${sevLabel}).`,
    link: `/requests/${r.id}`,
    type: rec.level === 'High' ? 'warning' : 'info',
    exceptUserId: req.user.id,
  });

  // Feature: Send email confirmation to the requester
  const { sendRequestCreatedEmail } = require('../services/mailer');
  sendRequestCreatedEmail({ ...r, categoryName: category ? category.name : '' }, req.user, eq).catch((err) => {
    console.error('Failed to send request confirmation email:', err.message);
  });

  flash(req, 'success', `Request ${r.code} submitted. You will be notified when its status changes.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Details ----------
function requesterCanModify(user, r) {
  if (!r || r.requesterId !== user.id) return false;
  // Only a report still waiting for admin review can be changed or withdrawn.
  return statusOf(r) === S.PENDING;
}

function canEditRequest(user, r) {
  if (!r) return false;
  if (user.role === 'admin') return OPEN_STATUSES.includes(statusOf(r));
  return requesterCanModify(user, r);
}

function canCancelRequest(user, r) {
  if (!r) return false;
  if (user.role === 'admin') return [S.PENDING, S.APPROVED].includes(statusOf(r));
  return requesterCanModify(user, r);
}

router.get('/:id', (req, res) => {
  const raw = loadRequest(req, res);
  if (!raw) return;
  const status = statusOf(raw);
  const r = { ...enrichRequest(raw), status, isOpen: OPEN_STATUSES.includes(status) };
  const user = req.user;
  const attachments = db.where('attachments', (a) => a.requestId === r.id);
  const technicians = db.where('users', (u) => u.role === 'technician' && u.active).map((t) => ({
    ...t,
    specNames: (t.specializations || [])
      .map((id) => { const c = db.find('categories', id); return c ? c.name : null; })
      .filter(Boolean),
    activeCount: activeTaskCount(t.id),
    activeTasks: activeTaskCount(t.id),
  }));
  res.render('requests/show', {
    title: `${r.code} · ${r.title}`,
    r,
    canWork: canWorkOn(user, r),
    canEdit: canEditRequest(user, r),
    canCancel: canCancelRequest(user, r),
    isAdmin: user.role === 'admin',
    canApprove: user.role === 'admin' && status === S.PENDING,
    canReject: user.role === 'admin' && [S.PENDING, S.APPROVED].includes(status),
    canAssign: user.role === 'admin' && ASSIGNABLE_STATUSES.includes(status) && !r.technicianId,
    canReassign: user.role === 'admin' && status === S.ASSIGNED && !!r.technicianId,
    statuses: REQUEST_STATUSES,
    recommendations: user.role === 'admin' && r.isOpen
      ? recommendTechnicians(r.equipment || (r.category ? { categoryId: r.category.id } : null))
      : [],
    technicians,
    availableTechnicians: technicians.filter((t) => t.availability === 'Available'),
    highWorkloadAt: HIGH_WORKLOAD_AT,
    before: attachments.filter((a) => ['before', 'report'].includes(a.stage)),
    after: attachments.filter((a) => ['after', 'completion'].includes(a.stage)),
    proofByStage: Object.fromEntries(C.PROOF_STAGES.map((s) => [s, attachments.filter((a) => a.stage === s)])),
    attempts: attempts.forRequest(r.id),
    materials: materials.forRequest(r.id),
    materialTotals: materials.totals(r.id),
    timeline: attempts.timeline(r.id),
    elapsedLabel: formatDuration(attempts.totalElapsedMs(r.id)),
    isNewFlow: isNewFlow(r),
    isRework: W.isRework(r),
    canVerify: user.role === 'admin' && r.status === 'Completed' && r.verificationStatus === C.AWAITING_VERIFICATION,
    record: db.where('maintenanceRecords', (m) => m.requestId === r.id)[0] || null,
    activities: activity.forRequest(r.id),
    today: todayISO(),
  });
});

// ---------- Edit Report ----------
router.get('/:id/edit', (req, res) => {
  const raw = loadRequest(req, res);
  if (!raw) return;
  if (!canEditRequest(req.user, raw)) {
    flash(req, 'error', 'You can only edit your own requests while they are still awaiting review.');
    return res.redirect(`/requests/${raw.id}`);
  }
  const r = enrichRequest(raw);
  const attachments = db.where('attachments', (a) => a.requestId === r.id && a.stage === 'before');
  res.render('requests/edit', {
    title: `Edit ${r.code} · ${r.title}`,
    r,
    equipment: db.all('equipment'),
    categories: db.all('categories'),
    locations: [...new Set([
      ...(C.CAMPUS_LOCATIONS || []),
      ...db.all('equipment').map((e) => e.location).filter(Boolean),
      ...db.all('requests').map((x) => x.location).filter(Boolean),
    ])].sort(),
    attachments,
    errors: [],
  });
});

router.post('/:id/edit', photos(), (req, res) => {
  const raw = loadRequest(req, res);
  if (!raw) return removeFiles(req.files);
  if (!canEditRequest(req.user, raw)) {
    removeFiles(req.files);
    flash(req, 'error', 'You can only edit your own requests while they are still awaiting review.');
    return res.redirect(`/requests/${raw.id}`);
  }
  const b = req.body || {};
  const severityInput = Array.isArray(b.severity) ? b.severity[0] : b.severity;
  const values = {
    categoryId: int(b.categoryId) || null,
    location: str(b.location, 150),
    title: str(b.title, 150),
    description: str(b.description, 3000),
    severity: severityInput ? Math.min(3, Math.max(1, int(severityInput))) : (raw.severity || 2),
    photoNote: str(b.photoNote, 1000),
  };
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  const linkedEq = raw.equipmentId ? db.find('equipment', raw.equipmentId) : null;
  const category = values.categoryId ? db.find('categories', values.categoryId) : null;
  if (!linkedEq) {
    if (!values.location) errors.push('Please choose the room or location.');
    if (!values.categoryId || !category) errors.push('Please choose a category.');
  }
  if (!values.title) errors.push('Please enter a short summary of the problem.');
  if (!values.description) errors.push('Please describe the problem.');

  if (errors.length) {
    removeFiles(req.files);
    const r = enrichRequest({ ...raw, ...values });
    const attachments = db.where('attachments', (a) => a.requestId === r.id && a.stage === 'before');
    return res.status(400).render('requests/edit', {
      title: `Edit ${r.code} · ${r.title}`,
      r,
      equipment: db.all('equipment'),
      categories: db.all('categories'),
      locations: [...new Set([
        ...(C.CAMPUS_LOCATIONS || []),
        ...db.all('equipment').map((e) => e.location).filter(Boolean),
        ...db.all('requests').map((x) => x.location).filter(Boolean),
      ])].sort(),
      attachments,
      errors,
    });
  }

  // Handle removed photos. Requesters may only remove their own before-photos;
  // admins may remove before-photos as part of an admin edit. All removals are logged.
  const toRemove = toArray(b.removeAttachments).map(int);
  toRemove.forEach((attId) => {
    const att = db.find('attachments', attId);
    if (!att || String(att.requestId) !== String(raw.id) || att.stage !== 'before') return;
    if (req.user.role !== 'admin' && String(att.userId) !== String(req.user.id)) return;
    const safeName = path.basename(String(att.filename || ''));
    if (safeName === att.filename) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, safeName)); } catch (_) { /* file may already be missing */ }
    }
    db.remove('attachments', att.id);
    activity.log({
      requestId: raw.id,
      equipmentId: raw.equipmentId || null,
      userId: req.user.id,
      action: 'Before-repair photo removed',
      details: att.originalName || att.filename,
    });
  });

  // Handle new uploaded photos
  if (req.files && req.files.length) {
    saveAttachments(req.files, { requestId: raw.id, userId: req.user.id, stage: 'before', note: values.photoNote });
  }

  // Keep legacy equipment links intact; new reports use the reported location/category.
  const nextCategoryId = linkedEq ? linkedEq.categoryId : values.categoryId;
  const nextCategory = nextCategoryId ? db.find('categories', nextCategoryId) : null;
  const nextLocation = linkedEq ? linkedEq.location : values.location;

  db.update('requests', raw.id, {
    categoryId: nextCategoryId,
    location: nextLocation,
    title: values.title,
    description: values.description,
    severity: values.severity,
  });

  activity.log({
    requestId: raw.id,
    equipmentId: raw.equipmentId || null,
    userId: req.user.id,
    action: 'Report details edited',
    details: `${req.user.name} updated the problem details`,
  });

  if (req.user.role !== 'admin') {
    notify(adminIds(), {
      message: `${req.user.name} updated report ${raw.code} (${[nextLocation, nextCategory ? nextCategory.name : ''].filter(Boolean).join(' · ') || raw.code}).`,
      link: `/requests/${raw.id}`,
      type: 'info',
      exceptUserId: req.user.id,
    });
  }

  flash(req, 'success', `Report ${raw.code} has been successfully updated.`);
  res.redirect(`/requests/${raw.id}`);
});

// ---------- Priority & Severity (features 4 & 15) ----------
router.post('/:id/priority', requireRole('admin'), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const b = req.body || {};
  const priorityVal = str(b.priority, 20);
  const sevVal = int(b.severity);

  const updates = {};
  const changes = [];

  if (b.severity !== undefined && b.severity !== '') {
    if (sevVal && C.SEVERITIES[sevVal]) {
      if (r.severity !== sevVal) {
        updates.severity = sevVal;
        changes.push(`severity set to ${C.SEVERITIES[sevVal]}`);
      }
    }
  }

  if (priorityVal) {
    if (priorityVal !== 'auto' && !C.PRIORITIES.includes(priorityVal)) {
      flash(req, 'error', 'Please choose a valid priority.');
      return res.redirect(`/requests/${r.id}`);
    }
    const priority = priorityVal === 'auto' ? null : priorityVal;
    if (r.priority !== priority) {
      updates.priority = priority;
      const label = priority || 'Automatic';
      changes.push(`priority set to ${label}`);
    }
  }

  if (Object.keys(updates).length) {
    db.update('requests', r.id, updates);
    activity.log({
      requestId: r.id,
      equipmentId: r.equipmentId,
      userId: req.user.id,
      action: 'Assessment updated',
      details: changes.join(', '),
    });
    if (r.technicianId) {
      notify([r.technicianId], {
        message: `${r.code} updated: ${changes.join(', ')}.`,
        link: `/requests/${r.id}`,
        exceptUserId: req.user.id,
      });
    }
    flash(req, 'success', `Assessment updated: ${changes.join(', ')}.`);
  } else {
    flash(req, 'info', 'No changes made.');
  }

  res.redirect(`/requests/${r.id}`);
});

router.post('/:id/severity', requireRole('admin'), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const sevVal = int((req.body || {}).severity);
  if (!sevVal || !C.SEVERITIES[sevVal]) {
    flash(req, 'error', 'Please choose a valid severity level.');
    return res.redirect(`/requests/${r.id}`);
  }
  const old = r.severity;
  db.update('requests', r.id, { severity: sevVal });
  activity.log({
    requestId: r.id,
    equipmentId: r.equipmentId,
    userId: req.user.id,
    action: 'Severity assessed',
    details: `Severity set to ${C.SEVERITIES[sevVal]}${old ? ` (was ${C.SEVERITIES[old]})` : ''}`,
  });
  if (r.technicianId) {
    notify([r.technicianId], {
      message: `${r.code} severity assessed as ${C.SEVERITIES[sevVal]}.`,
      link: `/requests/${r.id}`,
      exceptUserId: req.user.id,
    });
  }
  flash(req, 'success', `Severity set to ${C.SEVERITIES[sevVal]}.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Admin review ----------
router.post('/:id/approve', requireRole('admin'), workflowPhotos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const from = statusOf(r);
  try {
    W.assertApprove(r, req.user);
  } catch (err) {
    flash(req, 'error', from === S.APPROVED
      ? `${r.code} is already approved and waiting for assignment.`
      : err.message);
    return res.redirect(`/requests/${r.id}`);
  }

  const b = req.body || {};
  const note = str(b.note, 500);
  // Approval is review only: no technician, proof or target date is accepted.
  // Discard files posted by an older approval form instead of storing them.
  if (req.files) removeFiles(Object.values(req.files).flat());

  const equipment = r.equipmentId ? db.find('equipment', r.equipmentId) : null;
  const errors = [];
  if (r.equipmentId && !equipment) errors.push('The linked equipment no longer exists, so this request cannot be approved.');
  if (!str(r.title, 150)) errors.push('This request has no problem summary and cannot be approved.');
  const hasSeverity = b.severity !== undefined && b.severity !== '';
  const sevVal = int(b.severity);
  if (hasSeverity && (!sevVal || !C.SEVERITIES[sevVal])) errors.push('Please assess a valid severity before approving.');
  if (!hasSeverity && !r.severity) errors.push('Please assess a valid severity before approving.');
  const priorityVal = str(b.priority, 20);
  if (priorityVal && priorityVal !== 'auto' && !C.PRIORITIES.includes(priorityVal)) errors.push('Please choose a valid priority.');
  if (errors.length) {
    flash(req, 'error', errors.join(' '));
    return res.redirect(`/requests/${r.id}#approve`);
  }

  const extra = {
    approvedAt: r.approvedAt || new Date().toISOString(),
    approvedBy: req.user.id,
  };
  if (hasSeverity) extra.severity = sevVal;
  if (priorityVal) extra.priority = priorityVal === 'auto' ? null : priorityVal;

  changeStatus(r, S.APPROVED, req.user, {
    action: 'Request approved',
    details: `Approved by ${req.user.name}; awaiting technician assignment${note ? ` · ${note}` : ''}`,
    extra,
  });

  notifyRequester(r, `Your repair request ${r.code} has been approved and is awaiting technician assignment.`, 'success', {
    dedupeKey: `approve-${r.id}`,
  });
  flash(req, 'success', `${r.code} approved. Choose an available technician to continue.`);
  res.redirect(`/requests/${r.id}`);
});

router.post('/:id/reject', requireRole('admin'), formOnly(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const from = statusOf(r);
  const canReject = [S.PENDING, S.APPROVED].includes(from) || (from === S.ASSIGNED && !r.startedAt);
  if (!canReject) {
    flash(req, 'error', `Cannot reject a request that is already ${from}.`);
    return res.redirect(`/requests/${r.id}`);
  }
  const rawReason = String((req.body || {}).reason || '').trim();
  const reason = str(rawReason, 1000);
  if (reason.length < 5 || rawReason.length > 1000) {
    flash(req, 'error', 'Please provide a rejection reason between 5 and 1000 characters.');
    return res.redirect(`/requests/${r.id}#reject`);
  }
  try {
    W.assertReject(r, req.user, reason);
  } catch (err) {
    flash(req, 'error', err.message);
    return res.redirect(`/requests/${r.id}`);
  }
  const rejectedAt = new Date().toISOString();
  const oldTechId = r.technicianId;
  changeStatus(r, S.REJECTED, req.user, {
    action: 'Request rejected by Admin',
    details: reason,
    extra: {
      rejectedAt,
      rejectedBy: req.user.id,
      rejectionReason: reason,
      technicianId: null,
      assignedAt: null,
      assignedBy: null,
    },
  });

  const eq = r.equipmentId ? db.find('equipment', r.equipmentId) : null;
  const othersOpen = eq
    ? db.where('requests', (x) => x.equipmentId === eq.id && x.id !== r.id && OPEN_STATUSES.includes(statusOf(x))).length
    : 0;
  if (eq && !othersOpen && ['Needs Repair', 'Under Maintenance'].includes(eq.status) && r.type === 'Corrective') {
    setEquipmentStatus(eq.id, 'Operational', req.user, `${r.code} rejected`);
  }

  // One reason-bearing notification to the requester; no generic status notice.
  notifyRequester(r, `Your repair request ${r.code} was declined by the Administrator. Reason: ${reason}`, 'error', {
    dedupeKey: `reject-${r.id}-${rejectedAt}`,
  });
  if (oldTechId) {
    syncAvailability(oldTechId);
    notify([oldTechId], {
      message: `${r.code} was rejected by the Administrator and withdrawn from your tasks. Reason: ${reason}`,
      link: `/requests/${r.id}`,
      type: 'warning',
      dedupeKey: `withdraw-${r.id}-${oldTechId}`,
    });
  }
  flash(req, 'success', `${r.code} has been rejected.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Admin assignment / reassignment ----------
function assignTechnician(req, res, explicitReassign = false) {
  const r = loadRequest(req, res);
  if (!r) return;
  const b = req.body || {};
  const from = statusOf(r);
  const reason = str(b.reassignReason || b.reason, 1000);
  // A reason posted to /assign on an already-assigned request is the reassign path.
  const reassign = explicitReassign || (from === S.ASSIGNED && !!reason);
  const note = str(b.note, 500);
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);

  try {
    W.assertAssign(r, req.user, { reassign, reason, technicianId: null });
  } catch (err) {
    errors.push(err.message);
  }

  const techId = int(b.technicianId);
  const tech = techId ? db.find('users', techId) : null;
  if (!tech || tech.role !== 'technician' || !tech.active) {
    errors.push('Please choose an active technician.');
  } else {
    try {
      W.assertTechnicianAvailable(tech.id, {
        currentTechnicianId: reassign ? r.technicianId : null,
      });
    } catch (err) {
      errors.push(err.message);
    }
    if (activeTaskCount(tech.id) > 0 && !errors.some((e) => e.includes('active task'))) {
      errors.push(`${tech.name} already has active task(s) and cannot receive another assignment.`);
    }
  }

  // Target date is optional; an existing date is kept when none is supplied.
  let targetDate = r.targetDate || null;
  if (b.targetDate) {
    if (!isISODate(b.targetDate)) errors.push('Please choose a valid target date.');
    else if (b.targetDate < todayISO()) errors.push('Target date cannot be in the past.');
    else targetDate = b.targetDate;
  }

  if (errors.length) {
    if (req.files) removeFiles(Object.values(req.files).flat());
    flash(req, 'error', errors.join(' '));
    return res.redirect(`/requests/${r.id}#assign`);
  }

  const prevTech = r.technicianId ? db.find('users', r.technicianId) : null;
  const assignedAt = new Date().toISOString();
  const workload = activeTaskCount(tech.id);
  const details = `${reassign && prevTech ? `From ${prevTech.name} to ` : 'Assigned to '}${tech.name}` +
    `${targetDate ? `, target ${fmtDate(targetDate)}` : ''} · ${workload} active task(s)` +
    `${reason ? ` · Reason: ${reason}` : ''}${note ? ` — ${note}` : ''}`;
  const extra = {
    technicianId: tech.id,
    targetDate,
    assignedAt,
    assignedBy: req.user.id,
    approvedAt: r.approvedAt || assignedAt,
    approvedBy: r.approvedBy || req.user.id,
  };

  db.transaction(() => {
    changeStatus(r, S.ASSIGNED, req.user, {
      action: reassign ? 'Technician reassigned' : 'Technician assigned',
      details,
      extra,
    });
    const proof = (req.files && req.files.photos) || [];
    if (proof.length) saveAttachments(proof, { requestId: r.id, userId: req.user.id, stage: 'assignment', note });
  });

  syncAvailability(tech.id);
  if (reassign && prevTech && prevTech.id !== tech.id) syncAvailability(prevTech.id);

  if (reassign) {
    notify([tech.id], {
      message: `${r.code} has been reassigned to you. Reason: ${reason}`,
      link: `/requests/${r.id}`, type: 'warning', exceptUserId: req.user.id,
      dedupeKey: `assign-${r.id}-${assignedAt}-${tech.id}`,
    });
    if (prevTech && prevTech.id !== tech.id) {
      notify([prevTech.id], {
        message: `${r.code} was reassigned to ${tech.name}. Reason: ${reason}`,
        link: `/requests/${r.id}`, type: 'info', exceptUserId: req.user.id,
        dedupeKey: `withdraw-${r.id}-${prevTech.id}-${assignedAt}`,
      });
    }
    notifyRequester(r, `${r.code} has been reassigned to ${tech.name}. Reason: ${reason}`, 'warning', {
      dedupeKey: `reassign-${r.id}-${assignedAt}`,
    });
  } else {
    notify([tech.id], {
      message: `New assignment: ${r.code} – ${r.title}. Target date: ${targetDate ? fmtDate(targetDate) : 'not set'}.`,
      link: `/requests/${r.id}`, type: 'warning', exceptUserId: req.user.id,
      dedupeKey: `assign-${r.id}-${assignedAt}-${tech.id}`,
    });
    notifyRequester(r, `${r.code} has been assigned to technician ${tech.name}.`, 'info', {
      dedupeKey: `assign-${r.id}-${assignedAt}-requester`,
    });
  }

  flash(req, 'success', reassign ? `Reassigned to ${tech.name}.` : `Assigned to ${tech.name}.`);
  res.redirect(`/requests/${r.id}`);
}

router.post('/:id/assign', requireRole('admin'), workflowPhotos(), (req, res) => assignTechnician(req, res));
router.post('/:id/reassign', requireRole('admin'), workflowPhotos(), (req, res) => assignTechnician(req, res, true));

// ---------- Technician work: start / hold / resume ----------
router.post('/:id/status', requireRole('technician'), workflowPhotos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  if (!canWorkOn(req.user, r)) return forbidden(res, 'Only the assigned maintenance personnel can update this task.');
  const b = req.body || {};
  const action = str(req.query.action || b.action, 20);
  const note = str(b.note || b.remarks, 1000);
  const current = statusOf(r);
  const moves = {
    start: { from: STARTABLE_STATUSES, to: S.IN_PROGRESS, label: 'Work started' },
    hold: { from: [S.IN_PROGRESS], to: S.ON_HOLD, label: 'Put on hold' },
    resume: { from: [S.ON_HOLD], to: S.IN_PROGRESS, label: 'Work resumed' },
  };
  const m = moves[action];
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  if (!m) errors.push('Unknown status action.');
  if (m) {
    try {
      W.assertStatusAction(r, req.user, action, note);
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (action === 'hold' && !note) errors.push('Please give a reason for putting the task on hold.');
  if (action === 'start' && isNewFlow(r)) {
    // Remarks are required; a start photo is optional and saved when supplied.
    if (!note) errors.push('Repair remarks are required to start a repair.');
  }
  if (errors.length) {
    if (req.files) removeFiles(Object.values(req.files).flat());
    flash(req, 'error', errors.join(' '));
    return res.redirect(`/requests/${r.id}`);
  }

  const startedAt = new Date().toISOString();
  const extra = action === 'start' ? { startedAt, startProofDate: todayISO() } : {};
  db.transaction(() => {
    changeStatus(r, m.to, req.user, { action: m.label, details: note, extra });
    if (action === 'start') {
      if (isNewFlow(r) || !attempts.current(r.id)) attempts.start(r.id, req.user.id, { startedAt });
      const proof = (req.files && req.files.photos) || [];
      if (proof.length) {
        saveAttachments(proof, {
          requestId: r.id,
          userId: req.user.id,
          stage: 'start',
          note: note || `Start proof ${todayISO()}`,
        });
      }
    }
    if (action === 'start' || action === 'resume') {
      setEquipmentStatus(r.equipmentId, 'Under Maintenance', req.user, `Work on ${r.code}`);
    }
  });

  notifyRequester(r,
    action === 'hold'
      ? `${r.code} was put on hold. Reason: ${note}`
      : `${r.code} is now ${m.to}.`,
    action === 'hold' ? 'warning' : 'info',
    { dedupeKey: `status-${r.id}-${m.to}-${startedAt}` });
  flash(req, 'success', `${r.code} is now ${m.to}.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Complete: maintenance record + persisted completion report ----------
router.post('/:id/complete', requireRole('technician'), workflowPhotos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  if (!canWorkOn(req.user, r)) return forbidden(res, 'Only the assigned maintenance personnel can complete this task.');
  const b = req.body || {};
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  const current = statusOf(r);
  const rework = W.isRework(r);
  try {
    W.assertComplete(r, req.user, { rework });
  } catch (err) {
    errors.push(err.message);
  }
  // Completion photos are optional;remarks and the work performed are required.
  const proof = (req.files && req.files.photos) || [];
  const completionNotes = str(b.remarks, 1000);
  if (!completionNotes) errors.push('Final completion notes are required.');

  const linkedEquipment = r.equipmentId ? db.find('equipment', r.equipmentId) : null;
  const rec = {
    equipmentId: r.equipmentId || null,
    categoryId: r.categoryId || (linkedEquipment && linkedEquipment.categoryId) || null,
    location: r.location || (linkedEquipment && linkedEquipment.location) || '',
    requestId: r.id,
    technicianId: r.technicianId,
    type: r.type,
    problem: str(b.problem, 1000) || completionNotes,
    actionsTaken: str(b.actionsTaken, 2000) || str(b.remarks, 2000),
    partsReplaced: str(b.partsReplaced, 1000),
    serviceDate: isISODate(b.serviceDate) ? b.serviceDate : todayISO(),
    resultingStatus: C.EQUIPMENT_STATUSES.includes(b.resultingStatus) ? b.resultingStatus : 'Operational',
    remarks: completionNotes,
  };
  if (!rec.problem) errors.push('Please describe the problem that was identified.');
  if (!rec.actionsTaken) errors.push('Please describe the actions performed.');
  if (rec.serviceDate > todayISO()) errors.push('Service date cannot be in the future.');
  if (errors.length) {
    if (req.files) removeFiles(Object.values(req.files).flat());
    flash(req, 'error', errors.join(' '));
    return res.redirect(`/requests/${r.id}#complete`);
  }

  const completedAt = new Date().toISOString();
  db.transaction(() => {
    db.insert('maintenanceRecords', rec);
    changeStatus(r, S.COMPLETED, req.user, {
      action: rework ? 'Rework completed' : 'Repair completed',
      details: rec.actionsTaken,
      extra: {
        completedAt,
        verificationStatus: C.AWAITING_VERIFICATION || 'Awaiting Verification',
        // Persisted completion report shown on the detail page and in reports.
        completionNotes,
        completionReport: rec.actionsTaken,
      },
    });
    saveAttachments(proof, {
      requestId: r.id, userId: req.user.id, stage: 'completion', note: str(b.photoNote, 1000),
    });
    if (isNewFlow(r)) {
      const attempt = attempts.complete(r.id, completionNotes, {
        userId: req.user.id,
        completedAt,
        verificationResult: C.AWAITING_VERIFICATION || 'Awaiting Verification',
        startedAt: r.startedAt,
      });
      activity.log({
        requestId: r.id,
        equipmentId: r.equipmentId,
        userId: req.user.id,
        action: 'Elapsed repair time recorded',
        details: `${attempt.code}: ${formatDuration(attempts.elapsedMs(attempt))}`,
      });
    }
    const eq = linkedEquipment;
    if (eq) {
      setEquipmentStatus(eq.id, rec.resultingStatus, req.user, `Completed ${r.code}`);
      if (r.type === 'Preventive' && (!eq.lastMaintenanceDate || rec.serviceDate > eq.lastMaintenanceDate)) {
        db.update('equipment', eq.id, { lastMaintenanceDate: rec.serviceDate });
      }
    }
  });

  // One notification per recipient (notify dedupes the requester/admin overlap).
  notify([r.requesterId, ...adminIds()], {
    message: `${r.code} is completed and awaiting verification. Work performed: ${rec.actionsTaken}`,
    link: reportLink(r),
    type: 'success',
    dedupeKey: `completed-${r.id}-${completedAt}`,
  });
  syncAvailability(r.technicianId);

  flash(req, 'success', `${r.code} completed. ${isNewFlow(r) ? `Elapsed repair time: ${formatDuration(attempts.totalElapsedMs(r.id))}. ` : ''}Awaiting verification.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Withdraw (maps onto the canonical Rejected status) ----------
router.post('/:id/cancel', formOnly(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const from = statusOf(r);
  const isAdmin = req.user.role === 'admin';
  const isOwnerPending = r.requesterId === req.user.id && from === S.PENDING;
  if (!isAdmin && !isOwnerPending) {
    return forbidden(res, 'You can only withdraw your own request while it is still awaiting review.');
  }
  if (from !== S.PENDING && from !== S.APPROVED) {
    flash(req, 'error', `This request is already ${from}.`);
    return res.redirect(`/requests/${r.id}`);
  }
  const rawReason = String((req.body || {}).reason || '').trim();
  if (isAdmin && (rawReason.length < 5 || rawReason.length > 1000)) {
    flash(req, 'error', 'Please give a reason between 5 and 1000 characters.');
    return res.redirect(`/requests/${r.id}`);
  }
  const reason = str(rawReason, 1000) ||
    (isOwnerPending ? 'Withdrawn by requester (reported by mistake or resolved)' : 'Withdrawn by administrator');
  const cancelledAt = new Date().toISOString();
  const oldTechId = r.technicianId;
  changeStatus(r, S.REJECTED, req.user, {
    action: isAdmin ? 'Request rejected by Admin' : 'Request withdrawn by requester',
    details: reason,
    extra: {
      cancelledAt,
      rejectedAt: cancelledAt,
      rejectedBy: req.user.id,
      rejectionReason: reason,
      technicianId: null,
      assignedAt: null,
      assignedBy: null,
    },
  });

  // If nothing else is open for this equipment, undo the automatic "Needs Repair" mark.
  const eq = r.equipmentId ? db.find('equipment', r.equipmentId) : null;
  const othersOpen = eq
    ? db.where('requests', (x) => x.equipmentId === eq.id && x.id !== r.id && OPEN_STATUSES.includes(statusOf(x))).length
    : 0;
  if (eq && !othersOpen && ['Needs Repair', 'Under Maintenance'].includes(eq.status) && r.type === 'Corrective') {
    setEquipmentStatus(eq.id, 'Operational', req.user, `${r.code} withdrawn`);
  }

  if (isAdmin) notifyRequester(r, `Your repair request ${r.code} was declined by the Administrator. Reason: ${reason}`, 'error', {
    dedupeKey: `reject-${r.id}-${cancelledAt}`,
  });
  else notify(adminIds(), {
    message: `${req.user.name} withdrew report ${r.code} (${reason}).`,
    link: `/requests/${r.id}`,
    type: 'info',
    exceptUserId: req.user.id,
    dedupeKey: `withdraw-request-${r.id}-${cancelledAt}`,
  });
  if (oldTechId) {
    syncAvailability(oldTechId);
    notify([oldTechId], {
      message: `${r.code} was withdrawn and removed from your tasks. Reason: ${reason}`,
      link: `/requests/${r.id}`,
      type: 'warning',
      dedupeKey: `withdraw-${r.id}-${oldTechId}-${cancelledAt}`,
    });
  }

  flash(req, 'success', `${r.code} has been withdrawn.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Photos and notes (feature 12) ----------
router.post('/:id/attachments', photos(), (req, res) => {
  const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
  let r;
  if (wantsJson) {
    r = db.find('requests', req.params.id);
    if (!r) { removeFiles(req.files); return res.status(404).json({ ok: false, error: 'Request not found.' }); }
    if (!canViewRequest(req.user, r) ||
        (req.user.role === 'technician' && Number(r.technicianId) !== Number(req.user.id))) {
      removeFiles(req.files);
      return res.status(403).json({ ok: false, error: 'You do not have permission to add photos to this request.' });
    }
  } else {
    r = loadRequest(req, res);
    if (!r) return removeFiles(req.files);
  }
  const b = req.body || {};
  const stage = b.stage === 'after' ? 'after' : 'before';
  let error = req.uploadError;
  if (!error && (!req.files || !req.files.length)) error = 'Please choose at least one photo.';
  const currentStatus = statusOf(r);
  if (!error && currentStatus === S.REJECTED) error = 'Cannot add photos to a rejected request.';
  if (!error && stage === 'after' && currentStatus !== S.COMPLETED) error = 'After-repair photos can only be added once the repair has been completed.';
  if (!error && stage === 'after' && !canWorkOn(req.user, r)) error = 'Only the assigned maintenance personnel can add after-repair photos.';
  if (!error && stage === 'before' && !OPEN_STATUSES.includes(currentStatus)) error = 'Before-repair photos can only be added while the request is open.';
  if (error) {
    removeFiles(req.files);
    if (wantsJson) return res.status(400).json({ ok: false, error });
    flash(req, 'error', error);
    return res.redirect(`/requests/${r.id}#docs`);
  }
  const saved = saveAttachments(req.files, { requestId: r.id, userId: req.user.id, stage, note: b.note });
  activity.log({ requestId: r.id, equipmentId: r.equipmentId, userId: req.user.id, action: `${saved.length} ${stage}-repair photo(s) added`, details: str(b.note, 500) });
  if (wantsJson) {
    return res.json({
      ok: true,
      message: `${saved.length} photo${saved.length === 1 ? '' : 's'} uploaded successfully.`,
      count: saved.length,
      stage,
    });
  }
  flash(req, 'success', 'Photos uploaded.');
  res.redirect(`/requests/${r.id}#docs`);
});

router.post('/:id/attachments/:attId/delete', (req, res) => {
  const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
  const r = db.find('requests', req.params.id);
  if (!r) {
    if (wantsJson) return res.status(404).json({ ok: false, error: 'Request not found.' });
    return notFound(res);
  }
  if (!canViewRequest(req.user, r)) {
    if (wantsJson) return res.status(403).json({ ok: false, error: 'You do not have permission to modify this request.' });
    return forbidden(res, 'You do not have permission to modify this request.');
  }

  const att = db.find('attachments', req.params.attId);
  if (!att || String(att.requestId) !== String(r.id)) {
    if (wantsJson) return res.status(404).json({ ok: false, error: 'Photo not found.' });
    flash(req, 'error', 'Photo not found.');
    return res.redirect(`/requests/${r.id}#docs`);
  }

  const isAdmin = req.user.role === 'admin';
  const isOwnerBeforePending = String(r.requesterId) === String(req.user.id) &&
    String(att.userId) === String(req.user.id) &&
    att.stage === 'before' &&
    statusOf(r) === S.PENDING;
  const canDelete = isAdmin || isOwnerBeforePending;
  if (!canDelete) {
    if (wantsJson) return res.status(403).json({ ok: false, error: 'You do not have permission to delete this photo.' });
    flash(req, 'error', 'You do not have permission to delete this photo.');
    return res.redirect(`/requests/${r.id}#docs`);
  }

  const safeName = path.basename(String(att.filename || ''));
  if (safeName !== att.filename) {
    if (wantsJson) return res.status(400).json({ ok: false, error: 'Invalid attachment filename.' });
    flash(req, 'error', 'Invalid attachment filename.');
    return res.redirect(`/requests/${r.id}#docs`);
  }
  const filePath = path.join(UPLOAD_DIR, safeName);
  try { fs.unlinkSync(filePath); } catch (_) { /* file may already be missing */ }
  db.remove('attachments', att.id);
  activity.log({
    requestId: r.id,
    equipmentId: r.equipmentId,
    userId: req.user.id,
    action: `${att.stage === 'after' ? 'After' : 'Before'}-repair photo removed`,
    details: att.originalName || att.filename,
  });

  if (wantsJson) return res.json({ ok: true, message: 'Photo removed.', stage: att.stage, attachmentId: att.id });
  flash(req, 'success', 'Photo removed.');
  res.redirect(`/requests/${r.id}#docs`);
});

router.post('/:id/notes', (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const note = str((req.body || {}).note, 2000);
  if (!note) {
    flash(req, 'error', 'Note cannot be empty.');
    return res.redirect(`/requests/${r.id}#timeline`);
  }
  activity.log({ requestId: r.id, equipmentId: r.equipmentId, userId: req.user.id, action: 'Note added', details: note });
  notify([r.requesterId, r.technicianId, ...adminIds()], {
    message: `${req.user.name} added a note on ${r.code}.`,
    link: `/requests/${r.id}#timeline`,
    exceptUserId: req.user.id,
  });
  flash(req, 'success', 'Note added.');
  res.redirect(`/requests/${r.id}#timeline`);
});

// ---------- Connected repair workflow ----------

// Record one or more materials with per-item proof. Totals are recalculated here.
router.post('/:id/materials', workflowPhotos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const b = req.body || {};
  try {
    W.checkUpload(req);
    W.assertMaterials(r, req.user);
    if (!((req.files && req.files.materialPhotos) || []).length) W.fail('Picture proof is required for every material item.');
    const attempt = attempts.current(r.id);
    let rows = [];
    db.transaction(() => {
      const proofs = W.materialProofs(req, r.id, req.user.id, attempt && attempt.id);
      rows = materials.createBatch({
        requestId: r.id,
        userId: req.user.id,
        attemptId: attempt && attempt.id,
        rawItems: b.materials,
        proofs,
        idempotencyKey: str(b.idempotencyKey, 100),
      });
      activity.log({
        requestId: r.id,
        equipmentId: r.equipmentId,
        userId: req.user.id,
        action: 'Materials recorded',
        details: `${rows.length} item(s), total ${formatMoney(sumCents(rows))}`,
      });
    });
    flash(req, 'success', `${rows.length} material item(s) saved. Total: ${formatMoney(sumCents(rows))}.`);
  } catch (err) {
    return workflowError(res, req, err, r, '#materials');
  }
  res.redirect(`/requests/${r.id}#materials`);
});

// Authorized correction with an audit trail; original values are preserved.
router.post('/:id/materials/:materialId/correct', (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const b = req.body || {};
  try {
    let updated;
    db.transaction(() => {
      updated = materials.correct(req.params.materialId, r.id, b, req.user, str(b.reason, 1000));
      activity.log({
        requestId: r.id,
        equipmentId: r.equipmentId,
        userId: req.user.id,
        action: 'Material entry corrected',
        details: `${updated.code}: ${str(b.reason, 500)}`,
      });
    });
    flash(req, 'success', `${updated.code} corrected. The original values were kept in the audit trail.`);
  } catch (err) {
    flash(req, 'error', err.message || 'The correction could not be saved.');
  }
  res.redirect(`/requests/${r.id}#materials`);
});

// Kept only so old bookmarks do not 404. It never changes status: the primary
// flow goes In Progress / On Hold -> Completed directly.
router.post('/:id/nearing-completion', (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  flash(req, 'info', 'Nearing Completion is no longer part of the workflow. Keep working and submit the completion report when finished.');
  res.redirect(`/requests/${r.id}`);
});

router.post('/:id/verify', requireRole('admin'), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const b = req.body || {};
  if (str(b.confirm, 20) !== 'yes') {
    flash(req, 'error', 'Please confirm the verification.');
    return res.redirect(`/requests/${r.id}#verification`);
  }
  const verifiedAt = new Date().toISOString();
  try {
    db.transaction(() => {
      W.assertVerify(r, req.user);
      db.update('requests', r.id, {
        verificationStatus: 'Verified',
        verifiedAt,
        verifiedBy: req.user.id,
        verificationRemarks: str(b.remarks, 1000),
      });
      attempts.setVerification(r.id, 'Verified', { verifiedBy: req.user.id, verifiedAt });
      activity.log({
        requestId: r.id,
        equipmentId: r.equipmentId,
        userId: req.user.id,
        action: 'Completion verified',
        details: str(b.remarks, 1000) || `${r.code} verified`,
        verificationStatus: 'Verified',
      });
    });
    notify([r.requesterId, r.technicianId].filter(Boolean), {
      message: `${r.code} has been verified by the Administrator.`,
      link: reportLink(r),
      type: 'success',
      dedupeKey: `verified-${r.id}`,
    });
    flash(req, 'success', `${r.code} verified and saved to verified repair history.`);
  } catch (err) {
    flash(req, 'error', err.message || 'Verification failed.');
  }
  res.redirect(`/requests/${r.id}#verification`);
});

router.post('/:id/rework', requireRole('admin'), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const reason = str((req.body || {}).reason, 1000);
  if (!reason) {
    flash(req, 'error', 'Please give a reason for returning this repair for rework.');
    return res.redirect(`/requests/${r.id}#verification`);
  }
  try {
    const reworkAt = new Date().toISOString();
    db.transaction(() => {
      W.assertRework(r, req.user, reason);
      // Verification is a sub-track under Completed; rework sends the repair
      // back to In Progress and is logged as a real status transition.
      changeStatus(r, S.IN_PROGRESS, req.user, {
        action: 'Returned for rework',
        details: reason,
        extra: {
          verificationStatus: 'Rework Required',
          reworkReason: reason,
          reworkBy: req.user.id,
          reworkAt,
        },
      });
      attempts.setVerification(r.id, 'Rework Required', { reason, verifiedBy: req.user.id, verifiedAt: reworkAt });
    });
    notify([r.technicianId].filter(Boolean), {
      message: `${r.code} was returned for rework. Reason: ${reason}`,
      link: reportLink(r),
      type: 'warning',
      dedupeKey: `rework-${r.id}-${reworkAt}`,
    });
    syncAvailability(r.technicianId);
    flash(req, 'success', `${r.code} returned for rework.`);
  } catch (err) {
    flash(req, 'error', err.message || 'Rework request failed.');
  }
  res.redirect(`/requests/${r.id}#verification`);
});

// Rework resume starts a NEW attempt; previous proof, materials and logs stay.
router.post('/:id/rework/start', workflowPhotos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const b = req.body || {};
  const note = str(b.remarks, 1000);
  try {
    W.checkUpload(req);
    W.assertStart(r, req.user, { rework: true });
    if (!note) W.fail('Rework remarks are required.');
    if (!((req.files && req.files.photos) || []).length) W.fail('Updated picture proof is required.');
    const startedAt = new Date().toISOString();
    db.transaction(() => {
      const attempt = attempts.start(r.id, req.user.id, { startedAt });
      changeStatus(r, S.IN_PROGRESS, req.user, {
        action: 'Rework started',
        details: note,
        extra: {
          verificationStatus: 'Not Submitted',
          startedAt,
          startProofDate: todayISO(),
          reworkStartedAt: startedAt,
        },
      });
      saveAttachments(req.files.photos, { requestId: r.id, userId: req.user.id, stage: 'rework', note, attemptId: attempt.id });
    });
    syncAvailability(r.technicianId);
    notify(adminIds(), { message: `${r.code} rework has started.`, link: reportLink(r), type: 'info', exceptUserId: req.user.id });
    flash(req, 'success', 'Rework started. A new attempt is being tracked.');
  } catch (err) {
    return workflowError(res, req, err, r);
  }
  res.redirect(`/requests/${r.id}`);
});

// Cheap state endpoint used by dashboards/details to stay synchronized.
router.get('/api/state', (req, res) => {
  res.json({
    revision: db.revision(),
    serverTime: new Date().toISOString(),
  });
});

router.get('/:id/timeline', (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  res.json({
    code: r.code,
    status: r.status,
    verificationStatus: r.verificationStatus || 'Not Submitted',
    revision: db.revision(),
    timeline: attempts.timeline(r.id),
  });
});

module.exports = router;
