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
// The local (file-backed) database must live in an existing directory.
// DB_PATH is often pointed at a mounted persistent disk whose parent may not
// exist yet; without this the very first boot dies with SQLITE_CANTOPEN.
if (!TURSO_URL) {
  try { require('fs').mkdirSync(path.dirname(dbFile), { recursive: true }); } catch { /* best effort */ }
}
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
CREATE TABLE IF NOT EXISTS clubs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,        -- url-safe identifier, unique across the site
  description TEXT DEFAULT '',
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id     INTEGER REFERENCES clubs(id), -- owning club (each club has its own set)
  slug        TEXT NOT NULL,               -- hr | events | media | finance | materials
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  coming_soon INTEGER DEFAULT 0,           -- 1 = materials (coming soon)
  UNIQUE (club_id, slug)
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('supervisor','leader','coleader','manager','member','guest')),
  club_id       INTEGER REFERENCES clubs(id),
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
  -- media kind: text | image | video | poll
  type          TEXT NOT NULL DEFAULT 'text' CHECK(type IN ('text','image','video','poll')),
  title         TEXT NOT NULL,
  body          TEXT DEFAULT '',
  image         TEXT DEFAULT '',           -- public image path (type 'image')
  video         TEXT DEFAULT '',           -- public video path (type 'video')
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  value      TEXT NOT NULL CHECK(value IN ('yes','no','maybe')),
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

-- poll posts: the choices, and one vote per member per poll (changeable)
CREATE TABLE IF NOT EXISTS poll_options (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id  INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  body     TEXT NOT NULL,
  position INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS poll_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  option_id  INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(post_id, user_id)
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id     INTEGER REFERENCES clubs(id),
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  event_date  TEXT NOT NULL,
  end_date    TEXT DEFAULT '',           -- multi-day events: '' = single day
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
  club_id       INTEGER REFERENCES clubs(id),
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
  club_id     INTEGER REFERENCES clubs(id),
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
  club_id     INTEGER REFERENCES clubs(id),
  title       TEXT NOT NULL,
  body        TEXT DEFAULT '',
  meeting_date TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Sprint 7 · Meetings: leadership-started live rooms (global / department /
-- private) with host-approved joining and a per-meeting chat.
CREATE TABLE IF NOT EXISTS meetings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id       INTEGER REFERENCES clubs(id),
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  scope         TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global','department','private')),
  department_id INTEGER REFERENCES departments(id),
  started_by    INTEGER NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'live' CHECK(status IN ('live','ended')),
  created_at    TEXT DEFAULT (datetime('now')),
  ended_at      TEXT
);
CREATE TABLE IF NOT EXISTS meeting_participants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'participant' CHECK(role IN ('host','participant')),
  -- how they got here: the host · invited BY the host · asked to join.
  -- Only an 'invited' person may accept their own invite; a 'requested'
  -- person is accepted by the HOST (this is the join-approval rule).
  origin     TEXT NOT NULL DEFAULT 'requested' CHECK(origin IN ('host','invited','requested')),
  status     TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','left')),
  created_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT,
  UNIQUE(meeting_id, user_id)
);
CREATE TABLE IF NOT EXISTS meeting_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  club_id    INTEGER REFERENCES clubs(id),
  sender_id  INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS meeting_reads (
  meeting_id   INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (meeting_id, user_id)
);
CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id     INTEGER REFERENCES clubs(id),
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
  club_id     INTEGER REFERENCES clubs(id),
  title       TEXT NOT NULL,
  event_date  TEXT,
  steps       TEXT DEFAULT '',
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS decorations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id     INTEGER REFERENCES clubs(id),
  title       TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Sprint 5 · Finance: sponsor pipeline + budget (private to Finance)
CREATE TABLE IF NOT EXISTS sponsors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id     INTEGER REFERENCES clubs(id),
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
  club_id     INTEGER REFERENCES clubs(id),
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
// are created, the Supervisor registers himself on /signup, then creates the
// Leader and the club fills up with real people.
// Default: demo ON for local dev, OFF on Vercel / NODE_ENV=production so a
// hosted install never seeds public password123 accounts by accident.
const DEMO = process.env.ISIGK_DEMO_ACCOUNTS
  ? process.env.ISIGK_DEMO_ACCOUNTS !== '0'
  : !(process.env.VERCEL || process.env.NODE_ENV === 'production');

// Every club owns its own copy of these five departments. The slug is only
// unique INSIDE a club (see the UNIQUE (club_id, slug) constraint).
const DEFAULT_DEPARTMENTS = [
  ['hr',        'Human Resources', 'Members, attendance and discipline',            0],
  ['events',    'Events',          'Events planning, itineraries and decoration',   0],
  ['media',     'Media',           'Albums, clips and social media',                0],
  ['finance',   'Finance',         'Budget, expenses and sponsors',                 0],
  ['materials', 'Materials',       'Inventory and loans',                           1], // coming soon
];

// Create a brand-new club and seed its five starter departments.
// Returns the new club id. Used by the create-club flow (/api/auth/create-club)
// and by the demo/local seed below.
async function createClub(name, slug) {
  const info = await prepare('INSERT INTO clubs (name, slug) VALUES (?,?)')
    .run(String(name).trim(), slug);
  const clubId = info.lastInsertRowid;
  const insDept = prepare(
    'INSERT INTO departments (club_id, slug, name, description, coming_soon) VALUES (?,?,?,?,?)'
  );
  for (const [s, n, d, soon] of DEFAULT_DEPARTMENTS) await insDept.run(clubId, s, n, d, soon);
  return clubId;
}

// Make sure a club has its five departments (idempotent).
async function ensureDepartments(clubId) {
  const count = (await prepare('SELECT COUNT(*) AS c FROM departments WHERE club_id = ?').get(clubId)).c;
  if (Number(count) > 0) return;
  const insDept = prepare(
    'INSERT INTO departments (club_id, slug, name, description, coming_soon) VALUES (?,?,?,?,?)'
  );
  for (const [s, n, d, soon] of DEFAULT_DEPARTMENTS) await insDept.run(clubId, s, n, d, soon);
}

async function seed() {
  // A club is the root of every tenant. On a fresh install:
  //   * demo/local dev → build one ready-to-explore club with demo people;
  //   * real production → create NOTHING; the first visitor creates the club
  //     on /signup (POST /api/auth/create-club) and becomes its Supervisor.
  // On a database that already has a club (migrated legacy data, or a club
  // created by a real user), we only make sure the departments exist.
  let club = await prepare('SELECT id, slug FROM clubs ORDER BY id LIMIT 1').get();
  let fresh = false;
  if (!club) {
    if (!DEMO) return;
    const clubId = await createClub('ISIGK Robotics', 'isigk-robotics');
    club = { id: clubId, slug: 'isigk-robotics' };
    fresh = true;
  }
  const clubId = club.id;
  await ensureDepartments(clubId);
  if (DEMO && fresh) await seedDemoContent(clubId);
}

// Demo accounts + starter content for one club (local/dev only).
async function seedDemoContent(clubId) {
  const hash = bcrypt.hashSync('password123', 10);
  const insUser = prepare(
    'INSERT INTO users (email, password_hash, full_name, role, club_id, department_id, bio) VALUES (?,?,?,?,?,?,?)'
  );
  const deptId = async (slug) =>
    (await prepare('SELECT id FROM departments WHERE club_id=? AND slug=?').get(clubId, slug)).id;

  // Demo accounts — password for all: password123
  await insUser.run('supervisor@isigk.tn', hash, 'Pr. Ahmed Supervisor', 'supervisor', clubId, null, 'Club supervisor');
  await insUser.run('leader@isigk.tn',     hash, 'Karim Leader',         'leader',     clubId, null, 'Club leader');
  await insUser.run('coleader@isigk.tn',   hash, 'Sara Co-Leader',       'coleader',   clubId, null, 'Club co-leader');
  await insUser.run('hr@isigk.tn',         hash, 'Rania HR Manager',     'manager',    clubId, await deptId('hr'),     'Head of HR');
  await insUser.run('events@isigk.tn',     hash, 'Mehdi Events Manager', 'manager',    clubId, await deptId('events'), 'Head of Events');
  await insUser.run('media@isigk.tn',      hash, 'Yassine Media Manager','manager',    clubId, await deptId('media'),  'Head of Media');
  await insUser.run('finance@isigk.tn',    hash, 'Amel Finance Manager', 'manager',    clubId, await deptId('finance'),'Head of Finance');
  await insUser.run('member@isigk.tn',     hash, 'Omar Member',          'member',     clubId, await deptId('hr'),     'HR member');
  await insUser.run('guest@isigk.tn',      hash, 'Lina Guest',           'guest',      clubId, null,                  'Visitor');
  console.log('Database seeded with demo accounts.');

  const u = async (email) => (await prepare('SELECT id FROM users WHERE email=?').get(email)).id;

  // ---------------- demo posts ----------------
  const addPost = prepare(
    `INSERT INTO posts (department_id, author_id, type, title, body, created_at) VALUES (?,?,?,?,?, datetime('now', ?))`
  );
  const addVote = prepare(`INSERT INTO votes (post_id, user_id, value) VALUES (?,?,?)`);
  const addComment = prepare(
    `INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?,?,?, datetime('now', ?))`
  );
  const p1 = (await addPost.run(await deptId('media'), await u('media@isigk.tn'), 'text',
    'Teaser clip for the winter competition',
    'First cut of the 30s teaser — a Yes / No / Maybe from the team before we post it on the club page.',
    '-2 hours')).lastInsertRowid;
  await addVote.run(p1, await u('leader@isigk.tn'), 'yes');
  await addVote.run(p1, await u('member@isigk.tn'), 'yes');
  await addVote.run(p1, await u('coleader@isigk.tn'), 'maybe');
  await addComment.run(p1, await u('leader@isigk.tn'), 'Great pacing, go ahead once the logo is fixed.', '-1 hours');

  const p2 = (await addPost.run(await deptId('finance'), await u('finance@isigk.tn'), 'text',
    'Sponsor offer — TechnoVision',
    'They propose 1500 TND for the season in exchange for their logo on our t-shirts and a mention in every post.',
    '-1 days')).lastInsertRowid;
  await addVote.run(p2, await u('coleader@isigk.tn'), 'yes');
  await addComment.run(p2, await u('coleader@isigk.tn'), 'Good offer. Ask if it covers both events.', '-20 hours');

  // a poll post — shows the phase-4 poll type with options + per-member votes
  const p3 = (await addPost.run(await deptId('events'), await u('events@isigk.tn'), 'poll',
    'Where should we hold the February workshop?',
    'Pick one — we book the room next week.',
    '-3 hours')).lastInsertRowid;
  const insOpt = prepare('INSERT INTO poll_options (post_id, body, position) VALUES (?,?,?)');
  const o1 = (await insOpt.run(p3, 'Amphi A', 0)).lastInsertRowid;
  const o2 = (await insOpt.run(p3, 'Media lab', 1)).lastInsertRowid;
  await insOpt.run(p3, 'Online', 2);
  const addPollVote = prepare('INSERT INTO poll_votes (post_id, option_id, user_id) VALUES (?,?,?)');
  await addPollVote.run(p3, o1, await u('leader@isigk.tn'));
  await addPollVote.run(p3, o2, await u('member@isigk.tn'));
  console.log('Demo posts seeded.');

  // ---------------- demo events ----------------
  const leaderId = (await prepare("SELECT id FROM users WHERE email='leader@isigk.tn'").get())?.id ?? null;
  const insEvent = prepare(
    `INSERT INTO events (club_id, title, description, event_date, event_time, location, created_by) VALUES (?,?,?,?,?,?,?)`
  );
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  await insEvent.run(clubId, 'General assembly', 'Kick-off of the season: objectives and team assignments.', day(5), '14:00', 'Amphi A', leaderId);
  await insEvent.run(clubId, 'Robotics workshop — sensors', 'Hands-on session with ultrasonic sensors. Bring your laptop.', day(12), '10:00', 'Lab 203', leaderId);
  await insEvent.run(clubId, 'Competition registration deadline', 'Final date to register the team for the national challenge.', day(25), '', 'Online', leaderId);
  console.log('Demo events seeded.');

  // ---------------- demo tasks ----------------
  const insTask = prepare(
    `INSERT INTO tasks (department_id, title, description, assigned_to, status, due_date, created_by, created_at)
     VALUES (?,?,?,?,?,?,?, datetime('now', ?))`
  );
  await insTask.run(await deptId('hr'), 'Plan the general assembly seating', 'Book room + prepare the attendance sheet.',
    await u('member@isigk.tn'), 'doing', null, await u('hr@isigk.tn'), '-1 days');
  await insTask.run(await deptId('media'), 'Record the workshop recap video', 'Short 60s vertical video for Instagram.',
    null, 'todo', null, await u('media@isigk.tn'), '-3 hours');
  await insTask.run(await deptId('events'), 'Send invitation emails to partner clubs', '',
    await u('events@isigk.tn'), 'done', null, await u('leader@isigk.tn'), '-2 days');
  console.log('Demo tasks seeded.');

  // ---------------- demo chat messages ----------------
  const insMsg = prepare(
    `INSERT INTO messages (club_id, scope, department_id, sender_id, recipient_id, body, created_at)
     VALUES (?,?,?,?,?,?, datetime('now', ?))`
  );
  // global chat
  await insMsg.run(clubId, 'global', null, await u('leader@isigk.tn'), null, 'Welcome to the club chat everyone. Keep it professional.', '-2 days');
  await insMsg.run(clubId, 'global', null, await u('coleader@isigk.tn'), null, 'Reminder: general assembly next Monday, 14h, room 203.', '-1 days');
  await insMsg.run(clubId, 'global', null, await u('member@isigk.tn'), null, 'Noted, thank you.', '-1 hours');
  // managers chat
  await insMsg.run(clubId, 'managers', null, await u('leader@isigk.tn'), null, 'Managers: please submit your department reports before Friday.', '-2 days');
  await insMsg.run(clubId, 'managers', null, await u('hr@isigk.tn'), null, 'HR report will be ready tomorrow.', '-1 days');
  // HR dept chat
  await insMsg.run(clubId, 'dept', await deptId('hr'), await u('hr@isigk.tn'), null, 'Team, we need two volunteers for the assembly desk.', '-1 days');
  await insMsg.run(clubId, 'dept', await deptId('hr'), await u('member@isigk.tn'), null, 'I can help.', '-1 hours');
  // private DM: leader <-> member
  await insMsg.run(clubId, 'private', null, await u('leader@isigk.tn'), await u('member@isigk.tn'), 'Hi Omar, could you take charge of the attendance sheet?', '-1 days');
  await insMsg.run(clubId, 'private', null, await u('member@isigk.tn'), await u('leader@isigk.tn'), 'Yes, on it.', '-1 hours');
  console.log('Demo chat seeded.');

  // ---------------- chat read pointers ----------------
  // Everyone starts with chat read pointers set to the last seeded message
  // (so unread badges start at 0 and grow live)
  const maxMsg = (await prepare('SELECT COALESCE(MAX(id), 0) AS m FROM messages WHERE club_id = ?').get(clubId)).m;
  if (maxMsg > 0) {
    await prepare(
      `INSERT INTO chat_reads (user_id, room, last_read_id)
       SELECT id, 'global', ? FROM users WHERE club_id = ? AND role != 'guest'
       ON CONFLICT DO NOTHING`
    ).run(maxMsg, clubId);
    await prepare(
      `INSERT INTO chat_reads (user_id, room, last_read_id)
       SELECT id, 'managers', ? FROM users WHERE club_id = ? AND role IN ('manager','leader','coleader','supervisor')
       ON CONFLICT DO NOTHING`
    ).run(maxMsg, clubId);
    await prepare(
      `INSERT INTO chat_reads (user_id, room, last_read_id)
       SELECT DISTINCT u.id, 'dept:' || t.id, ?
       FROM users u JOIN departments t ON t.id = u.department_id
       WHERE u.role IN ('manager','member') AND u.club_id = ?
       ON CONFLICT DO NOTHING`
    ).run(maxMsg, clubId);
  }

  // ---------------- demo meeting (phase 5) ----------------
  const mt = await prepare(
    'INSERT INTO meetings (club_id, title, description, scope, started_by) VALUES (?,?,?,?,?)'
  ).run(clubId, 'Weekly club sync', 'Everyone: quick status round before the assembly.', 'global', await u('leader@isigk.tn'));
  const mtId = mt.lastInsertRowid;
  const insPart = prepare(
    "INSERT INTO meeting_participants (meeting_id, user_id, role, origin, status, decided_at) VALUES (?,?,?,?,?, datetime('now'))"
  );
  await insPart.run(mtId, await u('leader@isigk.tn'), 'host', 'host', 'accepted');
  await insPart.run(mtId, await u('coleader@isigk.tn'), 'participant', 'invited', 'accepted');
  // one person waiting for approval, so the host queue is visible in the demo
  await prepare(
    "INSERT INTO meeting_participants (meeting_id, user_id, role, origin, status) VALUES (?,?, 'participant','requested','pending')"
  ).run(mtId, await u('member@isigk.tn'));
  const insMM = prepare(
    "INSERT INTO meeting_messages (meeting_id, club_id, sender_id, body, created_at) VALUES (?,?,?,?, datetime('now', ?))"
  );
  await insMM.run(mtId, clubId, await u('leader@isigk.tn'), 'Agenda: winter competition, budget, then media plan.', '-40 minutes');
  await insMM.run(mtId, clubId, await u('coleader@isigk.tn'), 'I will present the media plan.', '-30 minutes');
  console.log('Demo meeting seeded.');
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

    // 2026-10-17 · multi-day calendar events — end_date ('' = single day)
    const eventCols = (await client.execute('PRAGMA table_info(events)')).rows.map((c) => c.name);
    if (!eventCols.includes('end_date')) await client.execute("ALTER TABLE events ADD COLUMN end_date TEXT DEFAULT ''");

    // 2026-10-18 · ROLE RENAME: 'professor' -> 'supervisor' (the club founder /
    // overseer). Databases created before the rename still carry the original
    // CHECK(role IN ('professor',...)), which would reject the new value, so the
    // users table is rebuilt ONCE — every id preserved, existing professors folded
    // into supervisors. Foreign keys are suspended for the swap (child tables
    // reference users.id by name, which survives the drop+rename). Runs only
    // while the old value is still present in the schema, so it is a no-op after.
    const usersDdl = (await client.execute(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
    )).rows[0];
    if (usersDdl && /professor/.test(String(usersDdl.sql || ''))) {
      await client.execute('PRAGMA foreign_keys = OFF');
      await client.executeMultiple(`
        CREATE TABLE users_migrate (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          email         TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          full_name     TEXT NOT NULL,
          role          TEXT NOT NULL CHECK(role IN ('supervisor','leader','coleader','manager','member','guest')),
          club_id       INTEGER REFERENCES clubs(id),
          department_id INTEGER REFERENCES departments(id),
          bio           TEXT DEFAULT '',
          created_at    TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO users_migrate (id, email, password_hash, full_name, role, department_id, bio, created_at)
          SELECT id, email, password_hash, full_name,
                 CASE WHEN role = 'professor' THEN 'supervisor' ELSE role END,
                 department_id, bio, created_at
          FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrate RENAME TO users;
      `);
      await client.execute('PRAGMA foreign_keys = ON');
      console.log('[db] migration: users role professor -> supervisor');
    }

    // 2026-10-18 · MULTI-CLUB foundation. A single install now hosts many
    // clubs; every row that is not already reachable through a department or a
    // user gets a `club_id`, and the departments table is rebuilt so its slug
    // is only unique PER CLUB (two clubs may both have an 'hr' department).
    const cols = async (t) => (await client.execute(`PRAGMA table_info(${t})`)).rows.map((c) => c.name);
    const addCol = async (t, name, type) => {
      if (!(await cols(t)).includes(name)) await client.execute(`ALTER TABLE ${t} ADD COLUMN ${name} ${type}`);
    };

    // departments: slug uniqueness must become per-club → rebuild once. Every
    // department id is preserved (users/posts/tasks/… reference it by id).
    if (!(await cols('departments')).includes('club_id')) {
      await client.execute('PRAGMA foreign_keys = OFF');
      await client.executeMultiple(`
        CREATE TABLE departments_migrate (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          club_id     INTEGER REFERENCES clubs(id),
          slug        TEXT NOT NULL,
          name        TEXT NOT NULL,
          description TEXT DEFAULT '',
          coming_soon INTEGER DEFAULT 0,
          UNIQUE (club_id, slug)
        );
        INSERT INTO departments_migrate (id, club_id, slug, name, description, coming_soon)
          SELECT id, NULL, slug, name, description, coming_soon FROM departments;
        DROP TABLE departments;
        ALTER TABLE departments_migrate RENAME TO departments;
      `);
      await client.execute('PRAGMA foreign_keys = ON');
      console.log('[db] migration: departments rebuilt (club_id, per-club slug)');
    }

    // club_id on the root + standalone tables (departments handled above).
    await addCol('users', 'club_id', 'INTEGER REFERENCES clubs(id)');
    await addCol('events', 'club_id', 'INTEGER REFERENCES clubs(id)');
    await addCol('messages', 'club_id', 'INTEGER REFERENCES clubs(id)');
    await addCol('attendance', 'club_id', 'INTEGER REFERENCES clubs(id)');
    await addCol('meeting_notes', 'club_id', 'INTEGER REFERENCES clubs(id)');
    await addCol('alerts', 'club_id', 'INTEGER REFERENCES clubs(id)');
    await addCol('itineraries', 'club_id', 'INTEGER REFERENCES clubs(id)');
    await addCol('decorations', 'club_id', 'INTEGER REFERENCES clubs(id)');
    await addCol('sponsors', 'club_id', 'INTEGER REFERENCES clubs(id)');
    await addCol('budget_entries', 'club_id', 'INTEGER REFERENCES clubs(id)');

    // 2026-10-18 · POST TYPES + REACTIONS (phase 4). posts.type becomes the
    // media kind (text|image|video|poll) and posts gains a `video` column;
    // votes.value gains 'maybe'. Each CHECK is baked into its table, so each is
    // rebuilt ONCE (ids preserved) while the old form is still present — a no-op
    // on a fresh or already-migrated database. Foreign keys are suspended for
    // the swap (votes/comments/album_media reference posts by name, which is
    // restored by the rename).
    const postsDdl = (await client.execute(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='posts'",
    )).rows[0];
    if (postsDdl && !/poll/.test(String(postsDdl.sql || ''))) {
      await client.execute('PRAGMA foreign_keys = OFF');
      await client.executeMultiple(`
        CREATE TABLE posts_migrate (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          department_id INTEGER NOT NULL REFERENCES departments(id),
          author_id     INTEGER NOT NULL REFERENCES users(id),
          type          TEXT NOT NULL DEFAULT 'text' CHECK(type IN ('text','image','video','poll')),
          title         TEXT NOT NULL,
          body          TEXT DEFAULT '',
          image         TEXT DEFAULT '',
          video         TEXT DEFAULT '',
          created_at    TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO posts_migrate (id, department_id, author_id, type, title, body, image, video, created_at)
          SELECT id, department_id, author_id,
                 CASE WHEN image IS NOT NULL AND image <> '' THEN 'image' ELSE 'text' END,
                 title, body, image, '', created_at
          FROM posts;
        DROP TABLE posts;
        ALTER TABLE posts_migrate RENAME TO posts;
      `);
      await client.execute('PRAGMA foreign_keys = ON');
      console.log('[db] migration: posts rebuilt (text|image|video|poll + media columns)');
    } else {
      await addCol('posts', 'video', "TEXT DEFAULT ''");
    }

    const votesDdl = (await client.execute(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='votes'",
    )).rows[0];
    if (votesDdl && !/maybe/.test(String(votesDdl.sql || ''))) {
      await client.execute('PRAGMA foreign_keys = OFF');
      await client.executeMultiple(`
        CREATE TABLE votes_migrate (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          user_id    INTEGER NOT NULL REFERENCES users(id),
          value      TEXT NOT NULL CHECK(value IN ('yes','no','maybe')),
          created_at TEXT DEFAULT (datetime('now')),
          UNIQUE(post_id, user_id)
        );
        INSERT INTO votes_migrate (id, post_id, user_id, value, created_at)
          SELECT id, post_id, user_id, value, created_at FROM votes;
        DROP TABLE votes;
        ALTER TABLE votes_migrate RENAME TO votes;
      `);
      await client.execute('PRAGMA foreign_keys = ON');
      console.log('[db] migration: votes rebuilt (yes|no|maybe)');
    }

    // Legacy database with data but no club yet → wrap everything in one club
    // so nothing is orphaned and the app keeps working exactly as before.
    const clubCount = (await client.execute('SELECT COUNT(*) AS c FROM clubs')).rows[0].c;
    const userCount = (await client.execute('SELECT COUNT(*) AS c FROM users')).rows[0].c;
    const deptCount = (await client.execute('SELECT COUNT(*) AS c FROM departments')).rows[0].c;
    if (Number(clubCount) === 0 && (Number(userCount) > 0 || Number(deptCount) > 0)) {
      const info = await client.execute(
        "INSERT INTO clubs (name, slug, description) VALUES ('ISIGK Robotics', 'isigk-robotics', '')",
      );
      const clubId = Number(info.lastInsertRowid);
      for (const t of ['users', 'departments', 'events', 'messages', 'attendance', 'meeting_notes',
        'alerts', 'itineraries', 'decorations', 'sponsors', 'budget_entries']) {
        await client.execute(`UPDATE ${t} SET club_id = ${clubId} WHERE club_id IS NULL`);
      }
      // point the club at its first supervisor, when there is one
      const sup = (await client.execute(
        "SELECT id FROM users WHERE role = 'supervisor' ORDER BY id LIMIT 1",
      )).rows[0];
      if (sup) await client.execute(`UPDATE clubs SET created_by = ${Number(sup.id)} WHERE id = ${clubId}`);
      console.log('[db] migration: legacy data folded into club "ISIGK Robotics"');
    }

    resolveReady();
    await seed();
    console.log(`[db] ready (${TURSO_URL ? 'Turso · online' : `local · ${dbFile}`})`);
  } catch (e) {
    console.error('[db] init failed:', e);
    rejectReady(e);
  }
})();

const db = { prepare, exec, backup, exportSnapshot, ready, seeded, client, remote: !!TURSO_URL, demo: DEMO, createClub };

module.exports = db;
