// ============================================================
//  test/calendar.test.js — shared calendar access + multi-day events
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req, loginAll } = require('./helpers');

let srv;
let users;

test.before(async () => {
  srv = await startServer({ port: 4312, demo: '1' });
  users = await loginAll(srv.base);
});
test.after(() => srv && srv.stop());

test('calendar is NOT readable without a session', async () => {
  const r = await req(srv.base, 'GET', '/events');
  assert.equal(r.status, 401);
});

test('every authenticated role (guests included) can READ the calendar', async () => {
  for (const [name, session] of Object.entries(users)) {
    const r = await req(srv.base, 'GET', '/events', session.token);
    assert.equal(r.status, 200, `${name} should read the calendar (got ${r.status})`);
    assert.ok(Array.isArray(r.data));
  }
});

test('only Leader / Co-Leader may WRITE the calendar', async () => {
  for (const name of ['member', 'guest', 'supervisor', 'hr', 'media']) {
    const r = await req(srv.base, 'POST', '/events', users[name].token, { title: 'X', event_date: '2027-01-10' });
    assert.equal(r.status, 403, `${name} must not create events (got ${r.status})`);
  }
});

test('leader creates a single-day AND a multi-day event', async () => {
  const single = await req(srv.base, 'POST', '/events', users.leader.token, {
    title: 'Team meeting', event_date: '2027-02-01', event_time: '14:30', location: 'Lab 203',
  });
  assert.equal(single.status, 201, JSON.stringify(single.data));
  assert.equal(single.data.event_time, '14:30');

  const multi = await req(srv.base, 'POST', '/events', users.leader.token, {
    title: 'Hackathon', event_date: '2027-03-05', end_date: '2027-03-07',
  });
  assert.equal(multi.status, 201);
  assert.equal(multi.data.end_date, '2027-03-07');

  // persisted
  const all = await req(srv.base, 'GET', '/events', users.member.token);
  const found = all.data.find((e) => e.id === multi.data.id);
  assert.equal(found.end_date, '2027-03-07');
});

test('calendar input validation rejects bad ranges and dates', async () => {
  const badRange = await req(srv.base, 'POST', '/events', users.leader.token, {
    title: 'Backwards', event_date: '2027-05-10', end_date: '2027-05-01',
  });
  assert.equal(badRange.status, 400);

  const badDate = await req(srv.base, 'POST', '/events', users.leader.token, { title: 'Nope', event_date: '10/05/2027' });
  assert.equal(badDate.status, 400);

  const badTime = await req(srv.base, 'POST', '/events', users.leader.token, { title: 'Nope', event_date: '2027-05-10', event_time: 'half past two' });
  assert.equal(badTime.status, 400);

  const noTitle = await req(srv.base, 'POST', '/events', users.leader.token, { event_date: '2027-05-10' });
  assert.equal(noTitle.status, 400);
});

test('a non-editor cannot modify or delete an event (IDOR)', async () => {
  const created = await req(srv.base, 'POST', '/events', users.leader.token, { title: 'Locked', event_date: '2027-06-01' });
  const id = created.data.id;

  const patch = await req(srv.base, 'PATCH', `/events/${id}`, users.member.token, { title: 'Hacked' });
  assert.equal(patch.status, 403);
  const del = await req(srv.base, 'DELETE', `/events/${id}`, users.member.token);
  assert.equal(del.status, 403);

  // leader can still delete; deleting a missing id -> 404
  const ok = await req(srv.base, 'DELETE', `/events/${id}`, users.leader.token);
  assert.equal(ok.status, 200);
  const missing = await req(srv.base, 'DELETE', `/events/${id}`, users.leader.token);
  assert.equal(missing.status, 404);
});
