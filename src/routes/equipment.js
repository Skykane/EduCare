// Features 2, 3, 5, 11: equipment profiles, status, history, search and filtering.
const express = require('express');
const db = require('../db');
const C = require('../constants');
const { requireRole, flash, forbidden } = require('../auth');
const { str, int, isISODate, todayISO } = require('../helpers');
const { scheduleFor } = require('../services/preventive');
const { enrichRequest, nextCode } = require('../services/requests');
const activity = require('../services/activity');
const { notify, adminIds } = require('../services/notify');
const { singlePhoto } = require('../upload');

const router = express.Router();

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const distinct = (field) => {
  if (field === 'location') {
    return [...new Set([...(C.CAMPUS_LOCATIONS || []), ...db.all('equipment').map((e) => e[field]).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  }
  return [...new Set(db.all('equipment').map((e) => e[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
};

function parseEquipment(b, file = null, existing = null) {
  let photo = existing ? existing.photo : null;
  if (file) {
    photo = file.filename;
  } else if (b.removePhoto === '1') {
    photo = null;
  }
  return {
    code: str(b.code, 40).toUpperCase(),
    name: str(b.name, 150),
    model: str(b.model, 150),
    serialNumber: str(b.serialNumber, 100),
    categoryId: int(b.categoryId),
    department: str(b.department, 150),
    location: str(b.location, 150),
    acquisitionDate: isISODate(b.acquisitionDate) ? b.acquisitionDate : null,
    status: str(b.status, 40),
    importance: int(b.importance, null),
    maintenanceIntervalDays: clamp(int(b.maintenanceIntervalDays, 0), 0, 3650),
    lastMaintenanceDate: isISODate(b.lastMaintenanceDate) ? b.lastMaintenanceDate : null,
    notes: str(b.notes, 2000),
    photo,
  };
}

function validate(e, id = null) {
  const errors = [];
  const today = todayISO();
  if (!e.name) errors.push('Equipment name is required.');
  if (!e.categoryId || !db.find('categories', e.categoryId)) errors.push('Please choose a category.');
  if (!e.department) errors.push('Department is required.');
  if (!e.location) errors.push('Location is required.');
  else if (!(C.CAMPUS_LOCATIONS || []).includes(e.location)) {
    const existingLoc = id ? (db.find('equipment', id) || {}).location : '';
    if (e.location !== existingLoc) errors.push('Please choose an approved campus location.');
  }
  if (!C.EQUIPMENT_STATUSES.includes(e.status)) errors.push('Please choose a condition.');
  if (!e.importance || e.importance < 1 || e.importance > 5) errors.push('Please choose an importance level.');
  if (e.code && db.all('equipment').some((x) => x.code === e.code && x.id !== id)) errors.push(`Equipment ID ${e.code} is already used.`);
  if (e.serialNumber && db.all('equipment').some((x) => x.serialNumber && x.serialNumber.toLowerCase() === e.serialNumber.toLowerCase() && x.id !== id))
    errors.push(`Serial number ${e.serialNumber} is already recorded.`);
  if (e.acquisitionDate && e.acquisitionDate > today) errors.push('Acquisition date cannot be in the future.');
  if (e.lastMaintenanceDate && e.lastMaintenanceDate > today) errors.push('Last maintenance date cannot be in the future.');
  return errors;
}

function renderForm(res, equipment, errors = [], status = 200) {
  res.status(status).render('equipment/form', {
    title: equipment.id ? `Edit ${equipment.code}` : 'Add Equipment',
    equipment,
    errors,
    categories: db.all('categories'),
    locations: distinct('location'),
    departments: distinct('department'),
  });
}

// List + search + filters
router.get('/', (req, res) => {
  const f = {
    q: str(req.query.q, 100),
    categoryId: int(req.query.categoryId),
    location: str(req.query.location, 150),
    department: str(req.query.department, 150),
    status: str(req.query.status, 40),
    pm: str(req.query.pm, 40),
  };
  const today = todayISO();
  const q = f.q.toLowerCase();
  let rows = db.all('equipment').map((e) => ({
    ...e,
    category: db.find('categories', e.categoryId),
    schedule: scheduleFor(e, today),
    openRequests: db.where('requests', (r) => r.equipmentId === e.id && C.OPEN_STATUSES.includes(r.status)).length,
  }));
  rows = rows.filter(
    (e) =>
      (!q || [e.code, e.name, e.model, e.serialNumber].some((v) => (v || '').toLowerCase().includes(q))) &&
      (!f.categoryId || e.categoryId === f.categoryId) &&
      (!f.location || e.location === f.location) &&
      (!f.department || e.department === f.department) &&
      (!f.status || e.status === f.status) &&
      (!f.pm || (e.schedule && e.schedule.status === f.pm))
  );
  rows.sort((a, b) => a.code.localeCompare(b.code));
  res.render('equipment/index', {
    title: 'Equipment',
    pageClass: 'equipment-management-page',
    rows,
    f,
    categories: db.all('categories'),
    locations: distinct('location'),
    departments: distinct('department'),
  });
});

router.get('/new', requireRole('admin'), (req, res) => {
  renderForm(res, { status: 'Operational', importance: 3, maintenanceIntervalDays: 180, categoryId: int(req.query.categoryId) });
});

router.post('/', requireRole('admin'), singlePhoto('photo'), (req, res) => {
  const e = parseEquipment(req.body || {}, req.file);
  const errors = validate(e);
  if (req.uploadError) errors.push(req.uploadError);
  if (errors.length) return renderForm(res, e, errors, 400);
  if (!e.code) e.code = nextCode('equipment', 'EQ');
  const row = db.insert('equipment', e);
  activity.log({ equipmentId: row.id, userId: req.user.id, action: 'Equipment added', details: `${row.code} ${row.name}`, toStatus: row.status });
  flash(req, 'success', `Equipment ${row.code} added.`);
  res.redirect(`/equipment/${row.id}`);
});

// Equipment Quick Lookup API (for QR scanner and search)
router.get('/api/lookup', (req, res) => {
  const q = str(req.query.q, 100).toLowerCase().trim();
  const all = db.all('equipment') || [];
  const results = all
    .filter(
      (e) =>
        !q ||
        (e.code && e.code.toLowerCase().includes(q)) ||
        (e.name && e.name.toLowerCase().includes(q)) ||
        (e.location && e.location.toLowerCase().includes(q)) ||
        (e.serialNumber && e.serialNumber.toLowerCase().includes(q))
    )
    .slice(0, 30)
    .map((e) => ({
      id: e.id,
      code: e.code,
      name: e.name,
      model: e.model || '',
      location: e.location || '',
      department: e.department || '',
      status: e.status || 'Operational',
      photo: e.photo || null,
    }));
  res.json({ ok: true, results });
});

router.get('/:id', (req, res) => {
  const e = db.find('equipment', req.params.id);
  if (!e) return res.status(404).render('error', { title: 'Not found', message: 'Equipment not found.' });
  const requests = db
    .where('requests', (r) => r.equipmentId === e.id)
    .filter((r) => req.user.role !== 'requester' || r.requesterId === req.user.id)
    .map(enrichRequest)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const records = db
    .where('maintenanceRecords', (m) => m.equipmentId === e.id)
    .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || b.id - a.id);
  res.render('equipment/show', {
    title: `${e.code} · ${e.name}`,
    e,
    category: db.find('categories', e.categoryId),
    schedule: scheduleFor(e),
    requests,
    records,
    activities: req.user.role === 'requester' ? [] : activity.forEquipment(e.id).slice(0, 20),
    technicians: db.where('users', (u) => u.role === 'technician' && u.active),
  });
});

router.get('/:id/edit', requireRole('admin'), (req, res) => {
  const e = db.find('equipment', req.params.id);
  if (!e) return res.status(404).render('error', { title: 'Not found', message: 'Equipment not found.' });
  renderForm(res, e);
});

router.post('/:id', requireRole('admin'), singlePhoto('photo'), (req, res) => {
  const existing = db.find('equipment', req.params.id);
  if (!existing) return res.status(404).render('error', { title: 'Not found', message: 'Equipment not found.' });
  const e = parseEquipment(req.body || {}, req.file, existing);
  if (!e.code) e.code = existing.code;
  const errors = validate(e, existing.id);
  if (req.uploadError) errors.push(req.uploadError);
  if (errors.length) return renderForm(res, { ...e, id: existing.id }, errors, 400);
  const oldStatus = existing.status;
  db.update('equipment', existing.id, e);
  activity.log({ equipmentId: existing.id, userId: req.user.id, action: 'Equipment profile updated', details: `${e.code} ${e.name}` });
  if (oldStatus !== e.status) {
    activity.log({ equipmentId: existing.id, userId: req.user.id, action: 'Condition changed', fromStatus: oldStatus, toStatus: e.status });
  }
  flash(req, 'success', 'Equipment updated.');
  res.redirect(`/equipment/${existing.id}`);
});

// Dedicated Instant Equipment Photo Upload, Edit & Removal Endpoint
router.post('/:id/photo', requireRole('admin'), singlePhoto('photo'), (req, res) => {
  const e = db.find('equipment', req.params.id);
  if (!e) return res.status(404).render('error', { title: 'Not found', message: 'Equipment not found.' });

  if (req.uploadError) {
    flash(req, 'error', req.uploadError);
    return res.redirect(`/equipment/${e.id}`);
  }

  const b = req.body || {};
  if (b.removePhoto === '1') {
    db.update('equipment', e.id, { photo: null });
    activity.log({
      equipmentId: e.id,
      userId: req.user.id,
      action: 'Equipment photo removed',
      details: `${e.code} ${e.name} photo was removed`,
    });
    flash(req, 'success', 'Equipment photo removed successfully.');
    return res.redirect(`/equipment/${e.id}`);
  }

  if (req.file) {
    db.update('equipment', e.id, { photo: req.file.filename });
    activity.log({
      equipmentId: e.id,
      userId: req.user.id,
      action: 'Equipment photo updated',
      details: `${e.code} ${e.name} photo updated`,
    });
    flash(req, 'success', 'Equipment photo updated successfully.');
    return res.redirect(`/equipment/${e.id}`);
  }

  flash(req, 'warning', 'No new photo was selected.');
  res.redirect(`/equipment/${e.id}`);
});

function canManageEquipment(req, equipmentId) {
  if (req.user.role === 'admin') return true;
  return db.where('requests', (r) =>
    Number(r.equipmentId) === Number(equipmentId) &&
    Number(r.technicianId) === Number(req.user.id) &&
    C.TECH_ACTIVE_STATUSES.includes(C.normalizeStatus(r.status, r))
  ).length > 0;
}

// Quick condition change (admins and technicians)
router.post('/:id/status', requireRole('admin', 'technician'), (req, res) => {
  const e = db.find('equipment', req.params.id);
  if (!e) return res.status(404).render('error', { title: 'Not found', message: 'Equipment not found.' });
  if (!canManageEquipment(req, e.id)) return forbidden(res, 'Technicians can only update equipment they have an active assigned task for.');
  const b = req.body || {};
  const status = str(b.status, 40);
  if (!C.EQUIPMENT_STATUSES.includes(status)) {
    flash(req, 'error', 'Please choose a valid condition.');
    return res.redirect(`/equipment/${e.id}`);
  }
  if (status !== e.status) {
    const from = e.status;
    db.update('equipment', e.id, { status });
    activity.log({ equipmentId: e.id, userId: req.user.id, action: 'Condition changed', details: str(b.note, 500), fromStatus: from, toStatus: status });
    notify(adminIds(), {
      message: `${e.code} ${e.name} condition changed from ${from} to ${status} by ${req.user.name}.`,
      link: `/equipment/${e.id}`,
      exceptUserId: req.user.id,
    });
    flash(req, 'success', `Condition updated to ${status}.`);
  }
  res.redirect(`/equipment/${e.id}`);
});

// Log a maintenance record directly (e.g. a routine inspection done without a request)
router.post('/:id/maintenance', requireRole('admin', 'technician'), (req, res) => {
  const e = db.find('equipment', req.params.id);
  if (!e) return res.status(404).render('error', { title: 'Not found', message: 'Equipment not found.' });
  if (!canManageEquipment(req, e.id)) return forbidden(res, 'Technicians can only log maintenance for equipment they have an active assigned task for.');
  const b = req.body || {};
  const rec = {
    equipmentId: e.id,
    requestId: null,
    technicianId: req.user.role === 'technician' ? req.user.id : int(b.technicianId) || null,
    type: C.REQUEST_TYPES.includes(b.type) ? b.type : 'Preventive',
    problem: str(b.problem, 1000),
    actionsTaken: str(b.actionsTaken, 2000),
    partsReplaced: str(b.partsReplaced, 1000),
    serviceDate: isISODate(b.serviceDate) ? b.serviceDate : '',
    resultingStatus: C.EQUIPMENT_STATUSES.includes(b.resultingStatus) ? b.resultingStatus : e.status,
    remarks: str(b.remarks, 1000),
  };
  const errors = [];
  if (!rec.serviceDate) errors.push('Service date is required.');
  else if (rec.serviceDate > todayISO()) errors.push('Service date cannot be in the future.');
  if (!rec.actionsTaken) errors.push('Describe the actions performed.');
  if (rec.technicianId) {
    const t = db.find('users', rec.technicianId);
    if (!t || t.role !== 'technician') errors.push('Invalid technician.');
  }
  if (errors.length) {
    flash(req, 'error', errors.join(' '));
    return res.redirect(`/equipment/${e.id}#log`);
  }
  db.insert('maintenanceRecords', rec);
  const patch = { status: rec.resultingStatus };
  if (rec.type === 'Preventive' && (!e.lastMaintenanceDate || rec.serviceDate > e.lastMaintenanceDate)) patch.lastMaintenanceDate = rec.serviceDate;
  const from = e.status;
  db.update('equipment', e.id, patch);
  activity.log({
    equipmentId: e.id,
    userId: req.user.id,
    action: `${rec.type} maintenance logged`,
    details: rec.actionsTaken,
    fromStatus: from !== rec.resultingStatus ? from : null,
    toStatus: from !== rec.resultingStatus ? rec.resultingStatus : null,
  });
  flash(req, 'success', 'Maintenance record saved.');
  res.redirect(`/equipment/${e.id}`);
});

router.post('/:id/delete', requireRole('admin'), (req, res) => {
  const e = db.find('equipment', req.params.id);
  if (!e) return res.status(404).render('error', { title: 'Not found', message: 'Equipment not found.' });
  if (db.where('requests', (r) => r.equipmentId === e.id).length) {
    flash(req, 'error', 'This equipment has repair requests on record, so it cannot be deleted. Set its condition to "Out of Service" instead.');
    return res.redirect(`/equipment/${e.id}`);
  }
  for (const m of db.where('maintenanceRecords', (m) => m.equipmentId === e.id)) db.remove('maintenanceRecords', m.id);
  db.remove('equipment', e.id);
  activity.log({ userId: req.user.id, action: 'Equipment deleted', details: `${e.code} ${e.name}` });
  flash(req, 'success', `Equipment ${e.code} deleted.`);
  res.redirect('/equipment');
});

module.exports = router;
