// ============================================================
//  routes/users.js — members directory
//  Rule: everyone sees members EXCEPT guests. Click = private chat.
// ============================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/users — club directory (guests: 403)
router.get('/', authenticate, async (req, res) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Guests cannot see the members directory' });
  }
  const users = await db.prepare(`
    SELECT u.id, u.full_name, u.role, u.bio, u.department_id, d.name AS department_name, d.slug AS department_slug
    FROM users u LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.club_id = ?
    ORDER BY u.full_name
  `).all(req.user.club_id);
  res.json(users);
});

// ============================================================
//  Self-service profile — every signed-in user edits ONLY their
//  own record. Role and department are never self-editable (those
//  go through the leader-only endpoints below).
// ============================================================

// PATCH /api/users/me — update own full name + bio
router.patch('/me', authenticate, async (req, res) => {
  const { full_name, bio } = req.body || {};
  const name = String(full_name ?? req.user.full_name).trim();
  const about = String(bio ?? '').trim().slice(0, 500);
  if (name.length < 2) return res.status(400).json({ error: 'Full name must be at least 2 characters' });
  if (name.length > 80) return res.status(400).json({ error: 'Full name is too long' });
  await db.prepare('UPDATE users SET full_name = ?, bio = ? WHERE id = ?').run(name, about, req.user.id);
  res.json(await db.prepare(
    'SELECT id, email, full_name, role, department_id, bio FROM users WHERE id = ?',
  ).get(req.user.id));
});

// POST /api/users/me/password — change own password (current one required)
router.post('/me/password', authenticate, async (req, res) => {
  const current = String(req.body?.current_password || '');
  const next = String(req.body?.new_password || '');
  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !bcrypt.compareSync(current, row.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  if (next === current) return res.status(400).json({ error: 'New password must be different from the current one' });
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(next, 10), req.user.id);
  res.json({ ok: true });
});

// GET /api/users/:id — profile of one member (for chat header)
router.get('/:id', authenticate, async (req, res) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Guests cannot see member profiles' });
  }
  const user = await db.prepare(`
    SELECT u.id, u.full_name, u.role, u.bio, u.department_id, d.name AS department_name, d.slug AS department_slug
    FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ? AND u.club_id = ?
  `).get(req.params.id, req.user.club_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ============================================================
//  Member management — Leader / Co-Leader only (README)
//   - change role: guest / member / manager  (leader & coleader
//     are deliberately NOT in the list: protect the hierarchy)
//   - assign/change department (required for member & manager)
//   - remove a member from the club (never yourself)
//   - Supervisor: read-only → 403
// ============================================================

// PATCH /api/users/:id/role  — body { role, department_id? }
router.patch('/:id/role', authenticate, async (req, res) => {
  if (!['leader', 'coleader'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Leader and Co-Leader can manage members' });
  }
  const target = await db.prepare('SELECT * FROM users WHERE id = ? AND club_id = ?').get(req.params.id, req.user.club_id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const { role, department_id } = req.body || {};
  const validRoles = ['guest', 'member', 'manager'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Role must be guest, member or manager' });
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role' });
  }
  if (['leader', 'coleader', 'supervisor'].includes(target.role)) {
    return res.status(403).json({ error: 'Leaders, Co-Leaders and the Supervisor cannot be demoted' });
  }

  let dept = null;
  if (role !== 'guest') {
    dept = await db.prepare('SELECT * FROM departments WHERE id = ? AND club_id = ?').get(Number(department_id), req.user.club_id);
    if (!dept || dept.slug === 'materials') {
      return res.status(400).json({ error: 'A valid department is required for members and managers' });
    }
  }
  await db.prepare('UPDATE users SET role = ?, department_id = ? WHERE id = ?')
    .run(role, dept ? dept.id : null, target.id);
  res.json({ ok: true, role, department_id: dept ? dept.id : null });
});

// ============================================================
//  POST /api/users — create an account (the onboarding chain)
//   Supervisor  → LEADER accounts, plus more SUPERVISOR accounts
//     (a club may have several supervisors; the founder is the
//     first one and peers can share the responsibility)
//   Leader/Co-Leader → every other account (co-leader, manager,
//     member, guest)
//   everyone else → 403. There is NO self-registration: the public
//   create-club flow mints the first supervisor and nothing else.
// ============================================================
router.post('/', authenticate, async (req, res) => {
  const actor = req.user.role;
  let allowed;
  if (actor === 'supervisor') {
    allowed = ['supervisor', 'leader'];
  } else if (['leader', 'coleader'].includes(actor)) {
    allowed = ['coleader', 'manager', 'member', 'guest'];
  } else {
    return res.status(403).json({ error: 'Only the Supervisor or the Leader/Co-Leader can create accounts' });
  }

  const { full_name, email, password, role, department_id } = req.body || {};
  if (!['supervisor', 'leader', 'coleader', 'manager', 'member', 'guest'].includes(role)) {
    return res.status(400).json({ error: 'Unknown role' });
  }
  if (!allowed.includes(role)) {
    return res.status(403).json({
      error: actor === 'supervisor'
        ? 'The Supervisor can only create Supervisor and Leader accounts — the Leader then creates everyone else'
        : 'Supervisor and Leader accounts are created by the Supervisor — you create Co-Leaders, Managers, Members and Guests',
    });
  }

  const name = String(full_name || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  const pwd = String(password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Full name is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ error: 'A valid email is required' });
  if (pwd.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (await db.prepare('SELECT id FROM users WHERE email = ?').get(mail)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  // same department rule as role changes: required for member & manager
  let dept = null;
  if (role === 'member' || role === 'manager') {
    dept = await db.prepare('SELECT * FROM departments WHERE id = ? AND club_id = ?').get(Number(department_id), req.user.club_id);
    if (!dept || dept.slug === 'materials') {
      return res.status(400).json({ error: 'A valid department is required for members and managers' });
    }
  }
  const info = await db.prepare(
    'INSERT INTO users (email, password_hash, full_name, role, club_id, department_id) VALUES (?,?,?,?,?,?)',
  ).run(mail, bcrypt.hashSync(pwd, 10), name, role, req.user.club_id, dept ? dept.id : null);
  res.status(201).json({
    id: info.lastInsertRowid, full_name: name, email: mail, role,
    department_id: dept ? dept.id : null,
  });
});

// DELETE /api/users/:id — remove a member from the club
router.delete('/:id', authenticate, async (req, res) => {
  if (!['leader', 'coleader'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Leader and Co-Leader can remove members' });
  }
  const target = await db.prepare('SELECT * FROM users WHERE id = ? AND club_id = ?').get(req.params.id, req.user.club_id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot remove yourself' });
  }
  if (['leader', 'coleader', 'supervisor'].includes(target.role)) {
    return res.status(403).json({ error: 'Leaders, Co-Leaders and the Supervisor cannot be removed' });
  }
  await db.prepare('DELETE FROM votes WHERE user_id = ?').run(target.id); // their votes go away
  try {
    await db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  } catch {
    // author_id / created_by FKs: member has authored posts/comments/events
    return res.status(409).json({
      error: 'This member has published posts, comments or calendar dates and cannot be removed yet',
    });
  }
  res.json({ ok: true });
});

module.exports = router;
