// ============================================================
//  test/auth.test.js — authentication & token security
//  (CommonJS; boot one isolated demo server for this suite)
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req, raw, login } = require('./helpers');

let srv;

test.before(async () => { srv = await startServer({ port: 4310, demo: '1' }); });
test.after(() => srv && srv.stop());

test('health reports demo mode + auth configured', async () => {
  const r = await req(srv.base, 'GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.demo, true);
  assert.equal(r.data.auth_configured, true);
});

test('login succeeds and /auth/me returns id + role + bio', async () => {
  const r = await login(srv.base, 'leader@isigk.tn');
  assert.ok(r.token);
  const me = await req(srv.base, 'GET', '/auth/me', r.token);
  assert.equal(me.status, 200);
  assert.equal(me.data.role, 'leader');
  assert.ok(me.data.id >= 1);
  assert.ok('bio' in me.data);
});

test('login with a wrong password -> 401, no token', async () => {
  const r = await req(srv.base, 'POST', '/auth/login', null, { email: 'leader@isigk.tn', password: 'wrong' });
  assert.equal(r.status, 401);
  assert.equal(r.data.token, undefined);
});

test('login with missing fields -> 400', async () => {
  const r = await req(srv.base, 'POST', '/auth/login', null, {});
  assert.equal(r.status, 400);
});

test('missing / garbage / forged / expired tokens -> 401', async () => {
  const noToken = await req(srv.base, 'GET', '/auth/me');
  assert.equal(noToken.status, 401);

  const garbage = await raw(srv.base, 'GET', '/api/auth/me', { headers: { Authorization: 'Bearer not-a-jwt' } });
  assert.equal(garbage.status, 401);

  const jwt = require('jsonwebtoken');
  const forged = jwt.sign({ id: 2, role: 'supervisor' }, 'a-different-secret', { expiresIn: '1h' });
  const f = await raw(srv.base, 'GET', '/api/auth/me', { headers: { Authorization: `Bearer ${forged}` } });
  assert.equal(f.status, 401);

  const expired = jwt.sign({ id: 2, role: 'leader' }, require('./helpers').TEST_SECRET, { expiresIn: -10 });
  const e = await raw(srv.base, 'GET', '/api/auth/me', { headers: { Authorization: `Bearer ${expired}` } });
  assert.equal(e.status, 401);
});

test('every protected route family rejects an anonymous caller', async () => {
  const protectedRoutes = [
    '/users', '/posts?department_id=1', '/tasks?department_id=1', '/events',
    '/chat/rooms', '/media/albums', '/notifications', '/applications',
    '/goals', '/reports/data', '/storage', '/finance/sponsors', '/hr/notes', '/plans/itineraries',
    '/departments/hr',
  ];
  for (const p of protectedRoutes) {
    const r = await req(srv.base, 'GET', p);
    assert.equal(r.status, 401, `expected 401 for anonymous GET ${p} (got ${r.status})`);
  }
});

test('guest session is rejected from member-only surfaces', async () => {
  const g = await login(srv.base, 'guest@isigk.tn');
  for (const p of ['/users', '/media/albums', '/chat/rooms']) {
    const r = await req(srv.base, 'GET', p, g.token);
    assert.equal(r.status, 403, `guest must be 403 on ${p} (got ${r.status})`);
  }
  // the public department feed stays readable for guests
  const feed = await req(srv.base, 'GET', '/posts?department_id=3', g.token);
  assert.equal(feed.status, 200);
});

test('the public directory never leaks password hashes', async () => {
  const l = await login(srv.base, 'leader@isigk.tn');
  const r = await req(srv.base, 'GET', '/users', l.token);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data));
  for (const u of r.data) assert.ok(!('password_hash' in u), 'password_hash leaked in directory');
});
