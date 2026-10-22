// ============================================================
//  test/departments_admin.test.js — departments created by the Leader
//  A club no longer stops at the five starter departments: the Leader /
//  Co-Leader can create a department AND its first manager + members in
//  one call. Supervisor stays read-only; managers/members/guests cannot.
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req, login, upload, PNG_1PX } = require('./helpers');

let srv;
let sup; // first club supervisor
let lead; // first club leader
let deptCount; // starter count (5)

test.before(async () => { srv = await startServer({ port: 4319, demo: '0' }); });
test.after(() => srv && srv.stop());

test('setup: create the club, its Leader and read the starter departments', async () => {
  const club = await req(srv.base, 'POST', '/auth/create-club', null, {
    club_name: 'Dept Test Club', full_name: 'Founder Supervisor', email: 'sup@dept.test', password: 'secret1',
  });
  assert.equal(club.status, 201, JSON.stringify(club.data));
  sup = { token: club.data.token, user: club.data.user };

  const leader = await req(srv.base, 'POST', '/users', sup.token,
    { full_name: 'Club Leader', email: 'lead@dept.test', password: 'secret1', role: 'leader' });
  assert.equal(leader.status, 201, JSON.stringify(leader.data));
  lead = await login(srv.base, 'lead@dept.test', 'secret1');

  const depts = await req(srv.base, 'GET', '/departments', lead.token);
  assert.equal(depts.status, 200);
  assert.equal(depts.data.length, 5);
  deptCount = depts.data.length;
});

test('the Supervisor cannot create departments (read-only on management)', async () => {
  const r = await req(srv.base, 'POST', '/departments', sup.token, { name: 'Supervisor Dept' });
  assert.equal(r.status, 403);
});

test('the Leader creates a department — it shows up with its own page', async () => {
  const r = await req(srv.base, 'POST', '/departments', lead.token,
    { name: 'Competition Team', description: 'Robot competitions and outreach' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.department.name, 'Competition Team');
  assert.equal(r.data.department.slug, 'competition-team');
  assert.equal(r.data.department.description, 'Robot competitions and outreach');
  assert.equal(r.data.department.coming_soon, 0);
  assert.equal(r.data.manager, null);
  assert.deepEqual(r.data.members, []);

  const list = await req(srv.base, 'GET', '/departments', lead.token);
  assert.equal(list.status, 200);
  assert.equal(list.data.length, deptCount + 1);
  assert.ok(list.data.some((d) => d.slug === 'competition-team'));

  const page = await req(srv.base, 'GET', '/departments/competition-team', lead.token);
  assert.equal(page.status, 200);
  assert.equal(page.data.name, 'Competition Team');
  assert.deepEqual(page.data.members, []);
});

test('two departments may share a name: the slug is unique inside the club', async () => {
  const r = await req(srv.base, 'POST', '/departments', lead.token, { name: 'Competition Team' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.department.slug, 'competition-team-2');
  assert.notEqual(r.data.department.id, undefined);
});

test('"a full department": the Leader creates the manager and members in one call', async () => {
  const r = await req(srv.base, 'POST', '/departments', lead.token, {
    name: 'Robotics Lab',
    description: 'Builds and tests the robots',
    manager: { full_name: 'Lab Manager', email: 'lab.manager@dept.test', password: 'secret1' },
    members: [
      { full_name: 'Lab Member One', email: 'lab.one@dept.test', password: 'secret1' },
      { full_name: 'Lab Member Two', email: 'lab.two@dept.test', password: 'secret1' },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const dept = r.data.department;
  assert.equal(dept.slug, 'robotics-lab');
  assert.equal(r.data.manager.full_name, 'Lab Manager');
  assert.equal(r.data.manager.role, 'manager');
  assert.equal(r.data.manager.department_id, dept.id);
  assert.equal(r.data.members.length, 2);
  assert.ok(r.data.members.every((m) => m.role === 'member' && m.department_id === dept.id));

  // each account can log in, in the right club and department
  const mgr = await login(srv.base, 'lab.manager@dept.test', 'secret1');
  assert.equal(mgr.user.role, 'manager');
  assert.equal(mgr.user.department_id, dept.id);
  assert.equal(mgr.user.club.id, sup.user.club.id);
  const one = await login(srv.base, 'lab.one@dept.test', 'secret1');
  assert.equal(one.user.role, 'member');
  assert.equal(one.user.department_id, dept.id);

  // the team is on the department page
  const page = await req(srv.base, 'GET', '/departments/robotics-lab', lead.token);
  assert.equal(page.status, 200);
  assert.equal(page.data.members.length, 3);
  assert.ok(page.data.members.some((m) => m.role === 'manager' && m.full_name === 'Lab Manager'));

  // the same accounts are in the directory with their department
  const dir = await req(srv.base, 'GET', '/users', lead.token);
  const row = dir.data.find((u) => u.email === 'lab.one@dept.test');
  assert.ok(row);
  assert.equal(row.department_slug, 'robotics-lab');
});

test('the Leader still creates managers / members / guests for any department', async () => {
  const depts = await req(srv.base, 'GET', '/departments', lead.token);
  const lab = depts.data.find((d) => d.slug === 'robotics-lab');

  const mgr = await req(srv.base, 'POST', '/users', lead.token, {
    full_name: 'Second Manager', email: 'lab.manager2@dept.test', password: 'secret1',
    role: 'manager', department_id: lab.id,
  });
  assert.equal(mgr.status, 201, JSON.stringify(mgr.data));
  assert.equal(mgr.data.role, 'manager');
  assert.equal(mgr.data.department_id, lab.id);

  const member = await req(srv.base, 'POST', '/users', lead.token, {
    full_name: 'Third Member', email: 'lab.three@dept.test', password: 'secret1',
    role: 'member', department_id: lab.id,
  });
  assert.equal(member.status, 201, JSON.stringify(member.data));
  assert.equal(member.data.department_id, lab.id);

  const guest = await req(srv.base, 'POST', '/users', lead.token, {
    full_name: 'Club Guest', email: 'guest@dept.test', password: 'secret1', role: 'guest',
  });
  assert.equal(guest.status, 201);
  assert.equal(guest.data.department_id, null);

  // managers and members still need a real department
  const noDept = await req(srv.base, 'POST', '/users', lead.token, {
    full_name: 'No Dept', email: 'nodept@dept.test', password: 'secret1', role: 'member',
  });
  assert.equal(noDept.status, 400);
});

test('a bad team form never leaves a half-created department', async () => {
  const before = (await req(srv.base, 'GET', '/departments', lead.token)).data.length;

  const dup = await req(srv.base, 'POST', '/departments', lead.token, {
    name: 'Broken Dept',
    manager: { full_name: 'Dup Manager', email: 'same@dept.test', password: 'secret1' },
    members: [{ full_name: 'Dup Member', email: 'same@dept.test', password: 'secret1' }],
  });
  assert.equal(dup.status, 400);
  assert.match(dup.data.error, /twice/);

  const shortPwd = await req(srv.base, 'POST', '/departments', lead.token, {
    name: 'Broken Dept',
    manager: { full_name: 'Short', email: 'short@dept.test', password: '123' },
  });
  assert.equal(shortPwd.status, 400);

  const existing = await req(srv.base, 'POST', '/departments', lead.token, {
    name: 'Broken Dept',
    manager: { full_name: 'Existing', email: 'lab.one@dept.test', password: 'secret1' },
  });
  assert.equal(existing.status, 409);

  const after = (await req(srv.base, 'GET', '/departments', lead.token)).data.length;
  assert.equal(after, before, 'no department may be created when validation fails');
  const missing = (await req(srv.base, 'GET', '/departments', lead.token)).data
    .filter((d) => d.slug.startsWith('broken-dept'));
  assert.equal(missing.length, 0);
});

test('managers, members and guests cannot create departments', async () => {
  const mgr = await login(srv.base, 'lab.manager@dept.test', 'secret1');
  const member = await login(srv.base, 'lab.one@dept.test', 'secret1');
  const guest = await login(srv.base, 'guest@dept.test', 'secret1');

  for (const token of [mgr.token, member.token, guest.token]) {
    const r = await req(srv.base, 'POST', '/departments', token, { name: 'Not Allowed' });
    assert.equal(r.status, 403);
  }
});

test('departments are isolated per club (same slug, different rows)', async () => {
  const other = await req(srv.base, 'POST', '/auth/create-club', null, {
    club_name: 'Other Dept Club', full_name: 'Other Founder', email: 'other@dept.test', password: 'secret1',
  });
  assert.equal(other.status, 201);
  const otherLead = await req(srv.base, 'POST', '/users', other.data.token,
    { full_name: 'Other Leader', email: 'other.lead@dept.test', password: 'secret1', role: 'leader' });
  assert.equal(otherLead.status, 201);

  const mine = await req(srv.base, 'POST', '/departments', lead.token, { name: 'Shared Name' });
  assert.equal(mine.status, 201);
  const ol = await login(srv.base, 'other.lead@dept.test', 'secret1');
  const theirs = await req(srv.base, 'POST', '/departments', ol.token, { name: 'Shared Name' });
  assert.equal(theirs.status, 201);
  assert.equal(theirs.data.department.slug, 'shared-name', 'the other club may reuse the slug');
  assert.notEqual(theirs.data.department.id, mine.data.department.id);
});

test('the Leader can rename and re-describe a department (slug stays stable)', async () => {
  const before = await req(srv.base, 'GET', '/departments/competition-team', lead.token);
  assert.equal(before.status, 200);

  const r = await req(srv.base, 'PATCH', '/departments/competition-team', lead.token,
    { name: 'Competition Squad', description: 'Robots, outreach and tournaments' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.slug, 'competition-team', 'the URL must not change');
  assert.equal(r.data.name, 'Competition Squad');
  assert.equal(r.data.description, 'Robots, outreach and tournaments');

  const after = await req(srv.base, 'GET', '/departments/competition-team', lead.token);
  assert.equal(after.data.name, 'Competition Squad');
  assert.equal(after.data.description, 'Robots, outreach and tournaments');

  // validation + role gate
  const empty = await req(srv.base, 'PATCH', '/departments/competition-team', lead.token, { name: ' ' });
  assert.equal(empty.status, 400);
  const bySup = await req(srv.base, 'PATCH', '/departments/robotics-lab', sup.token, { name: 'No' });
  assert.equal(bySup.status, 403);
});

test('edit/delete are refused for the Supervisor, managers, members and guests', async () => {
  const mgr = await login(srv.base, 'lab.manager@dept.test', 'secret1');
  const member = await login(srv.base, 'lab.one@dept.test', 'secret1');
  const guest = await login(srv.base, 'guest@dept.test', 'secret1');

  for (const token of [sup.token, mgr.token, member.token, guest.token]) {
    const patch = await req(srv.base, 'PATCH', '/departments/robotics-lab', token, { name: 'Hacked' });
    assert.equal(patch.status, 403);
    const del = await req(srv.base, 'DELETE', '/departments/robotics-lab?confirm=1', token);
    assert.equal(del.status, 403);
    const usage = await req(srv.base, 'GET', '/departments/robotics-lab/usage', token);
    assert.equal(usage.status, 403);
  }
});

test('deleting content needs a confirm and removes the department + its content', async () => {
  const created = await req(srv.base, 'POST', '/departments', lead.token,
    { name: 'Content Dept', description: 'Temporary' });
  assert.equal(created.status, 201);
  const dept = created.data.department;

  // content written by the Leader: a post, a goal, a task and an album
  const post = await req(srv.base, 'POST', '/posts', lead.token,
    { department_id: dept.id, type: 'text', title: 'Soon deleted', body: 'x' });
  assert.equal(post.status, 201, JSON.stringify(post.data));
  const goal = await req(srv.base, 'POST', '/goals', lead.token,
    { department_id: dept.id, title: 'Temporary goal' });
  assert.equal(goal.status, 201, JSON.stringify(goal.data));
  const task = await req(srv.base, 'POST', '/tasks', lead.token,
    { department_id: dept.id, title: 'Temporary task' });
  assert.equal(task.status, 201, JSON.stringify(task.data));
  const album = await req(srv.base, 'POST', '/media/albums', lead.token,
    { department_id: dept.id, title: 'Temporary album' });
  assert.equal(album.status, 201, JSON.stringify(album.data));

  const usage = await req(srv.base, 'GET', `/departments/${dept.slug}/usage`, lead.token);
  assert.equal(usage.status, 200);
  assert.equal(usage.data.posts, 1);
  assert.equal(usage.data.goals, 1);
  assert.equal(usage.data.tasks, 1);
  assert.equal(usage.data.albums, 1);
  assert.equal(usage.data.members, 0);

  // no confirm -> 409, still there
  const refused = await req(srv.base, 'DELETE', `/departments/${dept.slug}`, lead.token);
  assert.equal(refused.status, 409);
  assert.equal(refused.data.usage.posts, 1);
  assert.equal((await req(srv.base, 'GET', `/departments/${dept.slug}`, lead.token)).status, 200);

  // confirmed -> gone, and so is its content
  const gone = await req(srv.base, 'DELETE', `/departments/${dept.slug}?confirm=1`, lead.token);
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  assert.equal((await req(srv.base, 'GET', `/departments/${dept.slug}`, lead.token)).status, 404);

  const list = await req(srv.base, 'GET', '/departments', lead.token);
  assert.ok(!list.data.some((d) => d.id === dept.id));

  // the post is gone from the club feed too
  const feed = await req(srv.base, 'GET', '/posts/feed?limit=50', lead.token);
  assert.equal(feed.status, 200);
  assert.ok(!feed.data.some((p) => p.department_id === dept.id));
});

test('a department with people is never deleted until they are moved', async () => {
  const created = await req(srv.base, 'POST', '/departments', lead.token, {
    name: 'Staffed Dept',
    manager: { full_name: 'Staffed Manager', email: 'staffed@dept.test', password: 'secret1' },
  });
  assert.equal(created.status, 201);
  const dept = created.data.department;
  const managerId = created.data.manager.id;

  const blocked = await req(srv.base, 'DELETE', `/departments/${dept.slug}?confirm=1`, lead.token);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.usage.members, 1);
  assert.equal((await req(srv.base, 'GET', `/departments/${dept.slug}`, lead.token)).status, 200);

  // move the manager to HR, then delete
  const hr = (await req(srv.base, 'GET', '/departments', lead.token)).data.find((d) => d.slug === 'hr');
  const moved = await req(srv.base, 'PATCH', `/users/${managerId}/role`, lead.token,
    { role: 'manager', department_id: hr.id });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));

  const gone = await req(srv.base, 'DELETE', `/departments/${dept.slug}?confirm=1`, lead.token);
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  assert.equal((await req(srv.base, 'GET', `/departments/${dept.slug}`, lead.token)).status, 404);
});

test('deleting a department also removes its shared album photos without an FK error', async () => {
  const created = await req(srv.base, 'POST', '/departments', lead.token, { name: 'Photo Dept' });
  assert.equal(created.status, 201);
  const dept = created.data.department;

  const album = await req(srv.base, 'POST', '/media/albums', lead.token,
    { department_id: dept.id, title: 'Photo album' });
  assert.equal(album.status, 201, JSON.stringify(album.data));

  const up = await upload(srv.base, `/media/albums/${album.data.id}/media`, lead.token, {
    file: { buffer: PNG_1PX, mimetype: 'image/png', name: 'shot.png' },
    fieldName: 'file',
  });
  assert.equal(up.status, 201, JSON.stringify(up.data));

  const shared = await req(srv.base, 'POST', `/media/media/${up.data.id}/share`, lead.token,
    { title: 'Shared from the album' });
  assert.equal(shared.status, 201, JSON.stringify(shared.data));

  const gone = await req(srv.base, 'DELETE', `/departments/${dept.slug}?confirm=1`, lead.token);
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  assert.equal(gone.data.usage.albums, 1);
  assert.equal(gone.data.usage.posts, 1);
});
