// Features 4, 6, 8, 10, 11, 12, 15, 16: repair requests from submission to completion.
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const C = require('../constants');
const { requireRole, flash, forbidden } = require('../auth');
const { str, int, isISODate, todayISO, fmtDate, fmtManila, formatDuration, formatMoney } = require('../helpers');
const { enrichRequest, sortByPriority, nextCode, canViewRequest, canWorkOn } = require('../services/requests');
const { recommendTechnicians, activeTaskCount, HIGH_WORKLOAD_AT } = require('../services/assignment');
const activity = require('../services/activity');
const { notify, adminIds } = require('../services/notify');
const { photos, workflowPhotos, saveAttachments, removeFiles, UPLOAD_DIR } = require('../upload');
const W = require('../services/workflow');
const attempts = require('../services/repairAttempts');
const materials = require('../services/materials');
const { sumCents } = require('../services/money');

const router = express.Router();

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
  if (!canViewRequest(req.user, r)) {
    forbidden(res, 'You can only view repair requests that you submitted or that are assigned to you.');
    return null;
  }
  return r;
}

// Change a request's status, record it, and tell the people involved.
function changeStatus(r, toStatus, user, { action, details = '', extra = {} }) {
  const from = r.status;
  db.update('requests', r.id, { status: toStatus, ...extra });
  activity.log({ requestId: r.id, equipmentId: r.equipmentId, userId: user.id, action, details, fromStatus: from, toStatus });
  notify([r.requesterId, r.technicianId, ...adminIds()], {
    message: `${r.code} status changed: ${from} → ${toStatus} (by ${user.name}).`,
    link: `/requests/${r.id}`,
    type: toStatus === 'Completed' ? 'success' : 'info',
    exceptUserId: user.id,
  });
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
  else if (user.role === 'technician') base = db.where('requests', (r) => r.technicianId === user.id || r.requesterId === user.id);
  else base = db.where('requests', (r) => r.requesterId === user.id);

  const q = f.q.toLowerCase();
  let rows = base.map(enrichRequest).filter((r) => {
    if (q && ![r.code, r.title, r.description, r.location, r.equipment && r.equipment.name, r.equipment && r.equipment.code, r.category && r.category.name].some((v) => (v || '').toLowerCase().includes(q))) return false;
    if (f.status === 'open') { if (!r.isOpen) return false; }
    else if (f.status === 'active') { if (!C.TECH_ACTIVE_STATUSES.includes(r.status)) return false; }
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
    technicians: db.where('users', (u) => u.role === 'technician' && u.active),
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
  const isAdmin = req.user.role === 'admin';
  const values = {
    equipmentId: int(b.equipmentId) || null,
    categoryId: int(b.categoryId) || null,
    location: str(b.location, 150),
    title: str(b.title, 150),
    description: str(b.description, 3000),
    severity: isAdmin && b.severity ? Math.min(4, Math.max(1, int(b.severity))) : null,
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
        x.equipmentId === eq.id && x.requesterId === req.user.id && C.OPEN_STATUSES.includes(x.status)
      )[0]
    : db.where('requests', (x) =>
        !x.equipmentId && x.requesterId === req.user.id && x.location === values.location &&
        x.categoryId === values.categoryId && String(x.title || '').toLowerCase() === values.title.toLowerCase() &&
        C.OPEN_STATUSES.includes(x.status)
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
      status: 'Reported',
      workflowVersion: 2,
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
    activity.log({ requestId: r.id, equipmentId: eq ? eq.id : null, userId: req.user.id, action: 'Report submitted', details: r.title, toStatus: 'Reported' });
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
  // In the new flow, "Pending" already means dispatched to a technician.
  return isNewFlow(r) ? r.status === 'Reported' : ['Reported', 'Pending'].includes(r.status);
}

function canEditRequest(user, r) {
  if (!r) return false;
  if (user.role === 'admin') return r.isOpen;
  return requesterCanModify(user, r);
}

function canCancelRequest(user, r) {
  if (!r) return false;
  if (user.role === 'admin') return r.isOpen;
  return requesterCanModify(user, r);
}

router.get('/:id', (req, res) => {
  const raw = loadRequest(req, res);
  if (!raw) return;
  const r = enrichRequest(raw);
  const user = req.user;
  const attachments = db.where('attachments', (a) => a.requestId === r.id);
  res.render('requests/show', {
    title: `${r.code} · ${r.title}`,
    r,
    canWork: canWorkOn(user, r),
    canEdit: canEditRequest(user, r),
    canCancel: canCancelRequest(user, r),
    isAdmin: user.role === 'admin',
    recommendations: user.role === 'admin' && r.isOpen
      ? recommendTechnicians(r.equipment || (r.category ? { categoryId: r.category.id } : null))
      : [],
    technicians: db.where('users', (u) => u.role === 'technician' && u.active).map((t) => ({
      ...t,
      specNames: (t.specializations || [])
        .map((id) => { const c = db.find('categories', id); return c ? c.name : null; })
        .filter(Boolean),
      activeTasks: activeTaskCount(t.id),
    })),
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
  const isAdmin = req.user.role === 'admin';
  const values = {
    categoryId: int(b.categoryId) || null,
    location: str(b.location, 150),
    title: str(b.title, 150),
    description: str(b.description, 3000),
    severity: isAdmin && b.severity ? Math.min(4, Math.max(1, int(b.severity))) : raw.severity,
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

  // Handle removed photos
  const toRemove = toArray(b.removeAttachments).map(int);
  toRemove.forEach((attId) => {
    const att = db.find('attachments', attId);
    if (att && att.requestId === raw.id) {
      db.remove('attachments', att.id);
    }
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

// ---------- Admin Approval Workflow ----------
router.post('/:id/approve', requireRole('admin'), workflowPhotos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  if (![...new Set(['Reported', 'Pending', 'Approved'])].includes(r.status) || (isNewFlow(r) && r.status !== 'Reported')) {
    flash(req, 'error', isNewFlow(r)
      ? 'This request has already been approved and assigned; it cannot be approved again.'
      : `This request is already ${r.status}.`);
    return res.redirect(`/requests/${r.id}`);
  }
  const b = req.body || {};
  const sevVal = int(b.severity);
  const priorityVal = str(b.priority, 20);
  const techId = int(b.technicianId);
  const targetDate = isISODate(b.targetDate) ? b.targetDate : null;
  const note = str(b.note, 500);
  const today = todayISO();

  // Never approve an incomplete or invalid request.
  const equipment = r.equipmentId ? db.find('equipment', r.equipmentId) : null;
  const errors = [];
  if (r.equipmentId && !equipment) errors.push('The linked equipment no longer exists, so this request cannot be approved.');
  if (!str(r.title, 150)) errors.push('This request has no problem summary and cannot be approved.');
  if (!sevVal || !C.SEVERITIES[sevVal]) errors.push('Please assess a valid severity before approving.');
  if (priorityVal && priorityVal !== 'auto' && !C.PRIORITIES.includes(priorityVal)) errors.push('Please choose a valid priority.');
  if (targetDate && targetDate < today) errors.push('Target completion date cannot be in the past.');

  const tech = techId ? db.find('users', techId) : null;
  if (techId) {
    if (!tech || tech.role !== 'technician' || !tech.active) {
      errors.push('Please choose an active technician, or leave the technician unassigned.');
    } else if (!targetDate && !r.targetDate) {
      errors.push('Please set a target completion date when assigning a technician.');
    }
  }
  if (isNewFlow(r)) {
    try { W.checkUpload(req); } catch (err) { return workflowError(res, req, err, r, '#approve'); }
    if (tech && !((req.files && req.files.photos) || []).length && !str(b.existingProof)) {
      errors.push('Supporting picture proof is required when approving and assigning.');
    }
  }
  if (errors.length) {
    if (req.files) removeFiles(Object.values(req.files).flat());
    flash(req, 'error', errors.join(' '));
    return res.redirect(`/requests/${r.id}#approve`);
  }

  const updates = {
    approvedAt: r.approvedAt || new Date().toISOString(),
    approvedBy: req.user.id,
    severity: sevVal,
    // Always persist a valid value; 'auto' (or no value) clears a manual override.
    priority: priorityVal === 'auto' || !priorityVal ? null : priorityVal,
  };
  if (targetDate) updates.targetDate = targetDate;

  if (tech && tech.role === 'technician' && tech.active) {
    updates.technicianId = tech.id;
    updates.targetDate = targetDate || r.targetDate;
    updates.status = isNewFlow(r) ? 'Pending' : 'Assigned';
    updates.assignedAt = new Date().toISOString();
    if (isNewFlow(r)) updates.verificationStatus = 'Not Submitted';
  } else {
    updates.status = 'Approved';
  }

  db.transaction(() => {
    db.update('requests', r.id, updates);
    if (isNewFlow(r) && (req.files && req.files.photos || []).length) {
      saveAttachments(req.files.photos, { requestId: r.id, userId: req.user.id, stage: 'assignment', note });
    }
  });

  const assigned = isNewFlow(r) ? updates.status === 'Pending' : updates.status === 'Assigned';
  const actionDetail = assigned
    ? `Approved by Administrator and assigned to ${tech.name}${note ? ` · Note: ${note}` : ''}`
    : `Approved by Administrator; ready for technician dispatch${note ? ` · Note: ${note}` : ''}`;

  activity.log({
    requestId: r.id,
    equipmentId: r.equipmentId,
    userId: req.user.id,
    action: assigned ? 'Request approved and assigned' : 'Request approved',
    details: actionDetail,
    fromStatus: r.status,
    toStatus: updates.status,
  });

  notify([r.requesterId], {
    message: `Your repair request ${r.code} has been approved by the Administrator${tech ? ` and assigned to ${tech.name}` : ''}.`,
    link: `/requests/${r.id}`,
    type: 'success',
  });

  if (tech) {
    notify([tech.id], {
      message: `Approved repair request ${r.code} has been assigned to you.`,
      link: `/requests/${r.id}`,
      type: 'info',
    });
  }

  flash(req, 'success', assigned ? `${r.code} approved and assigned to ${tech.name}.` : `${r.code} approved.`);
  res.redirect(`/requests/${r.id}`);
});

router.post('/:id/reject', requireRole('admin'), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  if (!['Reported', 'Pending', 'Approved'].includes(r.status)) {
    flash(req, 'error', `Cannot reject a request that is already ${r.status}.`);
    return res.redirect(`/requests/${r.id}`);
  }
  const reason = str((req.body || {}).reason, 500);
  if (!reason) {
    flash(req, 'error', 'Please provide a reason for rejecting this request.');
    return res.redirect(`/requests/${r.id}#reject`);
  }

  changeStatus(r, 'Rejected', req.user, {
    action: 'Request rejected by Admin',
    details: reason,
    extra: {
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.user.id,
      rejectionReason: reason,
    },
  });

  const eq = r.equipmentId ? db.find('equipment', r.equipmentId) : null;
  const othersOpen = eq
    ? db.where('requests', (x) => x.equipmentId === eq.id && x.id !== r.id && C.OPEN_STATUSES.includes(x.status)).length
    : 0;
  if (eq && !othersOpen && ['Needs Repair', 'Under Maintenance'].includes(eq.status) && r.type === 'Corrective') {
    setEquipmentStatus(eq.id, 'Operational', req.user, `${r.code} rejected`);
  }

  notify([r.requesterId], {
    message: `Your repair request ${r.code} was declined by the Administrator. Reason: ${reason}`,
    link: `/requests/${r.id}`,
    type: 'error',
  });

  flash(req, 'success', `${r.code} has been rejected.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Assign technician (features 10 and 16) ----------
router.post('/:id/assign', requireRole('admin'), workflowPhotos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const b = req.body || {};
  if (isNewFlow(r)) {
    try {
      W.checkUpload(req);
      W.assertAssign(r, req.user, { reassign: !!r.technicianId, reason: str(b.reassignReason, 500) });
      if (!((req.files && req.files.photos) || []).length && !str(b.existingProof)) W.fail('Supporting picture proof is required for assignment.');
    } catch (err) {
      return workflowError(res, req, err, r, '#assign');
    }
  }
  if (!C.OPEN_STATUSES.includes(r.status)) {
    flash(req, 'error', 'Only open requests can be assigned.');
    return res.redirect(`/requests/${r.id}`);
  }
  const tech = db.find('users', int(b.technicianId));
  const targetDate = isISODate(b.targetDate) ? b.targetDate : null;
  const errors = [];
  if (!tech || tech.role !== 'technician' || !tech.active) errors.push('Please choose an active technician.');
  if (!targetDate) errors.push('Please set a target completion date.');
  else if (targetDate < todayISO()) errors.push('Target date cannot be in the past.');
  if (errors.length) {
    flash(req, 'error', errors.join(' '));
    return res.redirect(`/requests/${r.id}#assign`);
  }

  const prevTech = r.technicianId ? db.find('users', r.technicianId) : null;
  const from = r.status;
  const toStatus = isNewFlow(r) ? 'Pending' : (['Pending', 'Approved'].includes(r.status) ? 'Assigned' : r.status);
  const note = str(b.note, 500);
  db.transaction(() => {
    db.update('requests', r.id, {
      technicianId: tech.id,
      targetDate,
      status: toStatus,
      assignedAt: new Date().toISOString(),
      approvedAt: r.approvedAt || new Date().toISOString(),
      approvedBy: r.approvedBy || req.user.id,
    });
    if (isNewFlow(r) && (req.files && req.files.photos || []).length) {
      saveAttachments(req.files.photos, { requestId: r.id, userId: req.user.id, stage: 'assignment', note });
    }
  });
  activity.log({
    requestId: r.id,
    equipmentId: r.equipmentId,
    userId: req.user.id,
    action: prevTech && prevTech.id !== tech.id ? 'Technician reassigned' : prevTech ? 'Assignment updated' : 'Technician assigned',
    details: `${prevTech && prevTech.id !== tech.id ? `From ${prevTech.name} to ` : 'Assigned to '}${tech.name}, target ${fmtDate(targetDate)}${note ? ` — ${note}` : ''}`,
    fromStatus: from !== toStatus ? from : null,
    toStatus: from !== toStatus ? toStatus : null,
  });

  if (!prevTech || prevTech.id !== tech.id) {
    notify([tech.id], {
      message: `New assignment: ${r.code} – ${r.title}. Target date: ${fmtDate(targetDate)}.`,
      link: `/requests/${r.id}`,
      type: 'warning',
      exceptUserId: req.user.id,
    });
    if (prevTech) notify([prevTech.id], { message: `${r.code} was reassigned to ${tech.name}.`, link: `/requests/${r.id}`, exceptUserId: req.user.id });
  } else {
    notify([tech.id], { message: `${r.code} target date updated to ${fmtDate(targetDate)}.`, link: `/requests/${r.id}`, exceptUserId: req.user.id });
  }
  notify([r.requesterId], { message: `${r.code} has been assigned to technician ${tech.name}.`, link: `/requests/${r.id}`, exceptUserId: req.user.id });

  flash(req, 'success', `Assigned to ${tech.name}.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Work progress: start / hold / resume ----------
router.post('/:id/status', workflowPhotos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  if (!canWorkOn(req.user, r)) return forbidden(res, 'Only the assigned maintenance personnel can update this task.');
  const b = req.body || {};
  const action = str(b.action, 20);
  const note = str(b.note, 1000);
  const moves = {
    start: { from: isNewFlow(r) ? ['Pending', 'Assigned'] : ['Assigned'], to: 'In Progress', label: 'Work started' },
    hold: { from: ['In Progress'], to: 'On Hold', label: 'Put on hold' },
    resume: { from: ['On Hold'], to: 'In Progress', label: 'Work resumed' },
  };
  const m = moves[action];
  if (!m || !m.from.includes(r.status)) {
    flash(req, 'error', `This action is not allowed while the request is ${r.status}.`);
    return res.redirect(`/requests/${r.id}`);
  }
  if (action === 'hold' && !note) {
    flash(req, 'error', 'Please give a reason for putting the task on hold.');
    return res.redirect(`/requests/${r.id}`);
  }
  let extra = {};
  if (action === 'start' && isNewFlow(r)) {
    try {
      W.checkUpload(req);
      W.assertStart(r, req.user);
      if (!((req.files && req.files.photos) || []).length || !note) W.fail('Repair remarks and picture proof are required to start a repair.');
    } catch (err) {
      return workflowError(res, req, err, r);
    }
  }
  if (action === 'start') extra = { startedAt: new Date().toISOString() };
  db.transaction(() => {
    changeStatus(r, m.to, req.user, { action: m.label, details: note, extra });
    if (action === 'start' && isNewFlow(r)) {
      attempts.start(r.id, req.user.id, { startedAt: extra.startedAt });
      saveAttachments(req.files.photos, { requestId: r.id, userId: req.user.id, stage: 'start', note });
    }
    if (action === 'start' || action === 'resume') setEquipmentStatus(r.equipmentId, 'Under Maintenance', req.user, `Work on ${r.code}`);
  });
  flash(req, 'success', `${r.code} is now ${m.to}.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Complete with maintenance record (features 3 and 12) ----------
router.post('/:id/complete', workflowPhotos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const b = req.body || {};
  if (!canWorkOn(req.user, r)) return forbidden(res, 'Only the assigned maintenance personnel can complete this task.');
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  const newFlow = isNewFlow(r);
  const rework = W.isRework(r);
  if (newFlow) {
    try { W.assertComplete(r, req.user, { rework }); } catch (err) { return workflowError(res, req, err, r, '#complete'); }
    if (!((req.files && req.files.photos) || []).length) errors.push('Final picture proof is required.');
    if (!str(b.remarks, 1000)) errors.push('Final completion remarks are required.');
  } else if (!C.TECH_ACTIVE_STATUSES.includes(r.status)) {
    errors.push('Only assigned or in-progress tasks can be completed.');
  }
  const linkedEquipment = r.equipmentId ? db.find('equipment', r.equipmentId) : null;
  const rec = {
    equipmentId: r.equipmentId || null,
    categoryId: r.categoryId || (linkedEquipment && linkedEquipment.categoryId) || null,
    location: r.location || (linkedEquipment && linkedEquipment.location) || '',
    requestId: r.id,
    technicianId: r.technicianId,
    type: r.type,
    problem: str(b.problem, 1000) || str(b.remarks, 1000),
    actionsTaken: str(b.actionsTaken, 2000) || str(b.remarks, 2000),
    partsReplaced: str(b.partsReplaced, 1000),
    serviceDate: isISODate(b.serviceDate) ? b.serviceDate : todayISO(),
    resultingStatus: C.EQUIPMENT_STATUSES.includes(b.resultingStatus) ? b.resultingStatus : 'Operational',
    remarks: str(b.remarks, 1000),
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
    changeStatus(r, 'Completed', req.user, {
      action: rework ? 'Rework completed' : 'Repair completed',
      details: rec.actionsTaken,
      extra: {
        completedAt,
        ...(newFlow ? { verificationStatus: C.AWAITING_VERIFICATION } : {}),
      },
    });
    saveAttachments(req.files.photos, { requestId: r.id, userId: req.user.id, stage: 'completion', note: str(b.photoNote, 1000) });
    if (newFlow) {
      const attempt = attempts.complete(r.id, rec.remarks, {
        userId: req.user.id,
        completedAt,
        verificationResult: C.AWAITING_VERIFICATION,
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
  if (newFlow) {
    notify(adminIds(), {
      message: `${r.code} is completed and awaiting your verification.`,
      link: reportLink(r),
      type: 'warning',
      exceptUserId: req.user.id,
      dedupeKey: `verify-request-${r.id}-${r.completedAt || completedAt}`,
    });
  }
  flash(req, 'success', newFlow
    ? `${r.code} completed. Elapsed repair time: ${formatDuration(attempts.totalElapsedMs(r.id))}. Awaiting verification.`
    : `${r.code} marked as completed and saved to the maintenance history.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Cancel ----------
router.post('/:id/cancel', (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const isAdmin = req.user.role === 'admin';
  const isOwnerPending = r.requesterId === req.user.id &&
    (isNewFlow(r) ? r.status === 'Reported' : ['Reported', 'Pending'].includes(r.status));
  if (!isAdmin && !isOwnerPending) return forbidden(res, 'You can only cancel your own requests while they are still awaiting review.');
  if (!C.OPEN_STATUSES.includes(r.status)) {
    flash(req, 'error', 'This request is already closed.');
    return res.redirect(`/requests/${r.id}`);
  }
  const rawReason = str((req.body || {}).reason, 500);
  const reason = rawReason || (isOwnerPending ? 'Cancelled by requester (reported by mistake or resolved)' : 'Cancelled by administrator');
  const wasPending = r.status === 'Pending';
  changeStatus(r, 'Cancelled', req.user, { action: 'Request cancelled', details: reason, extra: { cancelledAt: new Date().toISOString() } });

  // If nothing else is open for this equipment, undo the automatic "Needs Repair" mark.
  const eq = r.equipmentId ? db.find('equipment', r.equipmentId) : null;
  const othersOpen = eq
    ? db.where('requests', (x) => x.equipmentId === eq.id && x.id !== r.id && C.OPEN_STATUSES.includes(x.status)).length
    : 0;
  if (eq && !othersOpen && ['Needs Repair', 'Under Maintenance'].includes(eq.status) && r.type === 'Corrective' && wasPending) {
    setEquipmentStatus(eq.id, 'Operational', req.user, `${r.code} cancelled`);
  }

  if (req.user.role !== 'admin') {
    notify(adminIds(), {
      message: `${req.user.name} cancelled report ${r.code} (${reason}).`,
      link: `/requests/${r.id}`,
      type: 'info',
      exceptUserId: req.user.id,
    });
  }

  flash(req, 'success', `${r.code} has been cancelled.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Photos and notes (feature 12) ----------
router.post('/:id/attachments', photos(), (req, res) => {
  const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
  let r;
  if (wantsJson) {
    r = db.find('requests', req.params.id);
    if (!r) { removeFiles(req.files); return res.status(404).json({ ok: false, error: 'Request not found.' }); }
    if (!canViewRequest(req.user, r)) { removeFiles(req.files); return res.status(403).json({ ok: false, error: 'You do not have permission to add photos to this request.' }); }
  } else {
    r = loadRequest(req, res);
    if (!r) return removeFiles(req.files);
  }
  const b = req.body || {};
  const stage = b.stage === 'after' ? 'after' : 'before';
  let error = req.uploadError;
  if (!error && (!req.files || !req.files.length)) error = 'Please choose at least one photo.';
  if (!error && r.status === 'Cancelled') error = 'Cannot add photos to a cancelled request.';
  if (!error && stage === 'after' && r.status !== 'Completed') error = 'After-repair photos can only be added once the repair has been completed.';
  if (!error && stage === 'after' && !canWorkOn(req.user, r)) error = 'Only the assigned maintenance personnel can add after-repair photos.';
  if (!error && stage === 'before' && !C.OPEN_STATUSES.includes(r.status)) error = 'Before-repair photos can only be added while the request is open.';
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
  const isOwnerBeforeOpen = String(r.requesterId) === String(req.user.id) && att.stage === 'before' && C.OPEN_STATUSES.includes(r.status);
  const canDelete = isAdmin || isOwnerBeforeOpen;
  if (!canDelete) {
    if (wantsJson) return res.status(403).json({ ok: false, error: 'You do not have permission to delete this photo.' });
    flash(req, 'error', 'You do not have permission to delete this photo.');
    return res.redirect(`/requests/${r.id}#docs`);
  }

  const filePath = path.join(UPLOAD_DIR, att.filename);
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

router.post('/:id/nearing-completion', workflowPhotos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const b = req.body || {};
  const note = str(b.remarks, 1000);
  try {
    W.checkUpload(req);
    W.assertNearing(r, req.user);
    if (!note) W.fail('Progress remarks are required.');
    if (!((req.files && req.files.photos) || []).length) W.fail('Updated picture proof is required.');
    db.transaction(() => {
      changeStatus(r, 'Nearing Completion', req.user, {
        action: 'Nearing completion',
        details: note,
        extra: { nearingAt: new Date().toISOString() },
      });
      saveAttachments(req.files.photos, { requestId: r.id, userId: req.user.id, stage: 'nearing', note });
    });
    notify(adminIds(), {
      message: `${r.code} is nearing completion.`,
      link: reportLink(r),
      type: 'info',
      exceptUserId: req.user.id,
      dedupeKey: `nearing-${r.id}-${r.status}`,
    });
    flash(req, 'success', `${r.code} is now Nearing Completion.`);
  } catch (err) {
    return workflowError(res, req, err, r);
  }
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
  try {
    db.transaction(() => {
      W.assertRework(r, req.user, reason);
      db.update('requests', r.id, {
        verificationStatus: 'Rework Required',
        status: 'In Progress',
        reworkReason: reason,
        reworkBy: req.user.id,
        reworkAt: new Date().toISOString(),
      });
      attempts.setVerification(r.id, 'Rework Required', { reason, verifiedBy: req.user.id, verifiedAt: new Date().toISOString() });
      activity.log({
        requestId: r.id,
        equipmentId: r.equipmentId,
        userId: req.user.id,
        action: 'Returned for rework',
        details: reason,
        verificationStatus: 'Rework Required',
      });
    });
    notify([r.technicianId].filter(Boolean), {
      message: `${r.code} was returned for rework. Reason: ${reason}`,
      link: reportLink(r),
      type: 'warning',
      dedupeKey: `rework-${r.id}-${r.completedAt || ''}`,
    });
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
      db.update('requests', r.id, {
        status: 'In Progress',
        verificationStatus: 'Not Submitted',
        startedAt,
        reworkStartedAt: startedAt,
      });
      saveAttachments(req.files.photos, { requestId: r.id, userId: req.user.id, stage: 'rework', note, attemptId: attempt.id });
      activity.log({
        requestId: r.id,
        equipmentId: r.equipmentId,
        userId: req.user.id,
        action: 'Rework started',
        details: note,
        toStatus: 'In Progress',
      });
    });
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
