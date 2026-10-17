// ============================================================
//  routes/posts.js — department announcements, votes, comments
//  Rules (README):
//   - public feed: anyone logged in, incl. guests (read)
//   - write: department members (manager/member) + Leader/Co-Leader
//   - Professor: may VOTE (the public feed is the club's voice and he is
//     part of it) · no post, no comment (management stays read-only)
//   - votes: 1 per user, changeable, transparent (who voted what)
//   - guests: read-only (no vote, no comment)
// ============================================================
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { notify } = require('../notify');
const { makeStorage, deleteUpload } = require('../storage');

const router = express.Router();

// ---- image uploads (clips / offers) — feed images are published content,
//      so they live in the PUBLIC tree and are viewable by guests ----
const storage = makeStorage('public');
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)),
});

const canWrite = (user) => user.role !== 'guest' && user.role !== 'professor'; // post / comment
const canVote = (user) => user.role !== 'guest'; // club members AND the professor
function canPostIn(user, deptId) {
  if (user.role === 'leader' || user.role === 'coleader') return true;
  if (user.role === 'manager' || user.role === 'member') return user.department_id === deptId;
  return false;
}

// ---- shape a post with votes + comments (transparent votes) ----
async function shapePost(post, viewerId) {
  const votes = await db.prepare(`
    SELECT v.value, u.id, u.full_name FROM votes v JOIN users u ON u.id = v.user_id
    WHERE v.post_id = ? ORDER BY u.full_name
  `).all(post.id);
  const comments = await db.prepare(`
    SELECT c.id, c.body, c.created_at, u.id AS author_id, u.full_name, u.role
    FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ? ORDER BY c.created_at
  `).all(post.id);
  const author = await db.prepare('SELECT id, full_name, role FROM users WHERE id = ?').get(post.author_id);
  return {
    ...post,
    author,
    yes: votes.filter((v) => v.value === 'yes').length,
    no: votes.filter((v) => v.value === 'no').length,
    voters: votes,
    my_vote: votes.find((v) => v.id === viewerId)?.value || null,
    comments,
    can_delete: viewerId === post.author_id || ['leader', 'coleader'].includes(
      (await db.prepare('SELECT role FROM users WHERE id=?').get(viewerId))?.role
    ),
  };
}

// GET /api/posts?department_id=3  — feed of one department
router.get('/', authenticate, async (req, res) => {
  const deptId = Number(req.query.department_id);
  if (!deptId) return res.status(400).json({ error: 'department_id required' });
  const posts = await db.prepare(
    'SELECT * FROM posts WHERE department_id = ? ORDER BY created_at DESC, id DESC'
  ).all(deptId);
  res.json(await Promise.all(posts.map((p) => shapePost(p, req.user.id))));
});

// POST /api/posts  — create (multipart if image, else JSON)
router.post('/', authenticate, (req, res, next) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'Invalid image (max 15MB, png/jpg/gif/webp)' });
    try {
      const deptId = Number(req.body.department_id);
      const { title, body, type } = req.body;
      if (!deptId || !title?.trim()) return res.status(400).json({ error: 'department_id and title required' });
      if (!canPostIn(req.user, deptId)) {
        return res.status(403).json({ error: 'Only this department\'s members or club leaders can post' });
      }
      const safeType = ['announcement', 'clip', 'offer'].includes(type) ? type : 'announcement';
      const image = req.file ? `/uploads/public/${req.file.filename}` : '';
      const info = await db.prepare(
        'INSERT INTO posts (department_id, author_id, type, title, body, image) VALUES (?,?,?,?,?,?)'
      ).run(deptId, req.user.id, safeType, title.trim(), (body || '').trim(), image);
      const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(info.lastInsertRowid);
      res.status(201).json(await shapePost(post, req.user.id));
    } catch (e) { next(e); }
  });
});

// POST /api/posts/:id/vote  — body { value: 'yes' | 'no' } (same value again = remove)
router.post('/:id/vote', authenticate, async (req, res) => {
  if (!canVote(req.user)) return res.status(403).json({ error: 'Guests cannot vote' });
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const { value } = req.body || {};
  if (!['yes', 'no'].includes(value)) return res.status(400).json({ error: 'value must be yes or no' });

  const existing = await db.prepare('SELECT * FROM votes WHERE post_id=? AND user_id=?').get(post.id, req.user.id);
  if (existing && existing.value === value) {
    await db.prepare('DELETE FROM votes WHERE id = ?').run(existing.id); // un-vote (changeable)
  } else if (existing) {
    await db.prepare('UPDATE votes SET value=? WHERE id=?').run(value, existing.id); // change vote
  } else {
    await db.prepare('INSERT INTO votes (post_id, user_id, value) VALUES (?,?,?)').run(post.id, req.user.id, value);
  }
  res.json(await shapePost(await db.prepare('SELECT * FROM posts WHERE id=?').get(post.id), req.user.id));
});

// POST /api/posts/:id/comments  — body { body: '...' }
router.post('/:id/comments', authenticate, async (req, res) => {
  if (!canWrite(req.user)) return res.status(403).json({ error: 'Read-only role: commenting is for club members' });
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const text = (req.body?.body || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty' });
  const info = await db.prepare('INSERT INTO comments (post_id, author_id, body) VALUES (?,?,?)')
    .run(post.id, req.user.id, text);
  // tell the post author someone commented (not yourself)
  if (post.author_id !== req.user.id) {
    const dept = await db.prepare('SELECT slug, name FROM departments WHERE id = ?').get(post.department_id);
    await notify(post.author_id, {
      type: 'comment',
      title: 'New comment on your post',
      body: `${req.user.full_name} commented on “${post.title}”`,
      link: `/departments/${dept.slug}`,
    });
  }
  res.status(201).json({ id: info.lastInsertRowid, body: text });
});

// DELETE /api/posts/:id — author, Leader, Co-Leader (Professor excluded: read-only)
router.delete('/:id', authenticate, async (req, res) => {
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const isAuthor = post.author_id === req.user.id;
  const isBoss = ['leader', 'coleader'].includes(req.user.role);
  if (!isAuthor && !isBoss) return res.status(403).json({ error: 'Only the author or a club leader can delete' });
  // album_media.shared_post_id references this post — clear it BEFORE deleting
  // (otherwise the FK constraint rejects the delete; shared photos can be re-shared later)
  await db.prepare('UPDATE album_media SET shared_post_id = NULL WHERE shared_post_id = ?').run(post.id);
  await db.prepare('DELETE FROM posts WHERE id = ?').run(post.id); // votes/comments cascade
  await deleteUpload(post.image); // no orphan file on disk
  res.json({ ok: true });
});

module.exports = router;
