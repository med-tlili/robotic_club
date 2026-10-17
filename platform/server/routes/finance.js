// ============================================================
//  routes/finance.js — Finance: sponsor pipeline + budget
//  Rules: the Finance manager (or leaders) write; Finance members
//  + leaders + professor can read. Guests blocked.
//  (Published sponsor offers live on the public feed as posts.)
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { canManageDept, canViewDept, getDept } = require('../deptPerms');

const router = express.Router();
const DEPT_SLUG = 'finance';
const SPONSOR_STATUSES = ['lead', 'contacted', 'negotiating', 'won', 'declined'];

function dept(res) {
  const d = getDept(DEPT_SLUG);
  if (!d) { res.status(404).json({ error: 'Finance department not found' }); return null; }
  return d;
}
function requireView(req, res) {
  const d = dept(res); if (!d) return null;
  if (!canViewDept(req.user, d.id)) { res.status(403).json({ error: 'Private to the Finance department' }); return null; }
  return d;
}
function requireManage(req, res) {
  const d = dept(res); if (!d) return null;
  if (!canManageDept(req.user, d.id)) { res.status(403).json({ error: 'Only the Finance manager or club leaders can do this' }); return null; }
  return d;
}

// ---------- sponsors ----------
router.get('/sponsors', authenticate, (req, res) => {
  const d = requireView(req, res); if (!d) return;
  const rows = db.prepare(
    `SELECT s.*, u.full_name AS owner FROM sponsors s
     LEFT JOIN users u ON u.id = s.created_by
     ORDER BY (s.status = 'won'), s.created_at DESC LIMIT 100`,
  ).all();
  res.json(rows);
});

router.post('/sponsors', authenticate, (req, res) => {
  const d = requireManage(req, res); if (!d) return;
  const {
    name, contact, value, notes, kind, details,
  } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Sponsor name required' });
  // a sponsor gives MONEY (TND) or GOODS (food, tech, material, services…)
  const k = kind === 'goods' ? 'goods' : 'money';
  const what = (details || '').trim();
  if (k === 'goods' && !what) return res.status(400).json({ error: 'Describe what the sponsor gives (e.g. 20 laptops, food for the tournament)' });
  if (k === 'money' && !(Number(value) > 0)) return res.status(400).json({ error: 'Amount required for a money sponsor' });
  const info = db.prepare(
    'INSERT INTO sponsors (name, contact, value, notes, kind, details, created_by) VALUES (?,?,?,?,?,?,?)',
  ).run(name.trim(), (contact || '').trim(), k === 'money' ? Number(value) : 0, (notes || '').trim(), k, what, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM sponsors WHERE id = ?').get(info.lastInsertRowid));
});

router.patch('/sponsors/:id', authenticate, (req, res) => {
  const d = requireManage(req, res); if (!d) return;
  const row = db.prepare('SELECT * FROM sponsors WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Sponsor not found' });
  const status = SPONSOR_STATUSES.includes(req.body?.status) ? req.body.status : row.status;
  db.prepare('UPDATE sponsors SET status = ? WHERE id = ?').run(status, row.id);
  res.json(db.prepare('SELECT * FROM sponsors WHERE id = ?').get(row.id));
});

router.delete('/sponsors/:id', authenticate, (req, res) => {
  const d = requireManage(req, res); if (!d) return;
  db.prepare('DELETE FROM sponsors WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- budget ----------
router.get('/budget', authenticate, (req, res) => {
  const d = requireView(req, res); if (!d) return;
  const rows = db.prepare(
    `SELECT b.*, u.full_name AS author FROM budget_entries b
     LEFT JOIN users u ON u.id = b.created_by ORDER BY b.entry_date DESC, b.created_at DESC LIMIT 200`,
  ).all();
  const income = rows.filter((r) => r.kind === 'income').reduce((s, r) => s + r.amount, 0);
  const expense = rows.filter((r) => r.kind === 'expense').reduce((s, r) => s + r.amount, 0);
  res.json({ entries: rows, income, expense, balance: income - expense });
});

router.post('/budget', authenticate, (req, res) => {
  const d = requireManage(req, res); if (!d) return;
  const { kind, label, amount, entry_date, notes } = req.body || {};
  if (!['income', 'expense'].includes(kind)) return res.status(400).json({ error: 'kind must be income or expense' });
  if (!label?.trim()) return res.status(400).json({ error: 'Label required' });
  const info = db.prepare(
    'INSERT INTO budget_entries (kind, label, amount, entry_date, notes, created_by) VALUES (?,?,?,?,?,?)',
  ).run(kind, label.trim(), Number(amount) || 0, (entry_date || '').trim() || null, (notes || '').trim(), req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM budget_entries WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/budget/:id', authenticate, (req, res) => {
  const d = requireManage(req, res); if (!d) return;
  db.prepare('DELETE FROM budget_entries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
