// ============================================================
//  routes/plans.js — Events: itineraries + decoration planning
//  Rules: the Events manager (or leaders) write; Events members +
//  leaders + supervisor can read. Guests blocked.
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { canManageDept, canViewDept, getDept } = require('../deptPerms');

const router = express.Router();
const DEPT_SLUG = 'events';
const DEC_STATUSES = ['todo', 'in_progress', 'done'];

async function dept(req, res) {
  const d = await getDept(DEPT_SLUG, req.user.club_id);
  if (!d) { res.status(404).json({ error: 'Events department not found' }); return null; }
  return d;
}
async function requireView(req, res) {
  const d = await dept(req, res); if (!d) return null;
  if (!canViewDept(req.user, d.id)) { res.status(403).json({ error: 'Private to the Events department' }); return null; }
  return d;
}
async function requireManage(req, res) {
  const d = await dept(req, res); if (!d) return null;
  if (!canManageDept(req.user, d.id)) { res.status(403).json({ error: 'Only the Events manager or club leaders can do this' }); return null; }
  return d;
}

// ---------- itineraries ----------
router.get('/itineraries', authenticate, async (req, res) => {
  const d = await requireView(req, res); if (!d) return;
  const rows = await db.prepare(
    `SELECT i.*, u.full_name AS author FROM itineraries i
     LEFT JOIN users u ON u.id = i.created_by WHERE i.club_id = ? ORDER BY i.event_date DESC, i.created_at DESC LIMIT 50`,
  ).all(req.user.club_id);
  res.json(rows);
});

router.post('/itineraries', authenticate, async (req, res) => {
  const d = await requireManage(req, res); if (!d) return;
  const { title, event_date, steps } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const info = await db.prepare(
    'INSERT INTO itineraries (club_id, title, event_date, steps, created_by) VALUES (?,?,?,?,?)',
  ).run(req.user.club_id, title.trim(), (event_date || '').trim() || null, (steps || '').trim(), req.user.id);
  res.status(201).json(await db.prepare('SELECT * FROM itineraries WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/itineraries/:id', authenticate, async (req, res) => {
  const d = await requireManage(req, res); if (!d) return;
  await db.prepare('DELETE FROM itineraries WHERE id = ? AND club_id = ?').run(req.params.id, req.user.club_id);
  res.json({ ok: true });
});

// ---------- decorations ----------
router.get('/decorations', authenticate, async (req, res) => {
  const d = await requireView(req, res); if (!d) return;
  const rows = await db.prepare(
    `SELECT dc.*, u.full_name AS author FROM decorations dc
     LEFT JOIN users u ON u.id = dc.created_by
     WHERE dc.club_id = ? ORDER BY (dc.status = 'done'), dc.created_at DESC LIMIT 100`,
  ).all(req.user.club_id);
  res.json(rows);
});

router.post('/decorations', authenticate, async (req, res) => {
  const d = await requireManage(req, res); if (!d) return;
  const { title, description } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const info = await db.prepare(
    'INSERT INTO decorations (club_id, title, description, created_by) VALUES (?,?,?,?)',
  ).run(req.user.club_id, title.trim(), (description || '').trim(), req.user.id);
  res.status(201).json(await db.prepare('SELECT * FROM decorations WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/decorations/:id', authenticate, async (req, res) => {
  const d = await requireManage(req, res); if (!d) return;
  const row = await db.prepare('SELECT * FROM decorations WHERE id = ? AND club_id = ?').get(req.params.id, req.user.club_id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const status = DEC_STATUSES.includes(req.body?.status) ? req.body.status : row.status;
  await db.prepare('UPDATE decorations SET status = ? WHERE id = ?').run(status, row.id);
  res.json(await db.prepare('SELECT * FROM decorations WHERE id = ?').get(row.id));
});

router.delete('/decorations/:id', authenticate, async (req, res) => {
  const d = await requireManage(req, res); if (!d) return;
  await db.prepare('DELETE FROM decorations WHERE id = ? AND club_id = ?').run(req.params.id, req.user.club_id);
  res.json({ ok: true });
});

module.exports = router;
