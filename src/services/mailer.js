// Feature: Real Email Notification System via Nodemailer
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('../db');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'email-settings.json');

// Escape values that originate from user input before placing them in HTML emails.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

function roleLabelFor(user) {
  if (user.accountKind === 'teacher') return 'Teacher';
  if (user.role === 'admin') return 'Administrator';
  if (user.role === 'technician') return 'Technician';
  return 'Student';
}

const DEFAULT_SETTINGS = {
  enabled: true,
  provider: 'gmail', // 'gmail' | 'outlook' | 'custom' | 'test'
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  fromName: 'EduCare',
  fromEmail: process.env.SMTP_FROM || 'no-reply@educare.local',
  adminEmail: 'admin@educare.local',
  notifyOnRegistration: true,
  notifyOnApproval: true,
  notifyOnRequests: true,
  notifyOnLogin: true,
};

function getEmailSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (err) {
    console.error('Error reading email settings:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveEmailSettings(newSettings) {
  const current = getEmailSettings();
  const merged = { ...current, ...newSettings };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function createTransporter(settings) {
  const s = settings || getEmailSettings();
  const cleanPass = (s.pass || '').trim().replace(/\s+/g, '');
  const cleanUser = (s.user || '').trim();

  if (!cleanUser || !cleanPass) {
    return null; // No SMTP credentials configured yet
  }

  if (s.provider === 'gmail') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: cleanUser,
        pass: cleanPass,
      },
    });
  }

  if (s.provider === 'outlook') {
    return nodemailer.createTransport({
      service: 'hotmail',
      auth: {
        user: cleanUser,
        pass: cleanPass,
      },
    });
  }

  // Custom SMTP
  return nodemailer.createTransport({
    host: s.host || 'localhost',
    port: Number(s.port) || 587,
    secure: s.secure || Number(s.port) === 465,
    auth: {
      user: cleanUser,
      pass: cleanPass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
}

/**
 * Verify SMTP connection with current settings
 */
async function verifyConnection() {
  const settings = getEmailSettings();
  const transporter = createTransporter(settings);
  if (!transporter) {
    return {
      success: false,
      message: 'SMTP credentials are incomplete. Please provide both sender email address and App Password.',
    };
  }

  try {
    await transporter.verify();
    return {
      success: true,
      message: `SMTP connection established successfully with ${settings.provider.toUpperCase()} (${settings.user})!`,
    };
  } catch (err) {
    let msg = err.message || 'SMTP Connection failed.';
    if (msg.includes('Invalid login') || msg.includes('BadCredentials') || msg.includes('Username and Password not accepted')) {
      msg = 'Authentication failed. If using Gmail, make sure 2-Step Verification is enabled and use a 16-character App Password (not your normal password).';
    }
    return {
      success: false,
      message: msg,
    };
  }
}

/**
 * Modern, branded HTML template for EduCare emails
 */
function renderHtmlEmail({
  title = 'EduCare Notification',
  preheader = '',
  headline = '',
  recipientName = '',
  badge = null,
  bodyHtml = '',
  actionUrl = null,
  actionText = 'Open in EduCare',
  footerNote = null,
}) {
  const badgeHtml = badge
    ? `<span style="display:inline-block;padding:4px 12px;font-size:12px;font-weight:700;border-radius:999px;background:${badge.bg || '#fef2f2'};color:${badge.color || '#991b1b'};margin-bottom:12px;border:1px solid ${badge.border || '#fecaca'};">${esc(badge.text)}</span>`
    : '';

  const buttonHtml = actionUrl
    ? `
      <div style="margin:28px 0 20px;text-align:center;">
        <a href="${esc(actionUrl)}" style="display:inline-block;padding:12px 28px;background:linear-gradient(180deg,#b3141f 0%,#7d0c17 100%);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;border-radius:10px;box-shadow:0 4px 14px rgba(125,12,23,0.3);">
          ${esc(actionText)} &rarr;
        </a>
      </div>
    `
    : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;line-height:1.6;">
  <div style="display:none;font-size:1px;color:#f4f5f8;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
    ${esc(preheader || headline)}
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f5f8;padding:24px 12px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.06);border:1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background:linear-gradient(135deg,#7d0c17 0%,#991b1b 50%,#5c0612 100%);padding:28px 32px;text-align:left;">
              <div style="font-size:26px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;margin:0;">
                Edu<span style="color:#fecaca;">Care</span>
              </div>
              <div style="font-size:12px;color:#fca5a5;font-weight:500;margin-top:2px;">
                School Equipment Maintenance and Repair Management System
              </div>
            </td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td style="padding:32px;">
              ${badgeHtml}
              ${headline ? `<h1 style="margin:0 0 16px;font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-0.3px;">${esc(headline)}</h1>` : ''}
              ${recipientName ? `<p style="margin:0 0 14px;font-size:15px;color:#334155;">Hello <strong>${esc(recipientName)}</strong>,</p>` : ''}
              
              <div style="font-size:14.5px;color:#334155;line-height:1.65;">
                ${bodyHtml}
              </div>

              ${buttonHtml}

              ${footerNote ? `<div style="margin-top:20px;padding:12px 16px;background-color:#f8fafc;border-left:4px solid #cbd5e1;border-radius:6px;font-size:13px;color:#64748b;">${esc(footerNote)}</div>` : ''}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;padding:20px 32px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8;">
              <p style="margin:0 0 6px;">
                <strong>EDUCARE System</strong> &bull; School Equipment Maintenance & Repair Management
              </p>
              <p style="margin:0;">
                This is an automated notification sent to your registered email. Please do not reply directly to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Core sendMail function
 * Automatically handles live delivery when SMTP is configured,
 * or logs and records simulated emails when SMTP is not yet set.
 */
async function sendMail({ to, subject, html, text, actionUrl = null, actionText = null, metadata = {} }) {
  const settings = getEmailSettings();
  if (!settings.enabled) {
    console.log(`[EMAIL DISABLED] Skipped email to ${to}: ${subject}`);
    return { ok: false, status: 'disabled', message: 'Email notifications are disabled in settings.' };
  }

  const fromAddress = settings.fromEmail
    ? `"${settings.fromName}" <${settings.fromEmail}>`
    : `"${settings.fromName}" <${settings.user || 'no-reply@educare.local'}>`;

  const logRecord = {
    to: Array.isArray(to) ? to.join(', ') : to,
    from: fromAddress,
    subject,
    text: text || '',
    html: html || '',
    actionUrl,
    metadata,
    status: 'pending',
    error: null,
    messageId: null,
    provider: settings.provider,
  };

  const transporter = createTransporter(settings);

  // If live credentials are available, send through nodemailer
  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        text,
        html,
      });

      console.log(`[EMAIL DELIVERED] To: ${to} | Subject: "${subject}" | MsgId: ${info.messageId}`);
      logRecord.status = 'delivered';
      logRecord.messageId = info.messageId;

      try {
        db.insert('outgoingEmails', logRecord);
      } catch (e) {
        /* ignore db log errors */
      }

      return { ok: true, status: 'delivered', messageId: info.messageId };
    } catch (err) {
      console.error(`[EMAIL ERROR] Failed to send to ${to}:`, err.message);
      logRecord.status = 'failed';
      logRecord.error = err.message;

      try {
        db.insert('outgoingEmails', logRecord);
      } catch (e) {
        /* ignore db log errors */
      }

      return { ok: false, status: 'failed', error: err.message };
    }
  }

  // Fallback: SMTP credentials not yet provided
  // Log clearly to console and store in database so it can be viewed in the UI!
  console.log(`\n======================================================`);
  console.log(`[EMAIL NOTIFICATION (Simulated - Add SMTP in /settings/email to send live)]`);
  console.log(`To:      ${to}`);
  console.log(`From:    ${fromAddress}`);
  console.log(`Subject: ${subject}`);
  console.log(`Date:    ${new Date().toLocaleString()}`);
  console.log(`======================================================\n`);

  logRecord.status = 'simulated';
  logRecord.error = 'No SMTP credentials configured. Stored in outbox log.';

  try {
    db.insert('outgoingEmails', logRecord);
  } catch (e) {
    /* ignore db log errors */
  }

  return {
    ok: true,
    status: 'simulated',
    message: 'Email generated and saved in Outgoing Emails. Configure SMTP to deliver to actual inboxes.',
  };
}

// -------------------------------------------------------------
// Transactional Email Dispatchers
// -------------------------------------------------------------

/**
 * 1. Registration Received (Pending Administrator Approval)
 */
async function sendRegistrationPendingEmail(user) {
  const settings = getEmailSettings();
  if (!settings.notifyOnRegistration || !user.email) return;

  const roleLabel = roleLabelFor(user);
  const subject = `[EduCare] Registration Received - Pending Approval (${user.name})`;

  const bodyHtml = `
    <p>Thank you for creating an account on <strong>EduCare: School Equipment Maintenance and Repair Management System</strong>.</p>
    
    <div style="background-color:#f1f5f9;border-radius:10px;padding:16px 20px;margin:18px 0;">
      <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;">Registration Summary</h3>
      <table width="100%" style="font-size:13.5px;color:#334155;border-collapse:collapse;">
        <tr><td style="padding:4px 0;width:140px;color:#64748b;">Full Name:</td><td><strong>${esc(user.name)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Requested Role:</td><td><strong>${esc(roleLabel)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Email Address:</td><td>${esc(user.email)}</td></tr>
        ${user.studentId ? `<tr><td style="padding:4px 0;color:#64748b;">Official Student ID:</td><td><strong style="color:#b3141f;">${esc(user.studentId)}</strong></td></tr>` : ''}
        ${user.department ? `<tr><td style="padding:4px 0;color:#64748b;">Department / Grade:</td><td>${esc(user.department)}</td></tr>` : ''}
        <tr><td style="padding:4px 0;color:#64748b;">Status:</td><td><span style="color:#d97706;font-weight:700;">⏳ Awaiting Administrator Review</span></td></tr>
      </table>
    </div>

    <p>To keep the school system secure, every new account must be verified and approved by the school administrator before access is enabled.</p>
    <p>You will receive another email confirmation as soon as your account is approved and ready for login.</p>
  `;

  const html = renderHtmlEmail({
    title: 'Registration Received - EduCare',
    preheader: 'Your registration was received and is pending administrator review.',
    headline: 'Your Registration Has Been Received!',
    recipientName: user.name,
    badge: { text: '⏳ Pending Approval', bg: '#fef3c7', color: '#b45309', border: '#fde68a' },
    bodyHtml,
    actionUrl: 'http://localhost:3000/login',
    actionText: 'View Login Page',
    footerNote: 'Need immediate access? Contact your institution\'s administration office.',
  });

  return sendMail({
    to: user.email,
    subject,
    html,
    text: `Hello ${user.name},\n\nYour registration for EduCare as ${roleLabel} has been received and is pending administrator approval.\n\nWe will notify you once your account is active.`,
    metadata: { userId: user.id, event: 'register_pending' },
  });
}

/**
 * 2. Account Approved & Activated
 */
async function sendAccountApprovedEmail(user) {
  const settings = getEmailSettings();
  if (!settings.notifyOnApproval || !user.email) return;

  const roleLabel = roleLabelFor(user);
  const subject = `🎉 [EduCare] Your Account Has Been Approved!`;

  const bodyHtml = `
    <p>Great news! Your account on the <strong>EduCare System</strong> has been officially verified and approved by the administrator.</p>
    
    <div style="background-color:#ecfdf5;border-radius:10px;padding:16px 20px;margin:18px 0;border:1px solid #a7f3d0;">
      <h3 style="margin:0 0 10px;font-size:14px;color:#065f46;text-transform:uppercase;letter-spacing:0.5px;">Account Status: Active</h3>
      <table width="100%" style="font-size:13.5px;color:#065f46;border-collapse:collapse;">
        <tr><td style="padding:4px 0;width:140px;color:#047857;">Account Name:</td><td><strong>${esc(user.name)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#047857;">Active Role:</td><td><strong>${esc(roleLabel)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#047857;">Login Email / ID:</td><td>${esc(user.email)}</td></tr>
        ${user.studentId ? `<tr><td style="padding:4px 0;color:#047857;">Student ID:</td><td><strong>${esc(user.studentId)}</strong></td></tr>` : ''}
      </table>
    </div>

    <p>You can now log in using your registered email and the password you created during sign up.</p>
  `;

  const html = renderHtmlEmail({
    title: 'Account Approved - EduCare',
    preheader: 'Your EduCare account has been approved and is ready to use.',
    headline: 'Welcome to EduCare! Your Account is Ready',
    recipientName: user.name,
    badge: { text: '✓ Approved & Active', bg: '#dcfce7', color: '#15803d', border: '#86efac' },
    bodyHtml,
    actionUrl: 'http://localhost:3000/login',
    actionText: 'Log In to EduCare Now',
    footerNote: 'Keep your login credentials secure. Never share your password with anyone.',
  });

  return sendMail({
    to: user.email,
    subject,
    html,
    text: `Hello ${user.name},\n\nYour EduCare account (${roleLabel}) has been approved by the administrator! You can now log in at http://localhost:3000/login`,
    metadata: { userId: user.id, event: 'account_approved' },
  });
}

/**
 * 3. Account Rejected
 */
async function sendAccountRejectedEmail(user, reason = '') {
  if (!user.email) return;

  const subject = `[EduCare] Account Registration Status Update`;
  const bodyHtml = `
    <p>We are writing to inform you that your registration for the <strong>EduCare System</strong> could not be approved at this time.</p>
    ${reason ? `<p><strong>Reason provided:</strong> ${esc(reason)}</p>` : ''}
    <p>If you believe this was in error or you are an officially registered member of the institution, please contact the Administration Office or verify your credentials.</p>
  `;

  const html = renderHtmlEmail({
    title: 'Registration Update - EduCare',
    preheader: 'Update regarding your EduCare account registration.',
    headline: 'Registration Status Update',
    recipientName: user.name,
    badge: { text: '✕ Not Approved', bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
    bodyHtml,
    footerNote: 'Questions? Please reach out to your school administration team.',
  });

  return sendMail({
    to: user.email,
    subject,
    html,
    text: `Hello ${user.name},\n\nYour registration for EduCare was not approved at this time.\n\n${reason ? 'Reason: ' + reason : ''}`,
    metadata: { userId: user.id, event: 'account_rejected' },
  });
}

/**
 * 4. Repair Request Submitted Confirmation
 */
async function sendRequestCreatedEmail(request, requester, equipment) {
  const settings = getEmailSettings();
  if (!settings.notifyOnRequests || !requester || !requester.email) return;

  const fallbackLabel = [request.location, request.categoryName].filter(Boolean).join(' · ') || 'General repair';
  const subject = `[EduCare] Repair Request Received: ${request.code} (${equipment ? equipment.name : fallbackLabel})`;
  const bodyHtml = `
    <p>Your repair request has been submitted and is currently queued for evaluation by our maintenance team.</p>
    
    <div style="background-color:#f8fafc;border-radius:10px;padding:16px 20px;margin:18px 0;border:1px solid #e2e8f0;">
      <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;">Ticket #${esc(request.code)}</h3>
      <table width="100%" style="font-size:13.5px;color:#334155;border-collapse:collapse;">
        <tr><td style="padding:4px 0;width:140px;color:#64748b;">${equipment ? 'Equipment' : 'Location / Category'}:</td><td><strong>${esc(equipment ? equipment.name : fallbackLabel)}</strong> ${equipment ? `(${esc(equipment.code)})` : ''}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Issue Title:</td><td><strong>${esc(request.title)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Status:</td><td><span style="color:#d97706;font-weight:700;">${esc(request.status || 'Pending')}</span></td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Submitted:</td><td>${new Date().toLocaleString()}</td></tr>
      </table>
    </div>

    <p>You can track the progress of this request directly in your EduCare account.</p>
  `;

  const html = renderHtmlEmail({
    title: `Repair Request ${request.code} - EduCare`,
    headline: 'Repair Request Submitted',
    recipientName: requester.name,
    badge: { text: `Ticket ${request.code}`, bg: '#eff6ff', color: '#1e40af', border: '#bfdbfe' },
    bodyHtml,
    actionUrl: `http://localhost:3000/requests/${request.id}`,
    actionText: 'View Request Status',
  });

  return sendMail({
    to: requester.email,
    subject,
    html,
    text: `Hello ${requester.name},\n\nYour repair request ${request.code} for ${equipment ? equipment.name : fallbackLabel} has been received.\n\nView details: http://localhost:3000/requests/${request.id}`,
    metadata: { requestId: request.id, event: 'request_created' },
  });
}

/**
 * 5. Send Test Email
 */
async function sendTestEmail(targetEmail) {
  const settings = getEmailSettings();
  const subject = `🧪 [EduCare] Test Email Notification`;

  const bodyHtml = `
    <p>This is a test notification confirming that the <strong>EduCare Email Notification System</strong> is successfully connected and transmitting emails.</p>
    
    <div style="background-color:#f0fdf4;border-radius:10px;padding:16px 20px;margin:18px 0;border:1px solid #bbf7d0;">
      <h3 style="margin:0 0 10px;font-size:14px;color:#166534;text-transform:uppercase;letter-spacing:0.5px;">Connection Details</h3>
      <table width="100%" style="font-size:13.5px;color:#166534;border-collapse:collapse;">
        <tr><td style="padding:4px 0;width:140px;color:#15803d;">Provider:</td><td><strong>${settings.provider.toUpperCase()}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#15803d;">Sender Address:</td><td>${settings.user || settings.fromEmail}</td></tr>
        <tr><td style="padding:4px 0;color:#15803d;">Timestamp:</td><td>${new Date().toLocaleString()}</td></tr>
        <tr><td style="padding:4px 0;color:#15803d;">System:</td><td>EduCare</td></tr>
      </table>
    </div>

    <p>All automatic email notifications (Sign-up, Admin Approval, Repair Requests, and Password Resets) are active and ready!</p>
  `;

  const html = renderHtmlEmail({
    title: 'Test Email - EduCare',
    headline: 'Email Connection Verified!',
    recipientName: 'EduCare Administrator',
    badge: { text: '✓ Verified Connection', bg: '#dcfce7', color: '#166534', border: '#86efac' },
    bodyHtml,
    actionUrl: 'http://localhost:3000/settings/email',
    actionText: 'Manage Email Settings',
  });

  return sendMail({
    to: targetEmail,
    subject,
    html,
    text: `This is a test email from EduCare to verify email connection.\n\nSent at: ${new Date().toLocaleString()}`,
    metadata: { event: 'test_email' },
  });
}

function parseDevice(uaString) {
  if (!uaString) return 'Web Browser';
  const ua = String(uaString);
  let os = 'Unknown Device';
  if (/windows/i.test(ua)) os = 'Windows PC';
  else if (/macintosh|mac os x/i.test(ua)) os = 'Mac';
  else if (/android/i.test(ua)) os = 'Android Device';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS Device';
  else if (/linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/edg\//i.test(ua)) browser = 'Microsoft Edge';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';
  else if (/opera|opr/i.test(ua)) browser = 'Opera';

  return `${browser} on ${os}`;
}

/**
 * 6. Account Login Security Alert
 */
async function sendLoginAlertEmail(user, { ip = '127.0.0.1', userAgent = '', time = new Date() } = {}) {
  const settings = getEmailSettings();
  if (settings.notifyOnLogin === false || !user.email) return;

  const roleLabel = roleLabelFor(user);
  const device = parseDevice(userAgent);
  const formattedTime = new Date(time).toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'medium',
  });

  const subject = `🔐 [EduCare Security] New Login to Your Account (${user.name})`;

  const bodyHtml = `
    <p>We detected a new login to your <strong>EduCare</strong> account.</p>
    
    <div style="background-color:#f8fafc;border-radius:10px;padding:16px 20px;margin:18px 0;border:1px solid #e2e8f0;">
      <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;">Login Activity Details</h3>
      <table width="100%" style="font-size:13.5px;color:#334155;border-collapse:collapse;">
        <tr><td style="padding:4px 0;width:130px;color:#64748b;">Account:</td><td><strong>${esc(user.name)}</strong> (${esc(user.email)})</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Role:</td><td><strong>${esc(roleLabel)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Date & Time:</td><td><strong>${esc(formattedTime)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Device / Browser:</td><td>${esc(device)}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">IP Address:</td><td><code>${esc(ip === '::1' || ip === '::ffff:127.0.0.1' ? '127.0.0.1 (Localhost)' : ip)}</code></td></tr>
      </table>
    </div>

    <div style="background-color:#eff6ff;border-radius:8px;padding:12px 16px;border-left:4px solid #3b82f6;margin-bottom:14px;">
      <strong style="color:#1e40af;font-size:13.5px;display:block;margin-bottom:2px;">Was this you?</strong>
      <span style="font-size:13px;color:#1e3a8a;">If you recently logged into EduCare from this device, you don't need to take any action.</span>
    </div>

    <div style="background-color:#fef2f2;border-radius:8px;padding:12px 16px;border-left:4px solid #ef4444;">
      <strong style="color:#991b1b;font-size:13.5px;display:block;margin-bottom:2px;">Didn't log in?</strong>
      <span style="font-size:13px;color:#7f1d1d;">If you did not initiate this login, your account might be compromised. Please report this immediately to the school administration office or change your password.</span>
    </div>
  `;

  const html = renderHtmlEmail({
    title: 'Security Alert: New Login - EduCare',
    preheader: `New login to your EduCare account on ${formattedTime}.`,
    headline: 'Security Alert: New Login Detected',
    recipientName: user.name,
    badge: { text: '🛡️ Security Notification', bg: '#f1f5f9', color: '#0f172a', border: '#cbd5e1' },
    bodyHtml,
    actionUrl: 'http://localhost:3000/profile/edit',
    actionText: 'Review Account Security',
    footerNote: 'This security notification was sent automatically to protect your EduCare account.',
  });

  return sendMail({
    to: user.email,
    subject,
    html,
    text: `Hello ${user.name},\n\nA new login was detected on your EduCare account:\n\nTime: ${formattedTime}\nDevice: ${device}\nIP: ${ip}\n\nIf this was not you, please report this immediately to the administrator.`,
    metadata: { userId: user.id, event: 'login_alert', ip, device },
  });
}

module.exports = {
  getEmailSettings,
  saveEmailSettings,
  createTransporter,
  verifyConnection,
  renderHtmlEmail,
  sendMail,
  sendRegistrationPendingEmail,
  sendAccountApprovedEmail,
  sendAccountRejectedEmail,
  sendRequestCreatedEmail,
  sendLoginAlertEmail,
  sendTestEmail,
};
