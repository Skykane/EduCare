// Test Suite: Account Login Security Email Alert
const assert = require('assert');
const db = require('../src/db');
const mailer = require('../src/services/mailer');

async function runTests() {
  console.log('=== TEST SUITE: LOGIN SECURITY EMAIL NOTIFICATION ===');

  db.load();

  // Test 1: Device / Browser string parsing
  console.log('Testing User-Agent device parser...');
  const testUAWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const testUAMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const testUAiPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  const testUser = {
    id: 99993,
    name: 'Jessie Salvador',
    email: 'jessie@gmail.com',
    role: 'requester',
  };

  // Test 2: Dispatch Login Security Email
  console.log('Testing sendLoginAlertEmail...');
  const result = await mailer.sendLoginAlertEmail(testUser, {
    ip: '127.0.0.1',
    userAgent: testUAWindows,
    time: new Date(),
  });

  assert.ok(result && result.ok, 'Login alert send must succeed');

  const outgoing = db.all('outgoingEmails');
  const alertEmail = outgoing.find(
    (m) => m.to.includes('jessie@gmail.com') && m.metadata && m.metadata.event === 'login_alert'
  );

  assert.ok(alertEmail, 'Login alert email must be stored in outgoingEmails');
  assert.ok(alertEmail.subject.includes('New Login'), 'Subject must mention new login');
  assert.ok(alertEmail.html.includes('Jessie Salvador'), 'HTML must include user name');
  assert.ok(alertEmail.html.includes('Chrome on Windows PC'), 'HTML must include parsed device name');
  assert.ok(alertEmail.html.includes('Was this you?'), 'HTML must include security advice');
  assert.ok(alertEmail.html.includes('Review Account Security'), 'HTML must include profile security button');

  console.log('✓ Login alert email generated with full device details, IP, and security advice.');

  // Test 3: Verify toggle can disable login alert if desired
  console.log('Testing notifyOnLogin setting toggle...');
  mailer.saveEmailSettings({ notifyOnLogin: false });
  const countBefore = outgoing.length;
  await mailer.sendLoginAlertEmail(testUser, { ip: '127.0.0.1', userAgent: testUAMac });
  const countAfter = db.all('outgoingEmails').length;
  assert.strictEqual(countBefore, countAfter, 'No email should be sent when notifyOnLogin is false');

  // Re-enable
  mailer.saveEmailSettings({ notifyOnLogin: true });
  console.log('✓ Toggle properly controls login alert dispatching.');

  // Cleanup test email
  const allOutgoing = db.all('outgoingEmails');
  const filtered = allOutgoing.filter((m) => !m.to.includes('jessie@gmail.com'));
  allOutgoing.length = 0;
  allOutgoing.push(...filtered);
  db.save();

  console.log('✓ Cleaned up test data.');
  console.log('=== ALL LOGIN EMAIL ALERT TESTS PASSED! ===');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
