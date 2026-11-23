// Admin-managed Student Directory. All records are stored in the shared
// `students` collection in data/db.json and are used directly by registration,
// login, profile and dashboard pages.
const express = require('express');
const C = require('../constants');
const { str } = require('../helpers');
const { requireRole, flash } = require('../auth');
const activity = require('../services/activity');
const studentDirectory = require('../services/studentDirectory');
const gradeSections = require('../services/gradeSections');

const router = express.Router();
router.use(requireRole('admin'));

const BASE = '/students';

function formFromBody(body) {
  const b = body || {};
  return {
    studentId: str(b.studentId, 50).toUpperCase(),
    fullName: str(b.fullName, 120),
    gradeSection: str(b.gradeSection, 200),
    gradeLevel: str(b.gradeLevel, 20),
    section: str(b.section, 50),
    schoolYear: str(b.schoolYear, 20) || studentDirectory.DEFAULT_SCHOOL_YEAR,
    status: studentDirectory.STATUSES.includes(b.status) ? b.status : 'Active',
    lrn: str(b.lrn, 50),
    track: str(b.track, 80),
    email: str(b.email, 200).toLowerCase(),
    address: str(b.address, 250),
  };
}

function valuesForForm(row) {
  if (!row) return { schoolYear: studentDirectory.DEFAULT_SCHOOL_YEAR, status: 'Active' };
  return {
    ...row,
    gradeSection: gradeSections.makeOptionValue(row.gradeLevel, row.section),
  };
}

function renderList(res, f = {}) {
  const filters = {
    q: f.q || '',
    gradeLevel: f.gradeLevel || '',
    section: f.section || '',
    status: f.status || '',
  };
  const students = studentDirectory.list(filters).map((s) => ({
    ...s,
    statusLabel: studentDirectory.statusOf(s),
    account: studentDirectory.accountFor(s),
  }));
  const all = studentDirectory.list();
  const options = studentDirectory.filterOptions();

  return res.render('students/index', {
    title: 'Student Directory',
    students,
    f: filters,
    grades: options.grades,
    sections: options.sections,
    sectionOptions: options.sectionOptions,
    groupedSectionOptions: options.groupedSectionOptions || [],
    counts: {
      total: all.length,
      active: all.filter(studentDirectory.isActive).length,
      inactive: all.filter((s) => !studentDirectory.isActive(s)).length,
      linked: all.filter((s) => !!studentDirectory.accountFor(s)).length,
    },
  });
}

function renderForm(res, values, errors = [], status = 200, editing = null) {
  const sectionOptions = gradeSections.getGradeSectionOptions();
  const groupedSectionOptions = gradeSections.getGroupedGradeSectionOptions();
  return res.status(status).render('students/form', {
    title: editing ? `Edit ${editing.fullName}` : 'Add Student Record',
    values: valuesForForm(values),
    errors,
    editing,
    sectionOptions,
    groupedSectionOptions,
    grades: C.STUDENT_GRADE_LEVELS,
    statuses: studentDirectory.STATUSES,
  });
}

function renderShow(res, student) {
  return res.render('students/show', {
    title: student.fullName,
    student,
    statusLabel: studentDirectory.statusOf(student),
    account: studentDirectory.accountFor(student),
  });
}

router.get('/', (req, res) => {
  renderList(res, {
    q: str(req.query.q, 100),
    gradeLevel: str(req.query.gradeLevel, 20),
    section: str(req.query.section, 50),
    status: studentDirectory.STATUSES.includes(req.query.status) ? req.query.status : '',
  });
});

router.get('/new', (req, res) => {
  renderForm(res, { schoolYear: studentDirectory.DEFAULT_SCHOOL_YEAR, status: 'Active' });
});

router.post('/', (req, res) => {
  const form = formFromBody(req.body);
  const result = studentDirectory.add(form);
  if (!result.ok) return renderForm(res, form, [result.error], 400);

  activity.log({
    userId: req.user.id,
    action: 'Student record added',
    details: `${result.row.studentId} · ${result.row.fullName} · ${result.row.gradeLevel} – ${result.row.section}`,
  });
  flash(req, 'success', `${result.row.fullName} was added to the Student Directory.`);
  res.redirect(BASE);
});

router.get('/:id', (req, res) => {
  const student = studentDirectory.findById(req.params.id);
  if (!student) return res.status(404).render('error', { title: 'Not found', message: 'Student record not found.' });
  renderShow(res, student);
});

router.get('/:id/edit', (req, res) => {
  const student = studentDirectory.findById(req.params.id);
  if (!student) return res.status(404).render('error', { title: 'Not found', message: 'Student record not found.' });
  renderForm(res, student, [], 200, student);
});

router.post('/:id', (req, res) => {
  const existing = studentDirectory.findById(req.params.id);
  if (!existing) return res.status(404).render('error', { title: 'Not found', message: 'Student record not found.' });
  const form = formFromBody(req.body);
  const result = studentDirectory.update(existing.id, form);
  if (!result.ok) return renderForm(res, form, [result.error], 400, existing);

  activity.log({
    userId: req.user.id,
    action: 'Student record updated',
    details: `${result.row.studentId} · ${result.row.fullName} · ${result.row.gradeLevel} – ${result.row.section}`,
  });
  flash(req, 'success', `${result.row.fullName}'s directory record was updated. Linked account information was synchronized.`);
  res.redirect(`${BASE}/${result.row.id}`);
});

router.post('/:id/toggle', (req, res) => {
  const student = studentDirectory.findById(req.params.id);
  if (!student) return res.status(404).render('error', { title: 'Not found', message: 'Student record not found.' });
  const activate = !studentDirectory.isActive(student);
  const result = studentDirectory.setActive(student.id, activate);
  if (!result.ok) {
    flash(req, 'error', result.error);
    return res.redirect(BASE);
  }

  activity.log({
    userId: req.user.id,
    action: activate ? 'Student record activated' : 'Student record deactivated',
    details: `${result.row.studentId} · ${result.row.fullName}`,
  });
  flash(
    req,
    'success',
    `${result.row.fullName} is now ${activate ? 'active and eligible for registration and login' : 'inactive and blocked from registration and login'}.`
  );
  res.redirect(BASE);
});

module.exports = router;
