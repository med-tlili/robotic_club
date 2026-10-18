// ============================================================
//  routes/applications.js — guest → member pipeline
//  Rules (README): a Guest applies to join a department;
//  the Leader/Co-Leader (or the manager of that department)
//  accepts or refuses. Supervisor: read-only, sees everything.
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { deptInClub } = require('../deptPerms');
const { notify, notifyMany } = require('../notify');

const router = express.Router();

const isBoss = (role) => ['leader', 'coleader'].includes(role);

// GET /api/applications — who may see what:
//   Leader/Co-Leader + Supervisor: all
//   Manager: only applications for his own department
router.get('/', authenticate, async (req, res) => {
  const rows = await db.prepare(`
    SELECT a.*, u.full_name, u.email, u.role AS applicant_role, d.name AS department_name,
           r.full_name AS reviewer_name
    FROM applications a
    JOIN users u ON u.id = a.user_id
    JOIN departments d ON d.id = a.department_id
    LEFT JOIN users r ON r.id = a.reviewed_by
    WHERE d.club_id = ?
    ORDER BY (a.status = 'pending') DESC, a.created_at DESC
  `).all(req.user.club_id);

  const visible = rows.filter((a) => {
    if (isBoss(req.user.role) || req.user.role === 'supervisor') return true;
    if (req.user.role === 'manager') return a.department_id === req.user.department_id;
    return false;
  });
  res.json(visible);
});

// POST /api/applications — Guests only, one pending at a time
router.post('/', authenticate, async (req, res) => {
  if (req.user.role !== 'guest') {
    return res.status(403).json({ error: 'Only guests can apply to join a department' });
  }
  const { department_id, message } = req.body || {};
  const dept = await db.prepare('SELECT * FROM departments WHERE id = ? AND club_id = ?').get(Number(department_id), req.user.club_id);
  if (!dept || dept.slug === 'materials') return res.status(400).json({ error: 'Choose a valid department' });

  const pending = await db.prepare(
    "SELECT id FROM applications WHERE user_id = ? AND status = 'pending'"
  ).get(req.user.id);
  if (pending) return res.status(409).json({ error: 'You already have a pending application' });

  const info = await db.prepare(
    'INSERT INTO applications (user_id, department_id, message) VALUES (?,?,?)'
  ).run(req.user.id, dept.id, (message || '').trim());

  // notify the reviewers: Leader + Co-Leader + this department's manager
  const reviewers = (await db.prepare(
    "SELECT id FROM users WHERE (role IN ('leader','coleader') OR (role='manager' AND department_id = ?)) AND club_id = ?"
  ).all(dept.id, req.user.club_id)).map((r) => r.id);
  await notifyMany(reviewers, {
    type: 'application',
    title: 'New membership application',
    body: `${req.user.full_name} applied to join ${dept.name}`,
    link: '/',
  }, req.user.id);

  res.status(201).json(await db.prepare('SELECT * FROM applications WHERE id = ?').get(info.lastInsertRowid));
});

// GET /api/applications/mine — the applicant's own status (guest view)
router.get('/mine', authenticate, async (req, res) => {
  const rows = await db.prepare(`
    SELECT a.*, d.name AS department_name FROM applications a
    JOIN departments d ON d.id = a.department_id
    WHERE a.user_id = ? ORDER BY a.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

// helper: may this user review applications for this department?
// (Supervisor is deliberately excluded — read-only everywhere.)
function canReview(user, deptId) {
  if (['leader', 'coleader'].includes(user.role)) return true;
  return user.role === 'manager' && user.department_id === deptId;
}

// POST /api/applications/:id/accept — applicant becomes a member of that dept
router.post('/:id/accept', authenticate, async (req, res) => {
  const app = await db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!app || !(await deptInClub(app.department_id, req.user.club_id))) return res.status(404).json({ error: 'Application not found' });
  if (app.status !== 'pending') return res.status(409).json({ error: 'Already reviewed' });
  if (!canReview(req.user, app.department_id)) {
    return res.status(403).json({ error: 'Only the Leader, Co-Leader or this department\'s manager can review' });
  }
  await db.prepare(
    "UPDATE applications SET status='accepted', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?"
  ).run(req.user.id, app.id);
  await db.prepare('UPDATE users SET role=?, department_id=? WHERE id=?')
    .run('member', app.department_id, app.user_id);
  const dept = await db.prepare('SELECT name, slug FROM departments WHERE id = ?').get(app.department_id);
  await notify(app.user_id, {
    type: 'application_result',
    title: 'Application accepted',
    body: `You are now a member of ${dept.name}`,
    link: `/departments/${dept.slug}`,
  });
  res.json({ ok: true, user_id: app.user_id });
});

// POST /api/applications/:id/refuse
router.post('/:id/refuse', authenticate, async (req, res) => {
  const app = await db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!app || !(await deptInClub(app.department_id, req.user.club_id))) return res.status(404).json({ error: 'Application not found' });
  if (app.status !== 'pending') return res.status(409).json({ error: 'Already reviewed' });
  if (!canReview(req.user, app.department_id)) {
    return res.status(403).json({ error: 'Only the Leader, Co-Leader or this department\'s manager can review' });
  }
  await db.prepare(
    "UPDATE applications SET status='refused', reviewed_by=?, reviewed_at=datetime('now') WHERE id=?"
  ).run(req.user.id, app.id);
  const deptR = await db.prepare('SELECT name FROM departments WHERE id = ?').get(app.department_id);
  await notify(app.user_id, {
    type: 'application_result',
    title: 'Application reviewed',
    body: `Your application for ${deptR.name} was not accepted — you can apply again`,
    link: '/',
  });
  res.json({ ok: true });
});

module.exports = router;
