// ============================================================
//  routes/auth.js — login / current user
// ============================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');
const { rateLimit, clientIp } = require('../middleware/rateLimit');

const router = express.Router();

// 503 instead of a crash/forgery risk when the server has no signing secret
const authReady = (req, res) => {
  if (JWT_SECRET) return false;
  res.status(503).json({ error: 'Server authentication is not configured (JWT_SECRET missing)' });
  return true;
};

function publicUser(u) {
  return {
    id: u.id, email: u.email, full_name: u.full_name,
    role: u.role, club_id: u.club_id, department_id: u.department_id, bio: u.bio
  };
}

// user + the club they belong to (the client shows the club name in the UI)
async function sessionUser(u) {
  const club = u.club_id
    ? await db.prepare('SELECT id, name, slug FROM clubs WHERE id = ?').get(u.club_id)
    : null;
  return { ...publicUser(u), club };
}

// url-safe, unique club slug (two clubs may share a name — the slug may not)
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'club';
}
async function uniqueSlug(base) {
  let slug = base; let i = 1;
  while (await db.prepare('SELECT id FROM clubs WHERE slug = ?').get(slug)) { i += 1; slug = `${base}-${i}`; }
  return slug;
}

// brute-force guard: per IP+email and per IP (see middleware/rateLimit.js)
const loginByEmail = rateLimit({ max: 10, name: 'login-email', key: (req) => `${clientIp(req)}|${String((req.body || {}).email || '').toLowerCase()}` });
const loginByIp = rateLimit({ max: 40, name: 'login-ip' });

// POST /api/auth/login
router.post('/login', loginByIp, loginByEmail, async (req, res) => {
  if (authReady(req, res)) return;
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = jwt.sign(
    { id: user.id, role: user.role, club_id: user.club_id, department_id: user.department_id, full_name: user.full_name },
    JWT_SECRET, { expiresIn: '7d' }
  );
  res.json({ token, user: await sessionUser(user) });
});

// POST /api/auth/create-club — the "create the club" action of the first page.
// Anyone may create their OWN club: this makes them its first Supervisor and
// gives the club its five starter departments. It grants NO power over any
// other club — accounts inside a club are still created by the chain
// Supervisor -> Leader -> everyone else (POST /api/users). Rate-limited.
router.post('/create-club', rateLimit({ max: 5, name: 'signup-ip' }), async (req, res) => {
  if (authReady(req, res)) return;
  const { club_name, full_name, email, password } = req.body || {};
  const clubName = String(club_name || '').trim();
  const name = String(full_name || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  const pwd = String(password || '');
  if (clubName.length < 2) return res.status(400).json({ error: 'Club name is required' });
  if (clubName.length > 60) return res.status(400).json({ error: 'Club name is too long' });
  if (name.length < 2) return res.status(400).json({ error: 'Your full name is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ error: 'A valid email is required' });
  if (pwd.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (await db.prepare('SELECT id FROM users WHERE email = ?').get(mail)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const slug = await uniqueSlug(slugify(clubName));
  const clubId = await db.createClub(clubName, slug);
  const info = await db.prepare(
    'INSERT INTO users (email, password_hash, full_name, role, club_id) VALUES (?,?,?,?,?)',
  ).run(mail, bcrypt.hashSync(pwd, 10), name, 'supervisor', clubId);
  await db.prepare('UPDATE clubs SET created_by = ? WHERE id = ?').run(info.lastInsertRowid, clubId);

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = jwt.sign(
    { id: user.id, role: user.role, club_id: user.club_id, department_id: user.department_id, full_name: user.full_name },
    JWT_SECRET, { expiresIn: '7d' },
  );
  res.status(201).json({ token, user: await sessionUser(user) });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(await sessionUser(user));
});

module.exports = router;
