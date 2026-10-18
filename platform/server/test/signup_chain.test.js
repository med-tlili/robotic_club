// ============================================================
//  test/signup_chain.test.js — multi-club creation & onboarding chain
//  Boots a FRESH (production-style) install: no club, no demo accounts.
//  The first page lets anyone CREATE their own club (they become its
//  Supervisor); the club then fills up through the chain
//  Supervisor -> Leader -> everyone else.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req, login } = require('./helpers');

let srv;
let club; // first club: { token, user, dept }

test.before(async () => { srv = await startServer({ port: 4311, demo: '0' }); });
test.after(() => srv && srv.stop());

test('fresh install has no club: department list needs a session, demo login fails', async () => {
  const h = await req(srv.base, 'GET', '/health');
  assert.equal(h.data.demo, false);
  const depts = await req(srv.base, 'GET', '/departments'); // session required now
  assert.equal(depts.status, 401);
  const bad = await req(srv.base, 'POST', '/auth/login', null, { email: 'leader@isigk.tn', password: 'password123' });
  assert.equal(bad.status, 401);
});

test('anonymous cannot create accounts', async () => {
  const r = await req(srv.base, 'POST', '/users', null, { full_name: 'X', email: 'x@x.tn', password: 'secret1', role: 'leader' });
  assert.equal(r.status, 401);
});

test('create-club validates its input first', async () => {
  const weak = await req(srv.base, 'POST', '/auth/create-club', null,
    { club_name: 'C', full_name: 'A', email: 'a@a.tn', password: '123' });
  assert.equal(weak.status, 400);
  const badMail = await req(srv.base, 'POST', '/auth/create-club', null,
    { club_name: 'Robotics Club', full_name: 'Valid Name', email: 'not-an-email', password: 'secret1' });
  assert.equal(badMail.status, 400);
  const noClub = await req(srv.base, 'POST', '/auth/create-club', null,
    { full_name: 'Valid Name', email: 'v@v.tn', password: 'secret1' });
  assert.equal(noClub.status, 400);
});

test('creating the club makes you its Supervisor and seeds its departments', async () => {
  const r = await req(srv.base, 'POST', '/auth/create-club', null, {
    club_name: 'Robotics Club', full_name: 'First Supervisor', email: 'prof@isigk.tn', password: 'SuperSecret1!',
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.user.role, 'supervisor');
  assert.ok(r.data.token);
  assert.equal(r.data.user.club.name, 'Robotics Club');

  club = { token: r.data.token, user: r.data.user };

  const depts = await req(srv.base, 'GET', '/departments', club.token);
  assert.equal(depts.status, 200);
  assert.equal(depts.data.length, 5);
  club.dept = Object.fromEntries(depts.data.map((d) => [d.slug, d.id]));

  // the same email cannot register twice
  const dup = await req(srv.base, 'POST', '/auth/create-club', null, {
    club_name: 'Other Club', full_name: 'Impostor', email: 'prof@isigk.tn', password: 'SuperSecret1!',
  });
  assert.equal(dup.status, 409);
});

test('a second person creates their OWN club — no cross-club data', async () => {
  const r = await req(srv.base, 'POST', '/auth/create-club', null, {
    club_name: 'Another Club', full_name: 'Second Founder', email: 'other@example.tn', password: 'SuperSecret1!',
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.user.role, 'supervisor');
  assert.notEqual(r.data.user.club.id, club.user.club.id);

  // the second club has its OWN department rows (never the first club's)
  const otherDepts = await req(srv.base, 'GET', '/departments', r.data.token);
  assert.equal(otherDepts.status, 200);
  assert.equal(otherDepts.data.length, 5);
  const overlap = otherDepts.data.filter((d) => club.dept[d.slug] === d.id);
  assert.equal(overlap.length, 0, 'clubs must not share department rows');

  // and the first club's directory does not contain the second founder
  const dir = await req(srv.base, 'GET', '/users', club.token);
  assert.equal(dir.status, 200);
  assert.ok(!dir.data.some((u) => u.email === 'other@example.tn'));
});

test('the chain: supervisor -> leader -> everyone else', async () => {
  const prof = await login(srv.base, 'prof@isigk.tn', 'SuperSecret1!');

  // supervisor can create a Leader — but not members
  const memberByProf = await req(srv.base, 'POST', '/users', prof.token,
    { full_name: 'M', email: 'm@isigk.tn', password: 'secret1', role: 'member', department_id: club.dept.hr });
  assert.equal(memberByProf.status, 403);

  // ...and may add another SUPERVISOR: a club can have several
  const coSup = await req(srv.base, 'POST', '/users', prof.token,
    { full_name: 'Second Supervisor', email: 'sup2@isigk.tn', password: 'secret1', role: 'supervisor' });
  assert.equal(coSup.status, 201, JSON.stringify(coSup.data));
  assert.equal(coSup.data.role, 'supervisor');
  const coSupLogin = await login(srv.base, 'sup2@isigk.tn', 'secret1');
  assert.equal(coSupLogin.user.role, 'supervisor');
  assert.equal(coSupLogin.user.club.id, club.user.club.id, 'both supervisors share the same club');

  const leader = await req(srv.base, 'POST', '/users', prof.token,
    { full_name: 'Club Leader', email: 'lead@isigk.tn', password: 'secret1', role: 'leader' });
  assert.equal(leader.status, 201, JSON.stringify(leader.data));

  const lead = await login(srv.base, 'lead@isigk.tn', 'secret1');

  // leader cannot mint another leader
  const leader2 = await req(srv.base, 'POST', '/users', lead.token,
    { full_name: 'L2', email: 'l2@isigk.tn', password: 'secret1', role: 'leader' });
  assert.equal(leader2.status, 403);

  // leader cannot create a supervisor either
  const prof2 = await req(srv.base, 'POST', '/users', lead.token,
    { full_name: 'P2', email: 'p2@isigk.tn', password: 'secret1', role: 'supervisor' });
  assert.equal(prof2.status, 403);

  // member/manager need a real department (materials excluded)
  const noDept = await req(srv.base, 'POST', '/users', lead.token,
    { full_name: 'M', email: 'm1@isigk.tn', password: 'secret1', role: 'member' });
  assert.equal(noDept.status, 400);
  const badDept = await req(srv.base, 'POST', '/users', lead.token,
    { full_name: 'M', email: 'm2@isigk.tn', password: 'secret1', role: 'member', department_id: club.dept.materials });
  assert.equal(badDept.status, 400);

  // a leader cannot place a member in ANOTHER club's department (tenant isolation)
  const foreignDept = await req(srv.base, 'POST', '/users', lead.token,
    { full_name: 'M', email: 'm3@isigk.tn', password: 'secret1', role: 'member', department_id: 99999 });
  assert.equal(foreignDept.status, 400);

  // valid member + guest
  const member = await req(srv.base, 'POST', '/users', lead.token,
    { full_name: 'HR Member', email: 'hr.member@isigk.tn', password: 'secret1', role: 'member', department_id: club.dept.hr });
  assert.equal(member.status, 201, JSON.stringify(member.data));
  const guest = await req(srv.base, 'POST', '/users', lead.token,
    { full_name: 'Visitor', email: 'visitor@isigk.tn', password: 'secret1', role: 'guest' });
  assert.equal(guest.status, 201);

  // duplicate email -> 409
  const dup = await req(srv.base, 'POST', '/users', lead.token,
    { full_name: 'HR Member', email: 'hr.member@isigk.tn', password: 'secret1', role: 'member', department_id: club.dept.hr });
  assert.equal(dup.status, 409);

  // the created member can log in and lands in the right club
  const m = await login(srv.base, 'hr.member@isigk.tn', 'secret1');
  assert.equal(m.user.role, 'member');
  assert.equal(m.user.club.id, club.user.club.id);

  // a plain member cannot create accounts nor change any role
  const asMember = await req(srv.base, 'POST', '/users', m.token,
    { full_name: 'Y', email: 'y@isigk.tn', password: 'secret1', role: 'guest' });
  assert.equal(asMember.status, 403);
  const promoteSelf = await req(srv.base, 'PATCH', `/users/${m.user.id}/role`, m.token, { role: 'leader' });
  assert.equal(promoteSelf.status, 403);
  const promoteOther = await req(srv.base, 'PATCH', `/users/${guest.data.id}/role`, m.token,
    { role: 'manager', department_id: club.dept.hr });
  assert.equal(promoteOther.status, 403);
});

test('a leader cannot manage another club\'s member (tenant isolation)', async () => {
  const other = await login(srv.base, 'other@example.tn', 'SuperSecret1!');
  const lead = await login(srv.base, 'lead@isigk.tn', 'secret1');
  // the first club's leader tries to demote the second club's supervisor
  const r = await req(srv.base, 'PATCH', `/users/${other.user.id}/role`, lead.token, { role: 'guest' });
  assert.equal(r.status, 404, 'a foreign-club user must look non-existent');
});
