/**
 * End-to-end HTTP verification of the Admin > Equipment Categories module.
 * The real server is started against a COPY of data/db.json so no live
 * records are changed.
 *
 * Run with: node scripts/verify-categories.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const C = require('../src/constants');

const ROOT = path.join(__dirname, '..');
const PORT = 3103;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'verify1234';
const ADMIN_EMAIL = 'admin@educare.local';

const NEW_NAME = 'Verification Test Category';
const NEW_DESCRIPTION = 'Temporary category used by verification.';
const EDITED_NAME = 'Verification Edited Category';
const EDITED_DESCRIPTION = 'Edited temporary category used by verification.';
const DEMO_DESCRIPTION = 'SAMPLE/DEMO category created for the sample inventory.';

const results = [];
function check(label, condition, detail = '') {
  results.push({ label, ok: !!condition, detail });
}

function createClient() {
  let cookie = '';
  return {
    async request(url, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(`${BASE}${url}`, { redirect: 'manual', ...options, headers });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const match = /(educare\.sid=[^;]+)/.exec(setCookie);
        if (match) cookie = match[1];
      }
      return res;
    },
    async post(url, fields) {
      return this.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
    },
    async text(url) {
      const res = await this.request(url);
      return { status: res.status, body: await res.text() };
    },
  };
}

function prepareTempData() {
  const source = path.join(ROOT, 'data');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'educare-categories-verify-'));
  for (const name of fs.readdirSync(source)) {
    const from = path.join(source, name);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dir, name));
  }

  const raw = JSON.parse(fs.readFileSync(path.join(source, 'db.json'), 'utf8'));
  const hash = bcrypt.hashSync(PASSWORD, 10);
  raw.users.forEach((u) => {
    if (u.email === ADMIN_EMAIL || u.role === 'admin') {
      u.passwordHash = hash;
      u.mustChangePassword = false;
      u.active = true;
      u.approvalStatus = 'approved';
    }
  });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(raw, null, 2));
  return dir;
}

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return true;
    } catch (err) { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function occurrences(body, needle) {
  return body.split(needle).length - 1;
}

function categoryRow(body, name) {
  const linkRe = new RegExp('class="category-link"[^>]*>\\s*' + escapeRegExp(name) + '\\s*</a>');
  const rows = body.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  return rows.find((row) => linkRe.test(row)) || '';
}

function statusCardValue(body, label) {
  const re = new RegExp(
    'category-stat-label[^>]*>\\s*' + escapeRegExp(label) + '\\s*</span>[\\s\\S]*?category-stat-value[^>]*>\\s*(\\d+)\\s*</span>'
  );
  const match = body.match(re);
  return match ? Number(match[1]) : null;
}

function rowNumbers(row) {
  const statusValues = Array.from(row.matchAll(/category-count[^>]*>\s*(\d+)\s*</g))
    .map((m) => Number(m[1]));
  const totalMatch = row.match(/category-total[^>]*>\s*(\d+)\s*</);
  return {
    statusValues: statusValues.slice(0, 4),
    total: totalMatch ? Number(totalMatch[1]) : null,
  };
}

function expectedCounts(items) {
  return C.EQUIPMENT_STATUSES.map((s) => items.filter((e) => e.status === s).length);
}

async function run() {
  const dataDir = prepareTempData();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });

  const admin = createClient();
  const dbNow = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const findCategory = (name) => dbNow().categories.find((c) => c.name === name);
  const initial = dbNow();

  try {
    const ready = await waitForServer();
    check('Server starts with copied database', ready, serverLog.trim().slice(0, 200));
    if (!ready) return;

    let res = await admin.post('/login', { email: ADMIN_EMAIL, password: PASSWORD, next: '/', remember: '0' });
    check('Administrator login succeeds', res.status === 302 && res.headers.get('location') === '/', `status ${res.status}`);

    // ---------- 1. Redesigned page shell ----------
    let page = await admin.text('/categories');
    check('Categories page opens', page.status === 200, `status ${page.status}`);
    check(
      'Page uses the scoped redesign and shared header stylesheets',
      /<body class="role-admin categories-page equipment-management-page">/.test(page.body)
        && page.body.includes('/css/categories.css')
        && page.body.includes('/css/equipment-management-header.css')
        && page.body.indexOf('/css/equipment-management-header.css') > page.body.indexOf('/css/categories.css')
    );
    check('Header keeps the Equipment Categories title and description', page.body.includes('<h1>Equipment Categories</h1>') && page.body.includes('Group school equipment by category, track maintenance status, and organize items.'));
    const bannerActions = (page.body.match(/<div class="dash-banner-actions">[\s\S]*?<\/div>/) || [''])[0];
    check(
      'Header keeps only the Add Equipment action',
      (bannerActions.match(/class="btn-banner-sub"/g) || []).length === 1
        && bannerActions.includes('href="/equipment/new"')
        && !bannerActions.includes('href="/locations"')
    );
    const tabNav = (page.body.match(/<nav class="section-tabs"[\s\S]*?<\/nav>/) || [''])[0];
    check(
      'Equipment Management navigation keeps the Equipment, Categories and Locations tabs',
      ['/equipment', '/categories', '/locations'].every((href) => tabNav.includes(`href="${href}"`))
        && /href="\/categories" class="active"/.test(tabNav)
        && (tabNav.match(/<a /g) || []).length === 3
    );

    const css = fs.readFileSync(path.join(ROOT, 'public/css/categories.css'), 'utf8');
    const sharedHeaderCss = fs.readFileSync(path.join(ROOT, 'public/css/equipment-management-header.css'), 'utf8');
    const sharedTabsRule = (sharedHeaderCss.match(/\.equipment-management-page \.app \.section-tabs\s*\{([^}]*)\}/) || ['', ''])[1];
    const categoryWatermarkRule = (sharedHeaderCss.match(/\.equipment-management-page\.categories-page \.app \.dash-banner-watermark\s*\{([^}]*)\}/) || ['', ''])[1];
    const tableAlignJs = fs.readFileSync(path.join(ROOT, 'public/js/table-align.js'), 'utf8');
    check(
      'Categories table keeps the per-column alignment from its markup',
      /classList\.contains\(['"]categories-table['"]\)/.test(tableAlignJs)
    );
    check(
      'Shared header and tabs match the Equipment Inventory reference',
      /\.equipment-management-page \.app \.dash-header-banner\s*\{[^}]*padding:\s*11px 18px !important/.test(sharedHeaderCss)
        && /\.equipment-management-page \.app \.dash-banner-actions\s*\{[^}]*justify-content:\s*flex-end !important/.test(sharedHeaderCss)
        && /width:\s*100% !important/.test(sharedTabsRule)
        && /margin:\s*0 0 14px !important/.test(sharedTabsRule)
        && /margin-left:\s*0 !important/.test(sharedTabsRule)
        && /margin-right:\s*0 !important/.test(sharedTabsRule)
        && /padding:\s*5px 10px !important/.test(sharedTabsRule)
        && /align-items:\s*center !important/.test(sharedTabsRule)
        && /justify-content:\s*flex-start !important/.test(sharedTabsRule)
        && !/justify-content:\s*center/.test(sharedTabsRule)
        && !/margin(?:-left|-right)?:\s*auto/.test(sharedTabsRule)
        && /background:\s*var\(--gray-soft\) !important/.test(sharedTabsRule)
        && /\.equipment-management-page \.app \.section-tabs a\.active\s*\{[^}]*background:\s*#ffffff !important/.test(sharedHeaderCss)
        && /\.equipment-management-page \.app \.section-tabs a\.active\s*\{[^}]*color:\s*var\(--primary\) !important/.test(sharedHeaderCss)
    );
    check(
      'Categories no longer overrides the shared header/tab layout',
      !/\.categories-page \.dash-header-banner\s*\{/.test(css)
        && !/\.categories-page \.section-tabs\s*\{/.test(css)
    );
    check(
      'Categories keeps the decorative shield on the right side of the header',
      /display:\s*flex\s*!important/.test(categoryWatermarkRule)
        && /right:\s*18px\s*!important/.test(categoryWatermarkRule)
        && /width:\s*64px\s*!important/.test(categoryWatermarkRule)
        && /height:\s*64px\s*!important/.test(categoryWatermarkRule)
        && /opacity:\s*0\.07\s*!important/.test(categoryWatermarkRule)
        && page.body.includes('dash-banner-watermark')
        && page.body.includes('/img/educare-logo.svg')
    );

    const sharedPages = [
      {
        label: 'Equipment',
        url: '/equipment',
        title: 'Equipment Inventory',
        subtitle: 'List of all school equipment, locations, condition, and maintenance checkups.',
        activeHref: '/equipment',
      },
      {
        label: 'Categories',
        url: '/categories',
        title: 'Equipment Categories',
        subtitle: 'Group school equipment by category, track maintenance status, and organize items.',
        activeHref: '/categories',
      },
      {
        label: 'Locations',
        url: '/locations',
        title: 'Campus Locations &amp; Rooms',
        subtitle: 'Monitor equipment deployment, room distribution, and operational readiness across all campus facilities.',
        activeHref: '/locations',
      },
    ];
    for (const pageConfig of sharedPages) {
      const rendered = await admin.text(pageConfig.url);
      check(
        `${pageConfig.label} page renders the shared Equipment Management shell`,
        rendered.status === 200
          && /<body class="role-admin [^"]*\bequipment-management-page\b/.test(rendered.body)
          && rendered.body.includes(`<h1>${pageConfig.title}</h1>`)
          && rendered.body.includes(pageConfig.subtitle)
          && rendered.body.includes('/css/equipment-management-header.css')
          && new RegExp(`href="${pageConfig.activeHref.replace(/\//g, '\\/')}" class="active"`).test(rendered.body),
        `status ${rendered.status}`
      );
    }
    check(
      'Section headings have no decorative icons or count badge',
      !page.body.includes('add-category-icon')
        && !/<svg/.test((page.body.match(/<div class="categories-table-head">[\s\S]*?<\/div>/) || [''])[0])
        && !page.body.includes('category-count-pill')
    );
    check(
      'Status cards use small plain icons with label above number',
      /\.categories-page \.category-stat-icon\s*\{[^}]*width:\s*18px/.test(css)
        && /\.categories-page \.category-stat-icon\s*\{[^}]*background:\s*transparent/.test(css)
        && /category-stat-label[^>]*>Operational\s*<\/span>[\s\S]*?category-stat-value/.test(page.body)
    );
    check('Add form uses one aligned desktop grid row', /\.categories-page \.add-category-form\s*\{[^}]*grid-template-columns:[^;]+;/.test(css));
    check('Forms stack on smaller screens', /@media \(max-width: 820px\)[\s\S]*?\.category-edit-form \{ grid-template-columns: 1fr;/.test(css));
    check('Table columns use balanced fixed widths', /\.categories-page table\.categories-table\s*\{[^}]*table-layout:\s*fixed/.test(css) && (css.match(/\.categories-page \.cat-col-/g) || []).length === 7);
    check(
      'Page layout is bounded and form text is left-aligned',
      /\.categories-page \.content\s*,\s*\.categories-page \.content > \*\s*\{[^}]*max-width:\s*100%/.test(css)
        && /\.categories-page \.app input::placeholder[\s\S]*?text-align:\s*left\s*!important/.test(css)
        && /\.categories-page \.app \.add-category-form label[\s\S]*?text-align:\s*left\s*!important/.test(css)
    );
    check(
      'Status cards use four, two, then one column',
      /\.categories-page \.category-status-stats\s*\{[^}]*grid-template-columns:\s*repeat\(4,/.test(css)
        && /@media \(max-width: 1100px\)[\s\S]*?\.categories-page \.category-status-stats\s*\{[^}]*grid-template-columns:\s*repeat\(2,/.test(css)
        && /@media \(max-width: 520px\)[\s\S]*?\.categories-page \.category-status-stats\s*\{[^}]*grid-template-columns:\s*1fr/.test(css)
    );
    check(
      'Table overflow is contained inside the table wrapper',
      /\.categories-page \.categories-table-wrap\s*\{[^}]*width:\s*100%[^}]*overflow-x:\s*auto/.test(css)
        && /\.categories-page \.app table\.categories-table \.category-actions-cell \.inline-form\s*\{[^}]*margin:\s*0\s*!important/.test(css)
    );
    check(
      'Counts are compact plain values and action labels stay visible',
      !page.body.includes('category-count-badge')
        && (page.body.match(/class="category-count/g) || []).length >= initial.categories.length * 4
        && !/category-action-label \{ display: none/.test(css)
    );

    // ---------- 2. Demo descriptions and status counts ----------
    check('Repetitive demo description is never rendered', !page.body.includes(DEMO_DESCRIPTION));
    check(
      'Empty descriptions use the muted fallback',
      occurrences(page.body, 'No description provided') === initial.categories.length,
      `${occurrences(page.body, 'No description provided')} of ${initial.categories.length}`
    );

    C.EQUIPMENT_STATUSES.forEach((status) => {
      const expected = initial.equipment.filter((e) => e.status === status).length;
      check(`Status card shows the real ${status} count`, statusCardValue(page.body, status) === expected, `expected ${expected}`);
    });

    initial.categories.forEach((c) => {
      const items = initial.equipment.filter((e) => e.categoryId === c.id);
      const row = categoryRow(page.body, c.name);
      const numbers = rowNumbers(row);
      check(
        `${c.name} row counts match equipment records`,
        JSON.stringify(numbers.statusValues) === JSON.stringify(expectedCounts(items)) && numbers.total === items.length,
        `expected ${JSON.stringify(expectedCounts(items))} / ${items.length}, got ${JSON.stringify(numbers.statusValues)} / ${numbers.total}`
      );
      check(`${c.name} links to its filtered equipment inventory`, row.includes(`href="/equipment?categoryId=${c.id}"`));
    });

    // ---------- 3. Add category, validation and duplicate protection ----------
    const beforeAdd = dbNow().categories.length;
    res = await admin.post('/categories', { name: NEW_NAME, description: NEW_DESCRIPTION });
    check('Administrator can add a category', res.status === 302 && res.headers.get('location') === '/categories', `status ${res.status}`);
    const created = findCategory(NEW_NAME);
    check('Added category and its real description are saved', !!created && created.description === NEW_DESCRIPTION);
    page = await admin.text('/categories');
    check('Success message is shown after adding', page.body.includes('added.') && page.body.includes(NEW_DESCRIPTION));
    check('Add form is cleared after successful creation', !/id="name"[^>]*value="/.test(page.body) && !/id="description"[^>]*value="/.test(page.body));

    res = await admin.post('/categories', { name: NEW_NAME.toLowerCase(), description: 'Duplicate attempt' });
    check('Duplicate category submission is rejected', res.status === 302);
    check('Duplicate category was not saved', dbNow().categories.length === beforeAdd + 1);
    page = await admin.text('/categories');
    check('Duplicate error message is shown', page.body.includes('already exists.'));

    res = await admin.post('/categories', { name: '   ', description: 'Invalid attempt' });
    check('Empty category name is rejected', res.status === 302 && dbNow().categories.length === beforeAdd + 1);
    page = await admin.text('/categories');
    check('Required-field error message is shown', page.body.includes('Category name is required.'));

    // ---------- 4. Edit category ----------
    page = await admin.text(`/categories?edit=${created.id}`);
    check('Edit form opens inline with the saved values', page.status === 200 && page.body.includes(`action="/categories/${created.id}"`) && page.body.includes(`value="${NEW_DESCRIPTION}"`));

    res = await admin.post(`/categories/${created.id}`, { name: EDITED_NAME, description: EDITED_DESCRIPTION });
    check('Administrator can edit a category', res.status === 302 && res.headers.get('location') === '/categories');
    check('Edited values are saved', !!findCategory(EDITED_NAME) && findCategory(EDITED_NAME).description === EDITED_DESCRIPTION);
    page = await admin.text('/categories');
    check('Updated list and success message reflect the edit', page.body.includes(EDITED_NAME) && page.body.includes(EDITED_DESCRIPTION) && page.body.includes('Category updated.') && !page.body.includes(NEW_NAME));

    res = await admin.post(`/categories/${created.id}`, { name: 'computers', description: 'Duplicate edit attempt' });
    check('Editing to an existing category name is rejected', res.status === 302 && findCategory(EDITED_NAME) && findCategory(EDITED_NAME).description === EDITED_DESCRIPTION);
    page = await admin.text('/categories');
    check('Duplicate edit error message is shown', page.body.includes('already exists.'));

    // ---------- 5. Category filtering ----------
    const categoryOneItems = dbNow().equipment.filter((e) => e.categoryId === 1);
    page = await admin.text('/equipment?categoryId=1');
    check('Category link filter opens the equipment inventory', page.status === 200 && page.body.includes('<option value="1" selected>Computers</option>'));
    check(
      'Filter shows only equipment assigned to the category',
      occurrences(page.body, 'data-label="Equipment ID"') === categoryOneItems.length,
      `expected ${categoryOneItems.length} rows`
    );

    // ---------- 6. Delete protection and successful delete ----------
    const assigned = findCategory('Computers');
    const assignedCount = dbNow().equipment.filter((e) => e.categoryId === assigned.id).length;
    res = await admin.post(`/categories/${assigned.id}/delete`);
    check('Deleting an assigned category is blocked', res.status === 302 && !!findCategory('Computers'));
    page = await admin.text('/categories');
    check('Blocked delete explains why', page.body.includes(`is used by ${assignedCount} equipment item(s)`));

    res = await admin.post(`/categories/${created.id}/delete`);
    check('Administrator can delete an unused category', res.status === 302 && !findCategory(EDITED_NAME));
    page = await admin.text('/categories');
    check(
      'Deleted category disappears with a success message',
      !categoryRow(page.body, EDITED_NAME) && page.body.includes('deleted.')
    );
    check(
      'Category count updates immediately',
      occurrences(page.body, 'class="category-link"') === dbNow().categories.length,
      `expected ${dbNow().categories.length} category rows`
    );

    // ---------- 7. Existing data is intact ----------
    const after = dbNow();
    check('Original categories remain intact', initial.categories.every((c) => after.categories.some((r) => r.id === c.id && r.name === c.name && r.description === c.description)));
    check('No sample categories or equipment were created', after.categories.length === initial.categories.length && after.equipment.length === initial.equipment.length);
    check('All equipment still belongs to an existing category', after.equipment.every((e) => after.categories.some((c) => c.id === e.categoryId)));
    check('User records were not changed', after.users.length === initial.users.length);
  } catch (err) {
    check('Verification ran without exceptions', false, err && err.stack ? err.stack : String(err));
  } finally {
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill();
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  results.forEach((r) => {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.detail && !r.ok ? '  [' + r.detail + ']' : ''}`);
  });
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exitCode = 1;
}

run();
