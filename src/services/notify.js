// Feature 13: Notifications and Reminders with real email forwarding
const db = require('../db');
const C = require('../constants');

let mailer = null;
function getMailer() {
  if (!mailer) {
    try {
      mailer = require('./mailer');
    } catch (e) {
      /* ignore */
    }
  }
  return mailer;
}

function adminIds() {
  return db.where('users', (u) => u.role === 'admin' && u.active).map((u) => u.id);
}

// Canonical status wording for notifications. Legacy labels are never shown.
function statusLabel(status, request = null) {
  const value = C.normalizeStatus(status, request);
  return value === undefined || value === null || value === '' ? 'Status updated' : String(value);
}

function statusChangeMessage(code, from, to, actorName, request = null) {
  const label = code ? `${code} ` : '';
  const actor = actorName ? ` (by ${actorName})` : '';
  const fromLabel = from === undefined || from === null || from === ''
    ? ''
    : `${statusLabel(from, request)} → `;
  return `${label}status changed: ${fromLabel}${statusLabel(to, request)}${actor}.`;
}

// Notification messages include user-entered text (titles, reasons, remarks).
// Escape it before embedding in HTML email bodies.
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

/**
 * Send one notification to each user in `userIds`.
 * Also sends an email notification to user's registered email address.
 * `dedupeKey` stops the same automatic reminder from being sent twice to the same user.
 * `exceptUserId` skips the person who caused the event.
 */
function notify(userIds, { message, link = null, type = 'info', dedupeKey = null, exceptUserId = null }) {
  const ids = [...new Set(userIds.filter(Boolean).map(Number))].filter((id) => id !== exceptUserId);
  let sent = 0;
  for (const userId of ids) {
    if (dedupeKey && db.where('notifications', (n) => n.userId === userId && n.dedupeKey === dedupeKey).length) continue;
    db.insert('notifications', { userId, message, link, type, dedupeKey, read: false });
    sent++;

    // Forward notification to user's real email address
    const m = getMailer();
    if (m) {
      const recipient = db.find('users', userId);
      if (recipient && recipient.email && recipient.email.includes('@')) {
        const fullLink = link ? (link.startsWith('http') ? link : `http://localhost:3000${link}`) : null;
        const html = m.renderHtmlEmail({
          title: 'EduCare Notification',
          headline: 'New Notification',
          recipientName: recipient.name,
          badge: { text: type ? type.toUpperCase() : 'INFO', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' },
          bodyHtml: `<p style="font-size:15px;color:#1e293b;">${escapeHtml(message)}</p>`,
          actionUrl: fullLink,
          actionText: 'View in EduCare',
        });
        m.sendMail({
          to: recipient.email,
          subject: `[EduCare Notification] ${message.length > 50 ? message.substring(0, 47) + '...' : message}`,
          html,
          text: `Hello ${recipient.name},\n\n${message}\n\n${fullLink ? 'View details: ' + fullLink : ''}`,
          metadata: { userId, type, dedupeKey },
        }).catch((err) => console.error('Error forwarding notification email:', err.message));
      }
    }
  }
  return sent;
}

function unreadCount(userId) {
  return db.where('notifications', (n) => n.userId === userId && !n.read).length;
}

module.exports = { notify, adminIds, unreadCount, statusLabel, statusChangeMessage };
