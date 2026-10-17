// ============================================================
//  drive-auth.js — ONE-TIME: authorize the club's Drive backups
//
//  Run locally once (needs ISIGK_DRIVE_CLIENT_ID + ISIGK_DRIVE_CLIENT_SECRET
//  in the environment or in .env.drive.local):
//
//      cd platform/server && node drive-auth.js
//
//  1. prints a Google consent link  → open it, pick the backup account,
//     approve, copy the CODE it shows
//  2. paste the code here  → the REFRESH TOKEN is printed
//  3. put that token (with the client id/secret) into the Vercel env vars
//      ISIGK_DRIVE_CLIENT_ID / ISIGK_DRIVE_CLIENT_SECRET / ISIGK_DRIVE_REFRESH_TOKEN
// ============================================================
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// convenience: read a local (git-ignored) .env.drive.local if present
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env.drive.local'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* no local file — env vars must already be set */ }

const CLIENT_ID = process.env.ISIGK_DRIVE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.ISIGK_DRIVE_CLIENT_SECRET || '';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log('Missing ISIGK_DRIVE_CLIENT_ID / ISIGK_DRIVE_CLIENT_SECRET.');
  console.log('Create them once: https://console.cloud.google.com/apis/credentials');
  console.log('  → OAuth client ID → "Desktop app" → copy id + secret into');
  console.log('  platform/server/.env.drive.local (git-ignored):');
  console.log('    ISIGK_DRIVE_CLIENT_ID=....apps.googleusercontent.com');
  console.log('    ISIGK_DRIVE_CLIENT_SECRET=....');
  process.exit(1);
}

const redirect = 'http://localhost:1'; // installed-app flow: the code is shown, not fetched
const link = 'https://accounts.google.com/o/oauth2/v2/auth'
  + `?client_id=${encodeURIComponent(CLIENT_ID)}`
  + `&redirect_uri=${encodeURIComponent(redirect)}`
  + '&response_type=code'
  + `&access_type=offline&prompt=consent`
  + `&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive')}`;

console.log('\n1) Open this link, pick the backup Google account, approve:\n');
console.log('   ' + link + '\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('2) Paste the CODE Google showed you: ', async (code) => {
  rl.close();
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        code: code.trim(),
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) {
      console.log('Exchange failed:', j.error_description || j.error || r.status);
      process.exit(1);
    }
    console.log('\n3) Success. Add this to the Vercel project env vars:\n');
    console.log(`   ISIGK_DRIVE_REFRESH_TOKEN=${j.refresh_token}\n`);
    console.log('   (keep ISIGK_DRIVE_CLIENT_ID / ISIGK_DRIVE_CLIENT_SECRET too)');
  } catch (e) {
    console.log('Exchange failed:', e.message);
    process.exit(1);
  }
});
