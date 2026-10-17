// ============================================================
//  driveClient.js — Google Drive REST client, pure Node (fetch only)
//
//  On Vercel the rclone binary cannot run, so the monthly Drive backup
//  talks to the Drive REST API directly. Two auth options (first wins):
//
//   1. ISIGK_DRIVE_SA_JSON       — a service-account key (the whole JSON,
//                                  or its base64). The account whose folder
//                                  receives backups must have that folder
//                                  shared with the service account's email.
//   2. ISIGK_DRIVE_CLIENT_ID + ISIGK_DRIVE_CLIENT_SECRET
//      + ISIGK_DRIVE_REFRESH_TOKEN — a normal Google app + one authorization.
//        Helper: node drive-auth.js (prints the link, exchanges the code).
//
//  Optional:
//      ISIGK_DRIVE_FOLDER_ID     — folder that receives the monthly folders
//                                  (default: 'ISIGK-Club-Backups' in My Drive)
//
//  API (all Promises):  isConfigured / authOk / about
//                      ensureFolder / listChildren / upload / deleteDeep
// ============================================================
const crypto = require('crypto');
const fs = require('fs');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive';

const SA_JSON = process.env.ISIGK_DRIVE_SA_JSON || '';
const CLIENT_ID = process.env.ISIGK_DRIVE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.ISIGK_DRIVE_CLIENT_SECRET || '';
const REFRESH_TOKEN = process.env.ISIGK_DRIVE_REFRESH_TOKEN || '';
const FOLDER_ID = process.env.ISIGK_DRIVE_FOLDER_ID || ''; // '' → find/create by name
const ROOT_FOLDER = 'ISIGK-Club-Backups';

const isConfigured = () => !!(SA_JSON || (CLIENT_ID && REFRESH_TOKEN));

// ---------------- token ----------------
let _token = null; // { value, expires_at }

function serviceAccount() {
  let json = SA_JSON.trim();
  if (!json.startsWith('{')) json = Buffer.from(json, 'base64').toString('utf8'); // base64-wrapped key
  const key = JSON.parse(json);
  if (!key.client_email || !key.private_key) throw new Error('ISIGK_DRIVE_SA_JSON is not a valid service-account key');
  return key;
}

function saJwtAssertion(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), sa.private_key).toString('base64url');
  return `${input}.${sig}`;
}

async function accessToken() {
  if (_token && _token.expires_at - 60_000 > Date.now()) return _token.value;
  let body;
  if (SA_JSON) {
    body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: saJwtAssertion(serviceAccount()),
    });
  } else {
    body = new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    });
  }
  const r = await fetch(TOKEN_URL, { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(`Drive auth failed (${r.status}): ${j.error_description || j.error || 'no token'}`);
  }
  _token = { value: j.access_token, expires_at: Date.now() + (j.expires_in || 3500) * 1000 };
  return _token.value;
}

const auth = async () => ({ Authorization: `Bearer ${await accessToken()}` });

// quick connectivity probe for the storage panel
async function authOk() {
  if (!isConfigured()) return false;
  try { await accessToken(); return true; } catch { return false; }
}

// ---------------- API ----------------
// real account quota (strings on the wire — numbers here)
async function about() {
  const r = await fetch(`${API}/about?fields=storageQuota(limit,usage,usageInDriveTrash)`, { headers: await auth() });
  if (!r.ok) return null;
  const q = (await r.json()).storageQuota || {};
  return {
    limit: q.limit === undefined ? null : Number(q.limit),
    usage: q.usage === undefined ? null : Number(q.usage) + Number(q.usageInDriveTrash || 0),
  };
}

const qEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// find-or-create a folder (parent '' = My Drive root)
async function ensureFolder(name, parentId = '') {
  const parents = parentId ? ` and '${qEscape(parentId)}' in parents` : '';
  const url = `${API}/files?pageSize=1&fields=files(id,name)`
    + `&q=${encodeURIComponent(`name='${qEscape(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parents}`)}`;
  const found = await (await fetch(url, { headers: await auth() })).json();
  if (found.files && found.files.length) return found.files[0].id;
  const created = await fetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { ...(await auth()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }),
  });
  if (!created.ok) throw new Error(`Drive folder create failed: ${created.status}`);
  return (await created.json()).id;
}

// direct children of a folder (id + name + mime + size)
async function listChildren(folderId) {
  const out = [];
  let pageToken = '';
  do {
    const url = `${API}/files?pageSize=1000&fields=nextPageToken,files(id,name,mimeType,size)`
      + `&q=${encodeURIComponent(`'${qEscape(folderId)}' in parents and trashed=false`)}` + (pageToken ? `&pageToken=${pageToken}` : '');
    const j = await (await fetch(url, { headers: await auth() })).json();
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

// stream a local file to Drive (resumable session — any size)
async function upload(localPath, name, parentId, mime = 'application/octet-stream') {
  const size = fs.statSync(localPath).size;
  const session = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id,size`, {
    method: 'POST',
    headers: {
      ...(await auth()),
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify({ name, parents: [parentId] }),
  });
  if (!session.ok) throw new Error(`Drive upload session failed: ${session.status}`);
  const location = session.headers.get('location');
  const put = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': mime, 'Content-Length': String(size) },
    body: fs.readFileSync(localPath), // files are ≤ ~15 MB (upload cap) — fine in memory
  });
  if (!put.ok && put.status !== 308) throw new Error(`Drive upload failed: ${put.status}`);
  return put.json();
}

// delete a folder and everything under it (children first — Drive folders
// are not cascading on permanent delete)
async function deleteDeep(folderId) {
  let deleted = 0;
  for (const item of await listChildren(folderId)) {
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      deleted += await deleteDeep(item.id);
    }
    await fetch(`${API}/files/${item.id}`, { method: 'DELETE', headers: await auth() });
    deleted += 1;
  }
  await fetch(`${API}/files/${folderId}`, { method: 'DELETE', headers: await auth() });
  return deleted + 1;
}

// the top folder that receives the monthly backups
async function rootFolderId() {
  if (FOLDER_ID) return FOLDER_ID;
  return ensureFolder(ROOT_FOLDER, '');
}

module.exports = { isConfigured, authOk, about, ensureFolder, listChildren, upload, deleteDeep, rootFolderId, ROOT_FOLDER };
