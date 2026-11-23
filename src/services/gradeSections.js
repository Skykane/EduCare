// Grade/section configuration for high-school student accounts.
// Sections are administrator-managed records in the main JSON database so the
// management screen and the registration dropdown read the same source of truth.
// Registration only ever receives ACTIVE records and never invents options.
const fs = require('fs');
const path = require('path');
const db = require('../db');
const C = require('../constants');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const LEGACY_FILE = path.join(DATA_DIR, 'grade-sections.json');

const VALID_GRADES = C.STUDENT_GRADE_LEVELS;
const MAX_SECTION_LENGTH = 50;

let migratedFor = null;

function gradeKey(grade) {
  return String(grade == null ? '' : grade).trim();
}

function cleanSection(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_SECTION_LENGTH);
}

function normalizeSection(value) {
  return cleanSection(value).toLocaleLowerCase();
}

function isValidGrade(grade) {
  return VALID_GRADES.includes(gradeKey(grade));
}

function isActive(row) {
  return !!row && row.active !== false;
}

function compareRows(a, b) {
  const ga = VALID_GRADES.indexOf(gradeKey(a.gradeLevel));
  const gb = VALID_GRADES.indexOf(gradeKey(b.gradeLevel));
  if (ga !== gb) return ga - gb;
  return cleanSection(a.section).localeCompare(cleanSection(b.section));
}

// Older EduCare builds kept sections in a standalone grade-sections.json file.
// Import those once into the database without deleting or changing that file,
// so existing administrator configuration is preserved on upgrade.
function migrateLegacySections() {
  if (migratedFor === LEGACY_FILE) return;
  migratedFor = LEGACY_FILE;

  if (!fs.existsSync(LEGACY_FILE)) return;
  if (db.all('gradeSections').length) return;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
  } catch (err) {
    console.error(`Could not read legacy grade sections (${LEGACY_FILE}):`, err.message);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

  for (const grade of VALID_GRADES) {
    const raw = parsed[grade];
    if (!Array.isArray(raw)) continue;
    for (const value of raw) {
      const section = cleanSection(value);
      if (!section || hasSection(grade, section)) continue;
      db.insert('gradeSections', { gradeLevel: grade, section, active: true });
    }
  }
}

function getAllSections() {
  migrateLegacySections();
  return db.all('gradeSections').slice().sort(compareRows);
}

function findSection(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  return getAllSections().find((r) => r.id === n) || null;
}

function hasSection(grade, section, excludeId) {
  const key = gradeKey(grade);
  const needle = normalizeSection(section);
  return getAllSections().some(
    (r) =>
      gradeKey(r.gradeLevel) === key &&
      normalizeSection(r.section) === needle &&
      (excludeId == null || Number(r.id) !== Number(excludeId))
  );
}

// Grouped view used by the administrator management screen.
function getGradeSections() {
  const config = {};
  for (const grade of VALID_GRADES) config[grade] = [];
  for (const row of getAllSections()) {
    const key = gradeKey(row.gradeLevel);
    if (config[key]) config[key].push(row);
  }
  return config;
}

function getSectionsForGrade(grade) {
  const key = gradeKey(grade);
  if (!isValidGrade(key)) return [];
  return getGradeSections()[key].filter(isActive).map((r) => r.section);
}

// The registration form submits one combined value so the browser never has
// to manage two dependent selects. Encoding keeps section names with spaces,
// hyphens, or delimiter-like characters safe.
function makeOptionValue(grade, section) {
  return `${encodeURIComponent(gradeKey(grade))}|${encodeURIComponent(cleanSection(section))}`;
}

function parseOptionValue(raw) {
  const parts = String(raw == null ? '' : raw).split('|');
  if (parts.length !== 2 || !parts[0]) return null;
  try {
    return {
      gradeLevel: gradeKey(decodeURIComponent(parts[0])),
      // An empty section is parsed so backend validation can report the
      // section-specific error instead of mislabelling it as a bad grade.
      section: cleanSection(decodeURIComponent(parts[1])),
    };
  } catch (err) {
    return null;
  }
}

// One option per ACTIVE grade/section pair, ordered Grade 7 -> Grade 12.
// Nothing is hardcoded here: an empty database produces no options.
function getGradeSectionOptions() {
  const options = [];
  for (const grade of VALID_GRADES) {
    for (const section of getSectionsForGrade(grade)) {
      options.push({
        grade,
        section,
        value: makeOptionValue(grade, section),
        label: `${grade} - ${section}`,
      });
    }
  }
  return options;
}

function validateInput(grade, section, excludeId) {
  const key = gradeKey(grade);
  const value = cleanSection(section);
  if (!isValidGrade(key)) {
    return { error: 'Select a grade from Grade 7 to Grade 12.' };
  }
  if (!value) {
    return { error: 'Enter a section name.' };
  }
  if (String(section == null ? '' : section).trim().length > MAX_SECTION_LENGTH) {
    return { error: `Section names must be ${MAX_SECTION_LENGTH} characters or fewer.` };
  }
  if (hasSection(key, value, excludeId)) {
    return { error: `A section named "${value}" is already configured for ${key}.` };
  }
  return { gradeLevel: key, section: value };
}

function addSection(grade, section) {
  const valid = validateInput(grade, section);
  if (valid.error) return { ok: false, error: valid.error };
  const row = db.insert('gradeSections', {
    gradeLevel: valid.gradeLevel,
    section: valid.section,
    active: true,
  });
  return { ok: true, row };
}

function updateSection(id, grade, section) {
  const row = findSection(id);
  if (!row) return { ok: false, error: 'That section no longer exists.' };
  const valid = validateInput(grade, section, row.id);
  if (valid.error) return { ok: false, error: valid.error };
  const updated = db.update('gradeSections', row.id, {
    gradeLevel: valid.gradeLevel,
    section: valid.section,
  });
  return { ok: true, row: updated };
}

function setSectionActive(id, active) {
  const row = findSection(id);
  if (!row) return { ok: false, error: 'That section no longer exists.' };
  return { ok: true, row: db.update('gradeSections', row.id, { active: !!active }) };
}

function formatGradeSection(grade, section) {
  const g = gradeKey(grade);
  const s = cleanSection(section);
  return g && s ? `${g} – ${s}` : (g || s || '');
}

function getGroupedGradeSectionOptions() {
  return [
    {
      group: 'Junior High School (Grades 7–10)',
      options: getGradeSectionOptions().filter((o) => ['Grade 7','Grade 8','Grade 9','Grade 10'].includes(o.grade)),
    },
    {
      group: 'Senior High School (Grades 11–12)',
      options: getGradeSectionOptions().filter((o) => ['Grade 11','Grade 12'].includes(o.grade)),
    },
  ].filter((g) => g.options.length);
}

module.exports = {
  GRADES: VALID_GRADES,
  LEGACY_FILE,
  MAX_SECTION_LENGTH,
  cleanSection,
  isValidGrade,
  isActive,
  findSection,
  getGradeSections,
  getSectionsForGrade,
  makeOptionValue,
  parseOptionValue,
  getGradeSectionOptions,
  getGroupedGradeSectionOptions,
  formatGradeSection,
  addSection,
  updateSection,
  setSectionActive,
};
