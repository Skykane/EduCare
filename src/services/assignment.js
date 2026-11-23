// Feature 16: Smart Technician Assignment.
//
// Each technician gets a match score (0–100):
//   specialization matches the equipment category  → 50 pts (general technician with no specialization → 15)
//   availability: Available → 30, Busy → 10, On Leave → not recommended
//   workload: 20 pts minus 5 per active task (minimum 0)
const db = require('../db');
const C = require('../constants');

// Technicians at or above this many active tasks are flagged as overloaded.
const HIGH_WORKLOAD_AT = 3;

function activeTaskCount(technicianId) {
  if (technicianId === undefined || technicianId === null || technicianId === '') return 0;
  return db.where(
    'requests',
    (r) => Number(r.technicianId) === Number(technicianId) &&
      C.TECH_ACTIVE_STATUSES.includes(C.normalizeStatus(r.status, r))
  ).length;
}

/**
 * Recalculate a technician's availability after an assignment or completion.
 * The rule is: any active assignment means Busy, none means Available. Manual
 * availability edits stay possible, but the next workflow change recalculates
 * them (including an On Leave override).
 */
function syncTechnicianAvailability(technicianId) {
  if (technicianId === undefined || technicianId === null || technicianId === '') return null;
  const tech = db.find('users', technicianId);
  if (!tech || tech.role !== 'technician') return null;
  const activeCount = activeTaskCount(tech.id);
  const availability = activeCount > 0 ? 'Busy' : 'Available';
  if (tech.availability === availability) return tech;
  return db.update('users', tech.id, { availability });
}

function recommendTechnicians(equipment) {
  const categoryId = equipment ? equipment.categoryId : null;
  const category = categoryId ? db.find('categories', categoryId) : null;
  const techs = db.where('users', (u) => u.role === 'technician' && u.active);

  const results = techs.map((t) => {
    const specs = t.specializations || [];
    const reasons = [];
    let specPts = 0;
    if (categoryId && specs.includes(categoryId)) {
      specPts = 50;
      reasons.push(`Specializes in ${category ? category.name : 'this category'}`);
    } else if (specs.length === 0) {
      specPts = 15;
      reasons.push('General technician');
    } else {
      reasons.push('No matching specialization');
    }

    const availability = t.availability || 'Available';
    const eligible = availability !== 'On Leave';
    const availPts = availability === 'Available' ? 30 : availability === 'Busy' ? 10 : 0;
    reasons.push(availability === 'On Leave' ? 'Currently on leave' : `Status: ${availability}`);

    const active = activeTaskCount(t.id);
    const loadPts = Math.max(0, 20 - active * 5);
    const workloadWarning = active >= HIGH_WORKLOAD_AT;
    reasons.push(`${active} active task(s)${workloadWarning ? ' (high workload)' : ''}`);

    return {
      technician: t,
      score: eligible ? specPts + availPts + loadPts : 0,
      specMatch: specPts === 50,
      availability,
      active,
      workloadWarning,
      eligible,
      reasons,
    };
  });

  results.sort((a, b) => b.eligible - a.eligible || b.score - a.score || a.active - b.active);
  if (results.length && results[0].eligible) results[0].best = true;
  return results;
}

module.exports = { recommendTechnicians, activeTaskCount, syncTechnicianAvailability, HIGH_WORKLOAD_AT };
