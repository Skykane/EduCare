// Formatting and small utility functions. Also exposed to every view.
const C = require('./constants');
const { icon, statusIcon, categoryIcon } = require('./icons');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

function localISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayISO() {
  return localISO(new Date());
}

function parseDate(v) {
  if (!v) return null;
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
  return isNaN(d) ? null : d;
}

// Date-only (YYYY-MM-DD) of any stored date/timestamp, in local time.
function dateOnly(v) {
  const d = parseDate(v);
  return d ? localISO(d) : null;
}

function addDays(iso, n) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  return localISO(d);
}

function addMonths(iso, months) {
  const d = parseDate(dateOnly(iso));
  if (!d) return iso;
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== originalDay) {
    d.setDate(0);
  }
  return localISO(d);
}

function calcNextDue(baseIso, intervalDays) {
  const n = Number(intervalDays);
  if (!n || n <= 0) return null;
  if (n === 30) return addMonths(baseIso, 1);
  if (n === 60) return addMonths(baseIso, 2);
  if (n === 90) return addMonths(baseIso, 3);
  if (n === 120) return addMonths(baseIso, 4);
  if (n === 180) return addMonths(baseIso, 6);
  if (n === 365) return addMonths(baseIso, 12);
  return addDays(baseIso, n);
}

function intervalLabel(intervalDays) {
  const n = Number(intervalDays);
  if (n === 30) return 'Monthly';
  if (n === 60) return 'Every 2 months';
  if (n === 90) return 'Quarterly';
  if (n === 120) return 'Every 4 months';
  if (n === 180) return 'Semi-annual';
  if (n === 365) return 'Annual';
  return null;
}

// Whole days from `fromIso` to `toIso` (date-only).
function diffDays(fromIso, toIso) {
  const a = parseDate(dateOnly(fromIso));
  const b = parseDate(dateOnly(toIso));
  return Math.round((b - a) / 86400000);
}

function isISODate(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !!parseDate(v);
}

function fmtDate(v) {
  const d = parseDate(v);
  if (!d) return '—';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function fmtDateTime(v) {
  const d = parseDate(v);
  if (!d) return '—';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${fmtDate(v)} ${h}:${pad(d.getMinutes())} ${ampm}`;
}

function timeAgo(v) {
  const d = parseDate(v);
  if (!d) return '';
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(v);
}

function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  return Array.isArray(v) ? v : [v];
}

function str(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

function int(v, def = null) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

const STATUS_CLASS = {
  Operational: 'green',
  'Needs Repair': 'amber',
  'Under Maintenance': 'blue',
  'Out of Service': 'red',
  Pending: 'amber',
  Approved: 'blue',
  Assigned: 'indigo',
  'In Progress': 'blue',
  'On Hold': 'gray',
  Completed: 'green',
  Cancelled: 'gray',
  Rejected: 'red',
  Low: 'gray',
  Medium: 'amber',
  High: 'red',
  Available: 'green',
  Busy: 'amber',
  'On Leave': 'gray',
  Overdue: 'red',
  'Due Soon': 'amber',
  Scheduled: 'green',
  Corrective: 'indigo',
  Preventive: 'teal',
};

function statusClass(s) {
  return 'badge badge-' + (STATUS_CLASS[s] || 'gray');
}

function statusColor(s) {
  return STATUS_CLASS[s] || 'gray';
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

// Build a query string from the current filters, overriding some keys.
function qs(params, overrides = {}) {
  const merged = { ...params, ...overrides };
  const parts = Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? '?' + parts.join('&') : '';
}

// Sidebar menu per role. Each item looks like:
//   { href: '/requests', label: 'Repair Requests', icon: 'clipboard' }   (icon names: src/icons.js)
// Optional: `paths` (URL sections that highlight the item), `tabs` (shown at
// the top of pages in that section), `badge: true` (unread notification count).
const DASHBOARD = { href: '/', label: 'Dashboard', icon: 'home' };
const NOTIFICATIONS = { href: '/notifications', label: 'Notifications', icon: 'bell', badge: true };

const NAV = {
  admin: [
    DASHBOARD,
    {
      href: '/equipment',
      label: 'Equipment Management',
      icon: 'monitor',
      paths: ['/equipment', '/categories', '/locations'],
      tabs: [
        { href: '/equipment', label: 'Equipment' },
        { href: '/categories', label: 'Categories' },
        { href: '/locations', label: 'Locations' },
      ],
    },
    { href: '/requests', label: 'Repair Requests', icon: 'clipboard' },
    { href: '/technicians', label: 'Technician Management', icon: 'users' },
    {
      href: '/schedule',
      label: 'Maintenance',
      icon: 'wrench',
      paths: ['/schedule', '/history'],
      tabs: [
        { href: '/schedule', label: 'Maintenance Schedule' },
        { href: '/history', label: 'Maintenance History' },
      ],
    },
    { href: '/reports', label: 'Reports', icon: 'chart' },
    { href: '/email-history', label: 'Email History', icon: 'mail' },
    {
      href: '/users',
      label: 'User Accounts',
      icon: 'settings',
      paths: ['/users', '/settings/email'],
      tabs: [
        { href: '/users', label: 'Accounts' },
        { href: '/users/approvals', label: 'Approvals', badge: true },
        { href: '/settings/email', label: 'Email Settings' },
      ],
    },
  ],
  technician: [
    DASHBOARD,
    { href: '/requests', label: 'My Tasks', icon: 'clipboard' },
    { href: '/schedule', label: 'Maintenance Schedule', icon: 'calendar' },
    { href: '/history', label: 'Repair History', icon: 'history' },
    { href: '/profile', label: 'My Profile', icon: 'user' },
  ],
  requester: [
    DASHBOARD,
    { href: '/requests/new', label: 'Submit Request', icon: 'plus' },
    { href: '/requests', label: 'My Requests', icon: 'file' },
    { href: '/profile', label: 'Edit Profile', icon: 'user' },
  ],
};

function navFor(role) {
  return NAV[role] || [];
}

// Bottom bar on phones (max 5 slots). `fab` is the round centre button;
// `menu` opens the full sidebar for roles with more pages than fit.
const BOTTOM_NAV = {
  admin: [
    { href: '/', label: 'Dashboard', icon: 'home' },
    { href: '/requests', label: 'Requests', icon: 'clipboard' },
    { href: '/requests/new', label: 'Submit Request', icon: 'plus', fab: true },
    { href: '/notifications', label: 'Alerts', icon: 'bell', badge: true },
    { label: 'Menu', icon: 'menu', menu: true },
  ],
  technician: [
    { href: '/', label: 'Dashboard', icon: 'home' },
    { href: '/requests', label: 'My Tasks', icon: 'clipboard' },
    { href: '/schedule', label: 'Schedule', icon: 'calendar' },
    { href: '/notifications', label: 'Alerts', icon: 'bell', badge: true },
    { href: '/profile', label: 'Profile', icon: 'user' },
  ],
  requester: [
    { href: '/', label: 'Dashboard', icon: 'home' },
    { href: '/requests', label: 'My Requests', icon: 'file' },
    { href: '/requests/new', label: 'Submit Request', icon: 'plus', fab: true },
    { href: '/notifications', label: 'Alerts', icon: 'bell', badge: true },
    { href: '/profile', label: 'Edit Profile', icon: 'user' },
  ],
};

function bottomNavFor(role) {
  return BOTTOM_NAV[role] || [];
}

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

// Length of the longest of `paths` that the current URL falls under, or 0.
function pathMatch(paths, currentPath) {
  let best = 0;
  for (const p of paths) {
    const hit = p === '/' ? currentPath === '/' : currentPath === p || currentPath.startsWith(p + '/');
    if (hit && p.length > best) best = p.length;
  }
  return best;
}

// The item the current page belongs to (most specific match wins,
// so /requests/new picks "Submit Request" over "My Requests").
function activeItem(items, currentPath) {
  let found = null;
  let best = 0;
  for (const item of items) {
    const len = pathMatch(item.paths || [item.href], currentPath);
    if (len > best) {
      best = len;
      found = item;
    }
  }
  return found;
}

function csvEscape(v) {
  let s = String(v ?? '');
  // Stop spreadsheet apps from treating a cell as a formula.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(headers, rows) {
  return '﻿' + [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

// Only allow redirects within this site.
function safeLocalPath(p, fallback = '/') {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') ? p : fallback;
}

module.exports = {
  C,
  localISO,
  todayISO,
  parseDate,
  dateOnly,
  addDays,
  addMonths,
  calcNextDue,
  intervalLabel,
  diffDays,
  isISODate,
  fmtDate,
  fmtDateTime,
  timeAgo,
  toArray,
  str,
  int,
  statusClass,
  statusColor,
  initials,
  qs,
  navFor,
  bottomNavFor,
  activeItem,
  icon,
  statusIcon,
  categoryIcon,
  greeting,
  firstName,
  toCSV,
  safeLocalPath,
};
