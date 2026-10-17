// ============================================================
//  routes/events.js — global calendar
//  Rules (README): the Leader (and Co-Leader) put/edit dates;
//  everyone else only views. Events are public club info.
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const isEditor = (role) => ['leader', 'coleader'].includes(role);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/events — public (login not required, like the department pages)
router.get('/', (req, res) => {
  const events = db.prepare(`
    SELECT e.*, u.full_name AS created_by_name
    FROM events e LEFT JOIN users u ON u.id = e.created_by
    ORDER BY e.event_date, e.event_time
  `).all();
  res.json(events);
});

// POST /api/events — Leader / Co-Leader only
router.post('/', authenticate, (req, res) => {
  if (!isEditor(req.user.role)) return res.status(403).json({ error: 'Only the Leader and Co-Leader can add dates to the calendar' });
  const { title, description, event_date, event_time, location } = req.body || {};
  if (!title?.trim() || !event_date || !DATE_RE.test(event_date)) {
    return res.status(400).json({ error: 'title and a valid event_date (YYYY-MM-DD) are required' });
  }
  const info = db.prepare(
    'INSERT INTO events (title, description, event_date, event_time, location, created_by) VALUES (?,?,?,?,?,?)'
  ).run(title.trim(), (description || '').trim(), event_date, (event_time || '').trim(), (location || '').trim(), req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid));
});

// PATCH /api/events/:id — Leader / Co-Leader only
router.patch('/:id', authenticate, (req, res) => {
  if (!isEditor(req.user.role)) return res.status(403).json({ error: 'Only the Leader and Co-Leader can modify the calendar' });
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  const merged = { ...ev, ...req.body };
  if (!DATE_RE.test(merged.event_date)) return res.status(400).json({ error: 'Invalid event_date' });
  db.prepare(
    'UPDATE events SET title=?, description=?, event_date=?, event_time=?, location=? WHERE id=?'
  ).run((merged.title || '').trim(), (merged.description || '').trim(), merged.event_date,
    (merged.event_time || '').trim(), (merged.location || '').trim(), ev.id);
  res.json(db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id));
});

// DELETE /api/events/:id — Leader / Co-Leader only
router.delete('/:id', authenticate, (req, res) => {
  if (!isEditor(req.user.role)) return res.status(403).json({ error: 'Only the Leader and Co-Leader can modify the calendar' });
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
  res.json({ ok: true });
});

module.exports = router;
