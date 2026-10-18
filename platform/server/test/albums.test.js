// ============================================================
//  test/albums.test.js — phase 6 department photo albums
//  per-department scoping · who may manage · browsing ·
//  upload → share-to-feed · delete · cross-club isolation
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req, loginAll, upload, PNG_1PX } = require('./helpers');

let srv;
let users;
const dept = {};
const png = { buffer: PNG_1PX, mimetype: 'image/png', name: 'shot.png' };

test.before(async () => {
  srv = await startServer({ port: 4318, demo: '1' });
  users = await loginAll(srv.base);
  const ds = await req(srv.base, 'GET', '/departments', users.member.token);
  for (const d of ds.data) dept[d.slug] = d.id;
});
test.after(() => srv && srv.stop());

test('every department has its own albums — scoped per department', async () => {
  const hr = await req(srv.base, 'POST', '/media/albums', users.hr.token, {
    department_id: dept.hr, title: 'HR kickoff',
  });
  assert.equal(hr.status, 201, JSON.stringify(hr.data));
  assert.equal(hr.data.department_id, dept.hr);

  const hrList = await req(srv.base, 'GET', `/media/albums?department_id=${dept.hr}`, users.member.token);
  assert.equal(hrList.status, 200);
  assert.ok(hrList.data.some((a) => a.id === hr.data.id));

  // it must NOT appear under another department
  const mediaList = await req(srv.base, 'GET', `/media/albums?department_id=${dept.media}`, users.member.token);
  assert.equal(mediaList.status, 200);
  assert.ok(!mediaList.data.some((a) => a.id === hr.data.id));
});

test('only that department manager or a club leader may manage its albums', async () => {
  // another department's manager cannot create in HR
  assert.equal((await req(srv.base, 'POST', '/media/albums', users.media.token, { department_id: dept.hr, title: 'Nope' })).status, 403);
  // an HR plain member cannot either
  assert.equal((await req(srv.base, 'POST', '/media/albums', users.member.token, { department_id: dept.hr, title: 'Nope' })).status, 403);
  // the supervisor is read-only
  assert.equal((await req(srv.base, 'POST', '/media/albums', users.supervisor.token, { department_id: dept.hr, title: 'Nope' })).status, 403);
  // a club leader may manage any department
  const byLeader = await req(srv.base, 'POST', '/media/albums', users.leader.token, { department_id: dept.hr, title: 'Leader album' });
  assert.equal(byLeader.status, 201, JSON.stringify(byLeader.data));
});

test('any member may browse a department\'s albums; guests may not', async () => {
  assert.equal((await req(srv.base, 'GET', `/media/albums?department_id=${dept.finance}`, users.member.token)).status, 200);
  assert.equal((await req(srv.base, 'GET', `/media/albums?department_id=${dept.finance}`, users.guest.token)).status, 403);
  // the legacy default (no department_id) still resolves to Media
  assert.equal((await req(srv.base, 'GET', '/media/albums', users.member.token)).status, 200);
});

test('upload into a department album, then share it to that department feed', async () => {
  const album = await req(srv.base, 'POST', '/media/albums', users.hr.token, { department_id: dept.hr, title: 'Photos' });
  assert.equal(album.status, 201);

  const up = await upload(srv.base, `/media/albums/${album.data.id}/media`, users.hr.token, {
    file: png, fields: { caption: 'team' }, fieldName: 'file',
  });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.match(up.data.file_path, /^\/uploads\/private\//);

  // a non-manager cannot upload into it
  assert.equal((await upload(srv.base, `/media/albums/${album.data.id}/media`, users.events.token, {
    file: png, fieldName: 'file',
  })).status, 403);

  // share → a post in the HR department feed
  const share = await req(srv.base, 'POST', `/media/media/${up.data.id}/share`, users.hr.token, {});
  assert.equal(share.status, 201, JSON.stringify(share.data));
  const feed = await req(srv.base, 'GET', `/posts?department_id=${dept.hr}`, users.member.token);
  assert.equal(feed.status, 200);
  assert.ok(feed.data.some((p) => p.id === share.data.post_id));
  // no double share
  assert.equal((await req(srv.base, 'POST', `/media/media/${up.data.id}/share`, users.hr.token, {})).status, 409);
});

test('a picture and an album can be deleted (manager only)', async () => {
  const album = await req(srv.base, 'POST', '/media/albums', users.hr.token, { department_id: dept.hr, title: 'Disposable' });
  assert.equal(album.status, 201);
  const up = await upload(srv.base, `/media/albums/${album.data.id}/media`, users.hr.token, { file: png, fieldName: 'file' });
  assert.equal(up.status, 201);

  // another department's manager cannot delete the picture
  assert.equal((await req(srv.base, 'DELETE', `/media/media/${up.data.id}`, users.media.token)).status, 403);
  // the album owner can
  assert.equal((await req(srv.base, 'DELETE', `/media/media/${up.data.id}`, users.hr.token)).status, 200);
  // a foreign manager cannot delete the album, the owner can
  assert.equal((await req(srv.base, 'DELETE', `/media/albums/${album.data.id}`, users.media.token)).status, 403);
  assert.equal((await req(srv.base, 'DELETE', `/media/albums/${album.data.id}`, users.hr.token)).status, 200);

  const left = await req(srv.base, 'GET', `/media/albums?department_id=${dept.hr}`, users.member.token);
  assert.ok(!left.data.some((a) => a.id === album.data.id));
});

test('albums are club-scoped: a foreign club gets 404', async () => {
  const album = await req(srv.base, 'POST', '/media/albums', users.hr.token, { department_id: dept.hr, title: 'Private to club' });
  assert.equal(album.status, 201);

  const other = await req(srv.base, 'POST', '/auth/create-club', null, {
    club_name: 'Gallery Rivals', full_name: 'Rival Boss', email: 'gallery@x.tn', password: 'password123',
  });
  assert.equal(other.status, 201, JSON.stringify(other.data));
  const t = other.data.token;

  // the foreign club cannot target our department …
  assert.equal((await req(srv.base, 'GET', `/media/albums?department_id=${dept.hr}`, t)).status, 404);
  assert.equal((await req(srv.base, 'POST', '/media/albums', t, { department_id: dept.hr, title: 'Sneak' })).status, 404);
  // … nor touch our album by id
  assert.equal((await req(srv.base, 'DELETE', `/media/albums/${album.data.id}`, t)).status, 404);
});
