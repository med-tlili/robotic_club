// ============================================================
//  routes/posts.js — feed posts (text | image | video | poll),
//  Yes/No/Maybe reactions, comments.
//  Rules (README):
//   - public feed: anyone logged in, incl. guests (read)
//   - write: department members (manager/member) + Leader/Co-Leader
//   - Supervisor: may REACT (the public feed is the club's voice and he is
//     part of it) · no post, no comment (management stays read-only)
//   - reactions: 1 per user, changeable, transparent (who reacted what)
//   - polls: 1 option per member, changeable; guests read-only
//   - guests: read-only (no react, no comment, no poll vote)
// ============================================================
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { notify } = require('../notify');
const { makeStorage, deleteUpload } = require('../storage');
const { deptInClub } = require('../deptPerms');

const router = express.Router();

const POST_TYPES = ['text', 'image', 'video', 'poll'];
const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/;
const VIDEO_MIME = /^video\/(mp4|webm)$/;

// ---- media uploads (images + video) — feed media is published content,
//      so it lives in the PUBLIC tree and is viewable by guests ----
const storage = makeStorage('public');
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, IMAGE_MIME.test(file.mimetype) || VIDEO_MIME.test(file.mimetype)),
});

const canWrite = (user) => user.role !== 'guest' && user.role !== 'supervisor'; // post / comment
const canVote = (user) => user.role !== 'guest'; // club members AND the supervisor
function canPostIn(user, deptId) {
  if (user.role === 'leader' || user.role === 'coleader') return true;
  if (user.role === 'manager' || user.role === 'member') return user.department_id === deptId;
  return false;
}

// poll options arrive as one "options" field per line (multipart) or a JSON array
function parseOptions(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try { const j = JSON.parse(raw); list = Array.isArray(j) ? j : raw.split('\n'); }
    catch { list = raw.split('\n'); }
  }
  return list.map((o) => String(o == null ? '' : o).trim()).filter(Boolean).slice(0, 6);
}

// ---- shape a post with reactions + comments (+ poll, when it is one) ----
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

  let poll = null;
  if (post.type === 'poll') {
    const options = await db.prepare(
      'SELECT id, body, position FROM poll_options WHERE post_id = ? ORDER BY position, id',
    ).all(post.id);
    const counts = await db.prepare(
      'SELECT option_id, COUNT(*) AS c FROM poll_votes WHERE post_id = ? GROUP BY option_id',
    ).all(post.id);
    const mine = (await db.prepare(
      'SELECT option_id FROM poll_votes WHERE post_id = ? AND user_id = ?',
    ).get(post.id, viewerId))?.option_id || null;
    const byId = Object.fromEntries(counts.map((r) => [Number(r.option_id), Number(r.c)]));
    poll = {
      options: options.map((o) => ({ id: o.id, body: o.body, votes: byId[o.id] || 0 })),
      my_choice: mine,
      total: counts.reduce((n, r) => n + Number(r.c), 0),
    };
  }

  return {
    ...post,
    author,
    yes: votes.filter((v) => v.value === 'yes').length,
    no: votes.filter((v) => v.value === 'no').length,
    maybe: votes.filter((v) => v.value === 'maybe').length,
    voters: votes,
    my_vote: votes.find((v) => v.id === viewerId)?.value || null,
    poll,
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
  if (!(await deptInClub(deptId, req.user.club_id))) {
    return res.status(404).json({ error: 'Department not found' });
  }
  const posts = await db.prepare(
    'SELECT * FROM posts WHERE department_id = ? ORDER BY created_at DESC, id DESC'
  ).all(deptId);
  res.json(await Promise.all(posts.map((p) => shapePost(p, req.user.id))));
});

// GET /api/posts/feed?limit=20&before_id=123 — the CLUB home feed.
// Every department's posts in one newest-first timeline (guests may read,
// like any public feed). Cursor-paginated by post id for a stable paging.
router.get('/feed', authenticate, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const beforeId = Number(req.query.before_id) || null;
  let sql = `
    SELECT p.*, d.slug AS department_slug, d.name AS department_name
    FROM posts p
    JOIN departments d ON d.id = p.department_id
    WHERE d.club_id = ?
  `;
  const params = [req.user.club_id];
  if (beforeId) { sql += ' AND p.id < ?'; params.push(beforeId); }
  sql += ' ORDER BY p.id DESC LIMIT ?';
  params.push(limit);
  const rows = await db.prepare(sql).all(...params);
  const shaped = await Promise.all(rows.map(async (p) => ({
    ...(await shapePost(p, req.user.id)),
    department: { id: p.department_id, slug: p.department_slug, name: p.department_name },
  })));
  res.json(shaped);
});

// POST /api/posts  — create (multipart). type: text | image | video | poll
router.post('/', authenticate, (req, res, next) => {
  upload.single('media')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'Invalid file (max 50MB: png/jpg/gif/webp or mp4/webm)' });
    try {
      const deptId = Number(req.body.department_id);
      const { title, body, type } = req.body;
      if (!deptId || !title?.trim()) return res.status(400).json({ error: 'department_id and title required' });
      if (!(await deptInClub(deptId, req.user.club_id))) {
        return res.status(404).json({ error: 'Department not found' });
      }
      if (!canPostIn(req.user, deptId)) {
        return res.status(403).json({ error: 'Only this department\'s members or club leaders can post' });
      }
      const safeType = POST_TYPES.includes(type) ? type : 'text';
      const isImage = !!req.file && IMAGE_MIME.test(req.file.mimetype);
      const isVideo = !!req.file && VIDEO_MIME.test(req.file.mimetype);

      let image = '';
      let video = '';
      let options = [];
      if (safeType === 'image') {
        if (!isImage) return res.status(400).json({ error: 'An image post needs a png/jpg/gif/webp file' });
        image = `/uploads/public/${req.file.filename}`;
      } else if (safeType === 'video') {
        if (!isVideo) return res.status(400).json({ error: 'A video post needs an mp4/webm file' });
        video = `/uploads/public/${req.file.filename}`;
      } else if (safeType === 'poll') {
        options = parseOptions(req.body.options);
        if (options.length < 2) return res.status(400).json({ error: 'A poll needs at least 2 options' });
      } else if (req.file) { // text
        return res.status(400).json({ error: 'A text post has no file — choose Image or Video' });
      }

      const info = await db.prepare(
        'INSERT INTO posts (department_id, author_id, type, title, body, image, video) VALUES (?,?,?,?,?,?,?)'
      ).run(deptId, req.user.id, safeType, title.trim(), (body || '').trim(), image, video);
      const postId = info.lastInsertRowid;
      if (safeType === 'poll') {
        const insOpt = db.prepare('INSERT INTO poll_options (post_id, body, position) VALUES (?,?,?)');
        for (let i = 0; i < options.length; i += 1) await insOpt.run(postId, options[i], i);
      }
      const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
      res.status(201).json(await shapePost(post, req.user.id));
    } catch (e) { next(e); }
  });
});

// POST /api/posts/:id/vote  — reactions { value: 'yes' | 'no' | 'maybe' }
// (same value again = remove)
router.post('/:id/vote', authenticate, async (req, res) => {
  if (!canVote(req.user)) return res.status(403).json({ error: 'Guests cannot react' });
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || !(await deptInClub(post.department_id, req.user.club_id))) return res.status(404).json({ error: 'Post not found' });
  const { value } = req.body || {};
  if (!['yes', 'no', 'maybe'].includes(value)) return res.status(400).json({ error: 'value must be yes, no or maybe' });

  const existing = await db.prepare('SELECT * FROM votes WHERE post_id=? AND user_id=?').get(post.id, req.user.id);
  if (existing && existing.value === value) {
    await db.prepare('DELETE FROM votes WHERE id = ?').run(existing.id); // un-react (changeable)
  } else if (existing) {
    await db.prepare('UPDATE votes SET value=? WHERE id=?').run(value, existing.id); // change reaction
  } else {
    await db.prepare('INSERT INTO votes (post_id, user_id, value) VALUES (?,?,?)').run(post.id, req.user.id, value);
  }
  res.json(await shapePost(await db.prepare('SELECT * FROM posts WHERE id=?').get(post.id), req.user.id));
});

// POST /api/posts/:id/poll-vote  — body { option_id } (one choice per member,
// changeable; clicking the same option again removes the vote)
router.post('/:id/poll-vote', authenticate, async (req, res) => {
  if (!canVote(req.user)) return res.status(403).json({ error: 'Guests cannot vote' });
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || !(await deptInClub(post.department_id, req.user.club_id))) return res.status(404).json({ error: 'Post not found' });
  if (post.type !== 'poll') return res.status(400).json({ error: 'This post is not a poll' });
  const optionId = Number(req.body?.option_id);
  const option = await db.prepare('SELECT id FROM poll_options WHERE id = ? AND post_id = ?').get(optionId, post.id);
  if (!option) return res.status(400).json({ error: 'Unknown poll option' });

  const existing = await db.prepare('SELECT * FROM poll_votes WHERE post_id=? AND user_id=?').get(post.id, req.user.id);
  if (existing && Number(existing.option_id) === optionId) {
    await db.prepare('DELETE FROM poll_votes WHERE id = ?').run(existing.id); // un-vote
  } else if (existing) {
    await db.prepare('UPDATE poll_votes SET option_id=? WHERE id=?').run(optionId, existing.id); // change choice
  } else {
    await db.prepare('INSERT INTO poll_votes (post_id, option_id, user_id) VALUES (?,?,?)').run(post.id, optionId, req.user.id);
  }
  res.json(await shapePost(await db.prepare('SELECT * FROM posts WHERE id=?').get(post.id), req.user.id));
});

// POST /api/posts/:id/comments  — body { body: '...' }
router.post('/:id/comments', authenticate, async (req, res) => {
  if (!canWrite(req.user)) return res.status(403).json({ error: 'Read-only role: commenting is for club members' });
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || !(await deptInClub(post.department_id, req.user.club_id))) return res.status(404).json({ error: 'Post not found' });
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

// DELETE /api/posts/:id — author, Leader, Co-Leader (Supervisor excluded: read-only)
router.delete('/:id', authenticate, async (req, res) => {
  const post = await db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post || !(await deptInClub(post.department_id, req.user.club_id))) return res.status(404).json({ error: 'Post not found' });
  const isAuthor = post.author_id === req.user.id;
  const isBoss = ['leader', 'coleader'].includes(req.user.role);
  if (!isAuthor && !isBoss) return res.status(403).json({ error: 'Only the author or a club leader can delete' });
  // album_media.shared_post_id references this post — clear it BEFORE deleting
  // (otherwise the FK constraint rejects the delete; shared photos can be re-shared later)
  await db.prepare('UPDATE album_media SET shared_post_id = NULL WHERE shared_post_id = ?').run(post.id);
  await db.prepare('DELETE FROM posts WHERE id = ?').run(post.id); // votes/comments/poll cascade
  await deleteUpload(post.image); // no orphan file on disk
  await deleteUpload(post.video);
  res.json({ ok: true });
});

module.exports = router;
