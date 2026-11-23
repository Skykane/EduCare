const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { flash } = require('../auth');
const { str, int, toArray, avatarUrl } = require('../helpers');
const { validatePassword } = require('../services/password');
const activity = require('../services/activity');
const { avatarPhoto, UPLOAD_DIR } = require('../upload');
const { findOfficialStudent, ensureStudentsDatabase } = require('../services/studentVerification');
const studentDirectory = require('../services/studentDirectory');

const router = express.Router();

// Statuses that mean a request cleared approval and entered the repair workflow.
// In the new flow, "Pending" means assigned to a technician, not awaiting admin.
const APPROVED_STATUSES = ['Approved', 'Pending', 'Assigned', 'In Progress', 'On Hold', 'Nearing Completion', 'Completed'];

function wantsJson(req) {
  return req.get('x-requested-with') === 'fetch' || String(req.get('accept') || '').includes('application/json');
}

function respondAvatar(req, res, { ok, message, avatar = null }) {
  if (wantsJson(req)) {
    return res.status(ok ? 200 : 400).json({
      ok,
      message,
      avatar: avatar ? avatarUrl(avatar) : '',
    });
  }
  flash(req, ok ? 'success' : 'error', message);
  return res.redirect('/profile');
}

// Remove an orphaned avatar only after the database no longer references it.
// Existing uploaded pictures are never replaced unless the user saves a new one
// or explicitly removes it.
function cleanupAvatar(filename, replacement = null) {
  const name = String(filename || '');
  if (!name || name === replacement) return;
  if (path.basename(name) !== name) return;
  if (db.all('users').some((u) => u.avatar === name)) return;
  fs.unlink(path.join(UPLOAD_DIR, name), () => {});
}

// Student records are optional profile metadata. A bad/missing record must not
// take down the whole profile page.
function syncStudentRecords() {
  try {
    ensureStudentsDatabase();
  } catch (err) {
    console.error('[profile] Could not sync student records:', err);
  }
}

// Automatically retrieve verified student information from the school database.
function officialStudent(user) {
  try {
    return studentDirectory.findById(user.directoryRecordId) ||
      studentDirectory.findByUserId(user.id) ||
      (user.studentId ? findOfficialStudent(user.studentId) : null) ||
      (user.role === 'requester' && user.email ? findOfficialStudent(user.email) : null);
  } catch (err) {
    console.error(`[profile] Student lookup failed for user ${user.id}:`, err);
    return null;
  }
}

// Request activity is scoped to what is relevant for the logged-in role.
function requestActivity(user) {
  const all = db.all('requests') || [];
  let rows;
  let scope;

  if (user.role === 'admin') {
    rows = all;
    scope = 'System-wide request activity across all accounts';
  } else if (user.role === 'technician') {
    rows = all.filter((r) => r.technicianId === user.id);
    scope = 'Requests assigned to you';
  } else {
    rows = all.filter((r) => r.requesterId === user.id);
    scope = 'Requests you submitted';
  }

  const pendingStatuses = user.role === 'technician' ? ['Pending', 'Assigned'] : ['Pending'];
  return {
    scope,
    stats: {
      total: rows.length,
      pending: rows.filter((r) => pendingStatuses.includes(r.status)).length,
      approved: rows.filter((r) => APPROVED_STATUSES.includes(r.status)).length,
      completed: rows.filter((r) => r.status === 'Completed').length,
    },
  };
}

// Profile Overview Dashboard. Edit Profile is a modal on this same page,
// so no separate form page is rendered.
router.get('/', (req, res) => {
  syncStudentRecords();
  const { stats, scope } = requestActivity(req.user);
  res.render('profile', {
    title: 'My Profile',
    pageClass: 'profile-page',
    stats,
    activityScope: scope,
    studentInfo: officialStudent(req.user),
    categories: db.all('categories'),
  });
});

// Legacy route kept working: send the user to the dashboard with the
// Edit Profile modal automatically opened.
router.get('/edit', (req, res) => {
  res.redirect('/profile?edit=1');
});

// Dedicated Instant Avatar Upload & Removal Endpoint.
// The cropper posts a squared canvas image here; normal multipart uploads also
// work. Only JPG/JPEG/PNG/WEBP, max 5 MB, with byte-level format validation.
router.post('/avatar', avatarPhoto('avatar'), (req, res) => {
  if (req.uploadError) {
    return respondAvatar(req, res, { ok: false, message: req.uploadError });
  }
  const b = req.body || {};
  const previous = req.user.avatar || null;
  if (b.removeAvatar === '1') {
    db.update('users', req.user.id, { avatar: null });
    req.user.avatar = null;
    cleanupAvatar(previous);
    activity.log({
      userId: req.user.id,
      action: 'Profile photo removed',
      details: 'User removed their profile avatar',
    });
    return respondAvatar(req, res, { ok: true, message: 'Profile photo removed successfully.' });
  }
  if (req.file) {
    db.update('users', req.user.id, { avatar: req.file.filename });
    req.user.avatar = req.file.filename;
    cleanupAvatar(previous, req.file.filename);
    activity.log({
      userId: req.user.id,
      action: 'Profile photo updated',
      details: `New avatar: ${req.file.filename}`,
    });
    return respondAvatar(req, res, {
      ok: true,
      message: 'Profile photo updated successfully.',
      avatar: req.file.filename,
    });
  }
  return respondAvatar(req, res, { ok: false, message: 'No photo was selected.' });
});

router.post('/', avatarPhoto('avatar'), (req, res) => {
  if (req.uploadError) {
    flash(req, 'error', req.uploadError);
    return res.redirect('/profile');
  }
  const b = req.body || {};
  const name = str(b.name, 120);
  if (!name) {
    flash(req, 'error', 'Name is required.');
    return res.redirect('/profile');
  }
  const rawPhone = String(b.phone || '').trim();
  const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
  if (cleanPhone.length > 11) {
    flash(req, 'error', 'Phone number cannot exceed 11 digits.');
    return res.redirect('/profile');
  }
  const address = str(b.address, 250);
  const previousAvatar = req.user.avatar || null;
  let avatar = previousAvatar;
  if (req.file) {
    avatar = req.file.filename;
  } else if (b.removeAvatar === '1') {
    avatar = null;
  }
  const updates = {
    name,
    phone: cleanPhone,
    address,
    department: str(b.department, 150),
    avatar,
  };
  if (req.user.role === 'technician') {
    const categoryIds = new Set(db.all('categories').map((c) => c.id));
    const newSpecs = toArray(b.specializations)
      .map((v) => int(v))
      .filter((id) => categoryIds.has(id));
    updates.specializations = newSpecs;
    // Clear seeded label metadata so displayed names follow the new selection.
    updates.specializationLabels = [];
    const specNames = newSpecs.map((id) => (db.find('categories', id) || {}).name).filter(Boolean);
    activity.log({
      userId: req.user.id,
      action: 'Specializations updated',
      details: specNames.length ? specNames.join(', ') : 'General Maintenance (none)',
    });
  }
  db.update('users', req.user.id, updates);
  if (avatar !== previousAvatar) cleanupAvatar(previousAvatar, avatar);
  req.user.name = name;
  req.user.phone = cleanPhone;
  req.user.address = address;
  req.user.department = updates.department;
  req.user.avatar = avatar;
  if (updates.specializations) req.user.specializations = updates.specializations;
  flash(req, 'success', req.user.role === 'technician' ? 'Profile and specializations updated successfully.' : 'Profile updated.');
  res.redirect('/profile');
});

// First-login password change for accounts created with a temporary password.
router.get('/change-password', (req, res) => {
  res.render('change-password', { title: 'Set Your Password' });
});

router.post('/password', (req, res) => {
  const b = req.body || {};
  const current = String(b.current || '').trim();
  const next = String(b.password || '').trim();
  const confirm = String(b.confirm || '').trim();
  const back = req.user.mustChangePassword ? '/profile/change-password' : '/profile';

  if (!current) {
    flash(req, 'error', 'Please enter your current password.');
    return res.redirect(back);
  }

  if (!bcrypt.compareSync(current, req.user.passwordHash)) {
    flash(req, 'error', 'Current password is incorrect. Please verify your existing password.');
    return res.redirect(back);
  }

  const { valid, errors } = validatePassword(next, {
    passwordHash: req.user.passwordHash,
    confirm,
    user: req.user,
  });

  if (!valid) {
    flash(req, 'error', errors[0] || 'Password does not meet requirements.');
    return res.redirect(back);
  }

  db.update('users', req.user.id, {
    passwordHash: bcrypt.hashSync(next, 10),
    mustChangePassword: false,
  });
  flash(req, 'success', 'Password successfully changed and secured!');
  res.redirect('/');
});

module.exports = router;
