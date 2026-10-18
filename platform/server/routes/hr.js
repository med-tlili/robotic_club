// ============================================================
//  routes/hr.js — HR: attendance, meeting conclusions, alerts
//  Rules: the HR manager (or leaders) write; HR members + leaders
//  + supervisor can read. Guests blocked.
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { canManageDept, canViewDept, getDept } = require('../deptPerms');

const router = express.Router();
const DEPT_SLUG = 'hr';
const STATUSES = ['present', 'absent', 'late'];

async function dept(req, res) {
  const d = await getDept(DEPT_SLUG, req.user.club_id);
  if (!d) { res.status(404).json({ error: 'HR department not found' }); return null; }
  return d;
}
async function requireView(req, res) {
  const d = await dept(req, res); if (!d) return null;
  if (!canViewDept(req.user, d.id)) { res.status(403).json({ error: 'Private to the HR department' }); return null; }
  return d;
}
async function requireManage(req, res) {
  const d = await dept(req, res); if (!d) return null;
  if (!canManageDept(req.user, d.id)) { res.status(403).json({ error: 'Only the HR manager or club leaders can do this' }); return null; }
  return d;
}

// ---------- attendance ----------
// GET /api/hr/attendance?date=YYYY-MM-DD — members + their status that day
router.get('/attendance', authenticate, async (req, res) => {
  const d = await requireView(req, res); if (!d) return;
  const date = req.query.date;
  const members = await db.prepare(
    "SELECT id, full_name, role FROM users WHERE department_id = ? AND role IN ('manager','member') ORDER BY full_name",
  ).all(d.id);
  const marks = date
    ? await db.prepare('SELECT * FROM attendance WHERE meeting_date = ? AND club_id = ?').all(date, req.user.club_id)
    : [];
  const byUser = Object.fromEntries(marks.map((m) => [m.user_id, m]));
  res.json(members.map((m) => ({
    user_id: m.id,
    full_name: m.full_name,
    role: m.role,
    status: byUser[m.id]?.status || null,
    notes: byUser[m.id]?.notes || '',
  })));
});

// GET /api/hr/attendance/dates — dates that already have records
router.get('/attendance/dates', authenticate, async (req, res) => {
  const d = await requireView(req, res); if (!d) return;
  const rows = await db.prepare(
    'SELECT DISTINCT meeting_date FROM attendance WHERE club_id = ? ORDER BY meeting_date DESC LIMIT 60',
  ).all(req.user.club_id);
  res.json(rows.map((r) => r.meeting_date));
});

// POST /api/hr/attendance — upsert marks for a date
router.post('/attendance', authenticate, async (req, res) => {
  const d = await requireManage(req, res); if (!d) return;
  const { meeting_date, entries } = req.body || {};
  if (!meeting_date) return res.status(400).json({ error: 'meeting_date required' });
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries array required' });
  const up = db.prepare(
    `INSERT INTO attendance (club_id, meeting_date, user_id, status, notes, marked_by)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(meeting_date, user_id)
     DO UPDATE SET status=excluded.status, notes=excluded.notes, marked_by=excluded.marked_by`,
  );
  let count = 0;
  for (const e of entries) {
    const status = STATUSES.includes(e.status) ? e.status : 'present';
    const member = await db.prepare('SELECT id FROM users WHERE id = ? AND department_id = ?')
      .get(Number(e.user_id), d.id);
    if (!member) continue;
    await up.run(req.user.club_id, meeting_date, member.id, status, (e.notes || '').trim(), req.user.id);
    count += 1;
  }
  res.json({ ok: true, marked: count });
});

// ---------- meeting conclusions ----------
router.get('/notes', authenticate, async (req, res) => {
  const d = await requireView(req, res); if (!d) return;
  const rows = await db.prepare(
    `SELECT n.*, u.full_name AS author FROM meeting_notes n
     LEFT JOIN users u ON u.id = n.created_by WHERE n.club_id = ? ORDER BY n.created_at DESC LIMIT 50`,
  ).all(req.user.club_id);
  res.json(rows);
});

router.post('/notes', authenticate, async (req, res) => {
  const d = await requireManage(req, res); if (!d) return;
  const { title, body, meeting_date } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const info = await db.prepare(
    'INSERT INTO meeting_notes (club_id, title, body, meeting_date, created_by) VALUES (?,?,?,?,?)',
  ).run(req.user.club_id, title.trim(), (body || '').trim(), (meeting_date || '').trim() || null, req.user.id);
  res.status(201).json(await db.prepare('SELECT * FROM meeting_notes WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/notes/:id', authenticate, async (req, res) => {
  const d = await requireManage(req, res); if (!d) return;
  await db.prepare('DELETE FROM meeting_notes WHERE id = ? AND club_id = ?').run(req.params.id, req.user.club_id);
  res.json({ ok: true });
});

// ---------- rule-break alerts ----------
router.get('/alerts', authenticate, async (req, res) => {
  const d = await requireView(req, res); if (!d) return;
  const rows = await db.prepare(
    `SELECT a.*, u.full_name AS member, r.full_name AS reporter FROM alerts a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN users r ON r.id = a.reported_by
     WHERE a.club_id = ? ORDER BY a.created_at DESC LIMIT 50`,
  ).all(req.user.club_id);
  res.json(rows);
});

router.post('/alerts', authenticate, async (req, res) => {
  const d = await requireManage(req, res); if (!d) return;
  const { user_id, title, description, severity } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
  const info = await db.prepare(
    'INSERT INTO alerts (club_id, user_id, title, description, severity, reported_by) VALUES (?,?,?,?,?,?)',
  ).run(req.user.club_id, user_id ? Number(user_id) : null, title.trim(), (description || '').trim(),
    ['minor', 'major', 'critical'].includes(severity) ? severity : 'minor', req.user.id);
  res.status(201).json(await db.prepare('SELECT * FROM alerts WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/alerts/:id', authenticate, async (req, res) => {
  const d = await requireManage(req, res); if (!d) return;
  await db.prepare('DELETE FROM alerts WHERE id = ? AND club_id = ?').run(req.params.id, req.user.club_id);
  res.json({ ok: true });
});

module.exports = router;
