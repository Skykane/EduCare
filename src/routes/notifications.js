// Feature 13: Notifications.
const express = require('express');
const db = require('../db');
const { safeLocalPath } = require('../helpers');

const router = express.Router();

router.get('/', (req, res) => {
  const show = req.query.show === 'unread' ? 'unread' : 'all';
  const list = db
    .where('notifications', (n) => n.userId === req.user.id && (show === 'all' || !n.read))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .slice(0, 200);
  res.render('notifications', { title: 'Notifications', list, show });
});

router.post('/read-all', (req, res) => {
  for (const n of db.where('notifications', (n) => n.userId === req.user.id && !n.read)) {
    n.read = true;
  }
  db.save();
  res.redirect('/notifications');
});

// Mark as read, then go to the linked page.
router.post('/:id/open', (req, res) => {
  const n = db.find('notifications', req.params.id);
  if (!n || n.userId !== req.user.id) return res.redirect('/notifications');
  if (!n.read) db.update('notifications', n.id, { read: true });
  res.redirect(safeLocalPath(n.link, '/notifications'));
});

module.exports = router;
