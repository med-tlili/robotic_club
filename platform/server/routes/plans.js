// ============================================================
//  routes/plans.js — Events: itineraries + decoration planning
//  Rules: the Events manager (or leaders) write; Events members +
//  leaders + professor can read. Guests blocked.
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { canManageDept, canViewDept, getDept } = require('../deptPerms');

const router = express.Router();
const DEPT_SLUG = 'events';
const DEC_STATUSES = ['todo', 'in_progress', 'done'];

function dept(res) {
  const d = getDept(DEPT_SLUG);
  if (!d) { res.status(404).json({ error: 'Events department not found' }); return null; }
  return d;
}
function requireView(req, res) {
  const d = dept(res); if (!d) return null;
  if (!canViewDept(req.user, d.id)) { res.status(403).json({ error: 'Private to the Events department' }); return null; }
  return d;
}
function requireManage(req, res) {
  const d = dept(res); if (!d) return null;
  if (!canManageDept(req.user, d.id)) { res.status(403).json({ error: 'Only the Events manager or club leaders can do this' }); return null; }
  return d;
}

// ---------- itineraries ----------
router.get('/itineraries', authenticate, (req, res) => {
  const d = requireView(req, res); if (!d) return;
  const rows = db.prepare(
    `SELECT i.*, u.full_name AS author FROM itineraries i
     LEFT JOIN users u ON u.id = i.created_by ORDER BY i.event_date DESC, i.created_at DESC LIMIT 50`,
  ).all();
  res.json(rows);
});

router.post('/itineraries', authenticate, (req, res) => {
  const d = requireManage(req, res); if (!d) return;
  const { title, event_date, steps } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const info = db.prepare(
    'INSERT INTO itineraries (title, event_date, steps, created_by) VALUES (?,?,?,?)',
  ).run(title.trim(), (event_date || '').trim() || null, (steps || '').trim(), req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM itineraries WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/itineraries/:id', authenticate, (req, res) => {
  const d = requireManage(req, res); if (!d) return;
  db.prepare('DELETE FROM itineraries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- decorations ----------
router.get('/decorations', authenticate, (req, res) => {
  const d = requireView(req, res); if (!d) return;
  const rows = db.prepare(
    `SELECT dc.*, u.full_name AS author FROM decorations dc
     LEFT JOIN users u ON u.id = dc.created_by
     ORDER BY (dc.status = 'done'), dc.created_at DESC LIMIT 100`,
  ).all();
  res.json(rows);
});

router.post('/decorations', authenticate, (req, res) => {
  const d = requireManage(req, res); if (!d) return;
  const { title, description } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const info = db.prepare(
    'INSERT INTO decorations (title, description, created_by) VALUES (?,?,?)',
  ).run(title.trim(), (description || '').trim(), req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM decorations WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/decorations/:id', authenticate, (req, res) => {
  const d = requireManage(req, res); if (!d) return;
  const row = db.prepare('SELECT * FROM decorations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const status = DEC_STATUSES.includes(req.body?.status) ? req.body.status : row.status;
  db.prepare('UPDATE decorations SET status = ? WHERE id = ?').run(status, row.id);
  res.json(db.prepare('SELECT * FROM decorations WHERE id = ?').get(row.id));
});

router.delete('/decorations/:id', authenticate, (req, res) => {
  const d = requireManage(req, res); if (!d) return;
  db.prepare('DELETE FROM decorations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
