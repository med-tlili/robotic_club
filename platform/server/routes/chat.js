// ============================================================
//  routes/chat.js — club chat (global / managers / dept / private)
//  Rules (README):
//   - Global chat: all club members (Manager, Member, Leader,
//     Co-Leader, Professor)
//   - Managers chat: 4 managers + Leader + Co-Leader + Professor
//   - Department chats: that dept's members + Leader/Co-Leader
//     + Professor (bosses see every department)
//   - Private 1↔1: any two non-guest users
//   - Anyone who can open a room can post in it — including the
//     Professor (he stays read-only on content management, not chat)
//   - Guests: no chat at all (403 everywhere)
//   - Attachments: images (preview) + pdf/zip/mp4 (link), max 15MB
// ============================================================
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { makeStorage, signPath } = require('../storage');

const router = express.Router();

// ---------- attachments — chat files are private (signed URLs only) ----------
const storage = makeStorage('private');
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null,
    /^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)
    || /^(application\/pdf|application\/zip|video\/mp4)$/.test(file.mimetype)),
});
const isImage = (f) => /^image\//.test(f || '');
// display name = the ORIGINAL filename (the disk name is random, see storage.js)
const displayName = (f) => (path.basename(f?.originalname || 'file').replace(/[\r\n\t]/g, '_').slice(0, 120) || 'file');
const IMG_EXT = /\.(png|jpe?g|gif|webp)$/i;

// ---------- room helpers ----------
// room keys: 'global' | 'managers' | 'dept:<id>' | 'private:<userId>'
function parseRoom(key) {
  const [kind, arg] = String(key || '').split(':');
  return { kind, id: Number(arg) || null };
}

function canRead(user, key) {
  const { kind, id } = parseRoom(key);
  if (user.role === 'guest') return false;
  const boss = ['leader', 'coleader'].includes(user.role);
  switch (kind) {
    case 'global': return true;
    case 'managers': return ['manager', 'leader', 'coleader', 'professor'].includes(user.role);
    case 'dept': {
      const dept = db.prepare('SELECT id FROM departments WHERE id = ?').get(id);
      if (!dept) return false;
      if (boss || user.role === 'professor') return true;
      return user.department_id === id && ['manager', 'member'].includes(user.role);
    }
    case 'private': {
      if (!id || id === user.id) return false;
      const other = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
      return !!other && other.role !== 'guest';
    }
    default: return false;
  }
}

function canSend(user, key) {
  // everyone who may open a room may post in it (canRead already blocks
  // guests, cross-department members and foreign private threads);
  // the Professor chats like any other member
  return canRead(user, key);
}

// audience: user ids who should receive 'chat:activity' for this room
function audience(user, key) {
  const { kind, id } = parseRoom(key);
  if (kind === 'global') {
    return db.prepare("SELECT id FROM users WHERE role != 'guest'").all().map((r) => r.id);
  }
  if (kind === 'managers') {
    return db.prepare("SELECT id FROM users WHERE role IN ('manager','leader','coleader','professor')")
      .all().map((r) => r.id);
  }
  if (kind === 'dept') {
    return db.prepare(
      "SELECT id FROM users WHERE department_id = ? OR role IN ('leader','coleader','professor')"
    ).all(id).map((r) => r.id);
  }
  // private: the two participants
  return [user.id, id];
}

// sockets to join for a connected user (group rooms only; DMs on demand)
function roomsForUser(user) {
  if (user.role === 'guest') return [];
  const rooms = ['global'];
  if (['manager', 'leader', 'coleader', 'professor'].includes(user.role)) rooms.push('managers');
  if (user.department_id) rooms.push(`dept:${user.department_id}`);
  if (['leader', 'coleader', 'professor'].includes(user.role)) {
    db.prepare('SELECT id FROM departments WHERE coming_soon = 0').all()
      .forEach((d) => { if (!rooms.includes(`dept:${d.id}`)) rooms.push(`dept:${d.id}`); });
  }
  return rooms;
}

function dmRoom(a, b) {
  return `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
}

function getMessages(key, beforeId = null) {
  const { kind, id } = parseRoom(key);
  let sql = `
    SELECT m.*, u.full_name, u.role FROM messages m
    JOIN users u ON u.id = m.sender_id
  `;
  const params = [];
  if (kind === 'private') {
    sql += ' WHERE m.scope = ? AND ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))';
    params.push('private');
    // key holds the OTHER user's id; both directions
    // resolved by the caller with req.user.id
  } else if (kind === 'dept') {
    sql += ' WHERE m.scope = ? AND m.department_id = ?';
    params.push('dept', id);
  } else {
    sql += ' WHERE m.scope = ? AND m.department_id IS NULL';
    params.push(kind);
  }
  if (beforeId) { sql += ' AND m.id < ?'; params.push(beforeId); }
  sql += ' ORDER BY m.id DESC LIMIT 50';
  return { sql, params };
}

// ---------- GET /api/chat/rooms — sidebar for this user ----------
router.get('/rooms', authenticate, (req, res) => {
  if (req.user.role === 'guest') return res.status(403).json({ error: 'Guests cannot use chat' });
  const me = req.user.id;
  const lastFor = (key) => {
    const { kind, id } = parseRoom(key);
    let sql = 'SELECT m.*, u.full_name FROM messages m JOIN users u ON u.id = m.sender_id';
    const p = [];
    if (kind === 'private') {
      sql += " WHERE m.scope='private' AND ((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))";
      p.push(me, id, id, me);
    } else if (kind === 'dept') {
      sql += " WHERE m.scope='dept' AND m.department_id=?";
      p.push(id);
    } else {
      sql += ' WHERE m.scope=? AND m.department_id IS NULL';
      p.push(kind);
    }
    sql += ' ORDER BY m.id DESC LIMIT 1';
    return db.prepare(sql).get(...p) || null;
  };
  const unreadFor = (key) => {
    const { kind, id } = parseRoom(key);
    const read = db.prepare('SELECT last_read_id FROM chat_reads WHERE user_id=? AND room=?')
      .get(me, key)?.last_read_id || 0;
    let sql = 'SELECT COUNT(*) AS c FROM messages m';
    const p = [];
    if (kind === 'private') {
      sql += " WHERE m.scope='private' AND m.sender_id != ? AND ((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))";
      p.push(me, me, id, id, me);
    } else if (kind === 'dept') {
      sql += " WHERE m.scope='dept' AND m.department_id=? AND m.sender_id != ?";
      p.push(id, me);
    } else {
      sql += ' WHERE m.scope=? AND m.department_id IS NULL AND m.sender_id != ?';
      p.push(kind, me);
    }
    sql += ' AND m.id > ?';
    p.push(read);
    return db.prepare(sql).get(...p).c;
  };

  const rooms = [];
  rooms.push({ key: 'global', label: 'Global chat', kind: 'global' });
  if (['manager', 'leader', 'coleader', 'professor'].includes(req.user.role)) {
    rooms.push({ key: 'managers', label: 'Managers chat', kind: 'managers' });
  }
  // department rooms: own dept for members/managers; ALL depts for leaders/professor
  const depts = ['leader', 'coleader', 'professor'].includes(req.user.role)
    ? db.prepare('SELECT id, name, slug FROM departments WHERE coming_soon = 0').all()
    : db.prepare('SELECT id, name, slug FROM departments WHERE id = ?').all(req.user.department_id || -1);
  depts.forEach((d) => rooms.push({ key: `dept:${d.id}`, label: `${d.name} chat`, kind: 'dept', department_id: d.id }));

  const shaped = rooms.map((r) => {
    const last = lastFor(r.key);
    return {
      ...r,
      unread: unreadFor(r.key),
      last_body: last ? last.body || (last.attachment ? '[attachment]' : '') : null,
      last_at: last ? last.created_at : null,
      last_sender: last ? last.full_name : null,
    };
  });
  res.json(shaped);
});

// ---------- GET /api/chat/messages?room=...&before_id=... ----------
// shape a DB row (message + sender flat fields) into the client format
function shapeRow(row, key) {
  return {
    id: row.id,
    room: key,
    body: row.body,
    attachment: signPath(row.attachment), // private file → 24h signed URL
    attachment_name: row.attachment_name || (row.attachment ? row.attachment.split('/').pop() : null),
    attachment_image: IMG_EXT.test(row.attachment || '') || !!row.attachment_image,
    created_at: row.created_at,
    sender: { id: row.sender_id, full_name: row.full_name, role: row.role },
  };
}

router.get('/messages', authenticate, (req, res) => {
  const key = req.query.room;
  if (!canRead(req.user, key)) return res.status(403).json({ error: 'No access to this chat' });
  const { kind, id } = parseRoom(key);
  const { sql, params } = getMessages(key, Number(req.query.before_id) || null);
  if (kind === 'private') params.push(req.user.id, id, id, req.user.id);
  const rows = db.prepare(sql).all(...params).reverse().map((r) => shapeRow(r, key));
  const peer = kind === 'private'
    ? db.prepare('SELECT id, full_name, role, department_id FROM users WHERE id = ?').get(id)
    : null;
  res.json({ messages: rows, peer });
});

// ---------- POST /api/chat/read — clear unread ----------
router.post('/read', authenticate, (req, res) => {
  const key = req.body?.room;
  if (!canRead(req.user, key)) return res.status(403).json({ error: 'No access to this chat' });
  const { kind, id } = parseRoom(key);
  let maxSql = 'SELECT COALESCE(MAX(id), 0) AS m FROM messages';
  const p = [];
  if (kind === 'private') {
    maxSql += " WHERE scope='private' AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))";
    p.push(req.user.id, id, id, req.user.id);
  } else if (kind === 'dept') {
    maxSql += " WHERE scope='dept' AND department_id=?";
    p.push(id);
  } else {
    maxSql += ' WHERE scope=? AND department_id IS NULL';
    p.push(kind);
  }
  const max = db.prepare(maxSql).get(...p).m;
  db.prepare(
    `INSERT INTO chat_reads (user_id, room, last_read_id) VALUES (?,?,?)
     ON CONFLICT(user_id, room) DO UPDATE SET last_read_id = excluded.last_read_id`
  ).run(req.user.id, key, max);
  res.json({ ok: true });
});

// ---------- POST /api/chat/messages — send (JSON or multipart) ----------
router.post('/messages', authenticate, (req, res) => {
  upload.single('attachment')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Invalid attachment (max 15MB: image, pdf, zip or mp4)' });
    const key = req.body?.room;
    if (!canSend(req.user, key)) {
      return res.status(403).json({ error: 'You cannot write in this chat' });
    }
    const body = (req.body?.body || '').trim();
    const attachment = req.file ? `/uploads/private/${req.file.filename}` : '';
    const attachmentName = req.file ? displayName(req.file) : '';
    if (!body && !attachment) return res.status(400).json({ error: 'Message cannot be empty' });

    const { kind, id } = parseRoom(key);
    let scope = kind; let deptId = null; let recipient = null;
    if (kind === 'dept') deptId = id;
    if (kind === 'private') recipient = id;

    const info = db.prepare(
      `INSERT INTO messages (scope, department_id, sender_id, recipient_id, body, attachment, attachment_name)
       VALUES (?,?,?,?,?,?,?)`
    ).run(scope, deptId, req.user.id, recipient, body, attachment, attachmentName);

    const row = db.prepare(`
      SELECT m.*, u.full_name, u.role FROM messages m
      JOIN users u ON u.id = m.sender_id WHERE m.id = ?
    `).get(info.lastInsertRowid);
    const shaped = {
      id: row.id, room: key, body: row.body,
      attachment: signPath(row.attachment),
      attachment_name: row.attachment_name || null,
      attachment_image: req.file ? isImage(req.file.mimetype) : false,
      created_at: row.created_at,
      sender: { id: row.sender_id, full_name: row.full_name, role: row.role },
    };

    // push live: to the room (group) and/or the DM pair + activity for sidebars
    const io = req.app.get('io');
    if (io) {
      if (kind === 'private') {
        io.to(dmRoom(req.user.id, id)).emit('chat:message', shaped);
      } else {
        io.to(`room:${key}`).emit('chat:message', shaped);
      }
      audience(req.user, key).forEach((uid) => {
        io.to(`user:${uid}`).emit('chat:activity', { room: key, message: shaped });
      });
    }
    res.status(201).json(shaped);
  });
});

module.exports = router;
module.exports.roomsForUser = roomsForUser;
module.exports.dmRoom = dmRoom;
