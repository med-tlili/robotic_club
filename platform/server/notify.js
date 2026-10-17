// ============================================================
//  notify.js — notifications core
//  Writes a row in `notifications` and, if a socket is attached,
//  pushes it live to the user's room ('user:<id>').
// ============================================================
const db = require('./db');

let ioRef = null;

function setIO(io) {
  ioRef = io;
}

// notify(userId, { type, title, body, link })
function notify(userId, { type, title, body = '', link = '' }) {
  if (!userId || !title) return;
  const info = db.prepare(
    'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)'
  ).run(userId, type, title, body, link);
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid);
  if (ioRef) ioRef.to(`user:${userId}`).emit('notification', row);
}

// notifyMany([userId, ...], payload) — no duplicates, skips the actor
function notifyMany(userIds, payload, actorId = null) {
  [...new Set(userIds)]
    .filter((id) => id && id !== actorId)
    .forEach((id) => notify(id, payload));
}

module.exports = { setIO, notify, notifyMany };
