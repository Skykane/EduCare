const express = require('express');
const { requireRole, flash } = require('../auth');
const { str } = require('../helpers');
const db = require('../db');
const {
  getEmailSettings,
  saveEmailSettings,
  verifyConnection,
  sendTestEmail,
} = require('../services/mailer');

const router = express.Router();

// Only administrators can manage email settings
router.use(requireRole('admin'));

router.get('/', async (req, res) => {
  const settings = getEmailSettings();

  res.render('settings/email', {
    title: 'Email Notifications',
    settings,
  });
});

router.post('/', (req, res) => {
  const b = req.body || {};
  const current = getEmailSettings();

  const cleanPass = String(b.pass !== undefined ? b.pass : '').trim().replace(/\s+/g, '');
  const passToSave = cleanPass !== '' ? cleanPass : current.pass;

  const updated = {
    enabled: b.enabled === '1' || b.enabled === 'on',
    provider: str(b.provider, 30) || 'gmail',
    host: str(b.host, 120) || 'smtp.gmail.com',
    port: parseInt(b.port, 10) || 465,
    secure: b.secure === '1' || b.secure === 'on',
    user: str(b.user, 200).trim(),
    pass: passToSave,
    fromName: str(b.fromName, 120) || 'EduCare - St. Anthony CST',
    fromEmail: str(b.fromEmail || b.user, 200).trim(),
    adminEmail: str(b.adminEmail, 200).trim() || 'admin@educare.local',
    notifyOnRegistration: b.notifyOnRegistration === '1' || b.notifyOnRegistration === 'on',
    notifyOnApproval: b.notifyOnApproval === '1' || b.notifyOnApproval === 'on',
    notifyOnRequests: b.notifyOnRequests === '1' || b.notifyOnRequests === 'on',
    notifyOnLogin: b.notifyOnLogin === '1' || b.notifyOnLogin === 'on',
  };

  saveEmailSettings(updated);
  flash(req, 'success', 'Email notification settings have been saved successfully.');
  res.redirect('/settings/email');
});

router.post('/test', async (req, res) => {
  const b = req.body || {};
  const targetEmail = str(b.targetEmail, 200).trim() || req.user.email;

  if (!targetEmail || !targetEmail.includes('@')) {
    flash(req, 'error', 'Please provide a valid recipient email address for testing.');
    return res.redirect('/settings/email');
  }

  try {
    const result = await sendTestEmail(targetEmail);
    if (result.ok) {
      if (result.status === 'delivered') {
        flash(req, 'success', `✓ Test email was successfully sent to ${targetEmail}! Check your inbox or spam folder.`);
      } else {
        flash(req, 'warning', `Email generated and logged in Outgoing Emails (${result.status}). Configure your Gmail/SMTP email and App Password to deliver live to inboxes.`);
      }
    } else {
      flash(req, 'error', `Failed to send email: ${result.error || result.message}`);
    }
  } catch (err) {
    flash(req, 'error', `Test email error: ${err.message}`);
  }

  res.redirect('/settings/email');
});

router.get('/logs', (req, res) => {
  const idx = req.originalUrl.indexOf('?');
  const query = idx !== -1 ? req.originalUrl.slice(idx) : '';
  res.redirect('/email-history' + query);
});

router.post('/clear-logs', (req, res) => {
  const emails = db.all('outgoingEmails');
  emails.length = 0;
  db.save();
  flash(req, 'success', 'Outgoing email history has been cleared.');
  res.redirect('/email-history');
});

module.exports = router;
