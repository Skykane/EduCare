// Feature 12: Repair Documentation (photo uploads).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');
const C = require('./constants');
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
const MAX_TOTAL_FILES = 20;

// Profile pictures have stricter rules than repair photos: JPG/JPEG/PNG/WEBP
// only, one file, and the bytes must actually match the declared image type.
const AVATAR_ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const AVATAR_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ALLOWED[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_TOTAL_FILES },
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
function photos(field = 'photos', maxFiles = MAX_FILES) {
  return (req, res, next) => {
    upload.array(field, maxFiles)(req, res, (err) => {
      if (err) {
        removeFiles(req.files);
        req.files = [];
        if (err.code === 'LIMIT_FILE_SIZE') req.uploadError = 'Each photo must be 5 MB or smaller.';
        else if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')
          req.uploadError = `You can upload up to ${maxFiles} photos at a time.`;
        else req.uploadError = err.message;
      }
      // Repair photos must really be images, not just a claimed mimetype.
      if (!req.uploadError && (req.files || []).length) {
        const valid = [];
        for (const f of req.files) {
          try {
            if (!hasValidImageSignature(fs.readFileSync(f.path), f.mimetype)) throw new Error('Invalid image');
            valid.push(f);
          } catch (e) {
            fs.unlink(f.path, () => {});
          }
        }
        if (valid.length !== req.files.length) {
          req.uploadError = 'One or more files are not valid JPG, PNG, GIF, or WEBP images.';
        }
        req.files = valid;
      }
      req.body = req.body || {};
      next();
    });
  };
}

// Repair workflow actions carry action proof plus one photo per material item.
function workflowPhotos() {
  return (req, res, next) => {
    const fields = [
      { name: 'photos', maxFiles: MAX_FILES },
      { name: 'materialPhotos', maxFiles: MAX_FILES * 3 },
    ];
    upload.fields(fields)(req, res, (err) => {
      req.body = req.body || {};
      if (err) {
        const all = Object.values(req.files || {}).flat();
        removeFiles(all);
        req.files = { photos: [], materialPhotos: [] };
        req.uploadError = err.code === 'LIMIT_FILE_SIZE'
          ? 'Each photo must be 5 MB or smaller.'
          : err.message || 'Invalid photo upload.';
        return next();
      }
      for (const [field, files] of Object.entries(req.files || {})) {
        const valid = [];
        for (const f of files) {
          try {
            if (!hasValidImageSignature(fs.readFileSync(f.path), f.mimetype)) throw new Error('Invalid image');
            valid.push(f);
          } catch (e) {
            fs.unlink(f.path, () => {});
          }
        }
        if (valid.length !== files.length && !req.uploadError) {
          req.uploadError = 'One or more files are not valid JPG, PNG, GIF, or WEBP images.';
        }
        req.files[field] = valid;
      }
      next();
    });
  };
}

function saveAttachments(files, { requestId, userId, stage, note, attemptId = null, materialId = null }) {
  const safeStage = C.PROOF_STAGES.includes(stage) ? stage : 'before';
  return (files || []).map((f) =>
    db.insert('attachments', {
      requestId,
      userId,
      stage: safeStage,
      attemptId,
      materialId,
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
        req.body = req.body || {};
        return next();
      }
      if (req.file) {
        try {
          if (!hasValidImageSignature(fs.readFileSync(req.file.path), req.file.mimetype)) {
            throw new Error('The selected file is not a valid JPG, PNG, GIF, or WEBP image.');
          }
        } catch (e) {
          fs.unlink(req.file.path, () => {});
          req.file = null;
          req.uploadError = e.message || 'The selected file could not be read as an image.';
        }
      }
      req.body = req.body || {};
      next();
    });
  };
}

function hasValidImageSignature(bytes, mimetype) {
  if (!bytes || bytes.length < 12) return false;
  if (mimetype === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimetype === 'image/png') {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (mimetype === 'image/webp') {
    return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  if (mimetype === 'image/gif') {
    const sig = String.fromCharCode(...bytes.slice(0, 6));
    return sig === 'GIF87a' || sig === 'GIF89a';
  }
  return false;
}

// Accepts one profile picture in the `avatar` field. The cropper in the Edit
// Profile modal sends an already squared/cropped canvas image, but direct form
// uploads still work as a no-JavaScript fallback.
function avatarPhoto(field = 'avatar') {
  const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = AVATAR_ALLOWED[file.mimetype] || path.extname(file.originalname).toLowerCase();
      cb(null, `avatar-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  });
  const middleware = multer({
    storage,
    limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!AVATAR_ALLOWED[file.mimetype] || !AVATAR_EXTENSIONS.has(ext)) {
        return cb(new Error('Only JPG, JPEG, PNG, and WEBP profile pictures are allowed.'));
      }
      cb(null, true);
    },
  });

  return (req, res, next) => {
    middleware.single(field)(req, res, (err) => {
      req.body = req.body || {};
      if (err) {
        if (req.file) fs.unlink(req.file.path, () => {});
        req.file = null;
        if (err.code === 'LIMIT_FILE_SIZE') {
          req.uploadError = `Profile picture must be ${Math.floor(MAX_AVATAR_BYTES / 1024 / 1024)} MB or smaller.`;
        } else {
          req.uploadError = err.message || 'Invalid profile picture upload.';
        }
        return next();
      }
      if (req.file) {
        try {
          const bytes = fs.readFileSync(req.file.path);
          if (!hasValidImageSignature(bytes, req.file.mimetype)) {
            throw new Error('The selected file is not a valid JPG, PNG, or WEBP image.');
          }
        } catch (e) {
          fs.unlink(req.file.path, () => {});
          req.file = null;
          req.uploadError = e.message || 'The selected file could not be read as an image.';
        }
      }
      next();
    });
  };
}

// Parse multipart/form-data text fields when no files are expected. This keeps
// req.body populated for routes that accept both urlencoded and multipart forms.
function formOnly() {
  const middleware = multer().none();
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err) {
        req.uploadError = err.message || 'Invalid form submission.';
      }
      req.body = req.body || {};
      next();
    });
  };
}

module.exports = {
  photos,
  workflowPhotos,
  singlePhoto,
  avatarPhoto,
  formOnly,
  saveAttachments,
  removeFiles,
  UPLOAD_DIR,
  MAX_AVATAR_BYTES,
};
