// Feature 2: Equipment Category and Status Management.
const express = require('express');
const db = require('../db');
const C = require('../constants');
const { requireRole, flash } = require('../auth');
const { str } = require('../helpers');
const activity = require('../services/activity');

const router = express.Router();
router.use(requireRole('admin'));

// Older sample data carries the same generated line on every seeded category.
// Treat it as "no description" for display/editing without changing the saved
// record until an administrator deliberately saves a different value.
const DEMO_CATEGORY_DESCRIPTION = /^SAMPLE\/DEMO category created for the sample inventory\.$/i;
function displayDescription(value) {
  const description = String(value || '').trim();
  return DEMO_CATEGORY_DESCRIPTION.test(description) ? '' : description;
}

function statusCounts(list) {
  const counts = {};
  for (const s of C.EQUIPMENT_STATUSES) counts[s] = list.filter((e) => e.status === s).length;
  return counts;
}

function renderList(req, res) {
  const equipment = db.all('equipment');
  const categories = db
    .all('categories')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => {
      const items = equipment.filter((e) => e.categoryId === c.id);
      return {
        ...c,
        description: displayDescription(c.description),
        total: items.length,
        counts: statusCounts(items),
      };
    });
  const locations = [...new Set(equipment.map((e) => e.location).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((loc) => {
      const items = equipment.filter((e) => e.location === loc);
      return { name: loc, total: items.length, counts: statusCounts(items) };
    });

  res.render('categories', {
    title: 'Equipment Categories',
    pageClass: 'categories-page equipment-management-page',
    categories,
    locations,
    totals: statusCounts(equipment),
    total: equipment.length,
    editId: Number(req.query.edit) || null,
  });
}

router.get('/', (req, res) => {
  renderList(req, res);
});

function nameTaken(name, id = null) {
  return db.all('categories').some((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== id);
}

router.post('/', (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 100);
  const description = str(b.description, 300);
  if (!name) flash(req, 'error', 'Category name is required.');
  else if (nameTaken(name)) flash(req, 'error', `Category "${name}" already exists.`);
  else {
    db.insert('categories', { name, description });
    activity.log({ userId: req.user.id, action: 'Category added', details: name });
    flash(req, 'success', `Category "${name}" added.`);
  }
  res.redirect('/categories');
});

// JSON endpoint used by inline "Add category" controls so a newly created
// category can be added to an open dropdown without reloading the page.
router.post('/api', (req, res) => {
  const name = str((req.body || {}).name, 100);
  if (!name) return res.status(400).json({ ok: false, error: 'Category name is required.' });
  if (nameTaken(name)) return res.status(409).json({ ok: false, error: `Category "${name}" already exists.` });
  const category = db.insert('categories', { name, description: '' });
  activity.log({ userId: req.user.id, action: 'Category added', details: name });
  return res.status(201).json({ ok: true, category: { id: category.id, name: category.name } });
});

router.post('/:id', (req, res) => {
  const c = db.find('categories', req.params.id);
  if (!c) return res.status(404).render('error', { title: 'Not found', message: 'Category not found.' });
  const b = req.body || {};
  const name = str(b.name, 100);
  if (!name) flash(req, 'error', 'Category name is required.');
  else if (nameTaken(name, c.id)) flash(req, 'error', `Category "${name}" already exists.`);
  else {
    db.update('categories', c.id, { name, description: str(b.description, 300) });
    flash(req, 'success', 'Category updated.');
  }
  res.redirect('/categories');
});

router.post('/:id/delete', (req, res) => {
  const c = db.find('categories', req.params.id);
  if (!c) return res.status(404).render('error', { title: 'Not found', message: 'Category not found.' });
  const used = db.where('equipment', (e) => e.categoryId === c.id).length;
  if (used) {
    flash(req, 'error', `"${c.name}" is used by ${used} equipment item(s). Move them to another category first.`);
    return res.redirect('/categories');
  }
  db.remove('categories', c.id);
  // Remove it from technician specializations too.
  for (const u of db.where('users', (u) => (u.specializations || []).includes(c.id))) {
    db.update('users', u.id, { specializations: u.specializations.filter((id) => id !== c.id) });
  }
  activity.log({ userId: req.user.id, action: 'Category deleted', details: c.name });
  flash(req, 'success', `Category "${c.name}" deleted.`);
  res.redirect('/categories');
});

module.exports = router;
