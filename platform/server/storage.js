// ============================================================
//  storage.js — where uploaded files live and how they are protected
//
//  uploads/public  → images published on the public feed
//                    (intentionally visible to guests — they are
//                    published content, like the posts themselves)
//  uploads/private → album photos & chat attachments
//                    (club members only, served through
//                    HMAC-signed URLs that expire after 24h)
//
//  Rules of this module:
//   - disk names are RANDOM (the original filename never touches
//     disk; it is kept in the DB for display only)
//   - every DB deletion must call deleteUpload() so no orphan
//     file is left behind
//   - sharing an album photo to the public feed COPIES the file
//     into /uploads/public so the album keeps its own copy
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { JWT_SECRET } = require('./middleware/auth');

const UPLOAD_ROOT = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(UPLOAD_ROOT, 'public');
const PRIVATE_DIR = path.join(UPLOAD_ROOT, 'private');

const SIGN_TTL_SECONDS = 24 * 60 * 60; // private files stay reachable 24h

function ensureDirs() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.mkdirSync(PRIVATE_DIR, { recursive: true });
}

// ---- filenames: random + extension only, original kept in the DB ----
function randomName(original) {
  const ext = path.extname(original || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const safeExt = /^[.a-z0-9]{1,8}$/.test(ext) ? ext : '';
  return `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}${safeExt}`;
}

// multer storage for either tree: makeStorage('public' | 'private')
function makeStorage(which) {
  const dir = which === 'public' ? PUBLIC_DIR : PRIVATE_DIR;
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => cb(null, randomName(file.originalname)),
  });
}

// ---- signed URLs for /uploads/private ----
function signature(relPath, expires) {
  return crypto.createHmac('sha256', JWT_SECRET)
    .update(`${relPath}|${expires}`).digest('base64url');
}

// DB path → ready-to-use URL (public paths pass through untouched)
function signPath(relPath) {
  if (!relPath || !relPath.startsWith('/uploads/private/')) return relPath;
  const expires = Math.floor(Date.now() / 1000) + SIGN_TTL_SECONDS;
  return `${relPath}?e=${expires}&s=${signature(relPath, expires)}`;
}

// middleware: only a valid, unexpired signature may read a private file
function verifySignedUpload(req, res, next) {
  const rel = '/uploads/private' + req.path; // req.path excludes the query string
  const expires = Number(req.query.e);
  const given = String(req.query.s || '');
  if (!expires || !given || expires < Math.floor(Date.now() / 1000)) {
    return res.status(401).json({ error: 'This file link has expired — open the page again' });
  }
  let ok = false;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(given), Buffer.from(signature(rel, expires)));
  } catch { ok = false; }
  if (!ok) return res.status(403).json({ error: 'Invalid file signature' });
  next();
}

// ---- file housekeeping ----
function resolveUpload(relPath) {
  if (!relPath || !relPath.startsWith('/uploads/')) return null;
  const rel = relPath.slice('/uploads/'.length);
  const [head, ...rest] = rel.split('/');
  const base = head === 'public' ? PUBLIC_DIR : head === 'private' ? PRIVATE_DIR : UPLOAD_ROOT;
  const file = path.resolve(base, ...(head === 'public' || head === 'private' ? rest : [head, ...rest]));
  // never escape the uploads tree
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}

function deleteUpload(relPath) {
  const file = resolveUpload(relPath);
  if (!file) return;
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

function copyToPublic(relPath) {
  const src = resolveUpload(relPath);
  if (!src || !fs.existsSync(src)) throw new Error('Source file missing');
  const name = `copy-${randomName(path.extname(relPath))}`;
  fs.copyFileSync(src, path.join(PUBLIC_DIR, name));
  return `/uploads/public/${name}`;
}

// ---- thumbnails (sharp is optional — silently skipped if absent) ----
let _sharp; // undefined = not tried yet, null = unavailable
function getSharp() {
  if (_sharp !== undefined) return _sharp;
  try { _sharp = require('sharp'); } catch { _sharp = null; }
  return _sharp;
}

// 800px webp version for grids/previews; returns '' when sharp is absent
async function makeThumb(srcAbsPath, label) {
  const sharp = getSharp();
  if (!sharp) return '';
  const name = `thumb-${randomName(label)}.webp`;
  await sharp(srcAbsPath).rotate() // honor EXIF orientation (phone photos)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(PRIVATE_DIR, name));
  return `/uploads/private/${name}`;
}

// ---- one-time move of legacy files (flat uploads/ → public/ | private/) ----
function migrateLegacyUploads(db) {
  ensureDirs();
  let moved = 0;
  const upd = (table, col) => db.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`);
  const moveOne = (rel, dir) => {
    if (!rel || !rel.startsWith('/uploads/')
      || rel.startsWith('/uploads/public/') || rel.startsWith('/uploads/private/')) return rel;
    const oldFile = path.join(UPLOAD_ROOT, rel.slice('/uploads/'.length));
    const name = path.basename(oldFile);
    const prefix = dir === PUBLIC_DIR ? '/uploads/public/' : '/uploads/private/';
    try {
      if (fs.existsSync(oldFile)) {
        fs.renameSync(oldFile, path.join(dir, name));
        moved += 1;
      }
      return prefix + name;
    } catch { return rel; }
  };
  const migrate = (table, col, dir) => {
    const statement = upd(table, col);
    db.prepare(`SELECT ${col} AS p FROM ${table} WHERE ${col} LIKE '/uploads/%'`)
      .all().forEach((row) => {
        const next = moveOne(row.p, dir);
        if (next !== row.p) statement.run(next, row.p);
      });
  };
  migrate('posts', 'image', PUBLIC_DIR);          // published → public
  migrate('album_media', 'file_path', PRIVATE_DIR); // albums → private
  migrate('album_media', 'thumb_path', PRIVATE_DIR);
  migrate('messages', 'attachment', PRIVATE_DIR);   // chat → private
  if (moved) console.log(`Media storage: moved ${moved} legacy file(s) into uploads/public|private.`);
}

module.exports = {
  UPLOAD_ROOT, PUBLIC_DIR, PRIVATE_DIR,
  ensureDirs, makeStorage,
  signPath, verifySignedUpload,
  deleteUpload, copyToPublic, makeThumb,
  migrateLegacyUploads,
};
