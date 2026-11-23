const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { safeLocalPath, str, todayISO } = require('../helpers');
const { notify, adminIds } = require('../services/notify');
const activity = require('../services/activity');
const { validatePassword } = require('../services/password');
const { verifyStudentRegistration, ensureStudentsDatabase } = require('../services/studentVerification');
const studentDirectory = require('../services/studentDirectory');
const { makeOptionValue, getGradeSectionOptions, getGroupedGradeSectionOptions } = require('../services/gradeSections');

const router = express.Router();

function renderRegister(res, errors, values, status = 200) {
  return res.status(status).render('register', {
    title: 'Register',
    errors,
    values,
    gradeSectionOptions: getGradeSectionOptions(),
    groupedGradeSectionOptions: getGroupedGradeSectionOptions(),
  });
}

// Public registration offers only Student and Teacher accounts. Both are
// requesters internally; `accountKind` decides whether Student Directory
// verification is required. A client-sent `role` is never trusted.
const ACCOUNT_TYPE_ROLES = Object.freeze({
  student: 'requester',
  teacher: 'requester',
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOURS = 60 * 60 * 1000;
const REMEMBER_MS = 30 * 24 * HOURS;
const DEFAULT_MS = 8 * HOURS;

const rateBuckets = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  bucket.count += 1;
  if (bucket.count > limit) return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  return { ok: true };
}

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

    // Accounts created with a temporary password must choose a new one first.
    res.redirect(user.mustChangePassword ? '/profile/change-password' : next);
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

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || 'unknown';
  const rl = rateLimit(`login:${String(ip).split(',')[0].trim()}`, 30, 10 * 60 * 1000);
  if (!rl.ok) {
    return renderLogin(res, {
      error: `Too many login attempts. Please wait ${rl.retryAfter} seconds and try again.`,
      email: rawInput,
      remember,
      next,
    }, 429);
  }

  // Search by email, student ID, or username.
  const user = db.all('users').find(
    (u) =>
      u.email.toLowerCase() === lowerInput ||
      (u.username && u.username.toLowerCase() === lowerInput) ||
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

  // Teacher requesters sign in with email/password only. Student accounts
  // must still match an official Student Directory record.
  if (user.role === 'requester' && user.accountKind !== 'teacher') {
    if (!user.studentId) {
      return renderLogin(
        res,
        {
          error: 'Access Denied: You are not a registered member of the institution. No Student ID is associated with this account.',
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
          error: verification.reason || 'Access Denied: You are not a registered member of the institution.',
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

// Public, read-only directory check used by the registration form to retrieve
// grade level and section. It returns only the record matching the submitted
// Student ID + full name; the full directory is never exposed to students.
router.post('/api/student-verify', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || 'unknown';
  const rl = rateLimit(`student-verify:${String(ip).split(',')[0].trim()}`, 20, 10 * 60 * 1000);
  res.set('Cache-Control', 'no-store');
  if (!rl.ok) {
    return res.status(429).json({
      ok: false,
      registered: false,
      message: `Too many verification attempts. Please wait ${rl.retryAfter} seconds.`,
      student: null,
    });
  }
  const b = req.body || {};
  const studentId = str(b.studentId, 50).toUpperCase();
  const name = str(b.fullName || b.name, 120);
  const verification = verifyStudentRegistration(studentId, name);

  const toPublic = (student) =>
    student
      ? {
          studentId: student.studentId,
          fullName: student.fullName || student.name || '',
          gradeLevel: student.gradeLevel || '',
          section: student.section || '',
          schoolYear: student.schoolYear || '',
          status: studentDirectory.statusOf(student),
        }
      : null;

  if (!verification.allowed) {
    return res.status(200).json({
      ok: false,
      registered: false,
      message: verification.reason || 'Student record verification failed.',
      student: toPublic(verification.student),
    });
  }

  if (studentDirectory.isStudentIdRegistered(studentId)) {
    return res.status(200).json({
      ok: false,
      registered: true,
      message: 'This Student ID is already associated with an account. Please log in instead.',
      student: toPublic(verification.student),
    });
  }

  return res.status(200).json({
    ok: true,
    registered: false,
    message: 'Student record verified.',
    student: toPublic(verification.student),
  });
});

// ---------- Register (public signup: Student or Teacher only) ----------
router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  return renderRegister(res, [], { accountType: 'student', role: 'requester' });
});

router.post('/register', (req, res) => {
  ensureStudentsDatabase();
  const b = req.body || {};

  // The account-type selector is the only trusted source of the role.
  // Admin and Technician are intentionally absent, so they cannot be
  // self-registered. Any client-sent `role` is ignored.
  const accountType = str(b.accountType, 20).trim().toLowerCase();
  const roleForAccountType = Object.prototype.hasOwnProperty.call(ACCOUNT_TYPE_ROLES, accountType)
    ? ACCOUNT_TYPE_ROLES[accountType]
    : null;
  const requestedRole = roleForAccountType || 'requester';
  const isStudent = accountType === 'student';
  const isTeacher = accountType === 'teacher';
  const errors = [];
  if (!roleForAccountType) {
    errors.push('Select a valid account type (Student or Teacher).');
  }

  const studentId = isStudent ? studentDirectory.normalizeStudentId(b.studentId) : null;
  const enteredName = str(b.fullName || b.name, 120);

  const values = {
    accountType: roleForAccountType ? accountType : 'student',
    role: requestedRole,
    accountKind: isTeacher ? 'teacher' : 'student',
    studentId,
    fullName: enteredName,
    name: enteredName,
    email: str(b.email, 200).toLowerCase(),
  };

  const password = String(b.password || '');
  let verifiedStudent = null;

  // Student accounts are created only from a verified directory record. The
  // browser never supplies grade level, section, status or identity values that
  // the server trusts. The optional confirmation dropdown is ignored here.
  if (isStudent) {
    const verification = verifyStudentRegistration(studentId, enteredName);
    if (!verification.allowed) {
      errors.push(verification.reason || 'Unable to verify this Student Directory record.');
    } else {
      verifiedStudent = verification.student;
      // These values are for redisplay only. The server uses the verified
      // directory record directly when the account is created below.
      values.fullName = verifiedStudent.fullName || verifiedStudent.name || enteredName;
      values.gradeLevel = verifiedStudent.gradeLevel || '';
      values.section = verifiedStudent.section || '';
      values.gradeSection = makeOptionValue(values.gradeLevel, values.section);
      values.department = `${values.gradeLevel} – ${values.section}`;
    }

    if (studentId && studentDirectory.isStudentIdRegistered(studentId)) {
      errors.push('This Student ID is already associated with an account. Please log in instead.');
    }
    if (verifiedStudent) {
      const linkedId = db.all('users').find(
        (u) => Number(u.directoryRecordId) === Number(verifiedStudent.id)
      );
      if (linkedId) {
        errors.push('This Student ID is already associated with an account. Please log in instead.');
      }
    }
  } else if (isTeacher) {
    // Optional department/subject helps identify the teacher but is never
    // used for permissions. Teachers are requesters, not staff accounts.
    values.department = str(b.department, 150) || 'Faculty';
    values.name = str(b.name, 120);
  }

  if (!values.name) errors.push('Full name is required.');
  if (!EMAIL_RE.test(values.email)) {
    errors.push('Please enter a valid email address.');
  } else if (db.all('users').some((u) => String(u.email || '').toLowerCase() === values.email)) {
    errors.push('That email address is already registered. Try logging in instead.');
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
    return renderRegister(res, errors, values, hasAccessDenied ? 403 : 400);
  }

  // Student and Teacher are both ready-to-use requester accounts.
  const roleLabel = isTeacher ? 'Teacher' : 'Student';
  // `gradeSection`, `fullName` and `accountType` are form/render helpers. Only
  // the discrete, directory-derived fields below are persisted.
  const {
    gradeSection: _gradeSectionValue,
    fullName: _fullNameValue,
    accountType: _accountTypeValue,
    ...userValues
  } = values;
  const displayName = isStudent && verifiedStudent
    ? (verifiedStudent.fullName || verifiedStudent.name)
    : values.name;

  const user = db.insert('users', {
    ...userValues,
    name: displayName,
    studentId: isStudent && verifiedStudent ? verifiedStudent.studentId : null,
    directoryRecordId: isStudent && verifiedStudent ? verifiedStudent.id : null,
    gradeLevel: isStudent && verifiedStudent ? verifiedStudent.gradeLevel : null,
    section: isStudent && verifiedStudent ? verifiedStudent.section : null,
    department: isStudent && verifiedStudent
      ? `${verifiedStudent.gradeLevel} – ${verifiedStudent.section}`
      : values.department,
    phone: '',
    role: requestedRole,
    accountKind: isTeacher ? 'teacher' : 'student',
    passwordHash: bcrypt.hashSync(password, 10),
    active: true,
    approvalStatus: 'approved',
    createdAt: new Date().toISOString(),
    specializations: [],
    availability: null,
  });

  if (isStudent && verifiedStudent) {
    studentDirectory.linkAccount(verifiedStudent.id, user);
  }

  activity.log({
    userId: user.id,
    action: `${roleLabel} account registered`,
    details: isStudent
      ? `${user.name} registered as ${roleLabel} (${user.email}, Student ID: ${user.studentId}) using a verified Student Directory record.`
      : `${user.name} registered as ${roleLabel} (${user.email}). Ready to submit requests.`,
  });

  notify(adminIds(), {
    message: `New ${roleLabel} account registered: ${user.name} (${user.email}). Ready to use.`,
    link: isStudent ? '/students' : '/users',
  });

  // Both public account types are active immediately.
  const mailer = require('../services/mailer');
  mailer.sendAccountApprovedEmail(user).catch((err) => {
    console.error('Failed to send registration email:', err.message);
  });

  renderLogin(res, {
    notice: `Account registered successfully as ${roleLabel}! You can log in now with ${isStudent ? 'your email address or Student ID' : 'your email address'}.`,
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
