// ============================================================
//  test/helpers.js — boot an isolated server instance per suite
//
//  Each suite gets its OWN temp directory (DB + uploads) and port,
//  so tests never touch the real club.db or uploads/ tree.
//  Run with:  npm test   (node --test test/)
// ============================================================
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TEST_SECRET = 'test-secret-do-not-use-in-prod';
// a valid 1×1 transparent PNG for upload tests
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// env vars that must never leak from the developer machine into a test server
const STRIP_ENV = ['TURSO_URL', 'TURSO_AUTH_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'REDIS_URL', 'CRON_SECRET', 'VERCEL', 'ISIGK_NO_RATELIMIT'];

async function startServer({ port, demo = '1', env: extraEnv = {}, initDb } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isigk-test-'));
  const uploads = path.join(dir, 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const dbPath = path.join(dir, 'club.db');

  // suites that need a pre-existing database (e.g. legacy migrations) build it here
  if (initDb) await initDb({ dir, dbPath, uploads });

  const env = { ...process.env };
  for (const k of STRIP_ENV) delete env[k];
  Object.assign(env, {
    PORT: String(port),
    DB_PATH: dbPath,
    UPLOAD_DIR: uploads,
    ISIGK_DEMO_ACCOUNTS: String(demo),
    JWT_SECRET: TEST_SECRET,
    ISIGK_NO_RATELIMIT: '1',
  }, extraEnv);

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode})\n${logs.join('')}`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`server did not start on :${port}\n${logs.join('')}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return {
    base,
    dir,
    uploads,
    logs: () => logs.join(''),
    stop() {
      try { child.kill(); } catch { /* already gone */ }
      setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }, 300);
    },
  };
}

// JSON request helper → { status, data }
async function req(base, method, apiPath, token, body) {
  const res = await fetch(`${base}/api${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// raw request helper → full response (for CORS header / file checks)
async function raw(base, method, fullPath, { token, origin, headers = {} } = {}) {
  const res = await fetch(`${base}${fullPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...headers,
    },
    redirect: 'manual',
  });
  let body = null;
  const text = await res.text().catch(() => '');
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: res.headers, body, text };
}

async function login(base, email, password = 'password123') {
  const r = await req(base, 'POST', '/auth/login', null, { email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data; // { token, user }
}

// log in every demo account once
async function loginAll(base) {
  const accounts = ['supervisor', 'leader', 'coleader', 'hr', 'events', 'media', 'finance', 'member', 'guest'];
  const out = {};
  for (const a of accounts) out[a] = await login(base, `${a}@isigk.tn`);
  return out;
}

// multipart upload helper; fieldName: image | attachment | file
async function upload(base, apiPath, token, { file, fields = {}, fieldName = 'attachment' }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append(fieldName, new Blob([file.buffer], { type: file.mimetype }), file.name);
  const res = await fetch(`${base}/api${apiPath}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

module.exports = { startServer, req, raw, login, loginAll, upload, PNG_1PX, TEST_SECRET };
