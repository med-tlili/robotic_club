// ============================================================
//  middleware/auth.js — JWT check + role-based access control
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');

// ---- secret resolution (FAIL-CLOSED in production) ----
// Priority: env JWT_SECRET -> .jwt-secret file -> generated once (local dev).
// On Vercel / production with nothing configured we deliberately end up with
// `null`: every auth check then answers 503 instead of silently falling back
// to a public default secret anyone could use to forge tokens (the old
// 'isigk-robotics-dev-secret-change-in-prod' fallback).
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(__dirname, '..', '.jwt-secret');
  try {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s) return s;
  } catch { /* no file yet */ }
  const hosted = !!process.env.VERCEL || process.env.NODE_ENV === 'production';
  if (hosted) {
    console.error('[auth] FATAL: JWT_SECRET is not set. Authentication stays DISABLED '
      + 'until you configure it (Project settings -> Environment Variables).');
    return null;
  }
  const s = crypto.randomBytes(48).toString('hex');
  try {
    fs.writeFileSync(file, s, { mode: 0o600 });
    console.log('[auth] generated a local JWT secret -> .jwt-secret (git-ignored, keep it private)');
  } catch {
    console.log('[auth] using an ephemeral in-memory JWT secret (file system not writable)');
  }
  return s;
}

const JWT_SECRET = resolveJwtSecret();

// Attaches req.user if a valid token is provided.
// Role/department are always re-read from the DB so that a promotion,
// department change or removal takes effect immediately (no re-login).
async function authenticate(req, res, next) {
  if (!JWT_SECRET) {
    return res.status(503).json({
      error: 'Server authentication is not configured (JWT_SECRET missing)',
    });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const fresh = await db.prepare('SELECT id, full_name, role, club_id, department_id FROM users WHERE id = ?')
      .get(payload.id);
    if (!fresh) return res.status(401).json({ error: 'Account no longer exists' });
    req.user = { ...payload, ...fresh };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Roles allowed: authenticate('leader','coleader','supervisor')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

// The "big three" who see everything
const isBoss = (role) => ['supervisor', 'leader', 'coleader'].includes(role);

module.exports = { authenticate, requireRole, isBoss, JWT_SECRET };
