// ============================================================
//  test/migration.test.js — legacy (pre-multi-club) database
//  Boots the server on a database built with the OLD schema
//  (professor role, departments.slug globally UNIQUE, no clubs)
//  and asserts the additive migration folds it into one club
//  WITHOUT losing ids or breaking foreign keys.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req, login } = require('./helpers');
const bcrypt = require('bcryptjs');
const { createClient } = require('@libsql/client');

// the schema exactly as it was BEFORE the multi-club work
const LEGACY_SCHEMA = `
CREATE TABLE departments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  coming_soon INTEGER DEFAULT 0
);
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('professor','leader','coleader','manager','member','guest')),
  department_id INTEGER REFERENCES departments(id),
  bio           TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  author_id     INTEGER NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL DEFAULT 'announcement' CHECK(type IN ('announcement','clip','offer')),
  title         TEXT NOT NULL,
  body          TEXT DEFAULT '',
  image         TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE TABLE votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  value      TEXT NOT NULL CHECK(value IN ('yes','no')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(post_id, user_id)
);
CREATE TABLE comments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body      TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

let srv;
let dbPath;

test.before(async () => {
  srv = await startServer({
    port: 4316,
    demo: '0',
    initDb: async ({ dbPath: p }) => {
      dbPath = p;
      const c = createClient({ url: `file:${p}` });
      await c.executeMultiple(LEGACY_SCHEMA);
      const hash = bcrypt.hashSync('password123', 10);
      await c.executeMultiple(`
        INSERT INTO departments (id, slug, name, description) VALUES
          (1,'hr','Human Resources','legacy'),
          (2,'events','Events','legacy');
        INSERT INTO users (id, email, password_hash, full_name, role, department_id) VALUES
          (1,'oldprof@x.tn','${hash}','Old Professor','professor',NULL),
          (2,'oldlead@x.tn','${hash}','Old Leader','leader',NULL),
          (3,'oldhr@x.tn','${hash}','Old HR','manager',1);
        INSERT INTO posts (id, department_id, author_id, title, body) VALUES
          (7, 1, 3, 'Legacy post', 'kept');
        INSERT INTO votes (id, post_id, user_id, value) VALUES (1, 7, 2, 'yes');
        INSERT INTO comments (id, post_id, author_id, body) VALUES (1, 7, 2, 'legacy comment');
      `);
      c.close();
    },
  });
});
test.after(() => srv && srv.stop());

async function query(sql) {
  const c = createClient({ url: `file:${dbPath}` });
  const rows = JSON.parse(JSON.stringify((await c.execute(sql)).rows));
  c.close();
  return rows;
}

test('the legacy professor is folded into supervisor and can still log in', async () => {
  const s = await login(srv.base, 'oldprof@x.tn');
  assert.equal(s.user.role, 'supervisor');
  assert.equal(s.user.id, 1, 'the user id is preserved');
  assert.ok(s.user.club_id, 'the user is attached to a club');
});

test('all legacy rows are folded into ONE club, with ids untouched', async () => {
  const clubs = await query('SELECT * FROM clubs');
  assert.equal(clubs.length, 1);
  assert.equal(clubs[0].created_by, 1, 'the club points at its first supervisor');

  const users = await query('SELECT id, role, club_id FROM users ORDER BY id');
  assert.equal(users.length, 3);
  assert.ok(users.every((u) => u.club_id === clubs[0].id), 'every user is in the club');
  assert.equal(users[0].role, 'supervisor');
  assert.equal(users[1].role, 'leader');

  // departments were rebuilt (club_id + per-club slug) without losing ids
  const depts = await query('SELECT id, slug, club_id FROM departments ORDER BY id');
  assert.deepEqual(depts.map((d) => [d.id, d.slug]), [[1, 'hr'], [2, 'events']]);
  assert.ok(depts.every((d) => d.club_id === clubs[0].id));

  // the legacy post is intact and still points at its department + author;
  // its old 'announcement' type is folded into the new media kind 'text'
  const posts = await query('SELECT id, department_id, author_id, type, video FROM posts WHERE id = 7');
  assert.deepEqual(posts[0], { id: 7, department_id: 1, author_id: 3, type: 'text', video: '' });

  // the legacy votes/comments survived the table rebuild (ids preserved)
  assert.deepEqual(await query('SELECT id, post_id, user_id, value FROM votes'), [
    { id: 1, post_id: 7, user_id: 2, value: 'yes' },
  ]);
  assert.equal((await query('SELECT COUNT(*) AS c FROM comments'))[0].c, 1);
});

test('the widened CHECKs accept the new reaction and post type after migration', async () => {
  const s = await login(srv.base, 'oldprof@x.tn');

  // reactions now accept 'maybe' (the old votes CHECK only allowed yes/no)
  const r = await req(srv.base, 'POST', '/posts/7/vote', s.token, { value: 'maybe' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.my_vote, 'maybe');

  // a poll post can be created (the old posts CHECK had no 'poll')
  const poll = await req(srv.base, 'POST', '/posts', s.token, {
    department_id: 1, type: 'poll', title: 'New after migration', options: ['A', 'B'],
  });
  // the supervisor cannot post — use the HR manager instead
  assert.equal(poll.status, 403);
  const mgr = await login(srv.base, 'oldhr@x.tn');
  const ok = await req(srv.base, 'POST', '/posts', mgr.token, {
    department_id: 1, type: 'poll', title: 'New after migration', options: ['A', 'B'],
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.type, 'poll');
  assert.equal(ok.data.poll.options.length, 2);
});

test('the migrated club works through the API', async () => {
  const s = await login(srv.base, 'oldprof@x.tn');

  const depts = await req(srv.base, 'GET', '/departments', s.token);
  assert.equal(depts.status, 200);
  assert.deepEqual(depts.data.map((d) => d.slug), ['hr', 'events']);

  const feed = await req(srv.base, 'GET', '/posts?department_id=1', s.token);
  assert.equal(feed.status, 200);
  assert.ok(feed.data.some((p) => p.title === 'Legacy post'), 'the legacy post is still visible');
});

test('a brand-new club can reuse the migrated club\'s department slugs', async () => {
  const r = await req(srv.base, 'POST', '/auth/create-club', null,
    { club_name: 'Second Club', full_name: 'Two', email: 'two@x.tn', password: 'password123' });
  assert.equal(r.status, 201, JSON.stringify(r.data));

  const depts = await req(srv.base, 'GET', '/departments', r.data.token);
  assert.deepEqual(
    depts.data.map((d) => d.slug).sort(),
    ['events', 'finance', 'hr', 'materials', 'media'],
  );
  // its ids are all new — the migrated club's rows are never reused
  assert.ok(depts.data.every((d) => d.id > 2), 'the new club gets fresh department rows');
});
