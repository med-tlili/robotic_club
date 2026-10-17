// ============================================================
//  deptPerms.js — shared permission helpers for department tools
//  "boss" = Leader/Co-Leader (see everything) or the dept manager.
// ============================================================
const db = require('./db');

function isLeader(user) {
  return ['leader', 'coleader'].includes(user.role);
}

// can this user WRITE this department's private tools?
function canManageDept(user, deptId) {
  if (isLeader(user)) return true;
  return user.role === 'manager' && user.department_id === deptId;
}

// can this user VIEW this department's private tools?
function canViewDept(user, deptId) {
  if (isLeader(user) || user.role === 'professor') return true;
  if (user.role === 'guest') return false;
  return user.department_id === deptId;
}

function getDept(slug) {
  return db.prepare('SELECT * FROM departments WHERE slug = ?').get(slug);
}

module.exports = { isLeader, canManageDept, canViewDept, getDept };
