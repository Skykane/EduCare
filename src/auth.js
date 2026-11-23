// Feature 9: Role-Based User Access.
const db = require('./db');
const C = require('./constants');
const helpers = require('./helpers');
const { unreadCount } = require('./services/notify');

function flash(req, type, msg) {
  req.session.flash = { type, msg, message: msg };
}

// Loads the logged-in user and shared view data for every request.
function loadUser(req, res, next) {
  let user = req.session && req.session.userId ? db.find('users', req.session.userId) : null;
  if (user && (!user.active || user.approvalStatus === 'pending' || user.approvalStatus === 'rejected')) {
    user = null;
    req.session.userId = null;
  }
  // Teacher requesters use email/password only. Student requesters must still
  // match an official Student Directory record.
  if (user && user.role === 'requester' && user.accountKind !== 'teacher') {
    const { verifyStudentRegistration } = require('./services/studentVerification');
    const verification = verifyStudentRegistration(user.studentId);
    if (!verification.allowed) {
      user = null;
      req.session.userId = null;
      if (req.session) {
        req.session.flash = {
          type: 'error',
          msg: verification.reason || 'Access Denied: You are not a registered member of the institution.',
        };
      }
    }
  }
  req.user = user;

  Object.assign(res.locals, helpers);
  res.locals.currentUser = user;
  res.locals.currentPath = req.path;
  res.locals.unreadCount = user ? unreadCount(user.id) : 0;
  res.locals.pendingApprovalCount = user && user.role === 'admin' ? db.where('users', (u) => u.approvalStatus === 'pending').length : 0;
  
  const navItems = user ? helpers.navFor(user.role) : [];
  const navActive = user ? helpers.activeItem(navItems, req.path) : null;
  const sectionTabs = navActive && navActive.tabs ? navActive.tabs : null;
  const tabActive = sectionTabs ? helpers.activeItem(sectionTabs, req.path) : null;
  res.locals.navItems = navItems;
  res.locals.navActive = navActive;
  res.locals.sectionTabs = sectionTabs;
  res.locals.tabActive = tabActive;
  res.locals.flash = req.session ? req.session.flash : null;
  if (req.session) delete req.session.flash;
  res.locals.getUser = (id) => (id ? db.find('users', id) : null);
  res.locals.getCategory = (id) => (id ? db.find('categories', id) : null);
  res.locals.getEquipment = (id) => (id ? db.find('equipment', id) : null);
  res.locals.allEquipment = () => db.all('equipment').slice().sort((a, b) => a.code.localeCompare(b.code));
  res.locals.allCategories = () => db.all('categories');
  res.locals.allLocations = () => [...new Set([...(C.CAMPUS_LOCATIONS || []), ...db.all('equipment').map((e) => e.location).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  // A temporary password must be replaced before the rest of the app is accessible.
  if (req.user.mustChangePassword) {
    const pathOnly = String(req.originalUrl || req.url || '').split('?')[0];
    const allowed = ['/profile/change-password', '/profile/password'];
    if (!allowed.includes(pathOnly)) return res.redirect('/profile/change-password');
  }
  next();
}

function forbidden(res, message = 'You do not have permission to view this page.') {
  return res.status(403).render('error', { title: 'Access denied', message });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.role)) return forbidden(res);
    next();
  };
}

module.exports = { loadUser, requireLogin, requireRole, forbidden, flash };
