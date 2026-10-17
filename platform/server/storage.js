// ============================================================
//  storage.js — where uploaded files live and how they are protected
//
//  Two backends, same API (chosen automatically):
//    · local disk (default)  →  uploads/public | uploads/private
//    · Vercel Blob (cloud)   →  keys uploads/public/… | uploads/private/…
//      activated by BLOB_READ_WRITE_TOKEN — used on Vercel where the
//      filesystem is read-only and ephemeral
//
//  uploads/public  → images published on the public feed
//                    (intentionally visible to guests — they are
//                    published content, like the posts themselves)
//  uploads/private → album photos & chat attachments
//                    (club members only, served through
//                    HMAC-signed URLs that expire after 24h)
//
//  Rules of this module:
//   - disk/blob names are RANDOM (the original filename never touches
//     storage; it is kept in the DB for display only)
//   - every DB deletion must call deleteUpload() so no orphan
//     file is left behind
//   - sharing an album photo to the public feed COPIES the file
//     into the public tree so the album keeps its own copy
//   - public files: served straight from the store (Blob URL redirect)
//   - private files: the API PROXIES the bytes after checking the HMAC
//     signature, so the store URL itself is never exposed to the browser
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

// ---- backend selection ----
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const BLOB = !!BLOB_TOKEN;
const blob = () => require('@vercel/blob'); // lazy: local runs never load it
const keyOf = (relPath) => String(relPath).replace(/^\/uploads\//, 'uploads/');

function ensureDirs() {
  if (BLOB) return; // nothing to create in the cloud
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
  if (BLOB) {
    // custom engine: multer streams the upload, we buffer it, push it to
    // Blob, and hand multer the same fields diskStorage would have set
    // (filename/size/path) so route code keeps working unchanged.
    return {
      _handleFile(req, file, cb) {
        const name = randomName(file.originalname);
        const key = `uploads/${which}/${name}`;
        const chunks = [];
        file.stream.on('data', (c) => chunks.push(c));
        file.stream.on('error', (e) => cb(e));
        file.stream.on('end', async () => {
          try {
            const buf = Buffer.concat(chunks);
            await blob().put(key, buf, {
              access: 'public', token: BLOB_TOKEN, contentType: file.mimetype,
            });
            cb(null, { filename: name, size: buf.length, buffer: buf, key });
          } catch (e) { cb(e); }
        });
      },
      _removeFile(req, file, cb) {
        if (!file.key) return cb(null);
        blob().del(file.key, { token: BLOB_TOKEN }).then(() => cb(null), cb);
      },
    };
  }
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

// ---------- cloud serving (Blob backend) ----------
// public files: redirect to the store's public URL (published content)
async function servePublicUpload(req, res) {
  const key = `uploads/public${req.path}`;
  try {
    const meta = await blob().head(key, { token: BLOB_TOKEN });
    res.redirect(302, meta.url);
  } catch { res.status(404).json({ error: 'File not found' }); }
}

// private files: signature already verified — PROXY the bytes so the
// store URL is never handed to the browser
async function servePrivateUpload(req, res) {
  const key = `uploads/private${req.path}`;
  try {
    const meta = await blob().head(key, { token: BLOB_TOKEN });
    const r = await fetch(meta.url);
    if (!r.ok || !r.body) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Type', meta.contentType || 'application/octet-stream');
    if (meta.contentLength) res.setHeader('Content-Length', meta.contentLength);
    res.setHeader('Cache-Control', 'private, max-age=86400'); // matches the 24h signature
    const { Readable } = require('stream');
    Readable.fromWeb(r.body).pipe(res);
  } catch { res.status(404).json({ error: 'File not found' }); }
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

async function deleteUpload(relPath) {
  try {
    if (BLOB) {
      if (!relPath || !relPath.startsWith('/uploads/')) return;
      await blob().del(keyOf(relPath), { token: BLOB_TOKEN });
      return;
    }
    const file = resolveUpload(relPath);
    if (!file) return;
    fs.unlinkSync(file);
  } catch { /* already gone */ }
}

async function copyToPublic(relPath) {
  if (BLOB) {
    if (!relPath || !relPath.startsWith('/uploads/private/')) throw new Error('Source file missing');
    const name = `copy-${randomName(path.extname(relPath))}`;
    await blob().copy(keyOf(relPath), `uploads/public/${name}`, {
      access: 'public', token: BLOB_TOKEN,
    });
    return `/uploads/public/${name}`;
  }
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

// 800px webp version for grids/previews; returns '' when sharp is absent.
// input: a local absolute path, or a Buffer (cloud backend).
async function makeThumb(input, label) {
  const sharp = getSharp();
  if (!sharp) return '';
  const name = `thumb-${randomName(label)}.webp`;
  const pipeline = sharp(input).rotate() // honor EXIF orientation (phone photos)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 });
  if (BLOB) {
    const buf = await pipeline.toBuffer();
    await blob().put(`uploads/private/${name}`, buf, {
      access: 'public', token: BLOB_TOKEN, contentType: 'image/webp',
    });
    return `/uploads/private/${name}`;
  }
  await pipeline.toFile(path.join(PRIVATE_DIR, name));
  return `/uploads/private/${name}`;
}

// copy every stored file into a local folder (Google Drive backup staging).
// local backend: plain recursive copy. Blob backend: list + download.
async function stageUploadsTo(destDir) {
  if (!BLOB) {
    if (fs.existsSync(UPLOAD_ROOT)) fs.cpSync(UPLOAD_ROOT, destDir, { recursive: true });
    return;
  }
  const { list } = blob();
  let cursor;
  do {
    const page = await list({ prefix: 'uploads/', token: BLOB_TOKEN, cursor });
    for (const b of page.blobs) {
      // b.pathname = 'uploads/public/x.png' → destDir/public/x.png
      const rel = b.pathname.replace(/^uploads\//, '');
      const dest = path.join(destDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const r = await fetch(b.url);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    }
    cursor = page.cursor;
  } while (cursor);
}

// ---- one-time move of legacy files (flat uploads/ → public/ | private/) ----
async function migrateLegacyUploads(db) {
  if (BLOB) return; // cloud store never had flat legacy files
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
  const migrate = async (table, col, dir) => {
    const statement = upd(table, col);
    const rows = await db.prepare(`SELECT ${col} AS p FROM ${table} WHERE ${col} LIKE '/uploads/%'`).all();
    for (const row of rows) {
      const next = moveOne(row.p, dir);
      if (next !== row.p) await statement.run(next, row.p);
    }
  };
  await migrate('posts', 'image', PUBLIC_DIR);          // published → public
  await migrate('album_media', 'file_path', PRIVATE_DIR); // albums → private
  await migrate('album_media', 'thumb_path', PRIVATE_DIR);
  await migrate('messages', 'attachment', PRIVATE_DIR);   // chat → private
  if (moved) console.log(`Media storage: moved ${moved} legacy file(s) into uploads/public|private.`);
}

module.exports = {
  UPLOAD_ROOT, PUBLIC_DIR, PRIVATE_DIR, BLOB,
  ensureDirs, makeStorage,
  signPath, verifySignedUpload,
  servePublicUpload, servePrivateUpload,
  deleteUpload, copyToPublic, makeThumb,
  stageUploadsTo,
  migrateLegacyUploads,
};
