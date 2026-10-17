// ============================================================
//  middleware/auth.js — JWT check + role-based access control
// ============================================================
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'isigk-robotics-dev-secret-change-in-prod';

// Attaches req.user if a valid token is provided.
// Role/department are always re-read from the DB so that a promotion,
// department change or removal takes effect immediately (no re-login).
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const fresh = await db.prepare('SELECT id, full_name, role, department_id FROM users WHERE id = ?')
      .get(payload.id);
    if (!fresh) return res.status(401).json({ error: 'Account no longer exists' });
    req.user = { ...payload, ...fresh };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Roles allowed: authenticate('leader','coleader','professor')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

// The "big three" who see everything
const isBoss = (role) => ['professor', 'leader', 'coleader'].includes(role);

module.exports = { authenticate, requireRole, isBoss, JWT_SECRET };
