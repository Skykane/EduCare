// Outgoing Email History module
const express = require('express');
const db = require('../db');
const { requireRole, flash } = require('../auth');
const { str } = require('../helpers');

const router = express.Router();

// Only administrators can view outgoing email history
router.use(requireRole('admin'));

router.get('/', (req, res) => {
  const q = str(req.query.q, 100).toLowerCase();
  const status = str(req.query.status, 20).toLowerCase();
  const allLogs = (db.all('outgoingEmails') || []).slice().reverse();

  const outgoingEmails = allLogs.filter((m) => {
    if (status && (m.status || '').toLowerCase() !== status) return false;
    if (q && ![m.to, m.subject, m.from].some((v) => (v || '').toLowerCase().includes(q))) return false;
    return true;
  });

  res.render('email-history', {
    title: 'Outgoing Email History',
    outgoingEmails,
    totalCount: allLogs.length,
    f: { q, status },
  });
});

router.post('/clear', (req, res) => {
  const emails = db.all('outgoingEmails');
  emails.length = 0;
  db.save();
  flash(req, 'success', 'Outgoing email history has been cleared.');
  res.redirect('/email-history');
});

module.exports = router;
