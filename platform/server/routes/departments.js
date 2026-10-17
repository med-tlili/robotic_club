// ============================================================
//  routes/departments.js — public home pages + private info
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/departments — list (public info)
router.get('/', (req, res) => {
  const departments = db.prepare('SELECT id, slug, name, description, coming_soon FROM departments').all();
  res.json(departments);
});

// GET /api/departments/:slug — department public home
router.get('/:slug', (req, res) => {
  const dept = db.prepare(
    'SELECT id, slug, name, description, coming_soon FROM departments WHERE slug = ?'
  ).get(req.params.slug);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  // goals visible to everyone (assigned by the leader)
  dept.goals = db.prepare(
    'SELECT id, title, description, due_date FROM goals WHERE department_id = ? ORDER BY due_date'
  ).all(dept.id);

  // members list — hidden from guests
  dept.members = [];
  if (!req.query.guest) {
    dept.members = db.prepare(`
      SELECT id, full_name, role FROM users
      WHERE department_id = ? AND role IN ('manager','member') ORDER BY role, full_name
    `).all(dept.id);
  }
  res.json(dept);
});

// GET /api/departments/:slug/private — ONLY department members + boss (skeleton for Sprint 2+)
router.get('/:slug/private', authenticate, (req, res) => {
  const dept = db.prepare('SELECT * FROM departments WHERE slug = ?').get(req.params.slug);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const boss = ['professor', 'leader', 'coleader'].includes(req.user.role);
  const inDept = req.user.department_id === dept.id;
  if (!boss && !inDept) return res.status(403).json({ error: 'Private area: department members only' });

  res.json({ message: `Welcome to the private ${dept.name} space`, tasks: [] }); // tasks in Sprint 3
});

module.exports = router;
