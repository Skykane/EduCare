// Test Suite: Real Email Notifications & Mailer Service
const assert = require('assert');
const path = require('path');
const db = require('../src/db');
const mailer = require('../src/services/mailer');

async function runTests() {
  console.log('=== TEST SUITE: EMAIL NOTIFICATION SYSTEM ===');

  db.load();

  // Test 1: Get & Save Email Settings
  console.log('Testing Email Settings Management...');
  const initialSettings = mailer.getEmailSettings();
  assert.ok(initialSettings, 'Initial settings must exist');
  assert.strictEqual(typeof initialSettings.enabled, 'boolean', 'Enabled must be boolean');

  const saved = mailer.saveEmailSettings({
    fromName: 'Test School CST',
    notifyOnRegistration: true,
  });
  assert.strictEqual(saved.fromName, 'Test School CST');
  console.log('✓ Email settings saved and retrieved correctly.');

  // Test 2: Render Branded HTML Email Template
  console.log('Testing HTML Email Template Rendering...');
  const rendered = mailer.renderHtmlEmail({
    title: 'Test Notification',
    headline: 'Welcome to EduCare',
    recipientName: 'Jessie',
    badge: { text: '✓ Active', bg: '#dcfce7', color: '#15803d' },
    bodyHtml: '<p>Your account is ready.</p>',
    actionUrl: 'http://localhost:3000/login',
    actionText: 'Log In Now',
  });
  assert.ok(rendered.includes('EduCare'), 'Email must contain EduCare brand');
  assert.ok(rendered.includes('St. Anthony Center of Science and Technology'), 'Must contain school name');
  assert.ok(rendered.includes('Jessie'), 'Must include recipient name');
  assert.ok(rendered.includes('Log In Now'), 'Must include call-to-action button');
  console.log('✓ Branded HTML email template rendered successfully.');

  // Test 3: Registration Pending Email
  console.log('Testing Registration Pending Notification...');
  const testStudent = {
    id: 99991,
    name: 'Jessie Test User',
    email: 'jessie@gmail.com',
    role: 'requester',
    studentId: '2024-00102',
    department: 'Grade 11 - TVL-ICT',
  };

  const regResult = await mailer.sendRegistrationPendingEmail(testStudent);
  assert.ok(regResult && regResult.ok, 'Registration email send must succeed');

  const outgoing = db.all('outgoingEmails');
  const regEmail = outgoing.find((m) => m.to.includes('jessie@gmail.com') && m.metadata && m.metadata.event === 'register_pending');
  assert.ok(regEmail, 'Registration email must be recorded in outgoingEmails log');
  assert.ok(regEmail.subject.includes('Registration Received'), 'Subject must indicate registration received');
  assert.ok(regEmail.html.includes('2024-00102'), 'Must include Student ID in email');
  console.log('✓ Registration pending notification dispatched and recorded for jessie@gmail.com.');

  // Test 4: Account Approved Email
  console.log('Testing Account Approved Notification...');
  const approveResult = await mailer.sendAccountApprovedEmail(testStudent);
  assert.ok(approveResult && approveResult.ok, 'Approval email send must succeed');

  const approveEmail = outgoing.find((m) => m.to.includes('jessie@gmail.com') && m.metadata && m.metadata.event === 'account_approved');
  assert.ok(approveEmail, 'Approval email must be recorded in outgoingEmails log');
  assert.ok(approveEmail.subject.includes('Approved'), 'Subject must indicate account approved');
  assert.ok(approveEmail.html.includes('Log In to EduCare Now'), 'Must contain login button');
  console.log('✓ Account approved notification dispatched and recorded.');

  // Test 5: Account Rejected Email
  console.log('Testing Account Rejected Notification...');
  const rejectResult = await mailer.sendAccountRejectedEmail(testStudent, 'Student ID not matching school records.');
  assert.ok(rejectResult && rejectResult.ok, 'Reject email send must succeed');

  const rejectEmail = outgoing.find((m) => m.to.includes('jessie@gmail.com') && m.metadata && m.metadata.event === 'account_rejected');
  assert.ok(rejectEmail, 'Reject email must be recorded in outgoingEmails log');
  assert.ok(rejectEmail.html.includes('Student ID not matching school records.'), 'Must include rejection reason');
  console.log('✓ Account rejected notification dispatched and recorded.');

  // Test 6: Repair Request Submitted Email
  console.log('Testing Repair Request Notification...');
  const testReq = { id: 8881, code: 'REQ-2026-999', title: 'Broken Monitor in Lab 3', status: 'Pending' };
  const testEq = { id: 7771, code: 'EQ-LAB-01', name: 'Dell 24" Monitor' };
  const reqResult = await mailer.sendRequestCreatedEmail(testReq, testStudent, testEq);
  assert.ok(reqResult && reqResult.ok, 'Request created email send must succeed');

  const reqEmail = outgoing.find((m) => m.to.includes('jessie@gmail.com') && m.metadata && m.metadata.event === 'request_created');
  assert.ok(reqEmail, 'Request email must be recorded in outgoingEmails log');
  assert.ok(reqEmail.html.includes('REQ-2026-999'), 'Must include ticket code in email');
  console.log('✓ Repair request confirmation email dispatched and recorded.');

  // Test 7: Send Test Email
  console.log('Testing Admin Test Email Dispatch...');
  const testResult = await mailer.sendTestEmail('admin@educare.local');
  assert.ok(testResult && testResult.ok, 'Admin test email send must succeed');
  console.log('✓ Admin test email dispatched successfully.');

  // Test 8: Transporter Configuration Check
  console.log('Testing Transporter Instantiation...');
  const dummyGmailSettings = {
    provider: 'gmail',
    user: 'school.educare@gmail.com',
    pass: 'abcd efgh ijkl mnop',
  };
  const transporter = mailer.createTransporter(dummyGmailSettings);
  assert.ok(transporter, 'Transporter must be created when credentials are provided');
  assert.strictEqual(transporter.options.service, 'gmail', 'Must use gmail service');
  assert.strictEqual(transporter.options.auth.user, 'school.educare@gmail.com');
  assert.strictEqual(transporter.options.auth.pass, 'abcdefghijklmnop', 'Spaces must be stripped from Google App Password');
  console.log('✓ Nodemailer Gmail transporter verified with App Password sanitization.');

  // Cleanup: Remove dummy test emails from db
  const allOutgoing = db.all('outgoingEmails');
  const filtered = allOutgoing.filter((m) => !m.to.includes('jessie@gmail.com') && !m.to.includes('admin@educare.local'));
  allOutgoing.length = 0;
  allOutgoing.push(...filtered);
  db.save();
  console.log('✓ Cleaned up test data.');

  console.log('=== ALL EMAIL NOTIFICATION TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
