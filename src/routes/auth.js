const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { safeLocalPath, str, todayISO } = require('../helpers');
const { notify, adminIds } = require('../services/notify');
const activity = require('../services/activity');
const { validatePassword } = require('../services/password');
const { verifyStudentRegistration, ensureStudentsDatabase } = require('../services/studentVerification');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOURS = 60 * 60 * 1000;
const REMEMBER_MS = 30 * 24 * HOURS;
const DEFAULT_MS = 8 * HOURS;

function renderLogin(res, opts = {}, status = 200) {
  res.status(status).render('login', {
    title: 'Log In',
    error: null,
    notice: null,
    email: '',
    remember: false,
    next: '/',
    ...opts,
  });
}

function startSession(req, res, user, remember, next) {
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('error', { title: 'Error', message: 'Could not start session.' });
    req.session.userId = user.id;
    req.session.cookie.maxAge = remember ? REMEMBER_MS : DEFAULT_MS;
    db.update('users', user.id, { lastLoginAt: new Date().toISOString() });

    // Feature: Send login security alert to the user's email
    try {
      const { sendLoginAlertEmail } = require('../services/mailer');
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || '127.0.0.1';
      const userAgent = req.headers['user-agent'] || '';
      sendLoginAlertEmail(user, { ip, userAgent, time: new Date() }).catch((e) => {
        console.error('Failed to dispatch login alert email:', e.message);
      });
    } catch (e) {
      /* ignore */
    }

    res.redirect(next);
  });
}

// ---------- Log in ----------
router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  renderLogin(res, { next: safeLocalPath(req.query.next, '/') });
});

router.post('/login', (req, res) => {
  ensureStudentsDatabase();
  const b = req.body || {};
  const rawInput = str(b.email, 200).trim();
  const lowerInput = rawInput.toLowerCase();
  const next = safeLocalPath(b.next, '/');
  const remember = b.remember === '1';

  // Search by either email or studentId
  const user = db.all('users').find(
    (u) =>
      u.email.toLowerCase() === lowerInput ||
      (u.studentId && u.studentId.toLowerCase() === lowerInput)
  );
  const ok = user && bcrypt.compareSync(String(b.password || ''), user.passwordHash);

  if (!ok) {
    return renderLogin(
      res,
      {
        error: 'Incorrect email/Student ID or password.',
        email: rawInput,
        remember,
        next,
      },
      401
    );
  }

  // Check administrator approval status
  if (user.approvalStatus === 'pending') {
    return renderLogin(
      res,
      {
        error: 'Access Denied: Your account is currently pending administrator verification and approval. Please wait for an administrator to activate your account.',
        email: rawInput,
        remember,
        next,
      },
      403
    );
  }

  if (user.approvalStatus === 'rejected') {
    return renderLogin(
      res,
      {
        error: 'Access Denied: Your registration was not approved by the administrator. Please contact the administration office.',
        email: rawInput,
        remember,
        next,
      },
      403
    );
  }

  if (!user.active) {
    return renderLogin(
      res,
      {
        error: 'This account is deactivated. Please contact the administrator.',
        email: rawInput,
        remember,
        next,
      },
      401
    );
  }

  // Verify student registration if role is requester (student account)
  if (user.role === 'requester') {
    if (!user.studentId) {
      return renderLogin(
        res,
        {
          error: 'Access Denied: You are not an officially registered student of this high school. No Student ID is associated with this account.',
          email: rawInput,
          remember,
          next,
        },
        403
      );
    }

    const verification = verifyStudentRegistration(user.studentId);
    if (!verification.allowed) {
      return renderLogin(
        res,
        {
          error: verification.reason || 'Access Denied: You are not an officially registered student of this high school.',
          email: rawInput,
          remember,
          next,
        },
        403
      );
    }
  }

  startSession(req, res, user, remember, next);
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('educare.sid');
    res.redirect('/login');
  });
});

// ---------- Register (supports Student, Admin, Technician with Approval Workflow) ----------
router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { title: 'Register', errors: [], values: { role: 'requester' } });
});

router.post('/register', (req, res) => {
  ensureStudentsDatabase();
  const b = req.body || {};
  const requestedRole = ['admin', 'technician', 'requester'].includes(b.role) ? b.role : 'requester';
  const rawStudentId = str(b.studentId, 50).trim().toUpperCase();
  const studentId = requestedRole === 'requester' ? rawStudentId : null;

  const values = {
    role: requestedRole,
    studentId,
    name: str(b.name, 120),
    email: str(b.email, 200).toLowerCase(),
    department: str(b.department, 150),
  };
  const password = String(b.password || '');
  const errors = [];

  // Enforce Student ID check only if registering as a Student (requester)
  if (requestedRole === 'requester') {
    if (!studentId) {
      errors.push('Student ID is required for student registration. Only officially registered students can create an account.');
    } else {
      const verification = verifyStudentRegistration(studentId);
      if (!verification.allowed) {
        errors.push(verification.reason || 'Access Denied: You are not an officially registered student of this high school.');
      } else {
        // Check if this Student ID is already linked to an existing account
        const alreadyLinked = db.all('users').find(
          (u) => u.studentId && u.studentId.toUpperCase() === studentId
        );
        if (alreadyLinked) {
          errors.push('Access Denied: This Student ID is already associated with an existing account. Please log in instead.');
        } else {
          // Auto-set department to student's official grade & section if not provided
          if (!values.department && verification.student) {
            values.department = `${verification.student.gradeLevel} - ${verification.student.section}`;
          }
          if (!values.name && verification.student) {
            values.name = verification.student.fullName;
          }
        }
      }
    }
  } else if (requestedRole === 'admin') {
    if (!values.department) values.department = 'Administration Office';
  } else if (requestedRole === 'technician') {
    if (!values.department) values.department = 'Maintenance & Technical Services';
  }

  if (!values.name) errors.push('Full name is required.');
  if (!EMAIL_RE.test(values.email)) errors.push('Please enter a valid email address.');
  else if (db.all('users').some((u) => u.email.toLowerCase() === values.email)) {
    errors.push('That email is already registered. Try logging in instead.');
  }

  const pwRes = validatePassword(password, {
    confirm: b.confirm,
    user: values,
  });
  if (!pwRes.valid) {
    errors.push(...pwRes.errors);
  }

  if (errors.length) {
    const hasAccessDenied = errors.some((e) => e.startsWith('Access Denied'));
    return res.status(hasAccessDenied ? 403 : 400).render('register', { title: 'Register', errors, values });
  }

  // Feature: Account verification & approval workflow.
  // New signups start as pending approval (active: false, approvalStatus: 'pending')
  const C = require('../constants');
  const roleLabel = C.ROLES[requestedRole] || requestedRole;
  const user = db.insert('users', {
    ...values,
    studentId,
    phone: '',
    role: requestedRole,
    passwordHash: bcrypt.hashSync(password, 10),
    active: false, // inactive until approved by admin
    approvalStatus: 'pending', // 'pending' | 'approved' | 'rejected'
    createdAt: new Date().toISOString(),
    specializations: [],
    availability: requestedRole === 'technician' ? 'Available' : null,
  });

  activity.log({
    userId: user.id,
    action: 'Account registered (Pending Approval)',
    details: `${user.name} registered as ${roleLabel} (${user.email}${studentId ? ', Student ID: ' + studentId : ''}). Awaiting admin verification.`
  });

  notify(adminIds(), {
    message: `New ${roleLabel} account registered: ${user.name} (${user.email}). Pending administrator approval.`,
    link: '/users'
  });

  // Feature: Send real email confirmation to newly registered email
  const { sendRegistrationPendingEmail } = require('../services/mailer');
  sendRegistrationPendingEmail(user).catch((err) => {
    console.error('Failed to send registration email:', err.message);
  });

  // Redirect to login with confirmation notice
  renderLogin(res, {
    notice: `Account registered successfully as ${roleLabel}! Your account is pending administrator verification and approval before you can log in.`,
    email: user.email,
  });
});

// ---------- Forgot password (asks an administrator to reset it) ----------
router.get('/forgot-password', (req, res) => {
  res.render('forgot', { title: 'Forgot Password', sent: false, email: '', error: null });
});

router.post('/forgot-password', (req, res) => {
  const email = str((req.body || {}).email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).render('forgot', { title: 'Forgot Password', sent: false, email, error: 'Please enter a valid email address.' });
  }
  const user = db.all('users').find((u) => u.email.toLowerCase() === email && u.active);
  if (user) {
    notify(adminIds(), {
      message: `Password reset requested by ${user.name} (${user.email}). Set a new password in User Accounts.`,
      link: `/users/${user.id}/edit`,
      type: 'warning',
      dedupeKey: `pw-reset-${user.id}-${todayISO()}`,
    });
  }
  // Same answer either way, so the page does not reveal which emails are registered.
  res.render('forgot', { title: 'Forgot Password', sent: true, email, error: null });
});

module.exports = router;
