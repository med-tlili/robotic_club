// ============================================================
//  routes/goals.js — leader assigns goals per department
//  Club-scoped: a goal belongs to a department, and a department
//  belongs to exactly one club (enforced with deptInClub).
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { deptInClub } = require('../deptPerms');

const router = express.Router();

// POST /api/goals — leader/co-leader only
router.post('/', authenticate, requireRole('leader', 'coleader'), async (req, res) => {
  const { department_id, title, description, due_date } = req.body || {};
  if (!department_id || !title) return res.status(400).json({ error: 'department_id and title required' });
  // the department must belong to the caller's club (no cross-club writes)
  if (!(await deptInClub(Number(department_id), req.user.club_id))) {
    return res.status(404).json({ error: 'Department not found' });
  }
  const info = await db.prepare(
    'INSERT INTO goals (department_id, title, description, due_date, created_by) VALUES (?,?,?,?,?)'
  ).run(department_id, title, description || '', due_date || null, req.user.id);
  const goal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(goal);
});

// GET /api/goals?department_id=1 — everyone logged in can view
router.get('/', authenticate, async (req, res) => {
  const { department_id } = req.query;
  if (department_id) {
    if (!(await deptInClub(Number(department_id), req.user.club_id))) {
      return res.status(404).json({ error: 'Department not found' });
    }
    return res.json(await db.prepare(
      'SELECT * FROM goals WHERE department_id = ? ORDER BY due_date',
    ).all(department_id));
  }
  // no department given → every goal OF THE CALLER'S CLUB only
  res.json(await db.prepare(`
    SELECT g.* FROM goals g
    JOIN departments d ON d.id = g.department_id
    WHERE d.club_id = ?
    ORDER BY g.due_date
  `).all(req.user.club_id));
});

module.exports = router;
