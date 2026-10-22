// ============================================================
//  routes/departments.js — department pages + team creation
// ============================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { deleteUpload } = require('../storage');

const router = express.Router();

// same rule as the rest of the club: the Leader / Co-Leader build the
// team, the Supervisor stays read-only on management.
const CAN_CREATE = ['leader', 'coleader'];

// url-safe slug, unique INSIDE the club (departments.slug is UNIQUE(club_id, slug))
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'department';
}
async function uniqueSlug(clubId, base) {
  let slug = base;
  let i = 1;
  while (await db.prepare('SELECT id FROM departments WHERE club_id = ? AND slug = ?').get(clubId, slug)) {
    i += 1;
    slug = `${base}-${i}`;
  }
  return slug;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One optional account row → { full_name, email, password, role } or an error.
// Fully empty rows are ignored (so the client can render blank member rows).
function readAccount(raw, role, label, errors) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const fullName = String(src.full_name || '').trim();
  const email = String(src.email || '').trim().toLowerCase();
  const password = String(src.password || '');
  if (!fullName && !email && !password) return null;

  if (fullName.length < 2 || fullName.length > 80) {
    errors.push(`${label}: a full name (2–80 characters) is required`);
  }
  if (!EMAIL_RE.test(email)) errors.push(`${label}: a valid email is required`);
  if (password.length < 6) errors.push(`${label}: the password must be at least 6 characters`);
  return { full_name: fullName, email, password, role };
}

// What a department currently holds — shown before a delete and used to
// refuse deleting a department that still has people in it.
async function usageOf(deptId) {
  const count = async (sql, ...args) => Number((await db.prepare(sql).get(...args)).c);
  return {
    members: await count('SELECT COUNT(*) AS c FROM users WHERE department_id = ?', deptId),
    posts: await count('SELECT COUNT(*) AS c FROM posts WHERE department_id = ?', deptId),
    albums: await count('SELECT COUNT(*) AS c FROM albums WHERE department_id = ?', deptId),
    photos: await count(
      'SELECT COUNT(*) AS c FROM album_media m JOIN albums a ON a.id = m.album_id WHERE a.department_id = ?',
      deptId,
    ),
    tasks: await count('SELECT COUNT(*) AS c FROM tasks WHERE department_id = ?', deptId),
    goals: await count('SELECT COUNT(*) AS c FROM goals WHERE department_id = ?', deptId),
    meetings: await count('SELECT COUNT(*) AS c FROM meetings WHERE department_id = ?', deptId),
    applications: await count('SELECT COUNT(*) AS c FROM applications WHERE department_id = ?', deptId),
    messages: await count('SELECT COUNT(*) AS c FROM messages WHERE department_id = ?', deptId),
  };
}

// ============================================================
//  GET /api/departments — the departments of the caller's club
// ============================================================
router.get('/', authenticate, async (req, res) => {
  const departments = await db.prepare(
    'SELECT id, slug, name, description, coming_soon FROM departments WHERE club_id = ? ORDER BY id'
  ).all(req.user.club_id);
  res.json(departments);
});

// ============================================================
//  POST /api/departments — create a department (Leader / Co-Leader).
//  Body: { name, description?, manager?: {full_name,email,password},
//          members?: [{full_name,email,password}] }
//
//  "A full department" in one call: the department + its first manager +
//  its first members. The accounts get the new department automatically.
//  Everything is validated BEFORE writing, and a failed insert rolls back
//  whatever was already written.
// ============================================================
router.post('/', authenticate, async (req, res) => {
  if (!CAN_CREATE.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Leader and Co-Leader can create departments' });
  }

  const { name, description, manager, members } = req.body || {};
  const deptName = String(name || '').trim();
  if (deptName.length < 2) return res.status(400).json({ error: 'Department name is required' });
  if (deptName.length > 60) return res.status(400).json({ error: 'Department name is too long' });
  const desc = String(description || '').trim().slice(0, 500);

  if (members !== undefined && !Array.isArray(members)) {
    return res.status(400).json({ error: 'members must be a list' });
  }
  const memberRows = Array.isArray(members) ? members : [];
  if (memberRows.length > 50) {
    return res.status(400).json({ error: 'A new department can start with at most 50 members' });
  }

  // 1. validate every account first (nothing is written on a bad form)
  const errors = [];
  const accounts = [];
  const mgr = readAccount(manager, 'manager', 'Manager', errors);
  if (mgr) accounts.push(mgr);
  memberRows.forEach((row, i) => {
    const acc = readAccount(row, 'member', `Member ${i + 1}`, errors);
    if (acc) accounts.push(acc);
  });
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const seen = new Set();
  for (const a of accounts) {
    if (seen.has(a.email)) {
      return res.status(400).json({ error: `The email ${a.email} is used twice in this form` });
    }
    seen.add(a.email);
  }
  for (const a of accounts) {
    if (await db.prepare('SELECT id FROM users WHERE email = ?').get(a.email)) {
      return res.status(409).json({ error: `An account with ${a.email} already exists` });
    }
  }

  // 2. create the department and its team
  const slug = await uniqueSlug(req.user.club_id, slugify(deptName));
  let dept = null;
  const created = [];
  try {
    const info = await db.prepare(
      'INSERT INTO departments (club_id, slug, name, description, coming_soon) VALUES (?,?,?,?,0)',
    ).run(req.user.club_id, slug, deptName, desc);
    dept = await db.prepare('SELECT * FROM departments WHERE id = ?').get(info.lastInsertRowid);

    for (const a of accounts) {
      const u = await db.prepare(
        'INSERT INTO users (email, password_hash, full_name, role, club_id, department_id) VALUES (?,?,?,?,?,?)',
      ).run(a.email, bcrypt.hashSync(a.password, 10), a.full_name, a.role, req.user.club_id, dept.id);
      created.push(await db.prepare(
        'SELECT id, full_name, email, role, department_id FROM users WHERE id = ?',
      ).get(u.lastInsertRowid));
    }
  } catch (e) {
    // best-effort rollback of a partial create (the accounts have no
    // posts/files yet, so deleting them cannot orphan anything)
    for (const u of created.reverse()) {
      try { await db.prepare('DELETE FROM users WHERE id = ?').run(u.id); } catch { /* best effort */ }
    }
    if (dept) {
      try { await db.prepare('DELETE FROM departments WHERE id = ?').run(dept.id); } catch { /* best effort */ }
    }
    console.error('[departments] create failed:', e);
    return res.status(500).json({ error: 'Could not create the department — nothing was saved' });
  }

  res.status(201).json({
    department: dept,
    manager: created.find((u) => u.role === 'manager') || null,
    members: created.filter((u) => u.role === 'member'),
  });
});

// ============================================================
//  PATCH /api/departments/:slug — rename / re-describe
//  (Leader / Co-Leader). The slug never changes, so bookmarks and
//  every existing link keep working.
// ============================================================
router.patch('/:slug', authenticate, async (req, res) => {
  if (!CAN_CREATE.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Leader and Co-Leader can edit departments' });
  }
  const dept = await db.prepare(
    'SELECT * FROM departments WHERE slug = ? AND club_id = ?',
  ).get(req.params.slug, req.user.club_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const { name, description } = req.body || {};
  let nextName = dept.name;
  if (name !== undefined) {
    nextName = String(name || '').trim();
    if (nextName.length < 2) return res.status(400).json({ error: 'Department name is required' });
    if (nextName.length > 60) return res.status(400).json({ error: 'Department name is too long' });
  }
  let nextDesc = dept.description || '';
  if (description !== undefined) nextDesc = String(description || '').trim().slice(0, 500);

  await db.prepare('UPDATE departments SET name = ?, description = ? WHERE id = ?')
    .run(nextName, nextDesc, dept.id);
  res.json(await db.prepare(
    'SELECT id, slug, name, description, coming_soon FROM departments WHERE id = ?',
  ).get(dept.id));
});

// ============================================================
//  GET /api/departments/:slug/usage — what a delete would affect
//  (Leader / Co-Leader). The client shows this before confirming.
// ============================================================
router.get('/:slug/usage', authenticate, async (req, res) => {
  if (!CAN_CREATE.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Leader and Co-Leader can manage departments' });
  }
  const dept = await db.prepare(
    'SELECT id FROM departments WHERE slug = ? AND club_id = ?',
  ).get(req.params.slug, req.user.club_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });
  res.json(await usageOf(dept.id));
});

// ============================================================
//  DELETE /api/departments/:slug?confirm=1 — remove a department
//  (Leader / Co-Leader).
//
//  Safety model:
//   1. A department with people in it is NEVER deleted: move them
//      (Members → Manage) or remove them first.
//   2. An empty department still needs an explicit confirm when it
//      holds content; the response lists exactly what will go.
//   3. Rows are removed in FK-safe order, then their files.
// ============================================================
router.delete('/:slug', authenticate, async (req, res) => {
  if (!CAN_CREATE.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Leader and Co-Leader can delete departments' });
  }
  const dept = await db.prepare(
    'SELECT * FROM departments WHERE slug = ? AND club_id = ?',
  ).get(req.params.slug, req.user.club_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const usage = await usageOf(dept.id);
  if (usage.members > 0) {
    const people = usage.members === 1 ? 'person' : 'people';
    return res.status(409).json({
      error: `Move the ${usage.members} ${people} in this department to another department (or remove them) first.`,
      usage,
    });
  }
  const confirmed = req.query.confirm === '1' || req.body?.confirm === true;
  if (!confirmed) {
    return res.status(409).json({
      error: 'This department still has content. Confirm deletion to remove it permanently.',
      usage,
    });
  }

  // capture files while the rows still exist
  const albumFiles = await db.prepare(`
    SELECT m.file_path, m.thumb_path FROM album_media m
    JOIN albums a ON a.id = m.album_id WHERE a.department_id = ?
  `).all(dept.id);
  const postFiles = await db.prepare(
    'SELECT image, video FROM posts WHERE department_id = ?',
  ).all(dept.id);
  const msgFiles = await db.prepare(
    'SELECT attachment FROM messages WHERE club_id = ? AND department_id = ?',
  ).all(req.user.club_id, dept.id);

  try {
    // posts and their children (explicit, not relying on FK pragma)
    await db.prepare(
      'DELETE FROM votes WHERE post_id IN (SELECT id FROM posts WHERE department_id = ?)',
    ).run(dept.id);
    await db.prepare(
      'DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE department_id = ?)',
    ).run(dept.id);
    await db.prepare(
      'DELETE FROM poll_votes WHERE post_id IN (SELECT id FROM posts WHERE department_id = ?)',
    ).run(dept.id);
    await db.prepare(
      'DELETE FROM poll_options WHERE post_id IN (SELECT id FROM posts WHERE department_id = ?)',
    ).run(dept.id);
    // a picture shared from an album points at its feed post: clear that
    // reference before the post goes (no ON DELETE on shared_post_id)
    await db.prepare(
      'UPDATE album_media SET shared_post_id = NULL WHERE shared_post_id IN (SELECT id FROM posts WHERE department_id = ?)',
    ).run(dept.id);
    await db.prepare('DELETE FROM posts WHERE department_id = ?').run(dept.id);

    await db.prepare('DELETE FROM goals WHERE department_id = ?').run(dept.id);
    await db.prepare('DELETE FROM tasks WHERE department_id = ?').run(dept.id);
    await db.prepare('DELETE FROM applications WHERE department_id = ?').run(dept.id);
    await db.prepare('DELETE FROM messages WHERE club_id = ? AND department_id = ?')
      .run(req.user.club_id, dept.id);

    // albums + photos
    await db.prepare(
      'DELETE FROM album_media WHERE album_id IN (SELECT id FROM albums WHERE department_id = ?)',
    ).run(dept.id);
    await db.prepare('DELETE FROM albums WHERE department_id = ?').run(dept.id);

    // department meetings + their chat
    await db.prepare(
      'DELETE FROM meeting_messages WHERE meeting_id IN (SELECT id FROM meetings WHERE club_id = ? AND department_id = ?)',
    ).run(req.user.club_id, dept.id);
    await db.prepare(
      'DELETE FROM meeting_participants WHERE meeting_id IN (SELECT id FROM meetings WHERE club_id = ? AND department_id = ?)',
    ).run(req.user.club_id, dept.id);
    await db.prepare('DELETE FROM meetings WHERE club_id = ? AND department_id = ?')
      .run(req.user.club_id, dept.id);

    // read markers for the department chat room
    await db.prepare('DELETE FROM chat_reads WHERE room = ?').run(`dept:${dept.id}`);
    await db.prepare('DELETE FROM departments WHERE id = ?').run(dept.id);
  } catch (e) {
    console.error('[departments] delete failed:', e);
    return res.status(500).json({ error: 'Could not delete the department — some data may remain' });
  }

  // files go last: an orphan file is harmless, a missing file with a live row is not
  for (const m of albumFiles) {
    await deleteUpload(m.file_path);
    await deleteUpload(m.thumb_path);
  }
  for (const p of postFiles) {
    await deleteUpload(p.image);
    await deleteUpload(p.video);
  }
  for (const m of msgFiles) await deleteUpload(m.attachment);

  res.json({ ok: true, usage });
});

// ============================================================
//  GET /api/departments/:slug — department home.
//  Requires a session (the page itself is members+guests only); the member
//  list is decided SERVER-SIDE from the caller's role — never from a query
//  flag the client controls.
// ============================================================
router.get('/:slug', authenticate, async (req, res) => {
  const dept = await db.prepare(
    'SELECT id, slug, name, description, coming_soon FROM departments WHERE slug = ? AND club_id = ?'
  ).get(req.params.slug, req.user.club_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  // goals visible to every signed-in member (assigned by the leader)
  dept.goals = await db.prepare(
    'SELECT id, title, description, due_date FROM goals WHERE department_id = ? ORDER BY due_date'
  ).all(dept.id);

  // members list — never for guests, whatever the query string says
  dept.members = [];
  if (req.user.role !== 'guest') {
    dept.members = await db.prepare(`
      SELECT id, full_name, role FROM users
      WHERE department_id = ? AND role IN ('manager','member') ORDER BY role, full_name
    `).all(dept.id);
  }
  res.json(dept);
});

// GET /api/departments/:slug/private — ONLY department members + boss (skeleton for Sprint 2+)
router.get('/:slug/private', authenticate, async (req, res) => {
  const dept = await db.prepare('SELECT * FROM departments WHERE slug = ? AND club_id = ?').get(req.params.slug, req.user.club_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const boss = ['supervisor', 'leader', 'coleader'].includes(req.user.role);
  const inDept = req.user.department_id === dept.id;
  if (!boss && !inDept) return res.status(403).json({ error: 'Private area: department members only' });

  res.json({ message: `Welcome to the private ${dept.name} space`, tasks: [] }); // tasks in Sprint 3
});

module.exports = router;
