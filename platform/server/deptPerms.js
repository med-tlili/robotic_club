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
  if (isLeader(user) || user.role === 'supervisor') return true;
  if (user.role === 'guest') return false;
  return user.department_id === deptId;
}

async function getDept(slug, clubId) {
  return await db.prepare('SELECT * FROM departments WHERE slug = ? AND club_id = ?').get(slug, clubId);
}

// Does this department belong to the given club? (the core of tenant isolation)
async function deptInClub(deptId, clubId) {
  if (!deptId) return false;
  const row = await db.prepare('SELECT 1 AS ok FROM departments WHERE id = ? AND club_id = ?').get(deptId, clubId);
  return !!row;
}

module.exports = { isLeader, canManageDept, canViewDept, getDept, deptInClub };
