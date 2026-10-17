// ============================================================
//  db.js — database layer (schema + seed data)
//
//  The SAME SQLite database in two places:
//    · self-host / dev : file:club.db       (DB_PATH overrides the path)
//    · Vercel / cloud  : TURSO_URL + TURSO_AUTH_TOKEN → Turso (online SQLite)
//
//  The API is unchanged — db.prepare(sql).get / .all / .run, db.exec(sql)
//  — except every call now returns a Promise (the whole server awaits it).
//  Queries issued before the schema is ready simply wait for it.
// ============================================================
const { createClient } = require('@libsql/client');
const path = require('path');
const bcrypt = require('bcryptjs');

const TURSO_URL = process.env.TURSO_URL || '';
const dbFile = process.env.DB_PATH || path.join(__dirname, 'club.db');
const client = createClient({
  url: TURSO_URL || `file:${dbFile}`,
  authToken: process.env.TURSO_AUTH_TOKEN || undefined,
});

// ---- ready gate: every query waits for schema + migrations ----
let resolveReady;
let rejectReady;
const ready = new Promise((res, rej) => {
  resolveReady = res;
  rejectReady = rej;
});
ready.catch(() => {}); // the rejection is delivered to each awaiting query

const plain = (row) => (row === undefined || row === null ? undefined : Object.assign({}, row));

// better-sqlite3 accepted undefined/NaN binds (SQLite matches nothing for
// them); @libsql/client refuses non-finite doubles outright. Normalise so
// `WHERE id = Number(undefined)` still behaves like before: no match.
const bindValue = (v) => (v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? null : v);

// better-sqlite3 bound either ...values or one array — normalise both into
// the array @libsql/client expects (a single plain object = named args).
const toArgs = (a) => {
  if (a.length === 1) {
    const v = a[0];
    if (Array.isArray(v)) return v.map(bindValue);
    if (v && typeof v === 'object' && !ArrayBuffer.isView(v) && !(v instanceof ArrayBuffer)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, bindValue(x)]));
    }
  }
  return a.map(bindValue);
};

function prepare(sql) {
  return {
    get: async (...a) => {
      await ready;
      const r = await client.execute({ sql, args: toArgs(a) });
      return plain(r.rows[0]);
    },
    all: async (...a) => {
      await ready;
      const r = await client.execute({ sql, args: toArgs(a) });
      return r.rows.map(plain);
    },
    run: async (...a) => {
      await ready;
      const r = await client.execute({ sql, args: toArgs(a) });
      return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid || 0) };
    },
  };
}

async function exec(sql) {
  await ready;
  await client.executeMultiple(sql);
}

// consistent DB snapshot to a file (local mode; the Turso-backed build
// exports its snapshot differently — see the Drive backup phase)
async function backup(dest) {
  if (TURSO_URL) throw new Error('file snapshot is local-only');
  await ready;
  const p = String(dest).replace(/'/g, "''");
  await client.execute(`VACUUM INTO '${p}'`);
}

// JSON snapshot of every table — the cloud (Turso) build's backup format.
// The file is human-readable and restorable row-for-row; local builds keep
// using backup() above (a real SQLite file, restorable by copying back).
async function exportSnapshot(dest) {
  const { writeFile } = require('fs/promises');
  await ready;
  const tables = (await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )).rows.map((r) => r.name);
  const out = { format: 'isigk-export-v1', exported_at: new Date().toISOString(), tables: {} };
  for (const t of tables) {
    const rows = (await client.execute(`SELECT * FROM "${t}"`)).rows;
    out.tables[t] = rows.map(plain);
  }
  await writeFile(dest, JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 1));
  return dest;
}

// ---------------- Schema ----------------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,        -- hr | events | media | finance | materials
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  coming_soon INTEGER DEFAULT 0            -- 1 = materials (coming soon)
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('professor','leader','coleader','manager','member','guest')),
  department_id INTEGER REFERENCES departments(id),
  bio           TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  due_date      TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  author_id     INTEGER NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL DEFAULT 'announcement' CHECK(type IN ('announcement','clip','offer')),
  title         TEXT NOT NULL,
  body          TEXT DEFAULT '',
  image         TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  value      TEXT NOT NULL CHECK(value IN ('yes','no')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(post_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body      TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  event_date  TEXT NOT NULL,
  event_time  TEXT DEFAULT '',
  location    TEXT DEFAULT '',
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  message       TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','refused')),
  reviewed_by   INTEGER REFERENCES users(id),
  created_at    TEXT DEFAULT (datetime('now')),
  reviewed_at   TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  assigned_to   INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
  due_date      TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT DEFAULT (datetime('now')),
  completed_at  TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT DEFAULT '',
  link       TEXT DEFAULT '',
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope         TEXT NOT NULL CHECK(scope IN ('global','managers','dept','private')),
  department_id INTEGER REFERENCES departments(id),
  sender_id     INTEGER NOT NULL REFERENCES users(id),
  recipient_id  INTEGER REFERENCES users(id),
  body            TEXT DEFAULT '',
  attachment      TEXT DEFAULT '',
  attachment_name TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_reads (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room        TEXT NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, room)
);

-- Sprint 6 · Media: private albums + media items (shareable to the public feed)
CREATE TABLE IF NOT EXISTS albums (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS album_media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id      INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  thumb_path    TEXT DEFAULT '',
  caption       TEXT DEFAULT '',
  shared_post_id INTEGER REFERENCES posts(id),
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Sprint 6 · HR: attendance, meeting conclusions, rule-break alerts
CREATE TABLE IF NOT EXISTS attendance (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_date TEXT NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'present' CHECK(status IN ('present','absent','late')),
  notes       TEXT DEFAULT '',
  marked_by   INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE (meeting_date, user_id)
);
CREATE TABLE IF NOT EXISTS meeting_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  body        TEXT DEFAULT '',
  meeting_date TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  severity    TEXT NOT NULL DEFAULT 'minor' CHECK(severity IN ('minor','major','critical')),
  reported_by INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- off-site backups: what we pushed to Google Drive (per month)
-- + tiny key/value settings (last sync status…)
CREATE TABLE IF NOT EXISTS drive_backups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  month      TEXT NOT NULL,           -- '2026-10'
  path       TEXT NOT NULL,           -- 'club.db' | 'uploads/public/x.png' …
  size       INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (month, path)
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

-- Sprint 6 · Events: itineraries + decoration planning
CREATE TABLE IF NOT EXISTS itineraries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  event_date  TEXT,
  steps       TEXT DEFAULT '',
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS decorations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Sprint 5 · Finance: sponsor pipeline + budget (private to Finance)
CREATE TABLE IF NOT EXISTS sponsors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  contact     TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'lead' CHECK(status IN ('lead','contacted','negotiating','won','declined')),
  kind        TEXT NOT NULL DEFAULT 'money' CHECK(kind IN ('money','goods')),
  value       REAL DEFAULT 0,
  details     TEXT DEFAULT '',
  notes       TEXT DEFAULT '',
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS budget_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK(kind IN ('income','expense')),
  label       TEXT NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  entry_date  TEXT,
  notes       TEXT DEFAULT '',
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);
`;

// Demo content (accounts, posts, events, tasks, messages) is skipped when
// ISIGK_DEMO_ACCOUNTS=0 — the real production install: only the departments
// are created, the Professor registers himself on /signup, then creates the
// Leader and the club fills up with real people. (Default: demo ON.)
const DEMO = process.env.ISIGK_DEMO_ACCOUNTS !== '0';

async function seed() {
  // ---------------- departments (+ demo accounts) ----------------
  const deptCount = (await prepare('SELECT COUNT(*) AS c FROM departments').get()).c;
  if (deptCount === 0) {
    const insDept = prepare(
      'INSERT INTO departments (slug, name, description, coming_soon) VALUES (?,?,?,?)'
    );
    await insDept.run('hr',       'Human Resources', 'Members, attendance and discipline', 0);
    await insDept.run('events',   'Events',          'Events planning, itineraries and decoration', 0);
    await insDept.run('media',    'Media',           'Albums, clips and social media', 0);
    await insDept.run('finance',  'Finance',         'Budget, expenses and sponsors', 0);
    await insDept.run('materials','Materials',       'Inventory and loans', 1); // coming soon

    if (DEMO) {
      const hash = bcrypt.hashSync('password123', 10);
      const insUser = prepare(
        'INSERT INTO users (email, password_hash, full_name, role, department_id, bio) VALUES (?,?,?,?,?,?)'
      );
      const deptId = async (slug) => (await prepare('SELECT id FROM departments WHERE slug=?').get(slug)).id;

      // Demo accounts — password for all: password123
      await insUser.run('professor@isigk.tn', hash, 'Pr. Ahmed Supervisor', 'professor', null, 'Club supervisor');
      await insUser.run('leader@isigk.tn',    hash, 'Karim Leader',         'leader',    null, 'Club leader');
      await insUser.run('coleader@isigk.tn',  hash, 'Sara Co-Leader',       'coleader',  null, 'Club co-leader');
      await insUser.run('hr@isigk.tn',        hash, 'Rania HR Manager',     'manager',   await deptId('hr'),     'Head of HR');
      await insUser.run('events@isigk.tn',    hash, 'Mehdi Events Manager', 'manager',   await deptId('events'), 'Head of Events');
      await insUser.run('media@isigk.tn',     hash, 'Yassine Media Manager','manager',   await deptId('media'),  'Head of Media');
      await insUser.run('finance@isigk.tn',   hash, 'Amel Finance Manager', 'manager',   await deptId('finance'),'Head of Finance');
      await insUser.run('member@isigk.tn',    hash, 'Omar Member',          'member',    await deptId('hr'),     'HR member');
      await insUser.run('guest@isigk.tn',     hash, 'Lina Guest',           'guest',     null,                  'Visitor');
      console.log('Database seeded with demo accounts.');
    } // DEMO accounts
  }

  // ---------------- demo posts (so feeds are not empty on first run) ----------------
  const seeded = (await prepare("SELECT COUNT(*) AS c FROM posts WHERE title = 'Sponsor offer — TechnoVision'").get()).c;
  if (DEMO && seeded === 0) {
    await exec('DELETE FROM posts'); // clear any partial seed (votes/comments cascade)
    const u = async (email) => (await prepare('SELECT id FROM users WHERE email=?').get(email)).id;
    const d = async (slug) => (await prepare('SELECT id FROM departments WHERE slug=?').get(slug)).id;
    const addPost = prepare(
      `INSERT INTO posts (department_id, author_id, type, title, body, created_at) VALUES (?,?,?,?,?, datetime('now', ?))`
    );
    const addVote = prepare(`INSERT INTO votes (post_id, user_id, value) VALUES (?,?,?)`);
    const addComment = prepare(
      `INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?,?,?, datetime('now', ?))`
    );

    const p1 = (await addPost.run(await d('media'), await u('media@isigk.tn'), 'clip',
      'Teaser clip for the winter competition',
      'First cut of the 30s teaser — we need a Yes/No from the team before posting it on the club page.',
      '-2 hours')).lastInsertRowid;
    await addVote.run(p1, await u('leader@isigk.tn'), 'yes');
    await addVote.run(p1, await u('member@isigk.tn'), 'yes');
    await addComment.run(p1, await u('leader@isigk.tn'), 'Great pacing, go ahead once the logo is fixed.', '-1 hours');

    const p2 = (await addPost.run(await d('finance'), await u('finance@isigk.tn'), 'offer',
      'Sponsor offer — TechnoVision',
      'They propose 1500 TND for the season in exchange for their logo on our t-shirts and a mention in every post.',
      '-1 days')).lastInsertRowid;
    await addVote.run(p2, await u('coleader@isigk.tn'), 'yes');
    await addComment.run(p2, await u('coleader@isigk.tn'), 'Good offer. Ask if it covers both events.', '-20 hours');

    console.log('Demo posts seeded.');
  }

  // ---------------- demo events (calendar) ----------------
  const eventCount = (await prepare('SELECT COUNT(*) AS c FROM events').get()).c;
  if (DEMO && eventCount === 0) {
    const leaderRow = await prepare("SELECT id FROM users WHERE email='leader@isigk.tn'").get();
    const leaderId = leaderRow?.id ?? null;
    const ins = prepare(
      `INSERT INTO events (title, description, event_date, event_time, location, created_by) VALUES (?,?,?,?,?,?)`
    );
    const day = (offset) => {
      const d = new Date(Date.now() + offset * 86400000);
      return d.toISOString().slice(0, 10);
    };
    await ins.run('General assembly', 'Kick-off of the season: objectives and team assignments.', day(5), '14:00', 'Amphi A', leaderId);
    await ins.run('Robotics workshop — sensors', 'Hands-on session with ultrasonic sensors. Bring your laptop.', day(12), '10:00', 'Lab 203', leaderId);
    await ins.run('Competition registration deadline', 'Final date to register the team for the national challenge.', day(25), '', 'Online', leaderId);
    console.log('Demo events seeded.');
  }

  // ---------------- demo tasks ----------------
  const taskCount = (await prepare('SELECT COUNT(*) AS c FROM tasks').get()).c;
  if (DEMO && taskCount === 0) {
    const u = async (email) => (await prepare('SELECT id FROM users WHERE email=?').get(email)).id;
    const d = async (slug) => (await prepare('SELECT id FROM departments WHERE slug=?').get(slug)).id;
    const ins = prepare(
      `INSERT INTO tasks (department_id, title, description, assigned_to, status, due_date, created_by, created_at)
       VALUES (?,?,?,?,?,?,?, datetime('now', ?))`
    );
    await ins.run(await d('hr'), 'Plan the general assembly seating', 'Book room + prepare the attendance sheet.',
      await u('member@isigk.tn'), 'doing', null, await u('hr@isigk.tn'), '-1 days');
    await ins.run(await d('media'), 'Record the workshop recap video', 'Short 60s vertical video for Instagram.',
      null, 'todo', null, await u('media@isigk.tn'), '-3 hours');
    await ins.run(await d('events'), 'Send invitation emails to partner clubs', '',
      await u('events@isigk.tn'), 'done', null, await u('leader@isigk.tn'), '-2 days');
    console.log('Demo tasks seeded.');
  }

  // ---------------- demo chat messages ----------------
  const msgCount = (await prepare('SELECT COUNT(*) AS c FROM messages').get()).c;
  if (DEMO && msgCount === 0) {
    const u = async (email) => (await prepare('SELECT id FROM users WHERE email=?').get(email)).id;
    const d = async (slug) => (await prepare('SELECT id FROM departments WHERE slug=?').get(slug)).id;
    const ins = prepare(
      `INSERT INTO messages (scope, department_id, sender_id, recipient_id, body, created_at)
       VALUES (?,?,?,?,?, datetime('now', ?))`
    );
    // global chat
    await ins.run('global', null, await u('leader@isigk.tn'), null, 'Welcome to the club chat everyone. Keep it professional.', '-2 days');
    await ins.run('global', null, await u('coleader@isigk.tn'), null, 'Reminder: general assembly next Monday, 14h, room 203.', '-1 days');
    await ins.run('global', null, await u('member@isigk.tn'), null, 'Noted, thank you.', '-1 hours');
    // managers chat
    await ins.run('managers', null, await u('leader@isigk.tn'), null, 'Managers: please submit your department reports before Friday.', '-2 days');
    await ins.run('managers', null, await u('hr@isigk.tn'), null, 'HR report will be ready tomorrow.', '-1 days');
    // HR dept chat
    await ins.run('dept', await d('hr'), await u('hr@isigk.tn'), null, 'Team, we need two volunteers for the assembly desk.', '-1 days');
    await ins.run('dept', await d('hr'), await u('member@isigk.tn'), null, 'I can help.', '-1 hours');
    // private DM: leader <-> member
    await ins.run('private', null, await u('leader@isigk.tn'), await u('member@isigk.tn'), 'Hi Omar, could you take charge of the attendance sheet?', '-1 days');
    await ins.run('private', null, await u('member@isigk.tn'), await u('leader@isigk.tn'), 'Yes, on it.', '-1 hours');
    console.log('Demo chat seeded.');
  }

  // ---------------- chat read pointers ----------------
  // Everyone starts with chat read pointers set to the last seeded message
  // (so unread badges start at 0 and grow live)
  const maxMsg = (await prepare('SELECT COALESCE(MAX(id), 0) AS m FROM messages').get()).m;
  if (maxMsg > 0) {
    await prepare(
      `INSERT INTO chat_reads (user_id, room, last_read_id)
       SELECT id, 'global', ? FROM users WHERE role != 'guest'
       ON CONFLICT DO NOTHING`
    ).run(maxMsg);
    await prepare(
      `INSERT INTO chat_reads (user_id, room, last_read_id)
       SELECT id, 'managers', ? FROM users WHERE role IN ('manager','leader','coleader','professor')
       ON CONFLICT DO NOTHING`
    ).run(maxMsg);
    await prepare(
      `INSERT INTO chat_reads (user_id, room, last_read_id)
       SELECT DISTINCT u.id, 'dept:' || t.id, ?
       FROM users u JOIN departments t ON t.id = u.department_id
       WHERE u.role IN ('manager','member')
       ON CONFLICT DO NOTHING`
    ).run(maxMsg);
  }
}

// resolves once the schema exists; `seeded` once demo content is in
const seeded = (async () => {
  try {
    // pragmas — file mode only (Turso runs its own journal; FKs are ON there)
    try { await client.execute('PRAGMA foreign_keys = ON'); } catch { /* remote manages it */ }
    if (!TURSO_URL) {
      try { await client.execute('PRAGMA journal_mode = WAL'); } catch { /* non-fatal */ }
    }

    await client.executeMultiple(SCHEMA);

    // ---------------- Migrations (safe on an existing database) ----------------
    // 2026-10-15 · a sponsor can contribute GOODS (food, tech, material…) — the
    // pipeline used to be money-only, so `kind` + `details` are added if missing
    const sponsorCols = (await client.execute('PRAGMA table_info(sponsors)')).rows.map((c) => c.name);
    if (!sponsorCols.includes('kind')) await client.execute("ALTER TABLE sponsors ADD COLUMN kind TEXT NOT NULL DEFAULT 'money'");
    if (!sponsorCols.includes('details')) await client.execute("ALTER TABLE sponsors ADD COLUMN details TEXT DEFAULT ''");

    // 2026-10-15 · media storage rework (storage.js): thumbnails for album
    // grids + the original attachment filename kept for display
    const mediaCols = (await client.execute('PRAGMA table_info(album_media)')).rows.map((c) => c.name);
    if (!mediaCols.includes('thumb_path')) await client.execute("ALTER TABLE album_media ADD COLUMN thumb_path TEXT DEFAULT ''");
    const msgCols = (await client.execute('PRAGMA table_info(messages)')).rows.map((c) => c.name);
    if (!msgCols.includes('attachment_name')) await client.execute("ALTER TABLE messages ADD COLUMN attachment_name TEXT DEFAULT ''");

    resolveReady();
    await seed();
    console.log(`[db] ready (${TURSO_URL ? 'Turso · online' : `local · ${dbFile}`})`);
  } catch (e) {
    console.error('[db] init failed:', e);
    rejectReady(e);
  }
})();

const db = { prepare, exec, backup, exportSnapshot, ready, seeded, client, remote: !!TURSO_URL };

module.exports = db;
