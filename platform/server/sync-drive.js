// ============================================================
//  sync-drive.js — CLI entry for the monthly scheduled backup:
//     cd platform/server && npm run sync-drive
//  Windows monthly task (runs the 1st of each month at 02:00):
//     schtasks /create /tn "ISIGK Drive backup" /sc monthly /d 1 /st 02:00
//              /tr "cmd /c cd C:\Users\USER\Desktop\club_robotic\platform\server && npm run sync-drive"
// ============================================================
const drive = require('./driveBackup');

(async () => {
  console.log('Syncing club backup to Google Drive…');
  const st = await drive.syncNow(null);
  const gb = (n) => (n == null ? '?' : `${(n / 1024 ** 3).toFixed(2)} GB`);
  console.log(`OK — ${st.months[0]?.month} now on the drive.`);
  console.log(`Drive usage: ${gb(st.usedBytes)} / ${gb(st.totalBytes)} (alert: ${st.alert})`);
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
