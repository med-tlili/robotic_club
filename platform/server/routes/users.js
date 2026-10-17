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
    ORDER BY u.full_name
  `).all();
  res.json(users);
});

// GET /api/users/:id — profile of one member (for chat header)
router.get('/:id', authenticate, async (req, res) => {
  if (req.user.role === 'guest') {
    return res.status(403).json({ error: 'Guests cannot see member profiles' });
  }
  const user = await db.prepare(`
    SELECT u.id, u.full_name, u.role, u.bio, u.department_id, d.name AS department_name, d.slug AS department_slug
    FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?
  `).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// ============================================================
//  Member management — Leader / Co-Leader only (README)
//   - change role: guest / member / manager  (leader & coleader
//     are deliberately NOT in the list: protect the hierarchy)
//   - assign/change department (required for member & manager)
//   - remove a member from the club (never yourself)
//   - Professor: read-only → 403
// ============================================================

// PATCH /api/users/:id/role  — body { role, department_id? }
router.patch('/:id/role', authenticate, async (req, res) => {
  if (!['leader', 'coleader'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Leader and Co-Leader can manage members' });
  }
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const { role, department_id } = req.body || {};
  const validRoles = ['guest', 'member', 'manager'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Role must be guest, member or manager' });
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role' });
  }
  if (['leader', 'coleader', 'professor'].includes(target.role)) {
    return res.status(403).json({ error: 'Leaders, Co-Leaders and the Professor cannot be demoted' });
  }

  let dept = null;
  if (role !== 'guest') {
    dept = await db.prepare('SELECT * FROM departments WHERE id = ?').get(Number(department_id));
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
//   Professor  → LEADER accounts only (root of the chain)
//   Leader/Co-Leader → every other account (co-leader, manager,
//     member, guest)
//   everyone else → 403. There is NO self-registration.
// ============================================================
router.post('/', authenticate, async (req, res) => {
  const actor = req.user.role;
  let allowed;
  if (actor === 'professor') {
    allowed = ['leader'];
  } else if (['leader', 'coleader'].includes(actor)) {
    allowed = ['coleader', 'manager', 'member', 'guest'];
  } else {
    return res.status(403).json({ error: 'Only the Professor or the Leader/Co-Leader can create accounts' });
  }

  const { full_name, email, password, role, department_id } = req.body || {};
  if (!['professor', 'leader', 'coleader', 'manager', 'member', 'guest'].includes(role) || role === 'professor') {
    return res.status(400).json({ error: 'Unknown role' });
  }
  if (!allowed.includes(role)) {
    return res.status(403).json({
      error: actor === 'professor'
        ? 'The Professor can only create Leader accounts — the Leader then creates everyone else'
        : 'Leader accounts are created by the Professor — you create Co-Leaders, Managers, Members and Guests',
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
    dept = await db.prepare('SELECT * FROM departments WHERE id = ?').get(Number(department_id));
    if (!dept || dept.slug === 'materials') {
      return res.status(400).json({ error: 'A valid department is required for members and managers' });
    }
  }
  const info = await db.prepare(
    'INSERT INTO users (email, password_hash, full_name, role, department_id) VALUES (?,?,?,?,?)',
  ).run(mail, bcrypt.hashSync(pwd, 10), name, role, dept ? dept.id : null);
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
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot remove yourself' });
  }
  if (['leader', 'coleader', 'professor'].includes(target.role)) {
    return res.status(403).json({ error: 'Leaders, Co-Leaders and the Professor cannot be removed' });
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
