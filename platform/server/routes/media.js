// ============================================================
//  routes/media.js — Department photo albums
//
//  Every department has its own album(s), shown on its home page:
//   - any club member may BROWSE them (guests are blocked, 403);
//   - only that department's manager, or a club leader, may
//     CREATE an album, UPLOAD/delete a picture, or SHARE a
//     picture to that department's public feed.
//
//  The department is chosen by `department_id` (query on GET,
//  body on POST). For backwards compatibility it DEFAULTS to the
//  club's `media` department when omitted.
//
//  Storage (see storage.js): photos live in uploads/private and
//  are only reachable through 24h signed URLs; sharing to the
//  feed COPIES the file into uploads/public (guests may view it).
// ============================================================
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { canManageDept, getDept, deptInClub } = require('../deptPerms');
const {
  makeStorage, signPath, deleteUpload, copyToPublic, makeThumb,
} = require('../storage');

const router = express.Router();
const DEFAULT_DEPT = 'media'; // legacy: no department_id → the Media department

const storage = makeStorage('private'); // album photos are never public
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  // raster photos only — SVG (scriptable) and everything non-image rejected
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)),
});

// DB row → client row: private paths leave the API already signed
const signMedia = (m) => ({
  ...m,
  file_path: signPath(m.file_path),
  thumb_path: m.thumb_path ? signPath(m.thumb_path) : '',
});

// Resolve the department an album request targets:
//   a real department_id of the caller's club → that department;
//   omitted                                  → the club's Media department.
// Always answers 404 itself (and returns null) when it cannot resolve.
async function targetDept(req, res, rawId) {
  if (rawId === undefined || rawId === null || rawId === '') {
    const d = await getDept(DEFAULT_DEPT, req.user.club_id);
    if (!d) { res.status(404).json({ error: 'Department not found' }); return null; }
    return d;
  }
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0 || !(await deptInClub(id, req.user.club_id))) {
    res.status(404).json({ error: 'Department not found' });
    return null;
  }
  return await db.prepare('SELECT * FROM departments WHERE id = ?').get(id);
}

// an album / media row, only if it belongs to the caller's club
async function albumInClub(id, clubId) {
  return await db.prepare(`
    SELECT a.* FROM albums a JOIN departments d ON d.id = a.department_id
    WHERE a.id = ? AND d.club_id = ?
  `).get(id, clubId) || null;
}
async function mediaInClub(id, clubId) {
  return await db.prepare(`
    SELECT am.*, a.title AS album_title, a.department_id
    FROM album_media am JOIN albums a ON a.id = am.album_id
    JOIN departments d ON d.id = a.department_id
    WHERE am.id = ? AND d.club_id = ?
  `).get(id, clubId) || null;
}

// ============================================================
//  GET /api/media/albums?department_id= — browse a department's
//  albums (every club member; guests blocked)
// ============================================================
router.get('/albums', authenticate, async (req, res) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Albums are for club members' });
  }
  const d = await targetDept(req, res, req.query.department_id); if (!d) return;
  const albums = await db.prepare(
    'SELECT * FROM albums WHERE department_id = ? ORDER BY created_at DESC',
  ).all(d.id);
  const withMedia = await Promise.all(albums.map(async (a) => ({
    ...a,
    media: (await db.prepare(
      'SELECT * FROM album_media WHERE album_id = ? ORDER BY created_at DESC',
    ).all(a.id)).map(signMedia),
  })));
  res.json(withMedia);
});

// ============================================================
//  POST /api/media/albums — create an album in a department
//  (that department's manager, or a club leader)
// ============================================================
router.post('/albums', authenticate, async (req, res) => {
  const d = await targetDept(req, res, req.body?.department_id); if (!d) return;
  if (!canManageDept(req.user, d.id)) {
    return res.status(403).json({ error: "Only this department's manager or club leaders can create albums" });
  }
  const { title, description } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const info = await db.prepare(
    'INSERT INTO albums (department_id, title, description, created_by) VALUES (?,?,?,?)',
  ).run(d.id, title.trim(), (description || '').trim(), req.user.id);
  res.status(201).json(await db.prepare('SELECT * FROM albums WHERE id = ?').get(info.lastInsertRowid));
});

// ============================================================
//  POST /api/media/albums/:id/media — upload an image into an album
// ============================================================
router.post('/albums/:id/media', authenticate, async (req, res) => {
  const album = await albumInClub(req.params.id, req.user.club_id);
  if (!album) return res.status(404).json({ error: 'Album not found' });
  if (!canManageDept(req.user, album.department_id)) {
    return res.status(403).json({ error: 'Only this album\'s department manager or club leaders can upload' });
  }
  upload.single('file')(req, res, async (err) => {
    if (err || !req.file) return res.status(400).json({ error: 'Image required (max 20MB)' });
    // 800px webp preview for the grids; the original stays for the opened view
    let thumbPath = '';
    try { thumbPath = await makeThumb(req.file.path || req.file.buffer, req.file.originalname); } catch { thumbPath = ''; }
    const info = await db.prepare(
      'INSERT INTO album_media (album_id, file_path, thumb_path, caption) VALUES (?,?,?,?)',
    ).run(album.id, `/uploads/private/${req.file.filename}`, thumbPath, (req.body?.caption || '').trim());
    res.status(201).json(signMedia(
      await db.prepare('SELECT * FROM album_media WHERE id = ?').get(info.lastInsertRowid),
    ));
  });
});

// ============================================================
//  DELETE /api/media/albums/:id — remove an album and its files
//  (that department's manager, or a club leader)
// ============================================================
router.delete('/albums/:id', authenticate, async (req, res) => {
  const album = await albumInClub(req.params.id, req.user.club_id);
  if (!album) return res.status(404).json({ error: 'Album not found' });
  if (!canManageDept(req.user, album.department_id)) {
    return res.status(403).json({ error: 'Only this album\'s department manager or club leaders can delete albums' });
  }
  // unlink every photo's files first — the rows cascade on album delete
  const media = await db.prepare('SELECT * FROM album_media WHERE album_id = ?').all(album.id);
  for (const m of media) {
    await deleteUpload(m.file_path);
    await deleteUpload(m.thumb_path);
  }
  await db.prepare('DELETE FROM albums WHERE id = ?').run(album.id);
  res.json({ ok: true });
});

// ============================================================
//  POST /api/media/media/:id/share — republish a picture to the
//  public feed OF ITS OWN department
// ============================================================
router.post('/media/:id/share', authenticate, async (req, res) => {
  const item = await mediaInClub(req.params.id, req.user.club_id);
  if (!item) return res.status(404).json({ error: 'Media not found' });
  if (!canManageDept(req.user, item.department_id)) {
    return res.status(403).json({ error: 'Only this album\'s department manager or club leaders can share publicly' });
  }
  if (item.shared_post_id) return res.status(409).json({ error: 'Already shared to the public feed' });
  // copy the file into the public tree — the album keeps its private original
  let publicPath;
  try { publicPath = await copyToPublic(item.file_path); } catch { publicPath = ''; }
  if (!publicPath) return res.status(500).json({ error: 'File missing on disk — re-upload the picture' });
  const title = (req.body?.title || item.caption || item.album_title || 'Media update').trim();
  const info = await db.prepare(
    "INSERT INTO posts (department_id, author_id, type, title, body, image) VALUES (?,?,?,?,?,?)",
  ).run(item.department_id, req.user.id, 'image', title, (req.body?.body || '').trim(), publicPath);
  await db.prepare('UPDATE album_media SET shared_post_id = ? WHERE id = ?').run(info.lastInsertRowid, item.id);
  res.status(201).json({ ok: true, post_id: info.lastInsertRowid });
});

// ============================================================
//  DELETE /api/media/media/:id — remove a picture (file goes too)
// ============================================================
router.delete('/media/:id', authenticate, async (req, res) => {
  const item = await mediaInClub(req.params.id, req.user.club_id);
  if (!item) return res.status(404).json({ error: 'Media not found' });
  if (!canManageDept(req.user, item.department_id)) {
    return res.status(403).json({ error: 'Only this album\'s department manager or club leaders can delete' });
  }
  // the public copy on the feed (if shared) is a separate post — it stays
  await deleteUpload(item.file_path);
  await deleteUpload(item.thumb_path);
  await db.prepare('DELETE FROM album_media WHERE id = ?').run(item.id);
  res.json({ ok: true });
});

module.exports = router;
