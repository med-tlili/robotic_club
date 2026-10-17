// ============================================================
//  driveBackup.js — monthly off-site backups to Google Drive
//
//  Two transports, same monthly snapshot:
//      <backups>/2026-10/club.db           (SQLite file — local DB)
//      <backups>/2026-10/club-export.json  (full JSON dump — Turso/cloud DB)
//      <backups>/2026-10/uploads/...       (public + private files)
//
//   · local (default): rclone talks to the configured remote
//     (`gdrive:ISIGK-Club-Backups` — see the panel's setup steps)
//   · cloud (Vercel, or any box with ISIGK_DRIVE_* env): driveClient.js
//     pushes through the Drive REST API — no binary needed
//
//  The storage panel shows the account's REAL quota so the leader sees
//  the limit approach and clears old months from the same panel (the
//  live site is never touched).
//
//  Config (env, all optional):
//      ISIGK_DRIVE_REMOTE      default 'gdrive:ISIGK-Club-Backups'  (rclone mode)
//      ISIGK_DRIVE_SA_JSON / ISIGK_DRIVE_CLIENT_ID + _CLIENT_SECRET
//        + ISIGK_DRIVE_REFRESH_TOKEN   (cloud mode — see driveClient.js)
//      ISIGK_DRIVE_TOTAL_BYTES override quota display (also used in tests)
//      ISIGK_DRIVE_WARN_PCT    default 80   (amber alert)
//      ISIGK_DRIVE_CRIT_PCT    default 95   (red alert)
// ============================================================
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('./db');
const { stageUploadsTo } = require('./storage');
const { notify } = require('./notify');
const drive = require('./driveClient');

const CLOUD = drive.isConfigured(); // REST transport (Vercel / cloud env)
const REMOTE = process.env.ISIGK_DRIVE_REMOTE || 'gdrive:ISIGK-Club-Backups';
const WARN_PCT = Number(process.env.ISIGK_DRIVE_WARN_PCT || 80);
const CRIT_PCT = Number(process.env.ISIGK_DRIVE_CRIT_PCT || 95);
const TOTAL_OVERRIDE = Number(process.env.ISIGK_DRIVE_TOTAL_BYTES || 0) || null;
const MONTH_RE = /^\d{4}-\d{2}$/;

// panel help text: which transport this install would use
const BACKEND = CLOUD || process.env.VERCEL ? 'cloud' : 'rclone';

// ---------------- rclone (local transport) ----------------
let _rclonePromise; // probe once — the cache must hold the PROMISE, not the result
function findRclone() {
  if (!_rclonePromise) {
    const run = (bin) => new Promise((res) => {
      execFile(bin, ['version'], { timeout: 10000 }, (err) => res(err ? null : bin));
    });
    _rclonePromise = (async () => {
      const onPath = await run('rclone'); // on PATH after install
      if (onPath) return onPath;
      // winget keeps it in a versioned folder that PATH may not carry yet
      const base = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
      try {
        const hit = fs.readdirSync(base)
          .filter((d) => d.startsWith('Rclone.Rclone'))
          .map((d) => path.join(base, d, 'rclone-v1.75.1-windows-amd64', 'rclone.exe'))
          .find((p) => fs.existsSync(p));
        return hit || null;
      } catch { return null; }
    })();
  }
  return _rclonePromise;
}

function rclone(args, opts = {}) {
  return findRclone().then((bin) => new Promise((resolve, reject) => {
    if (!bin) return reject(new Error('rclone is not installed'));
    execFile(bin, args, { timeout: 5 * 60 * 1000, windowsHide: true, ...opts },
      (err, stdout, stderr) => (err
        ? reject(new Error((stderr || stdout || err.message).toString().trim().split('\n').pop()))
        : resolve(stdout)));
  }));
}

// is a Drive destination configured & reachable?
async function remoteOk() {
  if (CLOUD) return drive.authOk();
  try {
    await rclone(['lsd', REMOTE.split(':')[0] + ':']);
    return true;
  } catch (e) {
    console.error(`[driveBackup] rclone check failed for remote "${REMOTE.split(':')[0]}:": ${e.message}`);
    return false;
  }
}

// ---------------- bookkeeping ----------------
const setSetting = async (k, v) => await db.prepare(
  'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
).run(k, String(v ?? ''));
const getSetting = async (k) => (await db.prepare('SELECT value FROM settings WHERE key = ?').get(k))?.value ?? '';

function monthOf(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

async function monthsList() {
  return await db.prepare(
    'SELECT month, SUM(size) AS bytes, COUNT(*) AS files FROM drive_backups GROUP BY month ORDER BY month DESC',
  ).all();
}

// build the alert state from the real quota
function alertFor(used, total) {
  if (!total) return 'unknown';
  const pct = (used / total) * 100;
  if (pct >= CRIT_PCT) return 'crit';
  if (pct >= WARN_PCT) return 'warn';
  return 'ok';
}

// ---------------- public status (powers the web panel) ----------------
async function status() {
  const bin = CLOUD ? null : await findRclone();
  const configured = CLOUD || bin ? await remoteOk() : false;
  const lastSyncAt = await getSetting('drive_last_sync_at');
  const lastSyncOk = (await getSetting('drive_last_sync_ok')) === '1';
  const lastSyncError = await getSetting('drive_last_sync_error');
  let used = null; let total = TOTAL_OVERRIDE; let free = null;
  if (configured) {
    if (CLOUD) {
      try {
        const q = await drive.about();
        if (q) { used = q.usage; if (!total && q.limit) total = q.limit; }
      } catch { /* quota not reported — panel falls back to bytes pushed */ }
    } else {
      try {
        const about = JSON.parse(await rclone(['about', '--json', REMOTE]));
        used = about.used ?? null;
        free = about.free ?? null;
        if (!total && about.total) total = about.total;
      } catch { /* quota not reported by this remote — panel falls back to bytes pushed */ }
    }
  }
  const months = await monthsList();
  return {
    setupRequired: !configured,
    backend: BACKEND,
    rcloneInstalled: CLOUD || !!bin,
    remoteConfigured: configured,
    remote: CLOUD ? `drive:${drive.ROOT_FOLDER}` : REMOTE,
    usedBytes: used,
    totalBytes: total,
    freeBytes: free,
    // honest fallback: what THIS platform pushed (equals usage on a dedicated account)
    pushedBytes: months.reduce((s, m) => s + m.bytes, 0),
    warnPct: WARN_PCT,
    critPct: CRIT_PCT,
    alert: alertFor(used ?? 0, total),
    months,
    lastSync: lastSyncAt ? { at: lastSyncAt, ok: lastSyncOk, error: lastSyncError } : null,
  };
}

// ---------------- push the staged tree through the REST client ----------------
const MIMES = {
  '.json': 'application/json', '.db': 'application/vnd.sqlite3',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.mov': 'video/quicktime', '.pdf': 'application/pdf',
};
const mimeOf = (name) => MIMES[path.extname(name).toLowerCase()] || 'application/octet-stream';

async function pushTree(dir, parentId, cache = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      let id = cache.get(abs);
      if (!id) { id = await drive.ensureFolder(entry.name, parentId); cache.set(abs, id); }
      await pushTree(abs, id, cache);
    } else {
      await drive.upload(abs, entry.name, parentId, mimeOf(entry.name));
    }
  }
}

// ---------------- sync one month ----------------
let running = false;
async function syncNow(user = null) {
  if (running) throw new Error('A backup is already running');
  running = true;
  const month = monthOf();
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'isigk-backup-'));
  try {
    if (CLOUD) {
      if (!(await drive.authOk())) throw new Error('Drive credentials are not working — check the ISIGK_DRIVE_* environment variables');
    } else {
      if (!(await findRclone())) throw new Error('rclone is not installed (winget install Rclone.Rclone)');
      if (!(await remoteOk())) throw new Error(`rclone remote not configured — run: rclone config create gdrive drive scope=drive`);
    }

    // 1. stage the snapshot: a consistent DB copy + the uploads tree
    //    (Turso is remote — VACUUM INTO cannot reach the local disk, so the
    //     online build exports every table as JSON instead)
    if (db.remote) await db.exportSnapshot(path.join(stage, 'club-export.json'));
    else await db.backup(path.join(stage, 'club.db'));
    await stageUploadsTo(path.join(stage, 'uploads')); // local copy or Blob download

    // 2. push (replaces last push of this month — one snapshot per month)
    if (CLOUD) {
      const root = await drive.rootFolderId();
      const old = (await drive.listChildren(root)).find((k) => k.name === month);
      if (old) await drive.deleteDeep(old.id);
      await pushTree(stage, await drive.ensureFolder(month, root));
    } else {
      await rclone(['sync', stage, `${REMOTE}/${month}`, '--create-empty-src-dirs', '--transfers', '4', '-q']);
    }

    // 3. rebuild the month's bookkeeping from what we actually staged
    const rows = [];
    const walk = (dir, rel) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r); else rows.push([month, r, fs.statSync(abs).size]);
    });
    walk(stage, '');
    await db.prepare('DELETE FROM drive_backups WHERE month = ?').run(month);
    const ins = db.prepare('INSERT INTO drive_backups (month, path, size) VALUES (?,?,?)');
    for (const r of rows) await ins.run(...r);

    await setSetting('drive_last_sync_at', new Date().toISOString());
    await setSetting('drive_last_sync_ok', '1');
    await setSetting('drive_last_sync_error', '');

    // 4. tell the bosses when it matters (never colour alone — the text says why)
    const st = await status();
    if (user && st.alert !== 'ok' && st.alert !== 'unknown') {
      const pct = st.totalBytes ? Math.round((st.usedBytes / st.totalBytes) * 100) : '?';
      for (const b of await db.prepare("SELECT id FROM users WHERE role IN ('leader','coleader')").all()) {
        await notify(b.id, {
          type: 'backup',
          title: st.alert === 'crit' ? 'Drive backups nearly full' : 'Drive backups approaching the limit',
          body: `Drive usage is at ${pct}% — clear old months in Storage.`,
          link: '/storage',
        });
      }
    }
    return st;
  } catch (err) {
    await setSetting('drive_last_sync_at', new Date().toISOString());
    await setSetting('drive_last_sync_ok', '0');
    await setSetting('drive_last_sync_error', err.message);
    if (user) {
      for (const b of await db.prepare("SELECT id FROM users WHERE role IN ('leader','coleader')").all()) {
        await notify(b.id, {
          type: 'backup',
          title: 'Drive backup failed',
          body: err.message,
          link: '/storage',
        });
      }
    }
    throw err;
  } finally {
    running = false;
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* temp cleaned by OS later */ }
  }
}

// ---------------- clear one month (leader pruning) ----------------
async function clearMonth(month) {
  if (!MONTH_RE.test(month || '')) throw new Error('Bad month — expected YYYY-MM');
  const exists = (await db.prepare('SELECT COUNT(*) AS c FROM drive_backups WHERE month = ?').get(month)).c;
  if (!exists) throw new Error('No backup recorded for that month');
  if (CLOUD) {
    const root = await drive.rootFolderId();
    const old = (await drive.listChildren(root)).find((k) => k.name === month);
    if (old) await drive.deleteDeep(old.id);
  } else {
    if (!(await remoteOk())) throw new Error('rclone remote not configured');
    await rclone(['purge', `${REMOTE}/${month}`]);
  }
  await db.prepare('DELETE FROM drive_backups WHERE month = ?').run(month);
  return status();
}

module.exports = { status, syncNow, clearMonth, monthOf, MONTH_RE };
