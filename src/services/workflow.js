// Central repair-workflow rules. Every status change goes through here so
// roles, stages, proof, and duplicate submissions are enforced on the server.
const db = require('../db');
const C = require('../constants');
const { str } = require('../helpers');
const { saveAttachments } = require('../upload');

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

function isRework(r) {
  return r.verificationStatus === 'Rework Required' && r.status !== 'Completed';
}

function assertAssign(r, user, { reassign = false, reason = '' } = {}) {
  requireAdmin(user);
  if (['Completed', 'Cancelled', 'Rejected'].includes(r.status)) fail('This repair can no longer be assigned.');
  if (r.verificationStatus === 'Verified') fail('A verified repair cannot be reassigned.');
  if (!reassign && r.assignedAt && r.technicianId) fail('This repair is already assigned. Use reassign if needed.');
  if (reassign && !str(reason)) fail('A reason is required when reassigning.');
  if (!reassign && !C.ASSIGNABLE_STATUSES.includes(r.status)) fail('Only reported or pending repairs can be assigned.');
}

function assertReject(r, user, reason) {
  requireAdmin(user);
  if (!['Reported', 'Pending', 'Approved'].includes(r.status)) fail('Only reported repairs can be rejected.');
  if (!str(reason)) fail('A rejection reason is required.');
}

function assertStart(r, user, { rework = false } = {}) {
  requireMaintenance(user, r);
  if (r.verificationStatus === 'Verified') fail('This repair is already verified.');
  if (rework) {
    if (!isRework(r)) fail('There is no rework pending on this repair.');
    return;
  }
  if (r.verificationStatus === 'Awaiting Verification') fail('This repair is already awaiting verification.');
  if (!C.STARTABLE_STATUSES.includes(r.status)) fail('This repair cannot be started from its current status.');
  if (r.startedAt) fail('This repair has already been started.');
}

function assertMaterials(r, user) {
  requireMaintenance(user, r);
  if (r.verificationStatus === 'Verified') fail('Materials cannot be added to a verified repair.');
  if (!['In Progress', 'On Hold', 'Nearing Completion'].includes(r.status) && !isRework(r)) {
    fail('Materials can only be recorded while work is in progress.');
  }
}

function assertNearing(r, user) {
  requireMaintenance(user, r);
  if (r.verificationStatus === 'Verified') fail('This repair is already verified.');
  if (!C.NEARING_STATUSES.includes(r.status) && !isRework(r)) fail('Only an in-progress repair can be moved to Nearing Completion.');
}

function assertComplete(r, user, { rework = false } = {}) {
  requireMaintenance(user, r);
  if (r.verificationStatus === 'Verified') fail('This repair is already verified.');
  if (rework) {
    if (!isRework(r)) fail('There is no rework pending on this repair.');
    return;
  }
  if (r.verificationStatus === 'Awaiting Verification') fail('This repair is already awaiting verification.');
  if (r.status !== 'Nearing Completion') fail('Complete after marking the repair as Nearing Completion.');
}

function assertVerify(r, user) {
  requireAdmin(user);
  if (r.status !== 'Completed') fail('Only a completed repair can be verified.');
  if (r.verificationStatus !== C.AWAITING_VERIFICATION) fail('This repair is not awaiting verification.');
}

function assertRework(r, user, reason) {
  requireAdmin(user);
  if (r.status !== 'Completed' || r.verificationStatus !== C.AWAITING_VERIFICATION) {
    fail('Only a repair awaiting verification can be returned for rework.');
  }
  if (!str(reason)) fail('A rework reason is required.');
}

function assertReporter(user, r) {
  if (!user || user.role !== 'requester' || r.requesterId !== user.id) fail('You cannot report an issue for another account.');
}

module.exports = {
  fail, getReport, requireAdmin, requireMaintenance, checkUpload, proof, materialProofs,
  isRework, assertAssign, assertReject, assertStart, assertMaterials, assertNearing,
  assertComplete, assertVerify, assertRework, assertReporter,
};
