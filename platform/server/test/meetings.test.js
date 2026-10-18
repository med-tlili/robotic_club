// ============================================================
//  test/meetings.test.js — phase 5 live meetings
//  leadership-only creation · host-approved joining · scopes ·
//  per-meeting chat · end · cross-club isolation
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req, loginAll, login } = require('./helpers');

let srv;
let users;
let hrDept;

test.before(async () => {
  srv = await startServer({ port: 4317, demo: '1' });
  users = await loginAll(srv.base);
  const ds = await req(srv.base, 'GET', '/departments', users.member.token);
  hrDept = ds.data.find((d) => d.slug === 'hr').id;
});
test.after(() => srv && srv.stop());

test('meetings: guests and plain members cannot start one', async () => {
  assert.equal((await req(srv.base, 'GET', '/meetings', users.guest.token)).status, 403);
  assert.equal((await req(srv.base, 'POST', '/meetings', users.guest.token, { title: 'Nope' })).status, 403);
  assert.equal((await req(srv.base, 'POST', '/meetings', users.member.token, { title: 'Nope' })).status, 403);
  // a department manager may start one
  const mgr = await req(srv.base, 'POST', '/meetings', users.hr.token, { title: 'HR sync', scope: 'department', department_id: hrDept });
  assert.equal(mgr.status, 201, JSON.stringify(mgr.data));
  assert.equal(mgr.data.is_host, true);
  // …and only with a real department
  assert.equal((await req(srv.base, 'POST', '/meetings', users.hr.token, { title: 'x', scope: 'department', department_id: 99999 })).status, 400);
  assert.equal((await req(srv.base, 'POST', '/meetings', users.hr.token, { title: '', scope: 'global' })).status, 400);
});

test('a global meeting: member asks to join, the host accepts, then they can chat', async () => {
  const start = await req(srv.base, 'POST', '/meetings', users.leader.token, {
    title: 'All-hands', description: 'Kick-off', scope: 'global',
  });
  assert.equal(start.status, 201, JSON.stringify(start.data));
  const id = start.data.id;
  assert.equal(start.data.accepted, 1, 'only the host is in so far');

  // a non-host sees it but is not in yet
  const seen = await req(srv.base, 'GET', `/meetings/${id}`, users.member.token);
  assert.equal(seen.status, 200);
  assert.equal(seen.data.my_status, null);
  assert.equal(seen.data.can_join, true);

  // asking to join does NOT let them in: pending until the host decides
  const ask = await req(srv.base, 'POST', `/meetings/${id}/join`, users.member.token);
  assert.equal(ask.status, 200);
  assert.equal(ask.data.my_status, 'pending');
  // a REQUESTER cannot let themselves in by "answering" their own request
  assert.equal((await req(srv.base, 'POST', `/meetings/${id}/respond`, users.member.token, { action: 'accept' })).status, 403);
  // a pending member cannot read the chat yet
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}/messages`, users.member.token)).status, 403);

  // the host sees the pending request (others don't)
  const hostView = await req(srv.base, 'GET', `/meetings/${id}`, users.leader.token);
  assert.equal(hostView.data.pending, 1);
  assert.equal(hostView.data.requests.length, 1);
  assert.equal(hostView.data.requests[0].id, users.member.user.id);
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}`, users.coleader.token)).data.pending, 0);

  // only the host may accept
  assert.equal((await req(srv.base, 'POST', `/meetings/${id}/requests/${users.member.user.id}`, users.coleader.token, { action: 'accept' })).status, 403);

  const accept = await req(srv.base, 'POST', `/meetings/${id}/requests/${users.member.user.id}`, users.leader.token, { action: 'accept' });
  assert.equal(accept.status, 200);
  assert.equal(accept.data.accepted, 2);

  // now the member is in and can chat
  const me = await req(srv.base, 'GET', `/meetings/${id}`, users.member.token);
  assert.equal(me.data.my_status, 'accepted');
  const post = await req(srv.base, 'POST', `/meetings/${id}/messages`, users.member.token, { body: 'Ready!' });
  assert.equal(post.status, 201, JSON.stringify(post.data));
  const chat = await req(srv.base, 'GET', `/meetings/${id}/messages`, users.leader.token);
  assert.equal(chat.status, 200);
  assert.equal(chat.data.length, 1);
  assert.equal(chat.data[0].body, 'Ready!');
  // a non-participant must not learn what was said inside (no preview, no unread)
  const outsider = await req(srv.base, 'GET', `/meetings/${id}`, users.finance.token);
  assert.equal(outsider.status, 200, 'a global meeting is visible to any member');
  assert.equal(outsider.data.last_body, null);
  assert.equal(outsider.data.unread, 0);
  assert.equal((await req(srv.base, 'POST', `/meetings/${id}/messages`, users.member.token, { body: '   ' })).status, 400);

  // an outsider who was never accepted cannot read the chat
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}/messages`, users.finance.token)).status, 403);

  // ending the meeting stops the chat
  const end = await req(srv.base, 'POST', `/meetings/${id}/end`, users.leader.token);
  assert.equal(end.status, 200);
  assert.equal(end.data.status, 'ended');
  assert.equal((await req(srv.base, 'POST', `/meetings/${id}/messages`, users.member.token, { body: 'after' })).status, 400);
  // participants may still READ the transcript after it ends
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}/messages`, users.member.token)).status, 200);
});

test('a department meeting is visible to that department and the bosses only', async () => {
  const start = await req(srv.base, 'POST', '/meetings', users.leader.token, {
    title: 'Events prep', scope: 'department', department_id: hrDept,
  });
  assert.equal(start.status, 201);
  const id = start.data.id;

  // HR member is in the department → sees it
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}`, users.member.token)).status, 200);
  // Media manager is in another department and not a boss → 404 (no existence leak)
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}`, users.media.token)).status, 404);
  // the co-leader (a boss) sees every department
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}`, users.coleader.token)).status, 200);
  // and it does not appear in the media manager's list
  const mediaList = await req(srv.base, 'GET', '/meetings', users.media.token);
  assert.ok(!mediaList.data.some((m) => m.id === id));
});

test('a private meeting is invisible until you are invited, and you must accept', async () => {
  const start = await req(srv.base, 'POST', '/meetings', users.supervisor.token, {
    title: 'Cabinet', scope: 'private', invite_ids: [users.coleader.user.id],
  });
  assert.equal(start.status, 201, JSON.stringify(start.data));
  const id = start.data.id;

  // not invited → 404
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}`, users.member.token)).status, 404);
  assert.equal((await req(srv.base, 'POST', `/meetings/${id}/join`, users.member.token)).status, 404);

  // invited → pending, must answer
  const invitee = await req(srv.base, 'GET', `/meetings/${id}`, users.coleader.token);
  assert.equal(invitee.status, 200);
  assert.equal(invitee.data.my_status, 'pending');
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}/messages`, users.coleader.token)).status, 403);

  const yes = await req(srv.base, 'POST', `/meetings/${id}/respond`, users.coleader.token, { action: 'accept' });
  assert.equal(yes.status, 200);
  assert.equal(yes.data.my_status, 'accepted');
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}/messages`, users.coleader.token)).status, 200);

  // a private meeting cannot be created without invitees
  assert.equal((await req(srv.base, 'POST', '/meetings', users.supervisor.token, { title: 'x', scope: 'private' })).status, 400);
});

test('the host can invite people; a participant can leave', async () => {
  const start = await req(srv.base, 'POST', '/meetings', users.leader.token, { title: 'Invite test', scope: 'global' });
  const id = start.data.id;
  const inv = await req(srv.base, 'POST', `/meetings/${id}/invite`, users.leader.token, { user_ids: [users.media.user.id] });
  assert.equal(inv.status, 200);
  assert.equal(inv.data.pending, 1);
  // non-host cannot invite
  assert.equal((await req(srv.base, 'POST', `/meetings/${id}/invite`, users.member.token, { user_ids: [users.finance.user.id] })).status, 403);

  // the invitee accepts, then leaves
  await req(srv.base, 'POST', `/meetings/${id}/respond`, users.media.token, { action: 'accept' });
  const left = await req(srv.base, 'POST', `/meetings/${id}/leave`, users.media.token);
  assert.equal(left.status, 200);
  assert.equal(left.data.my_status, 'left');
  // the host cannot leave (must end instead)
  assert.equal((await req(srv.base, 'POST', `/meetings/${id}/leave`, users.leader.token)).status, 400);
});

test('departments of another club cannot reach a meeting (tenant isolation)', async () => {
  const start = await req(srv.base, 'POST', '/meetings', users.leader.token, { title: 'Tenant probe', scope: 'global' });
  const id = start.data.id;

  const other = await req(srv.base, 'POST', '/auth/create-club', null, {
    club_name: 'Other Robotics', full_name: 'Other Boss', email: 'boss@otherclub.tn', password: 'password123',
  });
  assert.equal(other.status, 201, JSON.stringify(other.data));
  const otherToken = other.data.token;

  // the other club's supervisor sees an empty meeting list …
  const list = await req(srv.base, 'GET', '/meetings', otherToken);
  assert.equal(list.status, 200);
  assert.equal(list.data.length, 0);
  // … and gets 404 (not 403) for our meeting — no existence leak
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}`, otherToken)).status, 404);
  assert.equal((await req(srv.base, 'POST', `/meetings/${id}/join`, otherToken)).status, 404);
  assert.equal((await req(srv.base, 'GET', `/meetings/${id}/messages`, otherToken)).status, 404);

  // sanity: the other club's supervisor can still log back in
  const relog = await login(srv.base, 'boss@otherclub.tn');
  assert.equal(relog.user.role, 'supervisor');
});
