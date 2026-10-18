// ============================================================
//  routes/departments.js — public home pages + private info
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/departments — the departments of the caller's club (session required:
// which departments you see depends on which club you belong to)
router.get('/', authenticate, async (req, res) => {
  const departments = await db.prepare(
    'SELECT id, slug, name, description, coming_soon FROM departments WHERE club_id = ? ORDER BY id'
  ).all(req.user.club_id);
  res.json(departments);
});

// GET /api/departments/:slug — department home.
// Requires a session (the page itself is members+guests only); the member
// list is decided SERVER-SIDE from the caller's role — never from a query
// flag the client controls.
router.get('/:slug', authenticate, async (req, res) => {
  const dept = await db.prepare(
    'SELECT id, slug, name, description, coming_soon FROM departments WHERE slug = ? AND club_id = ?'
  ).get(req.params.slug, req.user.club_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  // goals visible to every signed-in member (assigned by the leader)
  dept.goals = await db.prepare(
    'SELECT id, title, description, due_date FROM goals WHERE department_id = ? ORDER BY due_date'
  ).all(dept.id);

  // members list — never for guests, whatever the query string says
  dept.members = [];
  if (req.user.role !== 'guest') {
    dept.members = await db.prepare(`
      SELECT id, full_name, role FROM users
      WHERE department_id = ? AND role IN ('manager','member') ORDER BY role, full_name
    `).all(dept.id);
  }
  res.json(dept);
});

// GET /api/departments/:slug/private — ONLY department members + boss (skeleton for Sprint 2+)
router.get('/:slug/private', authenticate, async (req, res) => {
  const dept = await db.prepare('SELECT * FROM departments WHERE slug = ? AND club_id = ?').get(req.params.slug, req.user.club_id);
  if (!dept) return res.status(404).json({ error: 'Department not found' });

  const boss = ['supervisor', 'leader', 'coleader'].includes(req.user.role);
  const inDept = req.user.department_id === dept.id;
  if (!boss && !inDept) return res.status(403).json({ error: 'Private area: department members only' });

  res.json({ message: `Welcome to the private ${dept.name} space`, tasks: [] }); // tasks in Sprint 3
});

module.exports = router;
