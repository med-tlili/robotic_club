// ============================================================
//  test/workflows.test.js — end-to-end feature flows
//  posts/votes/comments · tasks · profile & password
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req, loginAll, login, upload, PNG_1PX } = require('./helpers');

let srv;
let users;
let hrDept;

test.before(async () => {
  srv = await startServer({ port: 4314, demo: '1' });
  users = await loginAll(srv.base);
  const ds = await req(srv.base, 'GET', '/departments', users.member.token);
  hrDept = ds.data.find((d) => d.slug === 'hr').id;
});
test.after(() => srv && srv.stop());

test('post feed: authoring is scoped to the author\'s department', async () => {
  const feed = await req(srv.base, 'GET', `/posts?department_id=${hrDept}`, users.member.token);
  assert.equal(feed.status, 200);

  const own = await req(srv.base, 'POST', '/posts', users.member.token, { department_id: hrDept, title: 'HR notice', body: 'Hello' });
  assert.equal(own.status, 201, JSON.stringify(own.data));
  assert.equal(own.data.author.role, 'member');

  const leaderAnywhere = await req(srv.base, 'POST', '/posts', users.leader.token, { department_id: hrDept, title: 'From the leader' });
  assert.equal(leaderAnywhere.status, 201);

  const supervisor = await req(srv.base, 'POST', '/posts', users.supervisor.token, { department_id: hrDept, title: 'No' });
  assert.equal(supervisor.status, 403);
  const guest = await req(srv.base, 'POST', '/posts', users.guest.token, { department_id: hrDept, title: 'No' });
  assert.equal(guest.status, 403);
});

test('reactions: Yes/No/Maybe, 1 per user, changeable; supervisor allowed, guest blocked', async () => {
  const post = await req(srv.base, 'POST', '/posts', users.member.token, { department_id: hrDept, title: 'Vote me' });
  const id = post.data.id;
  assert.equal(post.data.type, 'text', 'a post with no media is a text post');

  const v1 = await req(srv.base, 'POST', `/posts/${id}/vote`, users.member.token, { value: 'yes' });
  assert.equal(v1.status, 200);
  assert.equal(v1.data.my_vote, 'yes');
  assert.equal(v1.data.yes, 1);

  // same value again = un-react
  const v2 = await req(srv.base, 'POST', `/posts/${id}/vote`, users.member.token, { value: 'yes' });
  assert.equal(v2.data.my_vote, null);
  assert.equal(v2.data.yes, 0);

  // switch to Maybe (only one reaction per user)
  const v3 = await req(srv.base, 'POST', `/posts/${id}/vote`, users.member.token, { value: 'maybe' });
  assert.equal(v3.data.my_vote, 'maybe');
  assert.equal(v3.data.maybe, 1);
  assert.equal(v3.data.yes, 0);

  // supervisor may react
  const pv = await req(srv.base, 'POST', `/posts/${id}/vote`, users.supervisor.token, { value: 'no' });
  assert.equal(pv.status, 200);
  assert.equal(pv.data.my_vote, 'no');

  // guest cannot
  const gv = await req(srv.base, 'POST', `/posts/${id}/vote`, users.guest.token, { value: 'yes' });
  assert.equal(gv.status, 403);

  // invalid value
  const bad = await req(srv.base, 'POST', `/posts/${id}/vote`, users.member.token, { value: 'sometimes' });
  assert.equal(bad.status, 400);
});

test('polls: options stored, one changeable vote per member, guest blocked', async () => {
  const poll = await req(srv.base, 'POST', '/posts', users.member.token, {
    department_id: hrDept, type: 'poll', title: 'Which day works?', options: ['Monday', 'Wednesday', 'Friday'],
  });
  assert.equal(poll.status, 201, JSON.stringify(poll.data));
  assert.equal(poll.data.type, 'poll');
  assert.equal(poll.data.poll.options.length, 3);
  assert.equal(poll.data.poll.total, 0);
  const [a, b] = poll.data.poll.options;

  // too few options is refused
  const one = await req(srv.base, 'POST', '/posts', users.member.token, {
    department_id: hrDept, type: 'poll', title: 'Bad', options: ['Only one'],
  });
  assert.equal(one.status, 400);

  const vote1 = await req(srv.base, 'POST', `/posts/${poll.data.id}/poll-vote`, users.member.token, { option_id: a.id });
  assert.equal(vote1.status, 200);
  assert.equal(vote1.data.poll.my_choice, a.id);
  assert.equal(vote1.data.poll.total, 1);

  // change choice — still one vote
  const vote2 = await req(srv.base, 'POST', `/posts/${poll.data.id}/poll-vote`, users.member.token, { option_id: b.id });
  assert.equal(vote2.data.poll.my_choice, b.id);
  assert.equal(vote2.data.poll.total, 1, 'changing the choice does not add a vote');
  assert.equal(vote2.data.poll.options.find((o) => o.id === a.id).votes, 0);

  // same option again = un-vote
  const vote3 = await req(srv.base, 'POST', `/posts/${poll.data.id}/poll-vote`, users.member.token, { option_id: b.id });
  assert.equal(vote3.data.poll.my_choice, null);
  assert.equal(vote3.data.poll.total, 0);

  // another member adds their own vote
  const other = await req(srv.base, 'POST', `/posts/${poll.data.id}/poll-vote`, users.leader.token, { option_id: a.id });
  assert.equal(other.data.poll.total, 1);

  // guest blocked; unknown option refused; a non-poll post is refused
  assert.equal((await req(srv.base, 'POST', `/posts/${poll.data.id}/poll-vote`, users.guest.token, { option_id: a.id })).status, 403);
  assert.equal((await req(srv.base, 'POST', `/posts/${poll.data.id}/poll-vote`, users.member.token, { option_id: 999999 })).status, 400);
  const textPost = await req(srv.base, 'POST', '/posts', users.member.token, { department_id: hrDept, title: 'Not a poll' });
  assert.equal((await req(srv.base, 'POST', `/posts/${textPost.data.id}/poll-vote`, users.member.token, { option_id: a.id })).status, 400);
});

test('post types: media must match the chosen type', async () => {
  // image / video without a file are refused
  assert.equal((await req(srv.base, 'POST', '/posts', users.member.token, { department_id: hrDept, type: 'image', title: 'x' })).status, 400);
  assert.equal((await req(srv.base, 'POST', '/posts', users.member.token, { department_id: hrDept, type: 'video', title: 'x' })).status, 400);

  // a text post must not carry a file
  const withFile = await upload(srv.base, '/posts', users.member.token, {
    file: { buffer: PNG_1PX, mimetype: 'image/png', name: 'p.png' },
    fields: { department_id: String(hrDept), type: 'text', title: 'x' }, fieldName: 'media',
  });
  assert.equal(withFile.status, 400);

  // a real image post stores its file in the public tree
  const img = await upload(srv.base, '/posts', users.member.token, {
    file: { buffer: PNG_1PX, mimetype: 'image/png', name: 'p.png' },
    fields: { department_id: String(hrDept), type: 'image', title: 'A photo' }, fieldName: 'media',
  });
  assert.equal(img.status, 201, JSON.stringify(img.data));
  assert.equal(img.data.type, 'image');
  assert.match(img.data.image, /^\/uploads\/public\/.*\.png$/);
  assert.equal(img.data.video, '');

  // a video post stores its file too
  const vid = await upload(srv.base, '/posts', users.member.token, {
    file: { buffer: Buffer.from('00'), mimetype: 'video/mp4', name: 'clip.mp4' },
    fields: { department_id: String(hrDept), type: 'video', title: 'A clip' }, fieldName: 'media',
  });
  assert.equal(vid.status, 201, JSON.stringify(vid.data));
  assert.equal(vid.data.type, 'video');
  assert.match(vid.data.video, /^\/uploads\/public\/.*\.mp4$/);
  assert.equal(vid.data.image, '');
});

test('comments: members yes, supervisor/guest no; author or leader deletes', async () => {
  const post = await req(srv.base, 'POST', '/posts', users.member.token, { department_id: hrDept, title: 'Commentable' });
  const id = post.data.id;

  const bad = await req(srv.base, 'POST', `/posts/${id}/comments`, users.member.token, { body: '   ' });
  assert.equal(bad.status, 400);
  const ok = await req(srv.base, 'POST', `/posts/${id}/comments`, users.member.token, { body: 'Looks good' });
  assert.equal(ok.status, 201);
  assert.equal((await req(srv.base, 'POST', `/posts/${id}/comments`, users.supervisor.token, { body: 'Nope' })).status, 403);
  assert.equal((await req(srv.base, 'POST', `/posts/${id}/comments`, users.guest.token, { body: 'Nope' })).status, 403);

  // a different member cannot delete it; the author can
  assert.equal((await req(srv.base, 'DELETE', `/posts/${id}`, users.media.token)).status, 403);
  assert.equal((await req(srv.base, 'DELETE', `/posts/${id}`, users.member.token)).status, 200);
});

test('tasks: create, assign, status update, delete', async () => {
  const create = await req(srv.base, 'POST', '/tasks', users.hr.token, {
    department_id: hrDept, title: 'Prepare agenda', assigned_to: users.member.user.id, due_date: '2027-01-01',
  });
  assert.equal(create.status, 201);
  const taskId = create.data.id;
  assert.equal(create.data.status, 'todo');

  // assignee moves it to doing then done
  const doing = await req(srv.base, 'PATCH', `/tasks/${taskId}`, users.member.token, { status: 'doing' });
  assert.equal(doing.status, 200);
  const done = await req(srv.base, 'PATCH', `/tasks/${taskId}`, users.member.token, { status: 'done' });
  assert.equal(done.status, 200);
  assert.ok(done.data.completed_at, 'completed_at set when done');

  // reassigning to a member of another department is refused
  const bad = await req(srv.base, 'PATCH', `/tasks/${taskId}`, users.hr.token, { assigned_to: users.media.user.id });
  assert.equal(bad.status, 400);

  assert.equal((await req(srv.base, 'DELETE', `/tasks/${taskId}`, users.hr.token)).status, 200);
});

test('profile: edit name + bio on self only; change own password', async () => {
  const m = users.member.token;
  const upd = await req(srv.base, 'PATCH', '/users/me', m, { full_name: 'Omar Updated', bio: 'HR member, loves sensors' });
  assert.equal(upd.status, 200, JSON.stringify(upd.data));
  assert.equal(upd.data.full_name, 'Omar Updated');

  const me = await req(srv.base, 'GET', '/auth/me', m);
  assert.equal(me.data.full_name, 'Omar Updated');
  assert.equal(me.data.bio, 'HR member, loves sensors');

  const tooShort = await req(srv.base, 'PATCH', '/users/me', m, { full_name: 'X' });
  assert.equal(tooShort.status, 400);

  // password change
  const wrong = await req(srv.base, 'POST', '/users/me/password', m, { current_password: 'nope', new_password: 'newpass1' });
  assert.equal(wrong.status, 400);
  const short = await req(srv.base, 'POST', '/users/me/password', m, { current_password: 'password123', new_password: '123' });
  assert.equal(short.status, 400);
  const ok = await req(srv.base, 'POST', '/users/me/password', m, { current_password: 'password123', new_password: 'newpass1' });
  assert.equal(ok.status, 200);

  // old password no longer works; new one does
  assert.equal((await req(srv.base, 'POST', '/auth/login', null, { email: 'member@isigk.tn', password: 'password123' })).status, 401);
  const relog = await login(srv.base, 'member@isigk.tn', 'newpass1');
  assert.equal(relog.user.role, 'member');
});

test('home feed: aggregates every department of the club; guests may read', async () => {
  // a session is required, like every feed
  assert.equal((await req(srv.base, 'GET', '/posts/feed')).status, 401);

  const feed = await req(srv.base, 'GET', '/posts/feed', users.leader.token);
  assert.equal(feed.status, 200);
  assert.ok(Array.isArray(feed.data));

  // every card carries its department, and they span more than one department
  for (const p of feed.data) assert.ok(p.department && p.department.slug);
  const slugs = new Set(feed.data.map((p) => p.department.slug));
  assert.ok(slugs.size >= 2, `posts come from several departments (got ${[...slugs]})`);

  // newest first, by the cursor (post id)
  const ids = feed.data.map((p) => p.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));

  // a guest may read it
  assert.equal((await req(srv.base, 'GET', '/posts/feed', users.guest.token)).status, 200);

  // cursor pagination is stable
  const page = await req(srv.base, 'GET', '/posts/feed?limit=1', users.leader.token);
  assert.equal(page.data.length, 1);
  const next = await req(srv.base, 'GET', `/posts/feed?limit=1&before_id=${page.data[0].id}`, users.leader.token);
  assert.ok(next.data.every((p) => p.id < page.data[0].id));
});

test('home feed is isolated per club: a brand-new club starts empty', async () => {
  const created = await req(srv.base, 'POST', '/auth/create-club', null,
    { club_name: 'Feed Isolation Club', full_name: 'Founder', email: 'founder@feed.tn', password: 'password123' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const feed = await req(srv.base, 'GET', '/posts/feed', created.data.token);
  assert.equal(feed.status, 200);
  assert.equal(feed.data.length, 0, 'a new club sees none of the demo club\'s posts');
});
