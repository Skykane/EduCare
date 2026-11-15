// Features 4, 6, 8, 10, 11, 12, 15, 16: repair requests from submission to completion.
const express = require('express');
const db = require('../db');
const C = require('../constants');
const { requireRole, flash, forbidden } = require('../auth');
const { str, int, isISODate, todayISO, fmtDate } = require('../helpers');
const { enrichRequest, sortByPriority, nextCode, canViewRequest, canWorkOn } = require('../services/requests');
const { recommendTechnicians } = require('../services/assignment');
const activity = require('../services/activity');
const { notify, adminIds } = require('../services/notify');
const { photos, saveAttachments, removeFiles } = require('../upload');

const router = express.Router();

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
    if (q && ![r.code, r.title, r.description, r.equipment && r.equipment.name, r.equipment && r.equipment.code].some((v) => (v || '').toLowerCase().includes(q))) return false;
    if (f.status === 'open') { if (!r.isOpen) return false; }
    else if (f.status === 'active') { if (!C.TECH_ACTIVE_STATUSES.includes(r.status)) return false; }
    else if (f.status && r.status !== f.status) return false;
    if (f.priority && r.effectivePriority !== f.priority) return false;
    if (f.type && r.type !== f.type) return false;
    if (f.categoryId && (!r.equipment || r.equipment.categoryId !== f.categoryId)) return false;
    if (f.location && (!r.equipment || r.equipment.location !== f.location)) return false;
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
    locations: [...new Set([...(C.HIGH_SCHOOL_LOCATIONS || []), ...db.all('equipment').map((e) => e.location).filter(Boolean)])].sort(),
    technicians: db.where('users', (u) => u.role === 'technician'),
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
    locations: [...new Set([...(C.HIGH_SCHOOL_LOCATIONS || []), ...allEq.map((e) => e.location).filter(Boolean)])].sort(),
  });
}

router.get('/new', (req, res) => {
  if (req.user.role === 'technician') {
    return forbidden(res, 'Technicians cannot submit repair requests.');
  }
  const eqId = req.query.equipmentId ? `&equipmentId=${encodeURIComponent(req.query.equipmentId)}` : '';
  res.redirect(`/requests?openModal=1${eqId}`);
});

router.post('/', photos(), (req, res) => {
  if (req.user.role === 'technician') {
    return forbidden(res, 'Technicians cannot submit repair requests.');
  }
  const b = req.body || {};
  const isAdmin = req.user.role === 'admin';
  const values = {
    equipmentId: int(b.equipmentId),
    title: str(b.title, 150),
    description: str(b.description, 3000),
    severity: isAdmin && b.severity ? Math.min(4, Math.max(1, int(b.severity))) : null,
    photoNote: str(b.photoNote, 1000),
  };
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  const eq = values.equipmentId ? db.find('equipment', values.equipmentId) : null;
  if (!eq) errors.push('Please choose the equipment that needs repair.');
  if (!values.title) errors.push('Please enter a short summary of the problem.');
  if (!values.description) errors.push('Please describe the problem.');
  if (errors.length) {
    if (!req.uploadError && req.files && req.files.length) errors.push('Please attach your photos again.');
    removeFiles(req.files);
    return renderNew(res, values, errors, 400);
  }

  const r = db.insert('requests', {
    code: nextCode('requests', 'REQ'),
    equipmentId: eq.id,
    requesterId: req.user.id,
    title: values.title,
    description: values.description,
    severity: values.severity,
    type: 'Corrective',
    status: 'Pending',
    priority: null,
    technicianId: null,
    targetDate: null,
    assignedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
  });
  activity.log({ requestId: r.id, equipmentId: eq.id, userId: req.user.id, action: 'Request submitted', details: r.title, toStatus: 'Pending' });
  saveAttachments(req.files, { requestId: r.id, userId: req.user.id, stage: 'before', note: values.photoNote });
  if (eq.status === 'Operational') setEquipmentStatus(eq.id, 'Needs Repair', req.user, `Reported in ${r.code}`);

  const rec = enrichRequest(r).rec;
  const sevLabel = r.severity ? `severity: ${C.SEVERITIES[r.severity]}, recommended priority: ${rec.level}` : `recommended priority: ${rec.level}`;
  notify(adminIds(), {
    message: `New repair request ${r.code} for ${eq.code} ${eq.name} (${sevLabel}).`,
    link: `/requests/${r.id}`,
    type: rec.level === 'High' ? 'warning' : 'info',
    exceptUserId: req.user.id,
  });

  // Feature: Send email confirmation to the requester
  const { sendRequestCreatedEmail } = require('../services/mailer');
  sendRequestCreatedEmail(r, req.user, eq).catch((err) => {
    console.error('Failed to send request confirmation email:', err.message);
  });

  flash(req, 'success', `Request ${r.code} submitted. You will be notified when its status changes.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Details ----------
function canEditRequest(user, r) {
  if (!r) return false;
  if (user.role === 'admin') return r.isOpen;
  return r.requesterId === user.id && r.status === 'Pending';
}

function canCancelRequest(user, r) {
  if (!r) return false;
  if (user.role === 'admin') return r.isOpen;
  return r.requesterId === user.id && r.status === 'Pending';
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
    recommendations: user.role === 'admin' && r.isOpen ? recommendTechnicians(r.equipment) : [],
    technicians: db.where('users', (u) => u.role === 'technician' && u.active),
    before: attachments.filter((a) => a.stage === 'before'),
    after: attachments.filter((a) => a.stage === 'after'),
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
    flash(req, 'error', 'You can only edit your own requests while they are pending review.');
    return res.redirect(`/requests/${raw.id}`);
  }
  const r = enrichRequest(raw);
  const attachments = db.where('attachments', (a) => a.requestId === r.id && a.stage === 'before');
  res.render('requests/edit', {
    title: `Edit ${r.code} · ${r.title}`,
    r,
    equipment: db.all('equipment'),
    categories: db.all('categories'),
    attachments,
    errors: [],
  });
});

router.post('/:id/edit', photos(), (req, res) => {
  const raw = loadRequest(req, res);
  if (!raw) return removeFiles(req.files);
  if (!canEditRequest(req.user, raw)) {
    removeFiles(req.files);
    flash(req, 'error', 'You can only edit your own requests while they are pending review.');
    return res.redirect(`/requests/${raw.id}`);
  }
  const b = req.body || {};
  const isAdmin = req.user.role === 'admin';
  const values = {
    equipmentId: int(b.equipmentId),
    title: str(b.title, 150),
    description: str(b.description, 3000),
    severity: isAdmin && b.severity ? Math.min(4, Math.max(1, int(b.severity))) : raw.severity,
    photoNote: str(b.photoNote, 1000),
  };
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  const eq = values.equipmentId ? db.find('equipment', values.equipmentId) : null;
  if (!eq) errors.push('Please choose the equipment that needs repair.');
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

  // Handle equipment change if student changed which equipment is broken
  const oldEqId = raw.equipmentId;
  const newEqId = eq.id;
  if (oldEqId !== newEqId) {
    const oldEq = db.find('equipment', oldEqId);
    if (oldEq && oldEq.status === 'Needs Repair') {
      const otherOpenForOld = db.where('requests', (x) => x.equipmentId === oldEqId && x.id !== raw.id && C.OPEN_STATUSES.includes(x.status)).length;
      if (!otherOpenForOld) {
        setEquipmentStatus(oldEq.id, 'Operational', req.user, `Equipment reassigned from ${raw.code}`);
      }
    }
    if (eq.status === 'Operational') {
      setEquipmentStatus(eq.id, 'Needs Repair', req.user, `Reported in ${raw.code}`);
    }
    activity.log({
      requestId: raw.id,
      equipmentId: newEqId,
      userId: req.user.id,
      action: 'Equipment selection changed',
      details: `Equipment changed to ${eq.code} ${eq.name}`,
    });
  }

  // Update request
  db.update('requests', raw.id, {
    equipmentId: newEqId,
    title: values.title,
    description: values.description,
    severity: values.severity,
  });

  activity.log({
    requestId: raw.id,
    equipmentId: newEqId,
    userId: req.user.id,
    action: 'Report details edited',
    details: `${req.user.name} updated the problem description / equipment`,
  });

  if (req.user.role !== 'admin') {
    notify(adminIds(), {
      message: `${req.user.name} updated report ${raw.code} for ${eq.code} ${eq.name}.`,
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
router.post('/:id/approve', requireRole('admin'), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  if (!['Pending', 'Approved'].includes(r.status)) {
    flash(req, 'error', `This request is already ${r.status}.`);
    return res.redirect(`/requests/${r.id}`);
  }
  const b = req.body || {};
  const sevVal = int(b.severity);
  const priorityVal = str(b.priority, 20);
  const techId = int(b.technicianId);
  const targetDate = isISODate(b.targetDate) ? b.targetDate : null;
  const note = str(b.note, 500);

  const updates = {
    approvedAt: r.approvedAt || new Date().toISOString(),
    approvedBy: req.user.id,
  };

  if (sevVal && C.SEVERITIES[sevVal]) {
    updates.severity = sevVal;
  }
  if (priorityVal && C.PRIORITIES.includes(priorityVal)) {
    updates.priority = priorityVal;
  } else if (priorityVal === 'auto') {
    updates.priority = null;
  }

  const tech = techId ? db.find('users', techId) : null;
  if (tech && tech.role === 'technician' && tech.active) {
    updates.technicianId = tech.id;
    updates.targetDate = targetDate || r.targetDate;
    updates.status = 'Assigned';
    updates.assignedAt = new Date().toISOString();
  } else {
    updates.status = 'Approved';
  }

  db.update('requests', r.id, updates);

  const actionDetail = updates.status === 'Assigned'
    ? `Approved by Administrator and assigned to ${tech.name}${note ? ` · Note: ${note}` : ''}`
    : `Approved by Administrator; ready for technician dispatch${note ? ` · Note: ${note}` : ''}`;

  activity.log({
    requestId: r.id,
    equipmentId: r.equipmentId,
    userId: req.user.id,
    action: updates.status === 'Assigned' ? 'Request approved and assigned' : 'Request approved',
    details: actionDetail,
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

  flash(req, 'success', updates.status === 'Assigned' ? `${r.code} approved and assigned to ${tech.name}.` : `${r.code} approved.`);
  res.redirect(`/requests/${r.id}`);
});

router.post('/:id/reject', requireRole('admin'), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  if (!['Pending', 'Approved'].includes(r.status)) {
    flash(req, 'error', `Cannot reject a request that is already ${r.status}.`);
    return res.redirect(`/requests/${r.id}`);
  }
  const b = req.body || {};
  const rawReason = str(b.reason, 500);
  const reason = rawReason || 'Declined by administrator (out of maintenance scope or invalid)';

  changeStatus(r, 'Rejected', req.user, {
    action: 'Request rejected by Admin',
    details: reason,
    extra: {
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.user.id,
      rejectionReason: reason,
    },
  });

  const eq = db.find('equipment', r.equipmentId);
  const othersOpen = db.where('requests', (x) => x.equipmentId === r.equipmentId && x.id !== r.id && C.OPEN_STATUSES.includes(x.status)).length;
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
router.post('/:id/assign', requireRole('admin'), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const b = req.body || {};
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
  const toStatus = ['Pending', 'Approved'].includes(r.status) ? 'Assigned' : r.status;
  const note = str(b.note, 500);
  db.update('requests', r.id, {
    technicianId: tech.id,
    targetDate,
    status: toStatus,
    assignedAt: new Date().toISOString(),
    approvedAt: r.approvedAt || new Date().toISOString(),
    approvedBy: r.approvedBy || req.user.id,
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
router.post('/:id/status', (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  if (!canWorkOn(req.user, r)) return forbidden(res, 'Only the assigned technician or an administrator can update this task.');
  const b = req.body || {};
  const action = str(b.action, 20);
  const note = str(b.note, 1000);
  const moves = {
    start: { from: ['Assigned'], to: 'In Progress', label: 'Work started' },
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
  const extra = action === 'start' ? { startedAt: new Date().toISOString() } : {};
  changeStatus(r, m.to, req.user, { action: m.label, details: note, extra });
  if (action === 'start' || action === 'resume') setEquipmentStatus(r.equipmentId, 'Under Maintenance', req.user, `Work on ${r.code}`);
  flash(req, 'success', `${r.code} is now ${m.to}.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Complete with maintenance record (features 3 and 12) ----------
router.post('/:id/complete', photos(), (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return removeFiles(req.files);
  const b = req.body || {};
  if (!canWorkOn(req.user, r)) {
    removeFiles(req.files);
    return forbidden(res, 'Only the assigned technician or an administrator can complete this task.');
  }
  const errors = [];
  if (req.uploadError) errors.push(req.uploadError);
  if (!C.TECH_ACTIVE_STATUSES.includes(r.status)) errors.push('Only assigned or in-progress tasks can be completed.');
  const rec = {
    equipmentId: r.equipmentId,
    requestId: r.id,
    technicianId: r.technicianId,
    type: r.type,
    problem: str(b.problem, 1000),
    actionsTaken: str(b.actionsTaken, 2000),
    partsReplaced: str(b.partsReplaced, 1000),
    serviceDate: isISODate(b.serviceDate) ? b.serviceDate : '',
    resultingStatus: C.EQUIPMENT_STATUSES.includes(b.resultingStatus) ? b.resultingStatus : 'Operational',
    remarks: str(b.remarks, 1000),
  };
  if (!rec.problem) errors.push('Please describe the problem that was identified.');
  if (!rec.actionsTaken) errors.push('Please describe the actions performed.');
  if (!rec.serviceDate) errors.push('Service date is required.');
  else if (rec.serviceDate > todayISO()) errors.push('Service date cannot be in the future.');
  if (errors.length) {
    removeFiles(req.files);
    flash(req, 'error', errors.join(' '));
    return res.redirect(`/requests/${r.id}#complete`);
  }

  db.insert('maintenanceRecords', rec);
  saveAttachments(req.files, { requestId: r.id, userId: req.user.id, stage: 'after', note: str(b.photoNote, 1000) });
  changeStatus(r, 'Completed', req.user, { action: 'Repair completed', details: rec.actionsTaken, extra: { completedAt: new Date().toISOString() } });

  const eq = db.find('equipment', r.equipmentId);
  if (eq) {
    setEquipmentStatus(eq.id, rec.resultingStatus, req.user, `Completed ${r.code}`);
    if (r.type === 'Preventive' && (!eq.lastMaintenanceDate || rec.serviceDate > eq.lastMaintenanceDate)) {
      db.update('equipment', eq.id, { lastMaintenanceDate: rec.serviceDate });
    }
  }
  flash(req, 'success', `${r.code} marked as completed and saved to the maintenance history.`);
  res.redirect(`/requests/${r.id}`);
});

// ---------- Cancel ----------
router.post('/:id/cancel', (req, res) => {
  const r = loadRequest(req, res);
  if (!r) return;
  const isAdmin = req.user.role === 'admin';
  const isOwnerPending = r.requesterId === req.user.id && r.status === 'Pending';
  if (!isAdmin && !isOwnerPending) return forbidden(res, 'You can only cancel your own requests while they are still pending.');
  if (!C.OPEN_STATUSES.includes(r.status)) {
    flash(req, 'error', 'This request is already closed.');
    return res.redirect(`/requests/${r.id}`);
  }
  const rawReason = str((req.body || {}).reason, 500);
  const reason = rawReason || (isOwnerPending ? 'Cancelled by requester (reported by mistake or resolved)' : 'Cancelled by administrator');
  const wasPending = r.status === 'Pending';
  changeStatus(r, 'Cancelled', req.user, { action: 'Request cancelled', details: reason, extra: { cancelledAt: new Date().toISOString() } });

  // If nothing else is open for this equipment, undo the automatic "Needs Repair" mark.
  const eq = db.find('equipment', r.equipmentId);
  const othersOpen = db.where('requests', (x) => x.equipmentId === r.equipmentId && x.id !== r.id && C.OPEN_STATUSES.includes(x.status)).length;
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
  const r = loadRequest(req, res);
  if (!r) return removeFiles(req.files);
  const b = req.body || {};
  const stage = b.stage === 'after' ? 'after' : 'before';
  let error = req.uploadError;
  if (!error && (!req.files || !req.files.length)) error = 'Please choose at least one photo.';
  if (!error && r.status === 'Cancelled') error = 'Cannot add photos to a cancelled request.';
  if (!error && stage === 'after' && !canWorkOn(req.user, r)) error = 'Only the assigned technician or an administrator can add after-repair photos.';
  if (error) {
    removeFiles(req.files);
    flash(req, 'error', error);
    return res.redirect(`/requests/${r.id}#docs`);
  }
  const saved = saveAttachments(req.files, { requestId: r.id, userId: req.user.id, stage, note: b.note });
  activity.log({ requestId: r.id, equipmentId: r.equipmentId, userId: req.user.id, action: `${saved.length} ${stage}-repair photo(s) added`, details: str(b.note, 500) });
  flash(req, 'success', 'Photos uploaded.');
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

module.exports = router;
