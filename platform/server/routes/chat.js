// ============================================================
//  routes/chat.js — club chat (global / managers / dept / private)
//  Rules (README):
//   - Global chat: all club members (Manager, Member, Leader,
//     Co-Leader, Supervisor)
//   - Managers chat: 4 managers + Leader + Co-Leader + Supervisor
//   - Department chats: that dept's members + Leader/Co-Leader
//     + Supervisor (bosses see every department)
//   - Private 1↔1: any two non-guest users
//   - Anyone who can open a room can post in it — including the
//     Supervisor (he stays read-only on content management, not chat)
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

async function canRead(user, key) {
  const { kind, id } = parseRoom(key);
  if (user.role === 'guest') return false;
  const boss = ['leader', 'coleader'].includes(user.role);
  switch (kind) {
    case 'global': return true;
    case 'managers': return ['manager', 'leader', 'coleader', 'supervisor'].includes(user.role);
    case 'dept': {
      const dept = await db.prepare('SELECT id FROM departments WHERE id = ? AND club_id = ?').get(id, user.club_id);
      if (!dept) return false;
      if (boss || user.role === 'supervisor') return true;
      return user.department_id === id && ['manager', 'member'].includes(user.role);
    }
    case 'private': {
      if (!id || id === user.id) return false;
      const other = await db.prepare('SELECT id, role FROM users WHERE id = ? AND club_id = ?').get(id, user.club_id);
      return !!other && other.role !== 'guest';
    }
    default: return false;
  }
}

async function canSend(user, key) {
  // everyone who may open a room may post in it (canRead already blocks
  // guests, cross-department members and foreign private threads);
  // the Supervisor chats like any other member
  return await canRead(user, key);
}

// audience: user ids who should receive 'chat:activity' for this room
async function audience(user, key) {
  const { kind, id } = parseRoom(key);
  if (kind === 'global') {
    return (await db.prepare("SELECT id FROM users WHERE role != 'guest' AND club_id = ?").all(user.club_id)).map((r) => r.id);
  }
  if (kind === 'managers') {
    return (await db.prepare("SELECT id FROM users WHERE role IN ('manager','leader','coleader','supervisor') AND club_id = ?")
      .all(user.club_id)).map((r) => r.id);
  }
  if (kind === 'dept') {
    return (await db.prepare(
      "SELECT id FROM users WHERE (department_id = ? OR role IN ('leader','coleader','supervisor')) AND club_id = ?"
    ).all(id, user.club_id)).map((r) => r.id);
  }
  // private: the two participants
  return [user.id, id];
}

// sockets to join for a connected user (group rooms only; DMs on demand)
async function roomsForUser(user) {
  if (user.role === 'guest') return [];
  const rooms = ['global'];
  if (['manager', 'leader', 'coleader', 'supervisor'].includes(user.role)) rooms.push('managers');
  if (user.department_id) rooms.push(`dept:${user.department_id}`);
  if (['leader', 'coleader', 'supervisor'].includes(user.role)) {
    (await db.prepare('SELECT id FROM departments WHERE coming_soon = 0 AND club_id = ?').all(user.club_id))
      .forEach((d) => { if (!rooms.includes(`dept:${d.id}`)) rooms.push(`dept:${d.id}`); });
  }
  return rooms;
}

function dmRoom(a, b) {
  return `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
}

function getMessages(key, beforeId = null, clubId = null) {
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
    sql += ' WHERE m.scope = ? AND m.department_id IS NULL AND m.club_id = ?';
    params.push(kind, clubId);
  }
  if (beforeId) { sql += ' AND m.id < ?'; params.push(beforeId); }
  sql += ' ORDER BY m.id DESC LIMIT 50';
  return { sql, params };
}

// ---------- GET /api/chat/rooms — sidebar for this user ----------
router.get('/rooms', authenticate, async (req, res) => {
  if (req.user.role === 'guest') return res.status(403).json({ error: 'Guests cannot use chat' });
  const me = req.user.id;
  const lastFor = async (key) => {
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
      sql += ' WHERE m.scope=? AND m.department_id IS NULL AND m.club_id = ?';
      p.push(kind, req.user.club_id);
    }
    sql += ' ORDER BY m.id DESC LIMIT 1';
    return await db.prepare(sql).get(...p) || null;
  };
  const unreadFor = async (key) => {
    const { kind, id } = parseRoom(key);
    const read = (await db.prepare('SELECT last_read_id FROM chat_reads WHERE user_id=? AND room=?')
      .get(me, key))?.last_read_id || 0;
    let sql = 'SELECT COUNT(*) AS c FROM messages m';
    const p = [];
    if (kind === 'private') {
      sql += " WHERE m.scope='private' AND m.sender_id != ? AND ((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))";
      p.push(me, me, id, id, me);
    } else if (kind === 'dept') {
      sql += " WHERE m.scope='dept' AND m.department_id=? AND m.sender_id != ?";
      p.push(id, me);
    } else {
      sql += ' WHERE m.scope=? AND m.department_id IS NULL AND m.club_id = ? AND m.sender_id != ?';
      p.push(kind, req.user.club_id, me);
    }
    sql += ' AND m.id > ?';
    p.push(read);
    return (await db.prepare(sql).get(...p)).c;
  };

  const rooms = [];
  rooms.push({ key: 'global', label: 'Global chat', kind: 'global' });
  if (['manager', 'leader', 'coleader', 'supervisor'].includes(req.user.role)) {
    rooms.push({ key: 'managers', label: 'Managers chat', kind: 'managers' });
  }
  // department rooms: own dept for members/managers; ALL depts for leaders/supervisor
  const depts = ['leader', 'coleader', 'supervisor'].includes(req.user.role)
    ? await db.prepare('SELECT id, name, slug FROM departments WHERE coming_soon = 0 AND club_id = ?').all(req.user.club_id)
    : await db.prepare('SELECT id, name, slug FROM departments WHERE id = ? AND club_id = ?').all(req.user.department_id || -1, req.user.club_id);
  depts.forEach((d) => rooms.push({ key: `dept:${d.id}`, label: `${d.name} chat`, kind: 'dept', department_id: d.id }));

  const shaped = await Promise.all(rooms.map(async (r) => {
    const last = await lastFor(r.key);
    return {
      ...r,
      unread: await unreadFor(r.key),
      last_body: last ? last.body || (last.attachment ? '[attachment]' : '') : null,
      last_at: last ? last.created_at : null,
      last_sender: last ? last.full_name : null,
    };
  }));
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

router.get('/messages', authenticate, async (req, res) => {
  const key = req.query.room;
  if (!(await canRead(req.user, key))) return res.status(403).json({ error: 'No access to this chat' });
  const { kind, id } = parseRoom(key);
  const { sql, params } = getMessages(key, Number(req.query.before_id) || null, req.user.club_id);
  if (kind === 'private') params.push(req.user.id, id, id, req.user.id);
  const rows = (await db.prepare(sql).all(...params)).reverse().map((r) => shapeRow(r, key));
  const peer = kind === 'private'
    ? await db.prepare('SELECT id, full_name, role, department_id FROM users WHERE id = ? AND club_id = ?').get(id, req.user.club_id)
    : null;
  res.json({ messages: rows, peer });
});

// ---------- POST /api/chat/read — clear unread ----------
router.post('/read', authenticate, async (req, res) => {
  const key = req.body?.room;
  if (!(await canRead(req.user, key))) return res.status(403).json({ error: 'No access to this chat' });
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
    maxSql += ' WHERE scope=? AND department_id IS NULL AND club_id = ?';
    p.push(kind, req.user.club_id);
  }
  const max = (await db.prepare(maxSql).get(...p)).m;
  await db.prepare(
    `INSERT INTO chat_reads (user_id, room, last_read_id) VALUES (?,?,?)
     ON CONFLICT(user_id, room) DO UPDATE SET last_read_id = excluded.last_read_id`
  ).run(req.user.id, key, max);
  res.json({ ok: true });
});

// ---------- POST /api/chat/messages — send (JSON or multipart) ----------
router.post('/messages', authenticate, (req, res, next) => {
  upload.single('attachment')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: 'Invalid attachment (max 15MB: image, pdf, zip or mp4)' });
    try {
      const key = req.body?.room;
      if (!(await canSend(req.user, key))) {
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

      const info = await db.prepare(
        `INSERT INTO messages (club_id, scope, department_id, sender_id, recipient_id, body, attachment, attachment_name)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(req.user.club_id, scope, deptId, req.user.id, recipient, body, attachment, attachmentName);

      const row = await db.prepare(`
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
          io.to(`room:${req.user.club_id}:${key}`).emit('chat:message', shaped);
        }
        for (const uid of await audience(req.user, key)) {
          io.to(`user:${uid}`).emit('chat:activity', { room: key, message: shaped });
        }
      }
      res.status(201).json(shaped);
    } catch (e) {
      next(e);
    }
  });
});

module.exports = router;
module.exports.roomsForUser = roomsForUser;
module.exports.dmRoom = dmRoom;
