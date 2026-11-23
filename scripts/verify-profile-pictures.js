/**
 * Verification harness for the global profile-picture fix.
 * Runs against a temporary DB and upload directory, so live data is untouched.
 *
 * Run with: node scripts/verify-profile-pictures.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3102;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];

function check(label, ok, detail = '') {
  results.push({ label, ok: !!ok, detail });
}

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return true;
    } catch (err) { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function prepare() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'educare-avatar-'));
  const dataDir = path.join(dir, 'data');
  const uploadDir = path.join(dir, 'uploads');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'db.json'), 'utf8'));
  const liveUploads = path.join(ROOT, 'uploads');
  const sample = fs.readdirSync(liveUploads).find((f) => /\.(jpe?g|png|webp)$/i.test(f));
  if (!sample) throw new Error('No existing profile image found in uploads/ to reuse for display checks.');
  fs.copyFileSync(path.join(liveUploads, sample), path.join(uploadDir, sample));

  const admin = db.users.find((u) => u.id === 1);
  admin.avatar = sample;
  admin.mustChangePassword = false;
  if (!db.users.some((u) => u.avatar === sample)) {
    // Keep a second reference so replacement testing proves existing files are
    // not deleted while another account still uses them.
    const other = db.users.find((u) => u.id !== 1);
    if (other) other.avatar = sample;
  }
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(db, null, 2));
  return { dir, dataDir, uploadDir, sample, db };
}

(async () => {
  const prep = prepare();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: prep.dataDir, UPLOAD_DIR: prep.uploadDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  let cookie = '';
  async function request(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + url, { redirect: 'manual', ...options, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = /(educare\.sid=[^;]+)/.exec(setCookie);
      if (match) cookie = match[1];
    }
    return res;
  }
  async function page(url) {
    const res = await request(url);
    return { status: res.status, body: await res.text() };
  }
  function multipart(bytes, type, filename) {
    const fd = new FormData();
    fd.append('avatar', new Blob([bytes], { type }), filename);
    return fd;
  }

  try {
    const ready = await waitForServer();
    check('Temporary EduCare server starts', ready, log.trim().slice(0, 200));
    if (!ready) return;

    const login = await request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'admin@educare.local', password: 'admin123', next: '/', remember: '0' }),
    });
    check('Admin login succeeds', login.status === 302, `status ${login.status}`);

    const imageUrl = `/uploads/${prep.sample}`;
    const avatarFile = await request(imageUrl);
    check('Existing uploaded avatar is served', avatarFile.status === 200, `status ${avatarFile.status}`);
    check('Avatar response is an image', /^image\//i.test(avatarFile.headers.get('content-type') || ''));

    const activityRequestId = (prep.db.activities.find((a) => a.requestId) || {}).requestId ||
      (prep.db.requests[0] || {}).id;
    const views = [
      ['/', 'Dashboard'],
      ['/profile', 'My Profile'],
      ['/users', 'User Accounts'],
      ['/users/1/edit', 'Account details'],
      ['/users/approvals', 'Approvals'],
      ['/students', 'Student Directory'],
      ['/students/13', 'Student detail'],
      ['/technicians', 'Technician list'],
      ['/technicians/2', 'Technician detail'],
      ['/notifications', 'Notifications'],
      [`/requests/${activityRequestId}`, 'Activity timeline'],
      ['/history', 'History'],
    ];

    for (const [url, label] of views) {
      const result = await page(url);
      check(`${label} loads`, result.status === 200, `status ${result.status}`);
      check(`${label} renders shared circular avatar`, result.body.includes('class="ec-avatar ec-avatar--'));
      check(`${label} renders online status indicator`, result.body.includes('ec-avatar__status is-active'));
      check(`${label} keeps status outside the clipped circle`, /<\/span>\s*<span class="ec-avatar__status/.test(result.body));
      check(`${label} resolves the saved avatar URL`, result.body.includes(imageUrl));
      check(`${label} renders avatar images through the shared class`, !result.body.includes('avatar-img'));
    }

    const profile = await page('/profile');
    check('Profile uses large avatar', profile.body.includes('ec-avatar--xl'));
    check('Profile includes crop dialog', profile.body.includes('id="avatar-crop-modal"'));
    check('Profile exposes zoom control', profile.body.includes('id="avatar-crop-zoom"'));
    check('Profile exposes reposition hint', /Drag to reposition/i.test(profile.body));

    const history = await page('/history');
    const historyIdentity = history.body.includes('class="ec-identity');
    const historyCenter = history.body.includes('au-center');
    check('History rows use circular technician avatars', historyIdentity && historyCenter, `status=${history.status} identity=${historyIdentity} center=${historyCenter}`);

    const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'avatar.css'), 'utf8');
    check('Avatar CSS enforces circular boundary', /border-radius:\s*50%/.test(css) && /overflow:\s*hidden/.test(css));
    check('Avatar CSS centers image with object-fit cover', /object-fit:\s*cover/.test(css) && /object-position:\s*center/.test(css));
    check('Avatar CSS prevents stretched fallback geometry', /width:\s*100%/.test(css) && /height:\s*100%/.test(css));
    check('Avatar CSS is responsive', /@media\s*\(max-width:\s*640px\)/.test(css));

    check('Outer avatar wrapper does not clip the status dot', /\.ec-avatar\s*\{[^}]*overflow:\s*visible/.test(css));
    check('Inner media keeps the image clipped to a circle', /\.ec-avatar__media\s*\{[^}]*overflow:\s*hidden/.test(css));
    check('Status dot is absolutely positioned above the image', /\.ec-avatar__status\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*10/.test(css));
    check('Status dot extends slightly outside the circle', /\.ec-avatar__status\s*\{[^}]*right:\s*-2px[^}]*bottom:\s*-2px/.test(css));
    check('Status dot has a thin white border', /\.ec-avatar__status\s*\{[^}]*border:\s*2px solid #fff/.test(css));
    check('Online/offline colors are preserved', /\.ec-avatar__status\.is-active\s*\{[^}]*#22c55e/.test(css) && /\.ec-avatar__status\.is-inactive\s*\{[^}]*#ef4444/.test(css));
    check('Identity rows reserve space beside the status dot', /\.ec-identity\s*\{[^}]*gap:\s*12px/.test(css));

    const goodBytes = fs.readFileSync(path.join(prep.uploadDir, prep.sample));
    const upload = await request('/profile/avatar', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch', 'Accept': 'application/json' },
      body: multipart(goodBytes, 'image/jpeg', 'profile-avatar.jpg'),
    });
    const uploadBody = await upload.json().catch(() => ({}));
    check('Valid JPG upload succeeds', upload.status === 200 && uploadBody.ok === true, JSON.stringify(uploadBody));
    check('Upload response returns stored avatar URL', /^\/uploads\/avatar-.*\.jpg$/.test(uploadBody.avatar || ''), uploadBody.avatar);

    let liveDb = JSON.parse(fs.readFileSync(path.join(prep.dataDir, 'db.json'), 'utf8'));
    const newAvatar = liveDb.users.find((u) => u.id === 1).avatar;
    check('Database stores the cropped avatar filename', /^avatar-.*\.jpg$/.test(newAvatar || ''), newAvatar);
    check('Stored avatar file exists', fs.existsSync(path.join(prep.uploadDir, newAvatar)));
    check('Previously uploaded image is preserved while still referenced', fs.existsSync(path.join(prep.uploadDir, prep.sample)));

    const fakeBytes = Buffer.from('not really an image file', 'utf8');
    const bad = await request('/profile/avatar', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch', 'Accept': 'application/json' },
      body: multipart(fakeBytes, 'image/jpeg', 'fake.jpg'),
    });
    const badBody = await bad.json().catch(() => ({}));
    check('Disguised non-image is rejected', bad.status === 400 && badBody.ok === false, JSON.stringify(badBody));

    const gifBytes = Buffer.from('GIF89a0100010000000000', 'ascii');
    const gif = await request('/profile/avatar', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch', 'Accept': 'application/json' },
      body: multipart(gifBytes, 'image/gif', 'old.gif'),
    });
    const gifBody = await gif.json().catch(() => ({}));
    check('GIF profile pictures are rejected', gif.status === 400 && gifBody.ok === false, JSON.stringify(gifBody));

    const webpBytes = Buffer.alloc(16);
    webpBytes.write('RIFF', 0, 'ascii');
    webpBytes.write('WEBP', 8, 'ascii');
    const webp = await request('/profile/avatar', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch', 'Accept': 'application/json' },
      body: multipart(webpBytes, 'image/webp', 'photo.webp'),
    });
    const webpBody = await webp.json().catch(() => ({}));
    check('WEBP profile pictures are accepted', webp.status === 200 && webpBody.ok === true, JSON.stringify(webpBody));

    liveDb = JSON.parse(fs.readFileSync(path.join(prep.dataDir, 'db.json'), 'utf8'));
    check('WEBP file extension is stored', /\.webp$/.test(liveDb.users.find((u) => u.id === 1).avatar || ''));
  } catch (err) {
    check('Harness completed without exception', false, err.stack || err.message);
  } finally {
    child.kill('SIGTERM');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed }, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
