// ============================================================
//  routes/events.js — global calendar
//  Rules (README): the Leader (and Co-Leader) put/edit dates;
//  every authenticated member views (guests included). Events are
//  club info for MEMBERS — the API never serves them anonymously.
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const isEditor = (role) => ['leader', 'coleader'].includes(role);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;
const validDate = (d) => typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(new Date(d + 'T00:00:00').getTime());
const validTime = (t) => !t || TIME_RE.test(String(t));

// GET /api/events — authenticated members of the club only (401 otherwise)
router.get('/', authenticate, async (req, res) => {
  const events = await db.prepare(`
    SELECT e.*, u.full_name AS created_by_name
    FROM events e LEFT JOIN users u ON u.id = e.created_by
    WHERE e.club_id = ?
    ORDER BY e.event_date, e.event_time
  `).all(req.user.club_id);
  res.json(events);
});

// POST /api/events — Leader / Co-Leader only
router.post('/', authenticate, async (req, res) => {
  if (!isEditor(req.user.role)) return res.status(403).json({ error: 'Only the Leader and Co-Leader can add dates to the calendar' });
  const { title, description, event_date, event_time, location, end_date } = req.body || {};
  if (!title?.trim() || !validDate(event_date)) {
    return res.status(400).json({ error: 'title and a valid event_date (YYYY-MM-DD) are required' });
  }
  if (!validTime(event_time)) return res.status(400).json({ error: 'event_time must be HH:MM' });
  const end = String(end_date || '').trim();
  if (end && !validDate(end)) return res.status(400).json({ error: 'end_date must be YYYY-MM-DD' });
  if (end && end < event_date) return res.status(400).json({ error: 'end_date cannot be before event_date' });
  const info = await db.prepare(
    'INSERT INTO events (club_id, title, description, event_date, end_date, event_time, location, created_by) VALUES (?,?,?,?,?,?,?,?)'
  ).run(req.user.club_id, title.trim(), (description || '').trim(), event_date, end, (event_time || '').trim(), (location || '').trim(), req.user.id);
  res.status(201).json(await db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid));
});

// PATCH /api/events/:id — Leader / Co-Leader only
router.patch('/:id', authenticate, async (req, res) => {
  if (!isEditor(req.user.role)) return res.status(403).json({ error: 'Only the Leader and Co-Leader can modify the calendar' });
  const ev = await db.prepare('SELECT * FROM events WHERE id = ? AND club_id = ?').get(req.params.id, req.user.club_id);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  const merged = { ...ev, ...req.body };
  if (!validDate(merged.event_date)) return res.status(400).json({ error: 'Invalid event_date' });
  if (!validTime(merged.event_time)) return res.status(400).json({ error: 'event_time must be HH:MM' });
  const end = String(merged.end_date || '').trim();
  if (end && !validDate(end)) return res.status(400).json({ error: 'end_date must be YYYY-MM-DD' });
  if (end && end < merged.event_date) return res.status(400).json({ error: 'end_date cannot be before event_date' });
  await db.prepare(
    'UPDATE events SET title=?, description=?, event_date=?, end_date=?, event_time=?, location=? WHERE id=?'
  ).run((merged.title || '').trim(), (merged.description || '').trim(), merged.event_date, end,
    (merged.event_time || '').trim(), (merged.location || '').trim(), ev.id);
  res.json(await db.prepare('SELECT * FROM events WHERE id = ?').get(ev.id));
});

// DELETE /api/events/:id — Leader / Co-Leader only
router.delete('/:id', authenticate, async (req, res) => {
  if (!isEditor(req.user.role)) return res.status(403).json({ error: 'Only the Leader and Co-Leader can modify the calendar' });
  const ev = await db.prepare('SELECT * FROM events WHERE id = ? AND club_id = ?').get(req.params.id, req.user.club_id);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  await db.prepare('DELETE FROM events WHERE id = ?').run(ev.id);
  res.json({ ok: true });
});

module.exports = router;
