// ============================================================
//  routes/meetings.js — live club meetings (phase 5)
//
//  Rules (README):
//   - only LEADERSHIP may START a meeting: Supervisor, Leader,
//     Co-Leader or a department Manager. Members/guests cannot.
//   - anyone (non-guest) who can SEE a meeting may ASK TO JOIN;
//     the host accepts or declines. Accepting is what grants the
//     meeting chat (global / department / private scopes).
//   - several meetings run at once; each has its own chat.
//   - guests: no meetings at all (403).
//   - every read/write is scoped to the caller's club.
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { notify, notifyMany } = require('../notify');
const { deptInClub } = require('../deptPerms');

const router = express.Router();

const LEADERSHIP = ['supervisor', 'leader', 'coleader', 'manager'];
const SCOPE_LABELS = { global: 'Club-wide', department: 'Department', private: 'Private' };
const canCreate = (user) => LEADERSHIP.includes(user.role);
const isBoss = (user) => ['leader', 'coleader', 'supervisor'].includes(user.role);

const io = (req) => req.app.get('io');
const emitUser = (req, uid, event, payload) => {
  const s = io(req);
  if (s) s.to(`user:${uid}`).emit(event, payload);
};

// ---------- small helpers ----------
async function getMeeting(id, clubId) {
  return await db.prepare('SELECT * FROM meetings WHERE id = ? AND club_id = ?').get(id, clubId) || null;
}
async function myParticipant(meetingId, userId) {
  return await db.prepare(
    'SELECT * FROM meeting_participants WHERE meeting_id = ? AND user_id = ?',
  ).get(meetingId, userId) || null;
}
// can this user SEE the meeting at all?
async function canSee(user, m) {
  if (!m || user.role === 'guest') return false;
  if (m.started_by === user.id) return true;
  if (await myParticipant(m.id, user.id)) return true;
  if (m.scope === 'global') return true;
  if (m.scope === 'department') return isBoss(user) || user.department_id === m.department_id;
  return false; // private — only invited people (the participant row above)
}
// may this user read/post in the meeting chat?
async function isAccepted(user, m) {
  if (m.started_by === user.id) return true;
  const p = await myParticipant(m.id, user.id);
  return !!p && p.status === 'accepted';
}
function parseIds(raw) {
  let list = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string' && raw.trim()) { try { const j = JSON.parse(raw); list = Array.isArray(j) ? j : raw.split(','); } catch { list = raw.split(','); } }
  return [...new Set(list.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
}

// ---------- shaping ----------
async function shapeMeeting(user, m, { withPeople = false } = {}) {
  const p = await myParticipant(m.id, user.id);
  const counts = await db.prepare(`
    SELECT COUNT(CASE WHEN status = 'accepted' THEN 1 END) AS accepted,
           COUNT(CASE WHEN status = 'pending'  THEN 1 END) AS pending
    FROM meeting_participants WHERE meeting_id = ?
  `).get(m.id);
  const host = await db.prepare('SELECT id, full_name, role FROM users WHERE id = ?').get(m.started_by);
  const dept = m.department_id
    ? await db.prepare('SELECT id, slug, name FROM departments WHERE id = ?').get(m.department_id)
    : null;
  const hostView = m.started_by === user.id;
  const inChat = hostView || (p && p.status === 'accepted');
  // the last-message preview + unread count are for people who may READ the
  // chat — a pending/outsider must not learn what was said inside.
  let last = null;
  let unread = 0;
  if (inChat) {
    last = await db.prepare(`
      SELECT mm.id, mm.body, mm.created_at, u.full_name AS sender
      FROM meeting_messages mm JOIN users u ON u.id = mm.sender_id
      WHERE mm.meeting_id = ? ORDER BY mm.id DESC LIMIT 1
    `).get(m.id);
    const read = (await db.prepare(
      'SELECT last_read_id FROM meeting_reads WHERE meeting_id = ? AND user_id = ?',
    ).get(m.id, user.id))?.last_read_id || 0;
    unread = (await db.prepare(
      'SELECT COUNT(*) AS c FROM meeting_messages WHERE meeting_id = ? AND sender_id != ? AND id > ?',
    ).get(m.id, user.id, read)).c;
  }

  const out = {
    id: m.id,
    title: m.title,
    description: m.description,
    scope: m.scope,
    scope_label: SCOPE_LABELS[m.scope] || m.scope,
    status: m.status,
    created_at: m.created_at,
    ended_at: m.ended_at,
    host,
    department: dept,
    is_host: hostView,
    my_status: hostView ? 'host' : (p ? p.status : null),
    my_origin: hostView ? 'host' : (p ? p.origin : null),
    can_join: m.status === 'live' && !p,
    accepted: Number(counts.accepted) || 0,
    pending: hostView ? (Number(counts.pending) || 0) : 0,
    last_body: last ? last.body : null,
    last_sender: last ? last.sender : null,
    last_at: last ? last.created_at : null,
    unread,
  };

  if (withPeople) {
    const accepted = await db.prepare(`
      SELECT mp.status, mp.role, u.id, u.full_name, u.role AS user_role
      FROM meeting_participants mp JOIN users u ON u.id = mp.user_id
      WHERE mp.meeting_id = ? AND mp.status = 'accepted'
      ORDER BY (mp.role = 'host') DESC, u.full_name
    `).all(m.id);
    out.participants = accepted;
    // pending requests are private to the host
    out.requests = hostView ? await db.prepare(`
      SELECT mp.user_id AS id, mp.created_at, u.full_name, u.role AS user_role
      FROM meeting_participants mp JOIN users u ON u.id = mp.user_id
      WHERE mp.meeting_id = ? AND mp.status = 'pending'
      ORDER BY mp.created_at
    `).all(m.id) : [];
  }
  return out;
}

// who should hear about a meeting (for start / new-message pushes)
async function audienceIds(m) {
  const rows = await db.prepare(`
    SELECT id FROM users WHERE club_id = ? AND role != 'guest' AND id != ?
  `).all(m.club_id, m.started_by);
  if (m.scope === 'global') return rows.map((r) => r.id);
  if (m.scope === 'department') {
    const members = await db.prepare(`
      SELECT id FROM users
      WHERE club_id = ? AND id != ?
        AND (role IN ('leader','coleader','supervisor') OR department_id = ?)
    `).all(m.club_id, m.started_by, m.department_id);
    return members.map((r) => r.id);
  }
  return []; // private → invitees are notified individually
}

// accepted participant ids (the people who can read the chat)
async function acceptedIds(meetingId) {
  const rows = await db.prepare(
    "SELECT user_id FROM meeting_participants WHERE meeting_id = ? AND status = 'accepted'",
  ).all(meetingId);
  return rows.map((r) => r.user_id);
}

// ============================================================
//  GET /api/meetings — every meeting I can see, live first
// ============================================================
router.get('/', authenticate, async (req, res) => {
  if (req.user.role === 'guest') return res.status(403).json({ error: 'Guests cannot see meetings' });
  const rows = await db.prepare(`
    SELECT DISTINCT m.* FROM meetings m
    LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.user_id = ?
    WHERE m.club_id = ? AND (
      m.scope = 'global'
      OR (m.scope = 'department' AND (? IN ('leader','coleader','supervisor') OR m.department_id = ?))
      OR m.started_by = ?
      OR mp.id IS NOT NULL
    )
    ORDER BY CASE WHEN m.status = 'live' THEN 0 ELSE 1 END, m.id DESC
    LIMIT 100
  `).all(req.user.id, req.user.club_id, req.user.role, req.user.department_id, req.user.id);
  res.json(await Promise.all(rows.map((m) => shapeMeeting(req.user, m))));
});

// ============================================================
//  POST /api/meetings — start one (leadership only)
// ============================================================
router.post('/', authenticate, async (req, res) => {
  if (!canCreate(req.user)) {
    return res.status(403).json({ error: 'Only the Supervisor, Leader, Co-Leader or a department Manager can start a meeting' });
  }
  const title = String(req.body?.title || '').trim();
  const description = String(req.body?.description || '').trim().slice(0, 2000);
  const scope = ['global', 'department', 'private'].includes(req.body?.scope) ? req.body.scope : 'global';
  if (title.length < 2) return res.status(400).json({ error: 'A meeting needs a title' });
  if (title.length > 140) return res.status(400).json({ error: 'Title is too long' });

  let departmentId = null;
  if (scope === 'department') {
    departmentId = Number(req.body?.department_id);
    if (!(await deptInClub(departmentId, req.user.club_id))) {
      return res.status(400).json({ error: 'A department meeting needs a valid department' });
    }
  }

  const inviteIds = parseIds(req.body?.invite_ids);
  if (scope === 'private' && inviteIds.length === 0) {
    return res.status(400).json({ error: 'A private meeting needs at least one invited person' });
  }

  const info = await db.prepare(
    "INSERT INTO meetings (club_id, title, description, scope, department_id, started_by) VALUES (?,?,?,?,?,?)",
  ).run(req.user.club_id, title, description, scope, departmentId, req.user.id);
  const meetingId = info.lastInsertRowid;
  await db.prepare(
    "INSERT INTO meeting_participants (meeting_id, user_id, role, origin, status, decided_at) VALUES (?,?, 'host','host','accepted', datetime('now'))",
  ).run(meetingId, req.user.id);

  // invitees must be real, non-guest members of the SAME club
  let invited = [];
  if (inviteIds.length) {
    const ph = inviteIds.map(() => '?').join(',');
    const valid = await db.prepare(
      `SELECT id FROM users WHERE club_id = ? AND role != 'guest' AND id IN (${ph})`,
    ).all(req.user.club_id, ...inviteIds);
    invited = valid.map((r) => r.id).filter((id) => id !== req.user.id);
    const ins = db.prepare(
      "INSERT OR IGNORE INTO meeting_participants (meeting_id, user_id, role, origin, status) VALUES (?,?, 'participant','invited','pending')",
    );
    for (const uid of invited) await ins.run(meetingId, uid);
  }

  const m = await getMeeting(meetingId, req.user.club_id);

  // tell the invited people directly…
  await notifyMany(invited, {
    type: 'meeting_invite',
    title: `${req.user.full_name} invited you to “${title}”`,
    body: description,
    link: `/meetings/${meetingId}`,
  }, req.user.id);
  // …and announce a public/department meeting to its audience
  if (scope !== 'private') {
    const audience = await audienceIds(m);
    await notifyMany(audience, {
      type: 'meeting_started',
      title: `${req.user.full_name} started a meeting: “${title}”`,
      body: description,
      link: `/meetings/${meetingId}`,
    });
    for (const uid of audience) emitUser(req, uid, 'meet:activity', { meeting_id: meetingId });
  }
  for (const uid of invited) emitUser(req, uid, 'meet:activity', { meeting_id: meetingId });

  res.status(201).json(await shapeMeeting(req.user, m, { withPeople: true }));
});

// ============================================================
//  GET /api/meetings/:id — detail (participants, host requests)
// ============================================================
router.get('/:id', authenticate, async (req, res) => {
  const m = await getMeeting(req.params.id, req.user.club_id);
  if (!m || !(await canSee(req.user, m))) return res.status(404).json({ error: 'Meeting not found' });
  res.json(await shapeMeeting(req.user, m, { withPeople: true }));
});

// ============================================================
//  POST /api/meetings/:id/join — ask the host to let me in
// ============================================================
router.post('/:id/join', authenticate, async (req, res) => {
  const m = await getMeeting(req.params.id, req.user.club_id);
  if (!m || !(await canSee(req.user, m))) return res.status(404).json({ error: 'Meeting not found' });
  if (m.status !== 'live') return res.status(400).json({ error: 'This meeting has ended' });
  const p = await myParticipant(m.id, req.user.id);
  if (p && (p.status === 'pending' || p.status === 'accepted')) {
    return res.status(400).json({ error: 'You already have a place in this meeting' });
  }
  if (p) {
    await db.prepare(
      "UPDATE meeting_participants SET status = 'pending', origin = 'requested', decided_at = NULL WHERE id = ?",
    ).run(p.id);
  } else {
    await db.prepare(
      "INSERT INTO meeting_participants (meeting_id, user_id, role, origin, status) VALUES (?,?, 'participant','requested','pending')",
    ).run(m.id, req.user.id);
  }
  await notify(m.started_by, {
    type: 'meeting_request',
    title: `${req.user.full_name} asks to join “${m.title}”`,
    body: 'Accept or decline from the meeting page.',
    link: `/meetings/${m.id}`,
  });
  emitUser(req, m.started_by, 'meet:activity', { meeting_id: m.id });
  emitUser(req, req.user.id, 'meet:activity', { meeting_id: m.id });
  res.json(await shapeMeeting(req.user, m, { withPeople: true }));
});

// ============================================================
//  POST /api/meetings/:id/invite — host adds people (body user_ids[])
// ============================================================
router.post('/:id/invite', authenticate, async (req, res) => {
  const m = await getMeeting(req.params.id, req.user.club_id);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  if (m.started_by !== req.user.id) return res.status(403).json({ error: 'Only the host can invite people' });
  if (m.status !== 'live') return res.status(400).json({ error: 'This meeting has ended' });
  const ids = parseIds(req.body?.user_ids);
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one person' });
  const ph = ids.map(() => '?').join(',');
  const valid = await db.prepare(
    `SELECT id FROM users WHERE club_id = ? AND role != 'guest' AND id IN (${ph})`,
  ).all(req.user.club_id, ...ids);
  const ins = db.prepare(
    "INSERT INTO meeting_participants (meeting_id, user_id, role, origin, status) VALUES (?,?, 'participant','invited','pending')",
  );
  const added = [];
  for (const uid of valid.map((r) => r.id)) {
    if (uid === req.user.id) continue;
    const before = await myParticipant(m.id, uid);
    if (before) {
      // someone who already ASKED to join becomes a proper invitee
      if (before.status === 'pending') {
        await db.prepare("UPDATE meeting_participants SET origin = 'invited' WHERE id = ?").run(before.id);
        added.push(uid);
      }
      continue;
    }
    await ins.run(m.id, uid);
    added.push(uid);
  }
  await notifyMany(added, {
    type: 'meeting_invite',
    title: `${req.user.full_name} invited you to “${m.title}”`,
    body: m.description,
    link: `/meetings/${m.id}`,
  }, req.user.id);
  for (const uid of added) emitUser(req, uid, 'meet:activity', { meeting_id: m.id });
  res.json(await shapeMeeting(req.user, m, { withPeople: true }));
});

// ============================================================
//  POST /api/meetings/:id/requests/:userId — host accepts/declines
// ============================================================
router.post('/:id/requests/:userId', authenticate, async (req, res) => {
  const m = await getMeeting(req.params.id, req.user.club_id);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  if (m.started_by !== req.user.id) return res.status(403).json({ error: 'Only the host can decide who joins' });
  const action = req.body?.action === 'accept' ? 'accepted' : req.body?.action === 'decline' ? 'declined' : null;
  if (!action) return res.status(400).json({ error: "action must be 'accept' or 'decline'" });
  const target = Number(req.params.userId);
  const p = await db.prepare(
    "SELECT * FROM meeting_participants WHERE meeting_id = ? AND user_id = ? AND status = 'pending' AND origin = 'requested'",
  ).get(m.id, target);
  if (!p) return res.status(404).json({ error: 'No pending request from that person' });
  await db.prepare(
    "UPDATE meeting_participants SET status = ?, decided_at = datetime('now') WHERE id = ?",
  ).run(action, p.id);
  await notify(target, {
    type: action === 'accepted' ? 'meeting_accepted' : 'meeting_declined',
    title: action === 'accepted'
      ? `You're in: “${m.title}”`
      : `Your request to join “${m.title}” was declined`,
    link: `/meetings/${m.id}`,
  });
  if (action === 'accepted') emitUser(req, target, 'meet:activity', { meeting_id: m.id, joined: true });
  else emitUser(req, target, 'meet:activity', { meeting_id: m.id });
  res.json(await shapeMeeting(req.user, m, { withPeople: true }));
});

// ============================================================
//  POST /api/meetings/:id/respond — I accept/decline MY invite
// ============================================================
router.post('/:id/respond', authenticate, async (req, res) => {
  const m = await getMeeting(req.params.id, req.user.club_id);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  const action = req.body?.action === 'accept' ? 'accepted' : req.body?.action === 'decline' ? 'declined' : null;
  if (!action) return res.status(400).json({ error: "action must be 'accept' or 'decline'" });
  const p = await db.prepare(
    "SELECT * FROM meeting_participants WHERE meeting_id = ? AND user_id = ?",
  ).get(m.id, req.user.id);
  if (!p || p.role === 'host') return res.status(400).json({ error: 'You have no invitation to answer' });
  if (p.origin !== 'invited') {
    return res.status(403).json({ error: 'You asked to join — the host decides. You cannot let yourself in.' });
  }
  await db.prepare(
    "UPDATE meeting_participants SET status = ?, decided_at = datetime('now') WHERE id = ?",
  ).run(action, p.id);
  await notify(m.started_by, {
    type: action === 'accepted' ? 'meeting_joined' : 'meeting_declined',
    title: action === 'accepted'
      ? `${req.user.full_name} accepted “${m.title}”`
      : `${req.user.full_name} declined “${m.title}”`,
    link: `/meetings/${m.id}`,
  }, req.user.id);
  emitUser(req, m.started_by, 'meet:activity', { meeting_id: m.id });
  emitUser(req, req.user.id, 'meet:activity', { meeting_id: m.id });
  res.json(await shapeMeeting(req.user, m, { withPeople: true }));
});

// ============================================================
//  POST /api/meetings/:id/leave
// ============================================================
router.post('/:id/leave', authenticate, async (req, res) => {
  const m = await getMeeting(req.params.id, req.user.club_id);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  if (m.started_by === req.user.id) return res.status(400).json({ error: 'The host cannot leave — end the meeting instead' });
  const p = await myParticipant(m.id, req.user.id);
  if (!p) return res.status(400).json({ error: 'You are not in this meeting' });
  await db.prepare(
    "UPDATE meeting_participants SET status = 'left', decided_at = datetime('now') WHERE id = ?",
  ).run(p.id);
  await notify(m.started_by, {
    type: 'meeting_left',
    title: `${req.user.full_name} left “${m.title}”`,
    link: `/meetings/${m.id}`,
  }, req.user.id);
  emitUser(req, m.started_by, 'meet:activity', { meeting_id: m.id });
  res.json(await shapeMeeting(req.user, m, { withPeople: true }));
});

// ============================================================
//  POST /api/meetings/:id/end — host closes a meeting
// ============================================================
router.post('/:id/end', authenticate, async (req, res) => {
  const m = await getMeeting(req.params.id, req.user.club_id);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  if (m.started_by !== req.user.id) return res.status(403).json({ error: 'Only the host can end the meeting' });
  if (m.status === 'ended') return res.json(await shapeMeeting(req.user, m, { withPeople: true }));
  await db.prepare("UPDATE meetings SET status = 'ended', ended_at = datetime('now') WHERE id = ?").run(m.id);
  const ids = await acceptedIds(m.id);
  await notifyMany(ids, {
    type: 'meeting_ended',
    title: `“${m.title}” has ended`,
    link: `/meetings/${m.id}`,
  }, req.user.id);
  for (const uid of ids) emitUser(req, uid, 'meet:activity', { meeting_id: m.id, ended: true });
  res.json(await shapeMeeting(req.user, await getMeeting(m.id, m.club_id), { withPeople: true }));
});

// ============================================================
//  GET /api/meetings/:id/messages — chat (accepted participants)
// ============================================================
router.get('/:id/messages', authenticate, async (req, res) => {
  const m = await getMeeting(req.params.id, req.user.club_id);
  if (!m || !(await canSee(req.user, m))) return res.status(404).json({ error: 'Meeting not found' });
  if (!(await isAccepted(req.user, m))) return res.status(403).json({ error: 'Join the meeting to read its chat' });
  const before = Number(req.query.before_id) || 0;
  const rows = before
    ? await db.prepare(`
        SELECT mm.id, mm.body, mm.created_at, mm.sender_id, u.full_name, u.role
        FROM meeting_messages mm JOIN users u ON u.id = mm.sender_id
        WHERE mm.meeting_id = ? AND mm.id < ? ORDER BY mm.id DESC LIMIT 50
      `).all(m.id, before)
    : await db.prepare(`
        SELECT mm.id, mm.body, mm.created_at, mm.sender_id, u.full_name, u.role
        FROM meeting_messages mm JOIN users u ON u.id = mm.sender_id
        WHERE mm.meeting_id = ? ORDER BY mm.id DESC LIMIT 50
      `).all(m.id);
  res.json(rows.reverse());
});

// ============================================================
//  POST /api/meetings/:id/messages — post to the chat
// ============================================================
router.post('/:id/messages', authenticate, async (req, res) => {
  const m = await getMeeting(req.params.id, req.user.club_id);
  if (!m || !(await canSee(req.user, m))) return res.status(404).json({ error: 'Meeting not found' });
  if (!(await isAccepted(req.user, m))) return res.status(403).json({ error: 'Join the meeting to post' });
  if (m.status !== 'live') return res.status(400).json({ error: 'This meeting has ended' });
  const body = String(req.body?.body || '').trim().slice(0, 4000);
  if (!body) return res.status(400).json({ error: 'Message cannot be empty' });
  const info = await db.prepare(
    'INSERT INTO meeting_messages (meeting_id, club_id, sender_id, body) VALUES (?,?,?,?)',
  ).run(m.id, m.club_id, req.user.id, body);
  const row = await db.prepare(`
    SELECT mm.id, mm.body, mm.created_at, mm.sender_id, u.full_name, u.role
    FROM meeting_messages mm JOIN users u ON u.id = mm.sender_id WHERE mm.id = ?
  `).get(info.lastInsertRowid);

  const ids = [...new Set([...(await acceptedIds(m.id)), m.started_by])];
  const s = io(req);
  if (s) for (const uid of ids) s.to(`user:${uid}`).emit('meet:message', { meeting_id: m.id, message: row });
  res.status(201).json(row);
});

// ============================================================
//  POST /api/meetings/:id/read — clear the unread badge
// ============================================================
router.post('/:id/read', authenticate, async (req, res) => {
  const m = await getMeeting(req.params.id, req.user.club_id);
  if (!m || !(await canSee(req.user, m))) return res.status(404).json({ error: 'Meeting not found' });
  const max = (await db.prepare(
    'SELECT COALESCE(MAX(id), 0) AS m FROM meeting_messages WHERE meeting_id = ?',
  ).get(m.id)).m;
  await db.prepare(`
    INSERT INTO meeting_reads (meeting_id, user_id, last_read_id) VALUES (?,?,?)
    ON CONFLICT(meeting_id, user_id) DO UPDATE SET last_read_id = excluded.last_read_id
  `).run(m.id, req.user.id, max);
  res.json({ ok: true, last_read_id: max });
});

module.exports = router;
