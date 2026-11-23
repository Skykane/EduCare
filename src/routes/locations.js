// Equipment Locations Management & Room Health Overview
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
  for (const s of C.EQUIPMENT_STATUSES) {
    counts[s] = list.filter((e) => e.status === s).length;
  }
  return counts;
}

// GET /locations - List all campus locations with equipment counts & health
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim().toLowerCase();
  const allEquipment = db.all('equipment');

  const rawLocationNames = [...new Set([
    ...C.CAMPUS_LOCATIONS,
    ...allEquipment.map((e) => e.location).filter(Boolean)
  ])].sort((a, b) => a.localeCompare(b));

  let locations = rawLocationNames.map((loc) => {
    const items = allEquipment.filter((e) => e.location === loc);
    const counts = statusCounts(items);
    const operationalCount = counts['Operational'] || 0;
    const attentionCount = (counts['Needs Repair'] || 0) + (counts['Under Maintenance'] || 0);
    const opPercent = items.length > 0 ? Math.round((operationalCount / items.length) * 100) : 0;

    return {
      name: loc,
      total: items.length,
      counts,
      operationalCount,
      attentionCount,
      opPercent,
    };
  });

  if (q) {
    locations = locations.filter((l) => l.name.toLowerCase().includes(q));
  }

  const totals = statusCounts(allEquipment);
  const totalEquipment = allEquipment.length;
  const totalLocationsCount = rawLocationNames.length;
  const totalAttention = (totals['Needs Repair'] || 0) + (totals['Under Maintenance'] || 0);

  res.render('locations', {
    title: 'Campus Locations & Rooms',
    pageClass: 'equipment-management-page locations-page',
    locations,
    rawLocationNames,
    totalLocationsCount,
    totalEquipment,
    totals,
    totalAttention,
    q: req.query.q || '',
    campusRooms: C.CAMPUS_ROOMS,
  });
});

// POST /locations/rename - Batch rename a campus location across all equipment
router.post('/rename', (req, res) => {
  const oldName = str(req.body.oldName, 150);
  const newName = str(req.body.newName, 150);

  if (!oldName || !newName) {
    flash(req, 'error', 'Both current and new location names are required.');
    return res.redirect('/locations');
  }

  if (oldName.toLowerCase() === newName.toLowerCase()) {
    flash(req, 'error', 'The new location name must be different from the current name.');
    return res.redirect('/locations');
  }

  if (!(C.CAMPUS_LOCATIONS || []).includes(newName)) {
    flash(req, 'error', 'Please choose an approved campus location.');
    return res.redirect('/locations');
  }

  const matches = db.where('equipment', (e) => (e.location || '').toLowerCase() === oldName.toLowerCase());
  if (!matches.length) {
    flash(req, 'error', `No equipment found in location "${oldName}".`);
    return res.redirect('/locations');
  }

  let updatedCount = 0;
  for (const item of matches) {
    db.update('equipment', item.id, { location: newName });
    updatedCount++;
  }

  activity.log({
    userId: req.user.id,
    action: 'Location renamed',
    details: `"${oldName}" renamed to "${newName}" (${updatedCount} assets updated)`,
  });

  flash(req, 'success', `Successfully renamed "${oldName}" to "${newName}" across ${updatedCount} equipment item(s).`);
  res.redirect('/locations');
});

module.exports = router;
