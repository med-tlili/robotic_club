// ============================================================
//  routes/auth.js — login / current user
// ============================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id, email: u.email, full_name: u.full_name,
    role: u.role, department_id: u.department_id, bio: u.bio
  };
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = jwt.sign(
    { id: user.id, role: user.role, department_id: user.department_id, full_name: user.full_name },
    JWT_SECRET, { expiresIn: '7d' }
  );
  res.json({ token, user: publicUser(user) });
});

// POST /api/auth/signup-professor — OPEN sign-up: anyone can register as
// Professor at any time (user decision — no gate, no invite, no fresh-install
// rule). Email must be unique; everything else is standard validation.
router.post('/signup-professor', (req, res) => {
  const { full_name, email, password } = req.body || {};
  const name = String(full_name || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  const pwd = String(password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Full name is required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ error: 'A valid email is required' });
  if (pwd.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  if (db.prepare('SELECT id FROM users WHERE email = ?').get(mail)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  db.prepare('INSERT INTO users (email, password_hash, full_name, role) VALUES (?,?,?,?)')
    .run(mail, bcrypt.hashSync(pwd, 10), name, 'professor');

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
  const token = jwt.sign(
    { id: user.id, role: user.role, department_id: user.department_id, full_name: user.full_name },
    JWT_SECRET, { expiresIn: '7d' },
  );
  res.status(201).json({ token, user: publicUser(user) });
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(publicUser(user));
});

module.exports = router;
