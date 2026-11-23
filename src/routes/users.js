// Feature 9 (and 1): user accounts for Requesters, Technicians, and Administrators.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const C = require('../constants');
const { requireRole, flash } = require('../auth');
const { str, int, toArray } = require('../helpers');
const activity = require('../services/activity');
const { validatePassword } = require('../services/password');
const { verifyStudentRegistration, ensureStudentsDatabase } = require('../services/studentVerification');

const router = express.Router();
router.use(requireRole('admin'));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isTechnicianActiveTask(r) {
  const status = typeof C.normalizeStatus === 'function' ? C.normalizeStatus(r.status, r) : r.status;
  return (C.TECH_ACTIVE_STATUSES || []).includes(status);
}
const approvalBackUrl = (req) =>
  req.headers.referer && req.headers.referer.includes('/approvals') ? '/users/approvals' : '/users';

function parseUser(b) {
  const role = Object.keys(C.ROLES).includes(b.role) ? b.role : 'requester';
  const categoryIds = new Set(db.all('categories').map((c) => c.id));
  const cleanPhone = String(b.phone || '').trim().replace(/[^0-9]/g, '');
  const studentId = str(b.studentId, 50).trim().toUpperCase() || null;
  const approvalStatus = ['approved', 'pending', 'rejected'].includes(b.approvalStatus) ? b.approvalStatus : 'approved';
  return {
    name: str(b.name, 120),
    email: str(b.email, 200).toLowerCase(),
    role,
    department: str(b.department, 150),
    accountKind: role === 'requester' ? (studentId ? 'student' : 'teacher') : null,
    studentId: role === 'requester' ? studentId : null,
    address: str(b.address, 250) || '',
    phone: cleanPhone.slice(0, 11),
    specializations: role === 'technician' ? toArray(b.specializations).map((v) => int(v)).filter((id) => categoryIds.has(id)) : [],
    availability: role === 'technician' ? (C.AVAILABILITY.includes(b.availability) ? b.availability : 'Available') : null,
    approvalStatus,
  };
}

function validate(u, password, id = null) {
  ensureStudentsDatabase();
  const errors = [];
  if (!u.name) errors.push('Full name is required.');
  if (!EMAIL_RE.test(u.email)) errors.push('Please enter a valid email address.');
  else if (db.all('users').some((x) => x.email.toLowerCase() === u.email && x.id !== id)) errors.push('That email is already used by another account.');
  if (u.phone && u.phone.length > 11) errors.push('Phone number cannot exceed 11 digits.');

  if (u.role === 'requester' && u.studentId) {
    const verification = verifyStudentRegistration(u.studentId);
    if (!verification.allowed) {
      errors.push(verification.reason || 'Access Denied: Member ID is not in the institution records.');
    } else if (db.all('users').some((x) => x.studentId && x.studentId.toUpperCase() === u.studentId && x.id !== id)) {
      errors.push('That Student ID is already linked to another account.');
    }
  }

  if (!id && !password) errors.push('Password is required for new accounts.');
  if (password) {
    const pwRes = validatePassword(password, { user: u });
    if (!pwRes.valid) {
      errors.push(...pwRes.errors);
    }
  }
  return errors;
}

function renderForm(res, account, errors = [], status = 200) {
  res.status(status).render('users/form', {
    title: account.id ? `Edit ${account.name}` : 'New User Account',
    account,
    errors,
    categories: db.all('categories'),
  });
}

router.get('/', (req, res) => {
  const role = Object.keys(C.ROLES).includes(req.query.role) ? req.query.role : '';
  const status = req.query.status || '';
  const q = str(req.query.q, 100).toLowerCase();

  const allUsers = db.all('users');
  const pendingUsers = allUsers.filter((u) => u.approvalStatus === 'pending');

  const users = allUsers
    .filter((u) => {
      if (role && u.role !== role) return false;
      if (status === 'pending' && u.approvalStatus !== 'pending') return false;
      if (status === 'approved' && (u.approvalStatus === 'pending' || u.approvalStatus === 'rejected' || !u.active)) return false;
      if (status === 'inactive' && u.active) return false;
      if (q && ![u.name, u.email, u.department, u.studentId].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.approvalStatus === 'pending' && b.approvalStatus !== 'pending') return -1;
      if (b.approvalStatus === 'pending' && a.approvalStatus !== 'pending') return 1;
      return a.role.localeCompare(b.role) || a.name.localeCompare(b.name);
    });

  res.render('users/index', { title: 'User Accounts', users, pendingUsers, f: { role, status, q } });
});

// Dedicated Account Approvals Tab / View
router.get('/approvals', (req, res) => {
  const allUsers = db.all('users') || [];
  const pendingUsers = allUsers.filter((u) => u.approvalStatus === 'pending');
  const recentDecisions = allUsers
    .filter((u) => u.approvalStatus === 'approved' || u.approvalStatus === 'rejected')
    .slice()
    .reverse()
    .slice(0, 15);

  res.render('users/approvals', {
    title: 'Account Approvals',
    pendingUsers,
    recentDecisions,
  });
});

router.get('/new', (req, res) => {
  const role = Object.keys(C.ROLES).includes(req.query.role) ? req.query.role : 'requester';
  res.redirect(`/users?openAccountModal=1&role=${encodeURIComponent(role)}`);
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const u = parseUser(b);
  const password = String(b.password || '');
  const errors = validate(u, password);
  if (errors.length) return renderForm(res, u, errors, 400);
  const row = db.insert('users', {
    ...u,
    passwordHash: bcrypt.hashSync(password, 10),
    active: true,
    approvalStatus: 'approved',
  });
  activity.log({ userId: req.user.id, action: 'User account created', details: `${row.name} (${C.ROLES[row.role]})` });
  flash(req, 'success', `Account for ${row.name} created.`);
  res.redirect(row.role === 'technician' ? `/technicians/${row.id}` : '/users');
});

// Approve a pending user account
router.post('/:id/approve', (req, res) => {
  const u = db.find('users', req.params.id);
  if (!u) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
  if (u.approvalStatus !== 'pending') {
    flash(req, 'error', 'Only pending registrations can be approved.');
    return res.redirect(approvalBackUrl(req));
  }

  db.update('users', u.id, {
    approvalStatus: 'approved',
    active: true,
  });

  activity.log({
    userId: req.user.id,
    action: 'User account approved',
    details: `${u.name} (${C.ROLES[u.role]} - ${u.email}) approved and activated by ${req.user.name}`
  });

  // Feature: Send real email notification upon approval
  const { sendAccountApprovedEmail } = require('../services/mailer');
  sendAccountApprovedEmail(u).catch((err) => {
    console.error('Failed to send approval email:', err.message);
  });

  flash(req, 'success', `Account for ${u.name} (${C.ROLES[u.role]}) has been approved and activated. An email notification was sent.`);
  res.redirect(approvalBackUrl(req));
});

// Reject a pending user account
router.post('/:id/reject', (req, res) => {
  const u = db.find('users', req.params.id);
  if (!u) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
  if (u.id === req.user.id) {
    flash(req, 'error', 'You cannot reject your own account.');
    return res.redirect('/users');
  }
  if (u.approvalStatus !== 'pending') {
    flash(req, 'error', 'Only pending registrations can be rejected.');
    return res.redirect(approvalBackUrl(req));
  }
  const reason = str((req.body || {}).reason, 500);
  if (!reason) {
    flash(req, 'error', 'Please provide a reason for rejecting this registration.');
    return res.redirect(approvalBackUrl(req));
  }

  db.update('users', u.id, {
    approvalStatus: 'rejected',
    active: false,
  });

  activity.log({
    userId: req.user.id,
    action: 'User account rejected',
    details: `${u.name} (${C.ROLES[u.role]} - ${u.email}) registration rejected by ${req.user.name} · Reason: ${reason}`
  });

  // Feature: Send email notification upon rejection
  const { sendAccountRejectedEmail } = require('../services/mailer');
  sendAccountRejectedEmail(u).catch((err) => {
    console.error('Failed to send rejection email:', err.message);
  });

  flash(req, 'warning', `Account registration for ${u.name} has been rejected.`);
  res.redirect(approvalBackUrl(req));
});

router.get('/:id/edit', (req, res) => {
  const u = db.find('users', req.params.id);
  if (!u) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
  renderForm(res, u);
});

router.post('/:id', (req, res) => {
  const existing = db.find('users', req.params.id);
  if (!existing) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
  const b = req.body || {};
  const u = parseUser(b);
  const password = String(b.password || '');
  const errors = validate(u, password, existing.id);
  if (existing.id === req.user.id && u.role !== 'admin') errors.push('You cannot remove your own administrator role.');
  if (existing.role === 'technician' && u.role !== 'technician') {
    const active = db.where('requests', (r) => r.technicianId === existing.id && isTechnicianActiveTask(r)).length;
    if (active) errors.push(`This technician still has ${active} active task(s). Reassign them first.`);
  }
  if (errors.length) return renderForm(res, { ...u, id: existing.id, active: existing.active }, errors, 400);
  const patch = { ...u };
  // Editing specializations in-app replaces any seeded label metadata so the
  // displayed names always reflect the current category selection.
  if ('specializations' in patch) patch.specializationLabels = [];
  if (password) patch.passwordHash = bcrypt.hashSync(password, 10);
  db.update('users', existing.id, patch);
  activity.log({ userId: req.user.id, action: 'User account updated', details: `${u.name} (${C.ROLES[u.role]})${password ? ', password reset' : ''}` });
  flash(req, 'success', 'Account updated.');
  res.redirect('/users');
});

router.post('/:id/toggle', (req, res) => {
  const u = db.find('users', req.params.id);
  if (!u) return res.status(404).render('error', { title: 'Not found', message: 'User not found.' });
  if (u.id === req.user.id) {
    flash(req, 'error', 'You cannot deactivate your own account.');
    return res.redirect('/users');
  }
  const active = !u.active;
  db.update('users', u.id, { active });
  activity.log({ userId: req.user.id, action: active ? 'User account activated' : 'User account deactivated', details: u.name });
  let msg = `${u.name} ${active ? 'activated' : 'deactivated'}.`;
  if (!active && u.role === 'technician') {
    const tasks = db.where('requests', (r) => r.technicianId === u.id && isTechnicianActiveTask(r)).length;
    if (tasks) msg += ` Note: they still have ${tasks} active task(s) that should be reassigned.`;
  }
  flash(req, active ? 'success' : 'warning', msg);
  res.redirect('/users');
});

module.exports = router;
