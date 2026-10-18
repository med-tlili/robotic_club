// ============================================================
//  test/permissions.test.js — server-side role / department matrix
//  Every check must hold even when the client is bypassed.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req, loginAll, login } = require('./helpers');

let srv;
let users;
let dept = {};

test.before(async () => {
  srv = await startServer({ port: 4313, demo: '1' });
  users = await loginAll(srv.base);
  const ds = await req(srv.base, 'GET', '/departments', users.member.token);
  for (const d of ds.data) dept[d.slug] = d.id;
});
test.after(() => srv && srv.stop());

test('department private tools follow canViewDept', async () => {
  // HR member reads HR private space; is blocked everywhere else
  const own = await req(srv.base, 'GET', '/hr/notes', users.member.token);
  assert.equal(own.status, 200);
  const foreign = await req(srv.base, 'GET', '/tasks?department_id=' + dept.media, users.member.token);
  assert.equal(foreign.status, 403);

  // HR manager writes HR tools
  const manage = await req(srv.base, 'POST', '/hr/notes', users.hr.token, { title: 'Weekly sync' });
  assert.equal(manage.status, 201);
  // Events manager cannot write HR tools
  const crossWrite = await req(srv.base, 'POST', '/hr/notes', users.events.token, { title: 'Nope' });
  assert.equal(crossWrite.status, 403);

  // leaders + supervisor may read HR tools (bosses); members of other depts may not
  assert.equal((await req(srv.base, 'GET', '/hr/notes', users.leader.token)).status, 200);
  assert.equal((await req(srv.base, 'GET', '/hr/notes', users.supervisor.token)).status, 200);
  // guest blocked
  assert.equal((await req(srv.base, 'GET', '/hr/notes', users.guest.token)).status, 403);
});

test('finance private ledger is scoped to the Finance department', async () => {
  assert.equal((await req(srv.base, 'GET', '/finance/sponsors', users.finance.token)).status, 200);
  assert.equal((await req(srv.base, 'GET', '/finance/sponsors', users.member.token)).status, 403);
  assert.equal((await req(srv.base, 'GET', '/finance/sponsors', users.guest.token)).status, 403);
  assert.equal((await req(srv.base, 'GET', '/finance/sponsors', users.leader.token)).status, 200);

  const create = await req(srv.base, 'POST', '/finance/sponsors', users.finance.token, { name: 'Acme', kind: 'money', value: 500 });
  assert.equal(create.status, 201);
  const goods = await req(srv.base, 'POST', '/finance/sponsors', users.finance.token, { name: 'Delta', kind: 'goods', details: '20 laptops' });
  assert.equal(goods.status, 201);
  const goodsNoDetails = await req(srv.base, 'POST', '/finance/sponsors', users.finance.token, { name: 'Delta', kind: 'goods' });
  assert.equal(goodsNoDetails.status, 400);
});

test('tasks: members read their dept, only managers/leaders write', async () => {
  const asMemberCreate = await req(srv.base, 'POST', '/tasks', users.member.token, { department_id: dept.hr, title: 'Sneaky' });
  assert.equal(asMemberCreate.status, 403);

  const asManager = await req(srv.base, 'POST', '/tasks', users.hr.token, { department_id: dept.hr, title: 'Real task', assigned_to: users.member.user.id });
  assert.equal(asManager.status, 201);

  const asLeader = await req(srv.base, 'POST', '/tasks', users.leader.token, { department_id: dept.media, title: 'Leader task' });
  assert.equal(asLeader.status, 201);

  // assignee must be in the same department
  const badAssignee = await req(srv.base, 'POST', '/tasks', users.hr.token, { department_id: dept.hr, title: 'Bad', assigned_to: users.media.user.id });
  assert.equal(badAssignee.status, 400);

  // a member may only move the status of their OWN task
  const otherMember = await req(srv.base, 'POST', '/tasks', users.hr.token, { department_id: dept.hr, title: 'Unassigned' });
  const patchForeign = await req(srv.base, 'PATCH', `/tasks/${otherMember.data.id}`, users.member.token, { status: 'done' });
  assert.equal(patchForeign.status, 403);
  const patchOwn = await req(srv.base, 'PATCH', `/tasks/${asManager.data.id}`, users.member.token, { status: 'doing' });
  assert.equal(patchOwn.status, 200);
  assert.equal(patchOwn.data.status, 'doing');
});

test('supervisor is read-only on management but can read everything', async () => {
  const p = users.supervisor.token;
  assert.equal((await req(srv.base, 'POST', '/tasks', p, { department_id: dept.hr, title: 'X' })).status, 403);
  assert.equal((await req(srv.base, 'POST', '/media/albums', p, { title: 'X' })).status, 403);
  assert.equal((await req(srv.base, 'PATCH', '/users/1/role', p, { role: 'guest' })).status, 403);
  assert.equal((await req(srv.base, 'POST', '/posts', p, { department_id: dept.hr, title: 'X' })).status, 403);
  // but reading is fine
  assert.equal((await req(srv.base, 'GET', '/users', p)).status, 200);
});

test('reports are supervisor-only', async () => {
  assert.equal((await req(srv.base, 'GET', '/reports/data', users.supervisor.token)).status, 200);
  assert.equal((await req(srv.base, 'GET', '/reports/charts', users.supervisor.token)).status, 200);
  assert.equal((await req(srv.base, 'GET', '/reports/data', users.leader.token)).status, 403);
  assert.equal((await req(srv.base, 'GET', '/reports/data', users.member.token)).status, 403);
});

test('storage panel is leaders + supervisor; members/guests blocked', async () => {
  assert.equal((await req(srv.base, 'GET', '/storage', users.member.token)).status, 403);
  assert.equal((await req(srv.base, 'GET', '/storage', users.guest.token)).status, 403);
  // leader/supervisor reach it (200 when Drive is configured, 500 otherwise — never 403)
  assert.notEqual((await req(srv.base, 'GET', '/storage', users.leader.token)).status, 403);
  assert.notEqual((await req(srv.base, 'GET', '/storage', users.supervisor.token)).status, 403);
});

test('managers only review applications for their own department', async () => {
  // guest applies to media
  const apply = await req(srv.base, 'POST', '/applications', users.guest.token, { department_id: dept.media, message: 'I want to help' });
  assert.equal(apply.status, 201);
  const id = apply.data.id;

  // HR manager cannot review a Media application
  const wrongMgr = await req(srv.base, 'POST', `/applications/${id}/refuse`, users.hr.token, {});
  assert.equal(wrongMgr.status, 403);
  // Media manager can
  const rightMgr = await req(srv.base, 'POST', `/applications/${id}/accept`, users.media.token, {});
  assert.equal(rightMgr.status, 200);
});

test('goals are club-scoped: no cross-club read or write', async () => {
  // the leader creates a goal in HR
  const made = await req(srv.base, 'POST', '/goals', users.leader.token, { department_id: dept.hr, title: 'Our goal' });
  assert.equal(made.status, 201, JSON.stringify(made.data));

  // listing with no department only ever returns the caller's club
  const all = await req(srv.base, 'GET', '/goals', users.member.token);
  assert.equal(all.status, 200);
  assert.ok(all.data.some((g) => g.id === made.data.id));
  // an unknown / foreign department answers 404
  assert.equal((await req(srv.base, 'GET', '/goals?department_id=99999', users.member.token)).status, 404);

  // a SECOND, unrelated club
  const other = await req(srv.base, 'POST', '/auth/create-club', null, {
    club_name: 'Rival Club', full_name: 'Rival Boss', email: 'rival@x.tn', password: 'password123',
  });
  assert.equal(other.status, 201, JSON.stringify(other.data));
  const mk = await req(srv.base, 'POST', '/users', other.data.token, {
    full_name: 'Rival Leader', email: 'rival.leader@x.tn', password: 'password123', role: 'leader',
  });
  assert.equal(mk.status, 201, JSON.stringify(mk.data));
  const rival = await login(srv.base, 'rival.leader@x.tn');

  // no goal from the first club leaks into the second
  const rivalAll = await req(srv.base, 'GET', '/goals', rival.token);
  assert.equal(rivalAll.status, 200);
  assert.deepEqual(rivalAll.data, []);
  // and it cannot read or write into the first club's department
  assert.equal((await req(srv.base, 'GET', `/goals?department_id=${dept.hr}`, rival.token)).status, 404);
  assert.equal((await req(srv.base, 'POST', '/goals', rival.token, { department_id: dept.hr, title: 'Sneak' })).status, 404);
});
