// ============================================================
//  backup.js — one command that saves everything that matters:
//    platform/backups/<timestamp>/club.db     (SQLite online backup —
//                                              safe while the server runs)
//    platform/backups/<timestamp>/uploads/    (public + private files)
//
//  Run:  cd platform/server && npm run backup
//  Weekly (Windows):  schtasks /create /tn "ISIGK backup" /sc weekly /d SUN
//                     /tr "cmd /c cd C:\Users\USER\Desktop\club_robotic\platform\server && node backup.js"
// ============================================================
const fs = require('fs');
const path = require('path');
const db = require('./db'); // opens (and migrates) the database
const { UPLOAD_ROOT } = require('./storage');

(async () => {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const out = path.join(__dirname, '..', 'backups', stamp);
  fs.mkdirSync(out, { recursive: true });

  await db.backup(path.join(out, 'club.db')); // consistent copy, even mid-write
  if (fs.existsSync(UPLOAD_ROOT)) {
    fs.cpSync(UPLOAD_ROOT, path.join(out, 'uploads'), { recursive: true });
  }

  const size = fs.statSync(path.join(out, 'club.db')).size;
  console.log(`Backup written: ${out} (club.db ${(size / 1024).toFixed(0)} KB + uploads)`);
  console.log('Keep it safe: copy the folder to a USB drive, Google Drive or another machine.');
  process.exit(0);
})().catch((err) => {
  console.error('Backup failed:', err.message);
  process.exit(1);
});
