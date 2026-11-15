const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { flash } = require('../auth');
const { str, int, toArray } = require('../helpers');
const { validatePassword } = require('../services/password');
const activity = require('../services/activity');
const { singlePhoto } = require('../upload');
const { findOfficialStudent, ensureStudentsDatabase } = require('../services/studentVerification');

const router = express.Router();

router.get('/', (req, res) => {
  ensureStudentsDatabase();
  const specs = (req.user.specializations || []).map((id) => db.find('categories', id)).filter(Boolean);
  const isTech = req.user.role === 'technician';
  const myRequests = isTech
    ? db.all('requests').filter((r) => r.technicianId === req.user.id)
    : db.all('requests').filter((r) => r.requesterId === req.user.id);
  const stats = {
    total: myRequests.length,
    pending: myRequests.filter((r) => isTech ? r.status === 'Assigned' : r.status === 'Pending').length,
    inProgress: myRequests.filter((r) => r.status === 'In Progress').length,
    completed: myRequests.filter((r) => r.status === 'Completed').length,
  };
  const categories = db.all('categories');

  // Automatically retrieve verified student information from the school database
  const studentInfo = (req.user.studentId ? findOfficialStudent(req.user.studentId) : null) ||
                      (req.user.role === 'requester' ? findOfficialStudent(req.user.email) : null);

  res.render('profile', { title: 'Edit Profile', specs, stats, categories, studentInfo });
});

// Dedicated Instant Avatar Upload & Removal Endpoint
router.post('/avatar', singlePhoto('avatar'), (req, res) => {
  if (req.uploadError) {
    flash(req, 'error', req.uploadError);
    return res.redirect('/profile');
  }
  const b = req.body || {};
  if (b.removeAvatar === '1') {
    db.update('users', req.user.id, { avatar: null });
    req.user.avatar = null;
    activity.log({
      userId: req.user.id,
      action: 'Profile photo removed',
      details: 'User removed their profile avatar',
    });
    flash(req, 'success', 'Profile photo removed successfully.');
    return res.redirect('/profile');
  }
  if (req.file) {
    db.update('users', req.user.id, { avatar: req.file.filename });
    req.user.avatar = req.file.filename;
    activity.log({
      userId: req.user.id,
      action: 'Profile photo updated',
      details: `New avatar: ${req.file.filename}`,
    });
    flash(req, 'success', 'Profile photo updated successfully.');
    return res.redirect('/profile');
  }
  flash(req, 'error', 'No photo was selected.');
  res.redirect('/profile');
});

router.post('/', singlePhoto('avatar'), (req, res) => {
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
  let avatar = req.user.avatar || null;
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
    const specNames = newSpecs.map((id) => (db.find('categories', id) || {}).name).filter(Boolean);
    activity.log({
      userId: req.user.id,
      action: 'Specializations updated',
      details: specNames.length ? specNames.join(', ') : 'General Maintenance (none)',
    });
  }
  db.update('users', req.user.id, updates);
  req.user.name = name;
  req.user.phone = cleanPhone;
  req.user.address = address;
  req.user.department = updates.department;
  req.user.avatar = avatar;
  if (updates.specializations) req.user.specializations = updates.specializations;
  flash(req, 'success', req.user.role === 'technician' ? 'Profile and specializations updated successfully.' : 'Profile updated.');
  res.redirect('/profile');
});

router.post('/password', (req, res) => {
  const b = req.body || {};
  const current = String(b.current || '').trim();
  const next = String(b.password || '').trim();
  const confirm = String(b.confirm || '').trim();

  if (!current) {
    flash(req, 'error', 'Please enter your current password.');
    return res.redirect('/profile#password-form');
  }

  if (!bcrypt.compareSync(current, req.user.passwordHash)) {
    flash(req, 'error', 'Current password is incorrect. Please verify your existing password.');
    return res.redirect('/profile#password-form');
  }

  const { valid, errors } = validatePassword(next, {
    passwordHash: req.user.passwordHash,
    confirm,
    user: req.user,
  });

  if (!valid) {
    flash(req, 'error', errors[0] || 'Password does not meet requirements.');
    return res.redirect('/profile#password-form');
  }

  db.update('users', req.user.id, { passwordHash: bcrypt.hashSync(next, 10) });
  flash(req, 'success', 'Password successfully changed and secured!');
  res.redirect('/profile#password-form');
});

module.exports = router;
