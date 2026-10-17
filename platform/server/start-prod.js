// ============================================================
//  start-prod.js — PRODUCTION entry point (npm start)
//
//  · NO demo accounts or demo content are seeded
//    (ISIGK_DEMO_ACCOUNTS=0 unless you override it)
//  · JWT_SECRET comes from the environment; if unset, a random
//    one is generated ONCE and persisted to .jwt-secret so login
//    sessions survive restarts. The file is git-ignored — keep
//    it private. Never run production on the default dev secret.
//
//  First run on a new host: the site starts EMPTY (5 departments
//  only). Open /signup → create the Professor account → Members
//  page → create the Leader → the Leader creates everyone else.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

if (!process.env.JWT_SECRET) {
  const file = path.join(__dirname, '.jwt-secret');
  try {
    process.env.JWT_SECRET = fs.readFileSync(file, 'utf8').trim();
    if (!process.env.JWT_SECRET) throw new Error('empty file');
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret);
    process.env.JWT_SECRET = secret;
    console.log('[prod] generated a random JWT secret → .jwt-secret (keep this file private, do not commit it)');
  }
}

// production default: seed nothing but the departments
if (!process.env.ISIGK_DEMO_ACCOUNTS) process.env.ISIGK_DEMO_ACCOUNTS = '0';

require('./index.js');
