// Feature 12: Repair Documentation (photo uploads).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');
const { str } = require('./helpers');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};
const MAX_FILES = 6;

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ALLOWED[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_FILES },
  fileFilter: (req, file, cb) =>
    ALLOWED[file.mimetype] ? cb(null, true) : cb(new Error('Only JPG, PNG, GIF, or WEBP images are allowed.')),
});

function removeFiles(files) {
  for (const f of files || []) {
    fs.unlink(f.path, () => {});
  }
}

// Accepts up to 6 photos in the `photos` field. Errors are put on req.uploadError
// so the route can show a friendly message instead of crashing.
function photos(field = 'photos') {
  return (req, res, next) => {
    upload.array(field, MAX_FILES)(req, res, (err) => {
      if (err) {
        removeFiles(req.files);
        req.files = [];
        if (err.code === 'LIMIT_FILE_SIZE') req.uploadError = 'Each photo must be 5 MB or smaller.';
        else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
          req.uploadError = `You can upload up to ${MAX_FILES} photos at a time.`;
        else req.uploadError = err.message;
      }
      req.body = req.body || {};
      next();
    });
  };
}

function saveAttachments(files, { requestId, userId, stage, note }) {
  return (files || []).map((f) =>
    db.insert('attachments', {
      requestId,
      userId,
      stage: stage === 'after' ? 'after' : 'before',
      filename: f.filename,
      originalName: str(f.originalname, 200),
      size: f.size,
      note: str(note, 1000),
    })
  );
}

// Accepts a single photo in the given field (e.g. equipment photo or user avatar).
function singlePhoto(field = 'photo') {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err) {
        if (req.file) fs.unlink(req.file.path, () => {});
        req.file = null;
        if (err.code === 'LIMIT_FILE_SIZE') req.uploadError = 'Photo must be 5 MB or smaller.';
        else req.uploadError = err.message;
      }
      req.body = req.body || {};
      next();
    });
  };
}

module.exports = { photos, singlePhoto, saveAttachments, removeFiles, UPLOAD_DIR };
