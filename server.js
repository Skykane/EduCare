// EDUCARE: School Equipment Maintenance and Repair Management System
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');

const db = require('./src/db');
const { loadUser, requireLogin } = require('./src/auth');
const { startScheduler } = require('./src/services/scheduler');
const { UPLOAD_DIR } = require('./src/upload');

db.load();

function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  fs.mkdirSync(db.DATA_DIR, { recursive: true });
  const file = path.join(db.DATA_DIR, 'session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const app = express();
const PORT = process.env.PORT || 3000;
const PRODUCTION = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
if (PRODUCTION) app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    name: 'educare.sid',
    secret: sessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: PRODUCTION,
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);
app.use(loadUser);

// Lightweight CSRF defence: same-origin browsers send Origin (or Referer) on
// form posts. Requests without either header (e.g. local API scripts) are left
// alone; cross-origin requests are rejected before reaching any route.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const expectedOrigin = `${req.protocol}://${req.headers.host}`;
  const origin = req.headers.origin;
  if (origin) {
    if (origin !== expectedOrigin) {
      return res.status(403).type('text/plain').send('Cross-origin request blocked.');
    }
    return next();
  }
  const referer = req.headers.referer;
  if (referer) {
    try {
      if (new URL(referer).host === req.headers.host) return next();
    } catch (e) { /* fall through to rejection */ }
    return res.status(403).type('text/plain').send('Cross-origin request blocked.');
  }
  return next();
});

// Public
app.use('/', require('./src/routes/auth'));

// Logged-in only
app.use('/uploads', requireLogin, express.static(UPLOAD_DIR));
app.use('/', requireLogin, require('./src/routes/dashboard'));
app.use('/equipment', requireLogin, require('./src/routes/equipment'));
app.use('/categories', requireLogin, require('./src/routes/categories'));
app.use('/locations', requireLogin, require('./src/routes/locations'));
app.use('/requests', requireLogin, require('./src/routes/requests'));
app.use('/technicians', requireLogin, require('./src/routes/technicians'));
app.use('/users', requireLogin, require('./src/routes/users'));
app.use('/students', requireLogin, require('./src/routes/students'));
app.use('/settings/email', requireLogin, require('./src/routes/emailSettings'));
app.use('/settings/grade-sections', requireLogin, require('./src/routes/gradeSections'));
app.use('/email-history', requireLogin, require('./src/routes/emailHistory'));
app.use('/history', requireLogin, require('./src/routes/history'));
app.use('/materials', requireLogin, require('./src/routes/materials'));
app.use('/schedule', requireLogin, require('./src/routes/schedule'));
app.use('/reports', requireLogin, require('./src/routes/reports'));
app.use('/notifications', requireLogin, require('./src/routes/notifications'));
app.use('/profile', requireLogin, require('./src/routes/profile'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Page not found', message: 'The page you are looking for does not exist.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Something went wrong', message: 'An unexpected error occurred. Please try again.' });
});

startScheduler();

app.listen(PORT, () => {
  console.log(`EduCare is running at http://localhost:${PORT}`);
});
