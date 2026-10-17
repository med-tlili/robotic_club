// ============================================================
//  routes/storage.js — Drive backups: status, manual sync, pruning
//  View:  Leader / Co-Leader / Professor (read-only for the Professor)
//  Act:   Leader / Co-Leader only (run backup, clear a month)
// ============================================================
const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const drive = require('../driveBackup');

const router = express.Router();
const BOSS = ['leader', 'coleader'];

// GET /api/storage — panel state (quota, months, last sync)
router.get('/', authenticate, (req, res) => {
  if (![...BOSS, 'professor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Storage is for club leaders and the professor' });
  }
  drive.status().then((s) => res.json(s)).catch((e) => res.status(500).json({ error: e.message }));
});

// POST /api/storage/sync — run a backup now (Leader / Co-Leader)
router.post('/sync', authenticate, async (req, res) => {
  if (!BOSS.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only the Leader or Co-Leader can run a backup' });
  }
  try {
    res.json(await drive.syncNow(req.user));
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
