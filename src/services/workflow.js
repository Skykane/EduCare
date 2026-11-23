// Central repair-workflow rules. Every status change goes through here so
// roles, stages, proof, and duplicate submissions are enforced on the server.
// Only the seven canonical C.STATUS values may be written by new code.
const db = require('../db');
const C = require('../constants');
const { str } = require('../helpers');
const { saveAttachments } = require('../upload');
const { syncTechnicianAvailability } = require('./assignment');

function fail(message) {
  const err = new Error(message);
  err.workflowError = true;
  throw err;
}

function getReport(id) {
  const r = db.find('requests', id);
  if (!r) fail('Repair report not found.');
  return r;
}

function requireAdmin(user) {
  if (!user || user.role !== 'admin') fail('Only an administrator can perform this action.');
}

function requireMaintenance(user, r) {
  if (!user || user.role !== 'technician') fail('Only maintenance personnel can perform this action.');
  if (r.technicianId !== user.id) fail('This repair is not assigned to you.');
}

function checkUpload(req) {
  if (req.uploadError) fail(req.uploadError);
}

function proof(req, { requestId, userId, stage, note = '', attemptId = null, materialId = null }) {
  const files = (req.files && req.files.photos) || [];
  if (!files.length) fail('Picture proof is required.');
  return saveAttachments(files, { requestId, userId, stage, note, attemptId, materialId });
}

function materialProofs(req, requestId, userId, attemptId = null) {
  const files = (req.files && req.files.materialPhotos) || [];
  return files.map((f) => saveAttachments([f], {
    requestId, userId, stage: 'material', note: 'material proof', attemptId,
  })[0]);
}

function statusOf(r) {
  return C.normalizeStatus(r.status, r);
}

function isRework(r) {
  return r.verificationStatus === 'Rework Required' && statusOf(r) !== C.STATUS.COMPLETED;
}

function reasonText(value, label, { min = 1, max = 1000 } = {}) {
  const text = str(value, max);
  if (text.length < min) {
    fail(min > 1
      ? `A ${label.toLowerCase()} reason of at least ${min} characters is required.`
      : `A ${label.toLowerCase()} reason is required.`);
  }
  return text;
}

// A technician may only take a new assignment when actually available.
function assertTechnicianAvailable(technicianId, { currentTechnicianId = null } = {}) {
  const tech = db.find('users', technicianId);
  if (!tech || tech.role !== 'technician' || tech.active === false) {
    fail('Please choose an active technician.');
  }
  if (currentTechnicianId !== null && Number(tech.id) === Number(currentTechnicianId)) {
    fail('Choose a different technician when reassigning.');
  }
  if ((tech.availability || 'Available') !== 'Available') {
    fail(`${tech.name} is currently ${tech.availability || 'unavailable'} and cannot take a new assignment.`);
  }
  return tech;
}

// Admin review is a distinct step: approval never selects or assigns a technician.
function assertApprove(r, user) {
  requireAdmin(user);
  if (statusOf(r) !== C.STATUS.PENDING_APPROVAL) {
    fail('Only a report awaiting approval can be approved.');
  }
  if (r.technicianId) {
    fail('This report already has a technician; use reassignment instead.');
  }
}

/**
 * First assignment is only legal from Approved – Awaiting Assignment.
 * Reassignment is a separate admin action from Assigned and needs a reason,
 * a different technician, and the same availability rule.
 */
function assertAssign(r, user, { reassign = false, reason = '', technicianId = null } = {}) {
  requireAdmin(user);
  const status = statusOf(r);
  if ([C.STATUS.COMPLETED, C.STATUS.REJECTED].includes(status)) {
    fail('This repair can no longer be assigned.');
  }
  if (r.verificationStatus === 'Verified') {
    fail('A verified repair cannot be reassigned.');
  }

  if (reassign) {
    if (!r.technicianId) fail('This repair has no technician to reassign.');
    if (status !== C.STATUS.ASSIGNED) fail('Only an assigned repair can be reassigned.');
    reasonText(reason, 'Reassignment');
    if (technicianId !== null) assertTechnicianAvailable(technicianId, { currentTechnicianId: r.technicianId });
  } else {
    if (r.technicianId) fail('This repair is already assigned. Use reassign if needed.');
    if (!C.ASSIGNABLE_STATUSES.includes(status)) {
      fail('Only a repair that is approved and awaiting assignment can be assigned.');
    }
    if (technicianId !== null) assertTechnicianAvailable(technicianId);
  }
  return technicianId !== null ? db.find('users', technicianId) : null;
}

function assertReject(r, user, reason) {
  requireAdmin(user);
  const status = statusOf(r);
  // Assigned may be rejected only before work has actually started.
  const allowed = [C.STATUS.PENDING_APPROVAL, C.STATUS.APPROVED_AWAITING_ASSIGNMENT];
  if (status === C.STATUS.ASSIGNED && !r.startedAt) allowed.push(C.STATUS.ASSIGNED);
  if (!allowed.includes(status)) {
    fail('Only a report awaiting approval or assignment can be rejected.');
  }
  return reasonText(reason, 'Rejection', { min: 5 });
}

function assertStart(r, user, { rework = false } = {}) {
  requireMaintenance(user, r);
  if (r.verificationStatus === 'Verified') fail('This repair is already verified.');
  if (rework) {
    if (!isRework(r)) fail('There is no rework pending on this repair.');
    return;
  }
  if (r.verificationStatus === C.AWAITING_VERIFICATION) {
    fail('This repair is already awaiting verification.');
  }
  if (!C.STARTABLE_STATUSES.includes(statusOf(r))) {
    fail('Only an assigned repair can be started.');
  }
  if (r.startedAt) fail('This repair has already been started.');
}

function assertHold(r, user, reason) {
  requireMaintenance(user, r);
  if (statusOf(r) !== C.STATUS.IN_PROGRESS) {
    fail('Only an in-progress repair can be put on hold.');
  }
  return reasonText(reason, 'Hold');
}

function assertResume(r, user) {
  requireMaintenance(user, r);
  if (statusOf(r) !== C.STATUS.ON_HOLD) {
    fail('Only a repair on hold can be resumed.');
  }
}

function assertStatusAction(r, user, action, reason = '') {
  if (action === 'start') return assertStart(r, user);
  if (action === 'hold') return assertHold(r, user, reason);
  if (action === 'resume') return assertResume(r, user);
  fail('Unknown status action.');
}

function assertMaterials(r, user) {
  requireMaintenance(user, r);
  if (r.verificationStatus === 'Verified') fail('Materials cannot be added to a verified repair.');
  if (![C.STATUS.IN_PROGRESS, C.STATUS.ON_HOLD].includes(statusOf(r)) && !isRework(r)) {
    fail('Materials can only be recorded while work is in progress.');
  }
}

// Kept only so an old caller cannot silently change status: Nearing Completion
// is no longer part of the primary workflow.
function assertNearing() {
  fail('Nearing Completion is no longer part of the repair workflow.');
}

function assertComplete(r, user, { rework = false } = {}) {
  requireMaintenance(user, r);
  if (r.verificationStatus === 'Verified') fail('This repair is already verified.');
  if (rework) {
    if (!isRework(r)) fail('There is no rework pending on this repair.');
    return;
  }
  if (![C.STATUS.IN_PROGRESS, C.STATUS.ON_HOLD].includes(statusOf(r))) {
    fail('Only an in-progress or on-hold repair can be completed.');
  }
}

function assertVerify(r, user) {
  requireAdmin(user);
  if (statusOf(r) !== C.STATUS.COMPLETED) fail('Only a completed repair can be verified.');
  if (r.verificationStatus !== C.AWAITING_VERIFICATION) fail('This repair is not awaiting verification.');
}

function assertRework(r, user, reason) {
  requireAdmin(user);
  if (statusOf(r) !== C.STATUS.COMPLETED || r.verificationStatus !== C.AWAITING_VERIFICATION) {
    fail('Only a repair awaiting verification can be returned for rework.');
  }
  return reasonText(reason, 'Rework');
}

function assertReporter(user, r) {
  if (!user || user.role !== 'requester' || r.requesterId !== user.id) {
    fail('You cannot report an issue for another account.');
  }
}

module.exports = {
  fail, getReport, requireAdmin, requireMaintenance, checkUpload, proof, materialProofs,
  statusOf, isRework, reasonText, assertTechnicianAvailable, assertApprove, assertAssign,
  assertReject, assertStart, assertHold, assertResume, assertStatusAction, assertMaterials,
  assertNearing, assertComplete, assertVerify, assertRework, assertReporter,
  syncTechnicianAvailability,
};
