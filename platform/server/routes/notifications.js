// ============================================================
//  routes/notifications.js — personal inbox
//  Every signed-in user (incl. guests) has one.
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications — my last 30 + unread count
router.get('/', authenticate, async (req, res) => {
  const rows = await db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30'
  ).all(req.user.id);
  const unread = (await db.prepare(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0'
  ).get(req.user.id)).c;
  res.json({ items: rows, unread });
});

// POST /api/notifications/read-all
router.post('/read-all', authenticate, async (req, res) => {
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// POST /api/notifications/:id/read — one notification (owner only)
router.post('/:id/read', authenticate, async (req, res) => {
  const n = await db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: 'Notification not found' });
  await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(n.id);
  res.json({ ok: true });
});

module.exports = router;
