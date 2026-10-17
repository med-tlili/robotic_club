// ============================================================
//  routes/media.js — Media: albums + share to public
//  Rules: every club member can BROWSE the albums (they live on
//  the Media home page); guests are blocked. The Media manager
//  (or leaders) creates albums & uploads; "Share to home"
//  republishes a picture to the public feed.
//  Storage (see storage.js): photos live in uploads/private and
//  are only reachable through 24h signed URLs; sharing to the
//  feed COPIES the file into uploads/public (guests may view it).
// ============================================================
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { canManageDept, canViewDept, getDept } = require('../deptPerms');
const {
  makeStorage, signPath, deleteUpload, copyToPublic, makeThumb,
} = require('../storage');

const router = express.Router();
const DEPT_SLUG = 'media';

const storage = makeStorage('private'); // album photos are never public
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// DB row → client row: private paths leave the API already signed
const signMedia = (m) => ({
  ...m,
  file_path: signPath(m.file_path),
  thumb_path: m.thumb_path ? signPath(m.thumb_path) : '',
});

function dept(res) {
  const d = getDept(DEPT_SLUG);
  if (!d) { res.status(404).json({ error: 'Media department not found' }); return null; }
  return d;
}

// GET /api/media/albums — every club member browses albums (guests blocked)
router.get('/albums', authenticate, (req, res) => {
  const d = dept(res); if (!d) return;
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Albums are for club members' });
  }
  const albums = db.prepare(
    'SELECT * FROM albums WHERE department_id = ? ORDER BY created_at DESC',
  ).all(d.id);
  const withMedia = albums.map((a) => ({
    ...a,
    media: db.prepare(
      'SELECT * FROM album_media WHERE album_id = ? ORDER BY created_at DESC',
    ).all(a.id).map(signMedia),
  }));
  res.json(withMedia);
});

// POST /api/media/albums — Media manager / leaders
router.post('/albums', authenticate, (req, res) => {
  const d = dept(res); if (!d) return;
  if (!canManageDept(req.user, d.id)) {
    return res.status(403).json({ error: 'Only the Media manager or club leaders can create albums' });
  }
  const { title, description } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const info = db.prepare(
    'INSERT INTO albums (department_id, title, description, created_by) VALUES (?,?,?,?)',
  ).run(d.id, title.trim(), (description || '').trim(), req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM albums WHERE id = ?').get(info.lastInsertRowid));
});

// POST /api/media/albums/:id/media — upload an image into an album
router.post('/albums/:id/media', authenticate, (req, res) => {
  const d = dept(res); if (!d) return;
  if (!canManageDept(req.user, d.id)) {
    return res.status(403).json({ error: 'Only the Media manager or club leaders can upload' });
  }
  const album = db.prepare('SELECT * FROM albums WHERE id = ? AND department_id = ?')
    .get(req.params.id, d.id);
  if (!album) return res.status(404).json({ error: 'Album not found' });
  upload.single('file')(req, res, async (err) => {
    if (err || !req.file) return res.status(400).json({ error: 'Image required (max 20MB)' });
    // 800px webp preview for the grids; the original stays for the opened view
    let thumbPath = '';
    try { thumbPath = await makeThumb(req.file.path, req.file.originalname); } catch { thumbPath = ''; }
    const info = db.prepare(
      'INSERT INTO album_media (album_id, file_path, thumb_path, caption) VALUES (?,?,?,?)',
    ).run(album.id, `/uploads/private/${req.file.filename}`, thumbPath, (req.body?.caption || '').trim());
    res.status(201).json(signMedia(
      db.prepare('SELECT * FROM album_media WHERE id = ?').get(info.lastInsertRowid),
    ));
  });
});

// POST /api/media/media/:id/share — republish a picture to the public feed
router.post('/media/:id/share', authenticate, (req, res) => {
  const d = dept(res); if (!d) return;
  if (!canManageDept(req.user, d.id)) {
    return res.status(403).json({ error: 'Only the Media manager or club leaders can share publicly' });
  }
  const item = db.prepare(
    `SELECT am.*, a.title AS album_title, a.department_id FROM album_media am
     JOIN albums a ON a.id = am.album_id WHERE am.id = ?`,
  ).get(req.params.id);
  if (!item || item.department_id !== d.id) return res.status(404).json({ error: 'Media not found' });
  if (item.shared_post_id) return res.status(409).json({ error: 'Already shared to the public feed' });
  // copy the file into the public tree — the album keeps its private original
  let publicPath;
  try { publicPath = copyToPublic(item.file_path); } catch { publicPath = ''; }
  if (!publicPath) return res.status(500).json({ error: 'File missing on disk — re-upload the picture' });
  const title = (req.body?.title || item.caption || item.album_title || 'Media update').trim();
  const info = db.prepare(
    "INSERT INTO posts (department_id, author_id, type, title, body, image) VALUES (?,?,?,?,?,?)",
  ).run(d.id, req.user.id, 'announcement', title, (req.body?.body || '').trim(), publicPath);
  db.prepare('UPDATE album_media SET shared_post_id = ? WHERE id = ?').run(info.lastInsertRowid, item.id);
  res.status(201).json({ ok: true, post_id: info.lastInsertRowid });
});

// DELETE /api/media/media/:id — Media manager / leaders (file goes too)
router.delete('/media/:id', authenticate, (req, res) => {
  const d = dept(res); if (!d) return;
  if (!canManageDept(req.user, d.id)) {
    return res.status(403).json({ error: 'Only the Media manager or club leaders can delete' });
  }
  const item = db.prepare(
    'SELECT am.*, a.department_id FROM album_media am JOIN albums a ON a.id = am.album_id WHERE am.id = ?',
  ).get(req.params.id);
  if (!item || item.department_id !== d.id) return res.status(404).json({ error: 'Media not found' });
  // the public copy on the feed (if shared) is a separate post — it stays
  deleteUpload(item.file_path);
  deleteUpload(item.thumb_path);
  db.prepare('DELETE FROM album_media WHERE id = ?').run(item.id);
  res.json({ ok: true });
});

module.exports = router;
