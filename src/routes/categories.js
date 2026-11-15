// Feature 2: Equipment Category and Status Management.
const express = require('express');
const db = require('../db');
const C = require('../constants');
const { requireRole, flash } = require('../auth');
const { str } = require('../helpers');
const activity = require('../services/activity');

const router = express.Router();
router.use(requireRole('admin'));

function statusCounts(list) {
  const counts = {};
  for (const s of C.EQUIPMENT_STATUSES) counts[s] = list.filter((e) => e.status === s).length;
  return counts;
}

router.get('/', (req, res) => {
  const equipment = db.all('equipment');
  const categories = db
    .all('categories')
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => {
      const items = equipment.filter((e) => e.categoryId === c.id);
      return { ...c, total: items.length, counts: statusCounts(items) };
    });
  const locations = [...new Set(equipment.map((e) => e.location).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((loc) => {
      const items = equipment.filter((e) => e.location === loc);
      return { name: loc, total: items.length, counts: statusCounts(items) };
    });
  res.render('categories', {
    title: 'Categories & Locations',
    categories,
    locations,
    totals: statusCounts(equipment),
    total: equipment.length,
    editId: Number(req.query.edit) || null,
  });
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
