// ============================================================
//  routes/goals.js — leader assigns goals per department
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate, requireRole, isBoss } = require('../middleware/auth');

const router = express.Router();

// POST /api/goals — leader/co-leader only
router.post('/', authenticate, requireRole('leader', 'coleader'), async (req, res) => {
  const { department_id, title, description, due_date } = req.body || {};
  if (!department_id || !title) return res.status(400).json({ error: 'department_id and title required' });
  const info = await db.prepare(
    'INSERT INTO goals (department_id, title, description, due_date, created_by) VALUES (?,?,?,?,?)'
  ).run(department_id, title, description || '', due_date || null, req.user.id);
  const goal = await db.prepare('SELECT * FROM goals WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(goal);
});

// GET /api/goals?department_id=1 — everyone logged in can view
router.get('/', authenticate, async (req, res) => {
  const { department_id } = req.query;
  const goals = department_id
    ? await db.prepare('SELECT * FROM goals WHERE department_id = ? ORDER BY due_date').all(department_id)
    : await db.prepare('SELECT * FROM goals ORDER BY due_date').all();
  res.json(goals);
});

module.exports = router;
