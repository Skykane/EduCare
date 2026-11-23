// Administrator-managed Grade & Section options used by student registration.
const express = require('express');
const C = require('../constants');
const { str } = require('../helpers');
const { requireRole, flash } = require('../auth');
const gradeSections = require('../services/gradeSections');

const router = express.Router();
router.use(requireRole('admin'));

const BASE = '/settings/grade-sections';

function formFromBody(body) {
  const b = body || {};
  return {
    gradeLevel: str(b.gradeLevel, 20),
    section: str(b.section, 80),
  };
}

// Keep entered values when a validation error sends the admin back to the form.
function rememberForm(req, form, editId) {
  req.session.gradeSectionForm = form;
  req.session.gradeSectionEditId = editId || null;
}

function takeForm(req) {
  const form = req.session.gradeSectionForm || null;
  const editId = req.session.gradeSectionEditId || null;
  delete req.session.gradeSectionForm;
  delete req.session.gradeSectionEditId;
  return { form, editId };
}

function renderPage(res, { editing = null, form = null } = {}) {
  const grouped = gradeSections.getGradeSections();
  const rows = [];
  for (const grade of C.STUDENT_GRADE_LEVELS) {
    for (const row of grouped[grade]) rows.push(row);
  }
  return res.render('settings/grade-sections', {
    title: 'Grade & Section Management',
    grades: C.STUDENT_GRADE_LEVELS,
    sections: grouped,
    rows,
    isActive: gradeSections.isActive,
    editing,
    form: form || (editing
      ? { gradeLevel: editing.gradeLevel, section: editing.section }
      : { gradeLevel: '', section: '' }),
  });
}

router.get('/', (req, res) => {
  const saved = takeForm(req);
  const requestedId = saved.editId || req.query.edit;
  const editing = requestedId ? gradeSections.findSection(requestedId) : null;
  renderPage(res, {
    editing,
    form: saved.form || null,
  });
});

router.post('/add', (req, res) => {
  const form = formFromBody(req.body);
  const result = gradeSections.addSection(form.gradeLevel, form.section);
  if (!result.ok) {
    rememberForm(req, form, null);
    flash(req, 'error', result.error);
    return res.redirect(BASE);
  }
  flash(req, 'success', `Added ${result.row.gradeLevel} – ${result.row.section}. Student registration now offers this option.`);
  res.redirect(BASE);
});

router.post('/:id/edit', (req, res) => {
  const id = req.params.id;
  const form = formFromBody(req.body);
  const result = gradeSections.updateSection(id, form.gradeLevel, form.section);
  if (!result.ok) {
    rememberForm(req, form, id);
    flash(req, 'error', result.error);
    return res.redirect(BASE);
  }
  flash(req, 'success', `Updated ${result.row.gradeLevel} – ${result.row.section}.`);
  res.redirect(BASE);
});

router.post('/:id/toggle', (req, res) => {
  const row = gradeSections.findSection(req.params.id);
  if (!row) {
    flash(req, 'error', 'That section no longer exists.');
    return res.redirect(BASE);
  }
  const activate = !gradeSections.isActive(row);
  const result = gradeSections.setSectionActive(row.id, activate);
  if (!result.ok) {
    flash(req, 'error', result.error);
    return res.redirect(BASE);
  }
  flash(
    req,
    'success',
    `${result.row.gradeLevel} – ${result.row.section} is now ${activate ? 'active and available for registration' : 'inactive and hidden from registration'}.`
  );
  res.redirect(BASE);
});

module.exports = router;
