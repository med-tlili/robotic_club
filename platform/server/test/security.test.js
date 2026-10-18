// ============================================================
//  test/security.test.js — CORS, uploads, signed URLs, cron guard
// ============================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, req, raw, upload, loginAll, PNG_1PX } = require('./helpers');

let srv;
let users;

test.before(async () => {
  srv = await startServer({ port: 4315, demo: '1' });
  users = await loginAll(srv.base);
});
test.after(() => srv && srv.stop());

test('CORS echoes only allow-listed / dev origins (no blanket *)', async () => {
  const dev = await raw(srv.base, 'GET', '/api/health', { origin: 'http://localhost:5173' });
  assert.equal(dev.headers.get('access-control-allow-origin'), 'http://localhost:5173');

  const evil = await raw(srv.base, 'GET', '/api/health', { origin: 'https://evil.example' });
  assert.equal(evil.headers.get('access-control-allow-origin'), null, 'must not reflect a foreign origin');
  assert.notEqual(evil.headers.get('access-control-allow-origin'), '*');
});

test('private uploads require a valid, unexpired HMAC signature', async () => {
  const album = await req(srv.base, 'POST', '/media/albums', users.media.token, { title: 'Test album' });
  assert.equal(album.status, 201);

  const up = await upload(srv.base, `/media/albums/${album.data.id}/media`, users.media.token, {
    file: { buffer: PNG_1PX, mimetype: 'image/png', name: 'shot.png' },
    fields: { caption: 'first' }, fieldName: 'file',
  });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.match(up.data.file_path, /^\/uploads\/private\//);
  assert.match(up.data.file_path, /\?e=\d+&s=/);

  const unsigned = up.data.file_path.split('?')[0];
  assert.equal((await raw(srv.base, 'GET', unsigned)).status, 401);

  const tampered = await raw(srv.base, 'GET', `${unsigned}?e=9999999999&s=deadbeef`);
  assert.equal(tampered.status, 403);

  const expired = await raw(srv.base, 'GET', `${unsigned}?e=1&s=x`);
  assert.equal(expired.status, 401);

  const good = await raw(srv.base, 'GET', up.data.file_path);
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('x-content-type-options'), 'nosniff');
});

test('a client cannot choose a dangerous on-disk extension', async () => {
  // html bytes, but advertised as png -> stored with the png extension
  const post = await upload(srv.base, '/posts', users.member.token, {
    file: { buffer: Buffer.from('<script>alert(1)</script>'), mimetype: 'image/png', name: 'evil.html' },
    fields: { department_id: '1', title: 'Sneaky image', type: 'image' }, fieldName: 'media',
  });
  assert.equal(post.status, 201, JSON.stringify(post.data));
  assert.ok(post.data.image, 'the image post stored a file');
  assert.doesNotMatch(post.data.image, /\.html?$/i, 'stored file must not keep a .html extension');
  assert.match(post.data.image, /\.(png|jpe?g|gif|webp)$/i);

  // an html upload to the album route is rejected outright
  const album = await req(srv.base, 'POST', '/media/albums', users.media.token, { title: 'X' });
  const bad = await upload(srv.base, `/media/albums/${album.data.id}/media`, users.media.token, {
    file: { buffer: Buffer.from('<script>'), mimetype: 'text/html', name: 'x.html' },
    fieldName: 'file',
  });
  assert.equal(bad.status, 400);
});

test('upload path traversal is blocked', async () => {
  const r = await raw(srv.base, 'GET', '/uploads/public/%2e%2e%2f%2e%2e%2fserver%2findex.js');
  assert.ok([400, 403, 404].includes(r.status), `unexpected ${r.status}`);
  assert.ok(!String(r.text).includes('express'), 'must not leak server source');
});

test('the backup cron endpoint is closed without CRON_SECRET', async () => {
  const r = await raw(srv.base, 'GET', '/api/storage/cron-sync');
  assert.equal(r.status, 404);
});

test('API failures are JSON, never HTML stack traces', async () => {
  const r = await req(srv.base, 'GET', '/this/route/does/not/exist');
  assert.equal(r.status, 404);
  assert.equal(typeof r.data, 'object');
});
