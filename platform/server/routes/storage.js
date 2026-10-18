// ============================================================
//  routes/storage.js — Drive backups: status, manual sync, pruning
//  View:  Leader / Co-Leader / Supervisor (read-only for the Supervisor)
//  Act:   Leader / Co-Leader only (run backup, clear a month)
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const drive = require('../driveBackup');

const router = express.Router();
const BOSS = ['leader', 'coleader'];

// GET /api/storage — panel state (quota, months, last sync)
// NOTE: 500s here return a generic message (details are logged server-side)
// — raw error strings can embed rclone stderr, filesystem paths or env info.
router.get('/', authenticate, (req, res) => {
  if (![...BOSS, 'supervisor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Storage is for club leaders and the supervisor' });
  }
  drive.status().then((s) => res.json(s)).catch((e) => {
    console.error('[storage] status failed:', e);
    res.status(500).json({ error: 'Could not read the backup status — see the server log' });
  });
});

// POST /api/storage/sync — run a backup now (Leader / Co-Leader)
router.post('/sync', authenticate, async (req, res) => {
  if (!BOSS.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Leader or Co-Leader can run a backup' });
  }
  try {
    res.json(await drive.syncNow(req.user));
  } catch (e) {
    console.error('[storage] sync failed:', e);
    res.status(500).json({ error: 'Backup failed — check the backup configuration and see the server log' });
  }
});

// POST /api/storage/months/:month/clear — delete one month's backup (Leader / Co-Leader)
router.post('/months/:month/clear', authenticate, async (req, res) => {
  if (!BOSS.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Leader or Co-Leader can clear backups' });
  }
  try {
    res.json(await drive.clearMonth(req.params.month));
  } catch (e) {
    // validation-style failure (bad month / not backed up) — message is safe
    res.status(400).json({ error: e.message });
  }
});

// GET /api/storage/cron-sync — Vercel Cron (Hobby: daily schedule; the
// handler itself skips unless the current month has no successful push yet,
// so the backup runs once a month). Guarded by CRON_SECRET — Vercel sends it
// as `Authorization: Bearer <CRON_SECRET>` on every cron request.
router.get('/cron-sync', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(404).json({ error: 'Not found' });
  }
  try {
    const month = drive.monthOf();
    const lastAt = (await db.prepare("SELECT value FROM settings WHERE key = 'drive_last_sync_at'").get())?.value || '';
    const lastOk = (await db.prepare("SELECT value FROM settings WHERE key = 'drive_last_sync_ok'").get())?.value === '1';
    if (lastOk && lastAt.slice(0, 7) === month) {
      return res.json({ skipped: true, month, reason: 'already backed up this month' });
    }
    const st = await drive.syncNow(null); // no user → no notification spam
    res.json({ synced: true, month, alert: st.alert });
  } catch (e) {
    console.error('[storage] cron sync failed:', e);
    res.status(500).json({ error: 'Backup failed — see the server log' });
  }
});

module.exports = router;
