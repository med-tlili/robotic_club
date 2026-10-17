# 🤖 ISIGK Robotics Club — Management Platform

> **Single source of truth** for the project: idea, roles, features, decisions, tech, how to run, and sprint status.
> The LaTeX report (`rapport/`) is **frozen** until the project ends — it will be updated from this README at the end.

---

## 1. 🎯 Vision

One web platform where the whole club — **Professor → Leader → Co-Leader → Managers → Members → Guests** — manages departments, communicates and organizes events. Replaces scattered WhatsApp groups, Excel files and folders.

**Pain points solved:** scattered communication, no member registry, manual event org, untracked materials, invisible finances, no remote collaboration.

---

## 2. 👥 Roles & Permissions

| Role | Powers |
|------|--------|
| **Professor** | Sees **everything**: graphs, goals, all department tasks, all chats. **Read-only on management** (no posts/comments, no member edits, no tasks/calendar/department tools) — with **one write: creating Leader accounts**, the root of the onboarding chain. **Takes part in every chat** like a member and **can vote** on posts. Can **download reports** (monthly / full year / per department) |
| **Leader** | Full control: all departments, all chats, **assigns goals**, **owns the global calendar** (members view only), promotes/removes users, **creates every other account** (Co-Leader, Managers, Members, Guests) |
| **Co-Leader** | Same powers as the Leader — including creating accounts |
| **Manager** (HR / Events / Media / Finance) | Own department: public home content, private space, tasks, his department chat |
| **Member** | Belongs to 1 department: tasks, chats, votes, sees directory |
| **Guest** | Public home pages only: **NO member directory**, limited access |

**"Bosses"** = Professor + Leader + Co-Leader → access everything.

**Onboarding chain — no free self-registration except the Professor.** Accounts inside the club are only ever created on the chain **Professor → Leader → everyone else** (Members page · API `POST /api/users`). The **Professor sign-up is open** (user decision): anyone can register as Professor on the public **`/signup`** page at any time — he then **creates the Leader** from the Members page ("Create leader account"), and the Leader creates everyone else.

---

## 3. 🏢 Departments

| Dept | Public home page shows | Private space (members only) |
|------|------------------------|------------------------------|
| **HR** | Announcements | Meeting conclusions, **manual attendance**, rule-break alerts, tasks |
| **Events** | Announcements | **Event itinerary/journey**, decoration planning, tasks |
| **Media** | Clips for social media with 👍/👎 vote + comments + **album cards (all members can browse albums)** | Album/photo management (create, upload, share to public), tasks |
| **Finance** | **Sponsor offers** (money **or goods**) with vote + comments | Sponsor pipeline (money/goods), budget/expenses, tasks |
| **Materials** | ⏳ **Coming soon** | — (deferred to PROD) |

Each department = **public home page** (like a profile, visible to everyone incl. guests) + **private space** (chat + tasks, members + bosses only).

---

## 4. 💬 Chat rules

| Chat | Who participates |
|------|------------------|
| 💬 **Global** | Everyone (all roles), **Professor included** |
| 👔 **Managers** | 4 Managers + Leader + Co-Leader + Professor |
| 🏢 **Department** | Members of that department + Leader/Co-Leader + Professor |
| 🔒 **Private 1↔1** | Two users — opened by **clicking a member in the directory** |

**Anyone who can open a chat can write in it — the Professor chats like any member** (his read-only rule applies to *content management*: creating posts, commenting, tasks, members, calendar, department tools — he can still **vote**). Chat supports **file & image attachments**. Bosses see all chats.

---

## 5. 🗳️ Votes, Calendar, Goals, Reports

- **Votes (on home-page posts):** Yes/No, **1 per user**, **changeable** anytime, **transparent** (everyone sees who voted what). Available to **every member, Professor included** — guests can't vote. Posts also have **comments** (members only).
- **Global calendar:** only the **Leader** adds/edits event dates; **members view only**.
- **Goals:** the **Leader assigns goals** to each department (shown on the department home page).
- **Professor reports:** from the calendar he downloads the **monthly global report** and the **full-year report**; from each department he downloads that **department's report**.

## 6. 👥 Members directory

- Visible to **all users except guests** (guests see a locked notice).
- **Clicking a member opens a private chat** with him.

## 7. 🖼️ Albums (Media)

- **Browsable by every club member** (album cards on the Media public home page); **guests excluded**.
- **Managed** by the Media department only (create/upload/delete — Media manager + leaders).
- Media members can **share selected pictures from albums to the public home page**.
- Purpose: the media team works autonomously — clips posted on home page get validated by vote before being published on social media.

## 8. ✋ HR specifics

- HR **manually marks** presence/absence of members at meetings/events.
- HR writes **meeting conclusions**.
- HR raises **rule-break alerts** on members.

---

## 9. ✅ MVP scope

- Auth + 6 roles + strict permissions
- 4 active departments + Materials "Coming Soon"
- Department **public home**: announcements, votes (visible voters), comments, sponsor offers, clips
- Department **private space**: chat + tasks
- **Albums** (browsable by all members, managed by Media) + share to home page
- **Chat**: global / managers / department / private + file & image attachments
- **Members directory** (hidden from guests) → click = private chat
- **HR**: conclusions, manual attendance, alerts
- **Events**: itinerary + decoration
- **Global calendar** (Leader edits, all view)
- **Goals** (Leader assigns per department)
- **Professor dashboard**: graphs, goals, tasks, **reports** (monthly/yearly/department)
- In-app notifications

## 10. ⏳ PROD (later)

Materials inventory & loans · video meetings (Jitsi test) · email/Telegram alerts · kanban board · member dues · purchase requests · sub-channels · post-event reports · social planner · FR/EN · notification preferences

---

## 11. 🛠️ Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | React 19 + Vite (light theme — engineering brand), react-router-dom |
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) → PostgreSQL in PROD |
| Real-time | Socket.io (wired, used from Sprint 4) |
| Auth | JWT + bcryptjs |
| Uploads (Sprint 2+, reworked 2026-10-15) | multer → `uploads/public` (feed images, guest-viewable) + `uploads/private` (album photos & chat attachments, 24h HMAC-signed URLs) · `sharp` thumbnails |
| Backups (2026-10-16) | `npm run backup` → local `platform/backups/` · `npm run sync-drive` → monthly snapshot on **Google Drive** via rclone (`<remote>/YYYY-MM`) · Storage page `/storage` with quota-limit alerts (amber ≥80%, red ≥95%) |
| Video (test) | Jitsi embedded iframe |
| Toolchain | MiKTeX for the report PDF |

---

## 12. 📁 Project structure

```
club_robotic/
├── README.md                     # ← this file (living spec)
├── rapport/                      # LaTeX report — FROZEN until project end
│   ├── rapport_robotic_club.tex
│   └── rapport_robotic_club.pdf  # 29 pages
└── platform/                     # the web app
    ├── server/                   # Backend (port 4000)
    │   ├── index.js              # Express + Socket.io entry
    │   ├── db.js                 # SQLite schema + seed
    │   ├── club.db               # database file (auto-created)
    │   ├── middleware/auth.js    # JWT + role guard
    │   └── routes/               # auth, users, departments, goals
    └── client/                   # Frontend (port 5173)
        └── src/
            ├── App.jsx           # routes + grouped sidebar layout
            ├── auth.jsx          # auth context
            ├── api.js            # fetch helper w/ JWT
            ├── roles.js          # role/dept labels, colors, icons
            ├── components/ui.jsx # Avatar, RolePill, Panel, EmptyState…
            └── pages/            # Login, Dashboard, Members, DepartmentHome, PrivateChat
```

---

## 13. 🚀 How to run

```bash
# Terminal 1 — API
cd platform/server
node index.js            # → http://localhost:4000

# Terminal 2 — App
cd platform/client
npm run dev              # → http://localhost:5173
```

Open **http://localhost:5173** — database and demo accounts are created automatically on first run.

**Production env (all optional):** `ISIGK_DEMO_ACCOUNTS=0` → *no demo accounts/content are seeded* (real install: only the 5 departments; the Professor registers himself on `/signup`, then builds the club) · `DB_PATH` → where `club.db` lives (default: `platform/server/club.db` — point it at your persistent disk) · `PORT` · `JWT_SECRET` → set a long random string.

### 🚀 Deploy on a host (production)

```bash
git clone https://github.com/med-tlili/robotic_club.git
cd robotic_club/platform/server
npm install        # API dependencies (better-sqlite3 & sharp ship Linux prebuilds)
npm start          # production mode: no demo data, JWT secret generated once → .jwt-secret
```

That's it — the UI build (`client/dist`) is committed. Then:

1. Open the site → **`/signup`** → create the **Professor** account
2. As Professor: **Members → Create leader account**
3. As Leader: create everyone else and start using the club

Notes: the database and `uploads/` appear next to the server on first run — **back them up** (the Drive panel does this automatically once rclone is configured on the host) · the server serves the API + the UI on one port (`PORT`, default 4000) · rebuild the UI only after changing client code: `cd platform/client && npm install && npm run build`. Local demo with seeded accounts: `npm run start:demo`.

## 14. 🔑 Demo accounts (password: `password123`)

| Email | Role |
|-------|------|
| professor@isigk.tn | Professor |
| leader@isigk.tn | Leader |
| coleader@isigk.tn | Co-Leader |
| hr@isigk.tn | HR Manager |
| events@isigk.tn | Events Manager |
| media@isigk.tn | Media Manager |
| finance@isigk.tn | Finance Manager |
| member@isigk.tn | Member (HR dept) |
| guest@isigk.tn | Guest |

These accounts exist **only** in the demo seed (`ISIGK_DEMO_ACCOUNTS` unset). Production installs run with `ISIGK_DEMO_ACCOUNTS=0` — an empty club where people register on the chain (§2).

## 15. 🔌 API overview (Sprint 0)

| Endpoint | Method | Who |
|----------|--------|-----|
| `/api/auth/login` | POST | anyone |
| `/api/auth/signup-professor` | POST | **anyone — open sign-up** |
| `/api/auth/me` | GET | logged in |
| `/api/users` | GET | logged in, **not guest** |
| `/api/users/:id` | GET | logged in, **not guest** |
| `/api/departments` | GET | public |
| `/api/departments/:slug` | GET | public (members list hidden with `?guest=1`) |
| `/api/departments/:slug/private` | GET | department members + bosses |
| `/api/goals` | GET | logged in |
| `/api/goals` | POST | Leader / Co-Leader |

---

## 16. 📅 Sprint plan & status

| Sprint | Goal | Status |
|--------|------|--------|
| **S0** | Setup, schema, auth, 6 roles, skeleton | ✅ **DONE** (2026-10-15) |
| **S1** | Announcements + votes + comments on home pages | ✅ **DONE** (2026-10-15) |
| **S2** | Members management (promote/remove), directory polish, calendar + goals UI | ✅ **DONE** (2026-10-15) |
| **S3** | Tasks per department + notifications core | ✅ **DONE** (2026-10-15) |
| **S4** | Chat (global/managers/department/private + attachments) + Jitsi test | ✅ **DONE** (2026-10-15) |
| **S5** | Finance module + reports (monthly/yearly/dept) | ✅ **DONE** (2026-10-15) |
| **S6** | Media albums + HR (attendance/conclusions/alerts) + Events (itinerary/decoration) | ✅ **DONE** (2026-10-15) |
| **S7** | Professor dashboard graphs + testing + deployment | ✅ **DONE** (2026-10-15) |
| **PROD** | Features of §10 | ⬜ |

---

## 17. 📜 Decisions log

**2026-10-17 — Google Drive backups CONNECTED to the real account (live)**
- **Setup done**: the club's dedicated Google account was created, `rclone config create gdrive drive scope=drive` + one browser consent (`rclone about gdrive:`) — token + refresh token saved in `rclone.conf`, no server env needed (default remote `gdrive:ISIGK-Club-Backups` matches). The Storage page's setup panel disappears automatically once the remote answers
- **First real backup**: leader clicked *Run backup now* → `club.db` + all `uploads/` (public + private + thumbs, 14 files / 2 MB) landed in **`ISIGK-Club-Backups/2026-10/`** · Storage page shows the true quota (**2 MB of 15 GB — "Healthy"**) · *"Last backup 17/10/2026 01:27:44 — ok"* · month row *2026-10 · 2 MB · 14* · Dashboard warn banner correctly absent at 0%
- **Heads-up (2026)**: rclone warns its *shared* Google OAuth client is being retired during 2026 — current backups keep working; if/when it nags, the fix is a personal `client_id`/`client_secret` in the remote (rclone.org/drive → "making your own client id"), a 5-minute Google Cloud Console step
- Re-running the monthly backup replaces the month's copy; *Clear month* only touches the off-site copy — the live site's files are never at risk

**2026-10-17 — Professor sign-up is now OPEN, always (user: "remouve the idea of fresh install only i want to sign up")**
- **What changed**: the fresh-install gate is gone — **`/signup` works at any time on any database**: fill name/email/password → Professor account → straight into the app. Multiple professors are allowed (they're just parallel full-access accounts). The page lost its status check, its Professor/Leader toggle remnants and the "already has a Professor" banner
- **Removed**: the no-professor-exists 403 in `POST /api/auth/signup-professor` and the whole `GET /api/auth/signup-status` endpoint (404 now). `ISIGK_DEMO_ACCOUNTS` / `DB_PATH` stay (still useful: production installs shouldn't seed the public `password123` demo accounts)
- **Tradeoff, accepted (user decision)**: on a public URL anyone who opens `/signup` becomes a Professor — full access to everything. If the club ever wants it restricted again, the one-line exists-check is one `if` away (or an env/setup-code gate)
- **Verified**: 14/14 open-signup suite **on the live demo DB** — validation 400s · duplicate email 409 · **signup → 201 while two professors already exist** · both new professors log in and read the directory · `signup-status` + invites → 404 · demo DB restored to exactly 9 users · regressions 25/25 + 32/32 · browser: `/signup` on the demo shows a plain always-working form (no banner, no code field) → signed up through the UI → **landed on the Professor dashboard** ("Club overview"), 0 console errors · clean `vite build`

**2026-10-17 — Leader invite codes + leader self-signup REMOVED — the Professor creates the Leader (user request: "remouve the leader invite code and sign up cause the professor will create the leader account")**
- **What changed**: the chain is back to its simplest form — **Professor → "Create leader account" (Members page) → Leader → creates everyone else**. Superseded: the invite-code system from the two entries below
- **Deleted**: `routes/invites.js` (issue/list/revoke endpoints) + its mount · `leader_invites` table (schema + dropped from the demo DB) · `POST /api/auth/signup-leader` · Members page *Invite leader* button + `InviteModal` · the Leader tab, invite-code field and leader path on `/signup`
- **Kept**: the **Professor bootstrap signup** (`/signup` = professor-only now; fresh-install one-time rule, `ISIGK_DEMO_ACCOUNTS=0` production seed, `DB_PATH`) — the login page's visible **Sign up** button stays, its subtitle now "Fresh install — create the club's Professor account"
- **Verified**: fresh-install suite updated to the direct chain — 22/22: 404 on both removed endpoints · professor signup → 201 · **professor creates the leader directly → 201** · leader logs in → creates a member → member logs in · page APIs 200 on the empty DB · demo regressions 25/25 (account chain) + 32/32 (media) · demo server also returns 404 on both removed endpoints · `vite build` clean (bundle shrank ~4 kB)

**2026-10-17 — Professor sign-up: the one-time fresh-install bootstrap (user request: "yeah do professor sign up")**
- **The problem it solves**: the Professor is the root of the trust chain — nobody is above him to invite him, so on a brand-new production install (no accounts at all) *somebody* must be able to become the first Professor. Rule: **this sign-up opens exactly once — while `role='professor'` count is 0 — and closes forever** (`GET /api/auth/signup-status` → `professor_open`; `POST /api/auth/signup-professor` → 403 with "already has a Professor… fresh install" the moment one exists). On a live club nobody can ever slip in
- **Demo seed made production-honest**: the old seed *always* created the 9 demo accounts (published `password123` passwords!) which would have blocked the bootstrap on every fresh DB. Now `ISIGK_DEMO_ACCOUNTS=0` seeds **only the 5 departments** — users, posts, events, tasks, messages all skip → the real production install starts empty and fills up with real people. Default unchanged (demo ON for local dev). `DB_PATH` env added (point `club.db` at the persistent disk; also used to run an isolated fresh-install instance for testing)
- **Bug found on the way**: the demo **events** seeder called `.id` on a `db.prepare()` *Statement* instead of `.get().id` — dormant on the demo DB (events already existed) but it would have **crashed every truly fresh install** at boot; fixed while gating the seeder
- **Client**: the login page now carries an **obvious Sign-up button** (bordered full-width row: *Sign up — Professor (fresh install) or Leader (with invite code)*) → **`/signup`**. The page shows a **Professor / Leader toggle at all times** so the feature is never invisible: on a fresh install it lands on **Professor mode** (no code field, "closes as soon as one Professor exists" note); on a live club the Professor tab stays visible but explains itself — an info banner: *"This sign-up only opens on a brand-new install — your club already has a Professor. Sign in with your account instead."* (first version hid the tab when closed — the feature became undiscoverable; user: "where is the sign up"). Leader mode submits to `/auth/signup-leader`, Professor mode to `/auth/signup-professor`, both auto-login via `signIn()`
- **Verified (isolated fresh instance: `DB_PATH`+`ISIGK_DEMO_ACCOUNTS=0` on :4100)**: 23/23 — 5 departments seeded, **zero** users/content · status `professor_open: true` · validation 400s · first signup → **201 role professor + token** · status flips false · second attempt → **403** with the fresh-install message · he logs in · **full chain runs on the empty DB**: invite code → leader self-signup → member created → logs in · every page API returns 200 on the empty DB (posts/tasks are department-scoped — the test's bare calls got the designed 400, not a crash). Demo DB (:4000): `professor_open: false` + 403 → UI shows **no toggle**, leader-only form; login shows the new link. Browser: fresh instance shows the toggle with Professor preselected and the "closes as soon as one Professor exists" note; Leader tab reveals the code field and vice-versa; 0 console errors · regressions 21/21 + 25/25 + 32/32 green · `vite build` clean
- **Full entry path now**: fresh host (`ISIGK_DEMO_ACCOUNTS=0`) → first visitor signs up as **Professor** at `/signup` → invite/create the **Leader** → Leader creates **everyone else**

**2026-10-17 — Leader sign-up page, gated by Professor-issued invite codes (user request: "add sign up for the leader")**
- **Why gated**: the platform is public (guests browse), so an open "become Leader" form would let *any visitor on the internet* claim leadership of the club — one line of signup UI vs. the entire trust chain. The compromise: the **Professor still roots the trust**, but the Leader types his own name/email/password instead of the Professor choosing them
- **Server**: `leader_invites` table (code · created_by · expires_at · used_at) + `routes/invites.js` — **POST/GET/DELETE `/api/invites/leader`, Professor-only**: generate an 8-hex code (shown as `XXXX-XXXX`, stored plain — signup normalizes the input, the display formats it), active list, revoke. **`POST /api/auth/signup-leader`** (public): validates fields first (a bad form never burns the code), then the code — single use, 7-day expiry, email uniqueness (409) — creates the leader, **consumes the code, and returns a token** so the new Leader lands straight in the app
- **Client**: login page gained *"Leading the club? Sign up as Leader"* → **`/signup`** (standalone, same card style as login: name, email, password, mono invite-code field) · Members page: Professor sees a second header button **Invite leader** → modal with *Generate a new code*, the list of active codes (mono, expiry date) and revoke · auth context gained `signIn(token, user)` for the direct session
- **Both chains now**: Professor → *Create leader account* (direct) **or** → *Invite leader* → `/signup` (self-registration) → Leader → creates everyone else
- **Verified**: 21/21 signup regression — 403s for member/leader on issue+list · professor issues `XXXX-XXXX` · bad code / missing name / short password / bad email → 400 **without burning the code** · existing email → 409 · valid signup → **201 with role leader + working token** · code reuse → 400 · revoke → 400 · expired (row tampered to the past) → 400 · used/revoked/expired codes vanish from the active list · self-registered leader creates a member (chain runs) · that member logs in · professor's direct path still 201 · demo DB pristine after cleanup. Browser: leader has **no** Invite button · login shows the signup link · professor generates `51B3-D5F5` in the modal → logged out → filled `/signup` → **auto-landed on the Leader dashboard** ("Lead the club") with Create-account powers and no Invite button — 0 console errors, clean `vite build`
- **Fix found by the test**: codes were stored dashed (`AE5E-E9A3`) while signup normalized the input to plain (`AE5EE9A3`) → every lookup missed; store plain, format on read

**2026-10-17 — Onboarding chain: the Professor creates the Leader, the Leader creates everyone else (user request)**
- **Problem**: no endpoint could create an account — every user came from the seed. Request: *"add create leader account and then the leader will create the other members"*
- **Rule (API `POST /api/users`, mirrored on the Members page)**:
  - **Professor → Leader accounts only** — his single write on management (everything else stays read-only): the root of the chain
  - **Leader/Co-Leader → every other account**: Co-Leader, Manager (with department), Member (with department), Guest. A leader attempting `role: leader` gets 403 (*"Leader accounts are created by the Professor"*)
  - **Manager/Member/Guest → 403. No self-registration exists** — `/api/auth` has only login + me
  - Validation matches the role-change rules: name ≥2 chars, email format + **unique (409)**, password ≥6 (bcrypt cost 10), department required for member/manager with **Materials excluded**; the Professor creating a member → 403 (chain, not just validation)
  - Hierarchy protection unchanged: created leaders are undeletable through the API like the seeded one
- **UI (Members page)**: header button — Professor sees **Create leader account** (role locked to Leader, no department field, hint: *"the chain starts with you"*); Leader/Co-Leader see **Create account** (role select Co-Leader/Manager/Member/Guest + department when needed, hint: *"Leader accounts come from the Professor"*); directory footnote explains each side of the chain
- **Verified**: 25/25 chain regression — 403 matrix (guest/member/manager) · professor→leader **201** · professor→member 403 · leader→leader 403 · leader→coleader/manager/member/guest **201** · dept rules 400 (missing, Materials) · duplicate 409 · short password/bad email 400 · every created account logs in with the password its creator set · a created Co-Leader creates a member → **the chain extends** · leader cannot delete the professor-created leader · directory shows the new leader · demo DB left pristine after cleanup. Browser: professor creates "Test Leader Pro" → Leader pill in the directory; leader creates "Test Member UI" (HR default) → appears → removed via the existing Manage-modal confirm; plain member sees **no** button — 0 console errors in every state, clean `vite build`

**2026-10-16 — Off-site backups: monthly Google Drive snapshots + a Storage page with limit alerts (user request)**
- **User proposal**: "I create a drive account and save on it monthly; if it reaches the limit it shows a limit alert on the web, and the leader clears the old images." Offered three shapes — **chosen: "Both — backups now, live storage later"** — Drive holds *backups* today (serving keeps the local signed-URL design), while the storage layer stays isolated so live Drive/R2/B2 serving can swap in during PROD (§10) without touching features
- **Why backups first, not Drive-as-image-host**: Drive image links are unofficial/hotlink-unfriendly and need "anyone with the link" sharing — *weaker* than the signed URLs just built — and pruning files the site still references would break every picture. Here pruning only ever removes **off-site copies**; the live site is never touched. The local `npm run backup` stays the quick-rollback copy, Drive is the off-site copy
- **How**: **rclone** (`winget install Rclone.Rclone`) talks to one **fresh dedicated Google account** (empty = the whole 15 GB belongs to the club). `server/driveBackup.js` stages `club.db` (SQLite online backup) + `uploads/` and `rclone sync`s it to `<remote>/YYYY-MM` — **one snapshot per month**, re-running replaces the month instead of stacking copies. Bookkeeping in new `drive_backups` table (month · path · size) + a `settings` kv (last sync time/status/error)
- **`/storage` page** (sidebar → Overview; Leader/Co-Leader act, **Professor read-only**, API mirrors this): real quota from `rclone about` → usage bar + status line always in **words**, never colour alone (healthy / "Approaching the limit — clear old months" ≥80% amber / "Nearly full" ≥95% red), last-backup time incl. failures, months table (size · files) with **Clear month** (confirm dialog → `rclone purge` + rows) and **Run backup now**
- **Limit alert on the web**: boss dashboard shows an amber/red banner with "Open Storage" when the quota crosses the thresholds; leaders/coleaders also get a notification on crossings and on failed syncs (a silently failing monthly backup is the worst kind)
- **First run**: rclone installed but no account linked → the page shows the exact 4 steps (fresh Google account → install → `rclone config create gdrive drive scope=drive` + `rclone about gdrive:` for the one-time browser login → Run backup) plus the `schtasks` monthly schedule line; `npm run sync-drive` is the CLI entry for the scheduler
- **Config (env, optional)**: `ISIGK_DRIVE_REMOTE` (default `gdrive:ISIGK-Club-Backups`), `ISIGK_DRIVE_TOTAL_BYTES` (quota display override), `ISIGK_DRIVE_WARN_PCT` / `ISIGK_DRIVE_CRIT_PCT` (80 / 95)
- **Verified**: 25/25 storage API regression against a local fake remote (401/403 matrix incl. professor read-only · sync → month folder with club.db + uploads on the "drive" · re-sync replaces, never duplicates · clear purges folder + rows · 400 on double-clear and bad month format). Browser: leader at 82% → amber bar + amber dashboard banner → **Run backup from the UI** (row `2026-10 · 1 MB · 8 files`, "Last backup — ok") → **Clear month** via confirm dialog → empty state; professor view has no action buttons; red `crit` state at 95%; healthy state shows **no** banner (no false alarms); out-of-box setup panel renders all 4 commands — 0 console errors in every state, `vite build` clean, media regression still 32/32

**2026-10-15 — Media storage rework: private files, signed URLs, real cleanup + backups**
- **Problem**: all three uploaders (album photos, feed images, chat attachments) wrote flat into `uploads/` and `express.static('/uploads')` served the folder **with no auth** — a private album photo or a private chat attachment was viewable by *anyone on the internet* with the URL, guests included. Deleting a DB row left the file on disk forever, filenames leaked the original names, and sharing an album photo to the feed stored **the same path in both tables** (one physical file, two owners)
- **Solution (still local disk — right call for a club at this scale; cloud would add accounts/cost for zero benefit)**, all in `server/storage.js`:
  - **`uploads/public/`** = feed images (published content — guests may view them, they're on the public feed); **`uploads/private/`** = album photos + chat attachments, served only through **HMAC-signed URLs that expire after 24h** (`?e=<unix>&s=<sig>`, JWT secret, `timingSafeEqual`). Signed at read time in the API, so the client just renders the URL it receives — works identically on `:5173` dev and `:4000` prod, no cookies/CORS
  - **Random disk filenames** (`timestamp-hex8.ext`) — the original filename is kept in the DB (`messages.attachment_name` new column) for display only; never on disk
  - **No orphan files**: album delete unlinks photo + thumbnail; post delete unlinks its image and clears `album_media.shared_post_id` first (this also fixed a **latent crash**: deleting a shared post hit `FOREIGN KEY constraint failed` and killed the server — the FK clear must run *before* the post delete); **share-to-feed now COPIES the file** into the public tree so album and post own separate files
  - **Thumbnails** (`sharp`): uploads generate an 800px webp preview (`.rotate()` honors EXIF) stored as `album_media.thumb_path`; grids render the thumb, the API signs both paths; legacy rows backfilled. `sharp` is required lazily and skipped silently if unavailable
- **Legacy data**: startup migration (`migrateLegacyUploads`) moves old flat files — posts → public, albums/chat → private; the demo DB's shared-file row was repaired (album got its own copy) and an orphaned test file removed
- **Backups**: `cd platform/server && npm run backup` → `platform/backups/<timestamp>/club.db` (SQLite online `db.backup()`, safe while the server runs) + full `uploads/`. Weekly Windows task command documented in `backup.js` header
- **Verified**: 32/32 media-storage regression — signed URL 200 · no signature 401 · tampered 403 · expired 401 · feed image fetchable with **no auth** · guest still 403 on albums API · upload → private tree + thumb generated · share → separate public copy · post delete → copy gone, album file survives, `shared_post_id` cleared → re-share works · chat attachment signed with original display name (`wiring diagram.png`) · media delete → photo + thumb gone from disk. Browser-tested: member sees the album cover/shot via signed thumb URL, guest sees both published feed images and **no** albums section, chat page renders all rooms — 0 console errors, clean `vite build`. `npm run backup` written (club.db 124 KB + uploads)

**2026-10-15 — Rule change: the Professor can vote on posts (user request)**
- **Old rule**: `canWrite()` in `routes/posts.js` was `role !== 'guest' && role !== 'professor'`, and it gated posting, voting *and* commenting — so the Professor couldn't vote. `PostFeed.jsx` mirrored it with `canInteract`, which disabled the Yes/No buttons and rendered a "Supervisor view — you can't vote or comment" note
- **New rule**: **voting is separated from content authoring**. A new `canVote()` (`role !== 'guest'`) now guards `POST /api/posts/:id/vote`, so the Professor votes like any member; `canWrite()` is unchanged and still blocks him from creating posts and commenting
- **Client** (`components/PostFeed.jsx`): `canInteract` split into `canVote` (Professor included) and `canComment` (Professor excluded) — the buttons enable for him, and the read-only note now says he can vote but not comment
- **Why**: votes are the club's opinion signal, not content creation; the Professor already sees every tally on his dashboard graphs, and being able to vote keeps that honest without loosening authoring rules
- **Verified**: 21/21 permission checks — Professor vote → 200 and the tally moves (yes+1, then switch to `no` with yes reverted, then un-vote restoring the original counts exactly) · guest vote 403 · Professor comment 403 · Professor create-post 403 · member comment 201. Browser-tested on `:4000` as the Professor on the Finance feed: buttons enabled, click → `voted-yes` class + "Yes 0 → Yes 1"; test votes removed from the demo DB

**2026-10-15 — Finance: a sponsor can give GOODS, not only money (user request)**
- **Old model**: the sponsor pipeline had a single `value` (TND) column, so a company donating food, drinks, laptops, print or stand material had nowhere to go — it either got a fake 0 TND or a wrong number in the money total
- **New model** (`sponsors` table, non-destructive migration in `db.js`): `kind` (`money` | `goods`, default `money` so existing rows stay valid) + `details` (free text for what was actually given). `value` stays the money amount
- **API** (`routes/finance.js` `POST /sponsors`): validates per kind — a money sponsor needs `value > 0`, a goods sponsor needs `details`; goods are stored with `value = 0` so they can never leak into a money sum. `GET` returns `kind`/`details`; status changes and delete unchanged; permissions unchanged (Finance manager/leaders write, dept members + bosses read, guests 403)
- **UI** (`components/DeptTools.jsx` `SponsorsLedger`): the Add-sponsor form gets a **Money / Goods** segmented control that swaps the second field — *Amount (TND)* vs *What they give* (with real examples: "20 laptops · meals for the tournament · print & stand material"). The ledger's "Value" column became **Contribution**: money rows show tabular TND, goods rows show a `Package` icon + the description. The header summary now splits honestly: money is summed (`5,000 TND secured`), goods are **counted, never priced** (`+ 1 goods donation`)
- **Also**: the public Finance feed composer nudge updated to "Sponsor — money or goods (…)" (`components/PostFeed.jsx`)
- **Verified in the browser as Amel (Finance Manager) on `:4000`**: Money↔Goods toggle swaps fields and the submit guard follows (amount required for money, description required for goods) → created a goods sponsor ("Delta Foods — meals + drinks for the regional tournament") → it renders with the goods tag and **no TND** → set it to Won → summary became "1 open · 5,000 TND secured **+ 1 goods donation**" (the existing money total untouched) → deleted it and the summary reverted to "1 open · 5,000 TND secured". 0 console errors; clean `vite build`

**2026-10-15 — Media: album cards on the department home page, open to all members (user request)**
- **Old rule**: albums were reachable only inside the Media **private workspace** (`MediaTools`), so only the Media team, bosses and professor ever saw them — other departments' members couldn't open them at all
- **New rule**: `GET /api/media/albums` is now readable by **every logged-in member** regardless of department; **guests stay blocked** (403). Creating albums / uploading / deleting / sharing to the public feed remain manager+leader powers (`canManageDept`), unchanged
- **New surface** (`components/AlbumsGallery.jsx`, rendered from `pages/DepartmentHome.jsx`): a card grid placed **at the top of the Media page, above the public feed** — a cover photo per album (`object-fit: cover`, 16:10, or a placeholder icon when empty), title, description, "N photos · added YYYY-MM-DD", and a header count ("1 photo in 1 album"). Clicking a card expands its photos **inline** (no modal); the private workspace below still holds the management tools, so the page reads public → members → private
- **Permissions cross-checked in the browser as Omar (HR member)** — a member outside Media sees the cards and can open the album, which was the whole point of the request; Media-manager-only controls correctly absent
- **Design**: white surfaces on Mist White, Cool Gray borders, 6px radius, cobalt hover on the title, `.eyebrow.members` in cobalt to sit between the teal *public* and amber *private* eyebrows — no new colours, no card shadows
- **Verified**: 12/12 album permission checks (member/professor/leader 200 · guest 403 · member create 403 · manager create 201); geometry read back off the rendered DOM (2-col grid, 12px gap, 254×338 cards, 253px cover, `object-fit: cover`); albums render above the feed; empty-album placeholder + inline expand + empty state all work; 0 console errors

**2026-10-15 — Rule change: the Professor can send messages in every chat (user request)**
- **Old rule**: Professor read-only in chat — he could write only in the Managers chat (server: `canSend()` in `routes/chat.js`; client: a "Supervisor view" note that hid the composer everywhere else)
- **New rule**: **chat is communication, not management** — the Professor posts in the global, department and private chats like any member. His read-only stance is unchanged for *content management* (creating/deleting posts, commenting, members, calendar, tasks, department tools) — see the entry below for the vote change
- **Server** (`routes/chat.js`): `canSend()` now simply returns `canRead()` — room membership is unchanged, only the write flag. Guests still 403 on every chat route, members still blocked from the managers room and from foreign department rooms, private threads still 1↔1
- **Client** (`pages/Chat.jsx`): the composer renders for everyone who reaches a conversation; the read-only note became a generic defensive fallback ("You can read this conversation but cannot write in it.") — unreachable in practice since guests are routed away from `/chat`
- **Verified**: 14/14 chat permission checks — Professor POST → 201 in all four room kinds (global, managers, `dept:<id>`, private); member → managers 403 (read + write), member → foreign dept 403, guest → global 403 (read + write + room list). Browser-tested on the production build (`:4000`) as the Professor: composer present in the global chat, Send disabled until text, message renders as a cobalt "mine" bubble; 0 console errors. All test messages deleted from the demo DB

**2026-10-15 — Visual identity: light-theme-first engineering brand + chat as a full working surface**
- **Why**: the platform still read as a generic dark admin template (near-black panels, neon-ish accents, pill badges) and the chat sat as a centered 1060px card with dead space around it — it didn't feel like a precision/engineering club tool. Redesign brief: light theme first, one fixed brand palette, engineering-document feel (workbenches, tables, lists, timelines) — explicitly *not* sci-fi (no gradients, neon, glassmorphism, pill badges, circuit-pattern backgrounds, robot art, invented stats)
- **Brand palette as tokens** (`client/src/index.css`): **Ink Navy `#172B4D`** (sidebar, headings, body text) · **Cobalt Blue `#2457C5`** (primary buttons, active nav, links, focus) · **Circuit Teal `#168C88`** (positive/technical accents, used sparingly; text variant deepened to `#0F7A75` for AA) · **Amber `#E7A23B`** (pending/attention; text variant `#8A5A12`) · **Cool Gray `#D8E0EA`** (borders/separators) · **Mist White `#F7F9FC`** (main background) + white content surfaces. Exposed as `--ink/--cobalt/--teal/--amber/--gray/--mist` beside the working aliases (`--bg`, `--surface*`, `--text*`, `--border*`, `--accent*`, `--success/warning/danger`) so no route had to be rewritten
- **Ink Navy sidebar = the only dark plane** (`.sidebar` + scoped `--side-*` tokens): cobalt brand mark with a small inline-SVG `.brand-circuit` trace under the wordmark (the *only* circuit detail in the app), small-caps section eyebrows, cobalt active nav with a solid left bar. Role colours re-darkened so white initials and role text both pass AA; badges and role pills squared (3px) instead of 999px pills; radius cut to 6px/4px; login page gets a faint engineering grid
- **Charts re-palletted** (`components/Charts.jsx`, `ProfessorGraphs.jsx`): `#1e3a8a` → `var(--ink)`, bar accents → `#2457C5`, legend dots from the brand vars — no decorative/invented graphs, real aggregated data only
- **Chat rebuilt as ONE surface** (`pages/Chat.jsx`, `.panel.chat`): a single grid panel = **284px room rail** (head + scrolling rooms/private list, active room = white with a cobalt inset bar) beside the **conversation column** (`.chat-head` with icon/title/role badge + Meet, `.msg-list`, `.chat-foot`). Two separate cards → one tool. Messages **group**: consecutive same-sender messages drop the repeated avatar/name and show the time only on the last one; own messages are cobalt-filled bubbles capped at `min(76%, 620px)` for readability; `.chat-composer` replaced the generic `.composer` (composer class kept for Calendar/PostFeed)
- **Chat covers the page** (user report: *"why is the chat centered, why doesn't it cover the page"*): `Layout` in `App.jsx` adds `page-wide` on `/chat` (drops the shared 1060px measure) and `shell-full` (`height:100vh; overflow:hidden`) so the page itself never scrolls — the rail and the message list scroll *inside* the surface (`.main`/`.page-wide`/`.chat-layout` became flex columns with `min-height:0`, `.panel.chat` uses `flex:1` instead of viewport math). Verified: `scrollHeight == innerHeight`, panel spans the content column top bar → 16px above the fold, ≤820px collapses to one column (rail **or** conversation with a back button)
- **Verified in the browser**: professor read-only footer ("Supervisor view") vs leader composer (Send disabled until text) + `mine` bubble rendering; dashboard/finance/calendar/members spot-checked after the theme flip; 0 console errors; clean `vite build`

**2026-10-15 — Product/UX redesign: role-aware workspace, real Finance ledger, no template filler**
- **Why**: the app read as a generic dark admin dashboard — every block was an equal rounded card, the Finance Manager's real tools (pipeline/budget) sat at the bottom of a ~1200px scroll behind two ~300px empty panels, public/private was an ambiguous "Public page / Private space" pill toggle, and money/votes were under-prioritised. Redesigned around actual workflows, not colours
- **Department page = public feed → private workspace, in one column** (`pages/DepartmentHome.jsx`): dropped the `.grid-2` two-column layout (it collapsed under ~960px and pushed the workspace below the whole feed). Header now states the department's *purpose*; a one-line **scope legend** replaces the pills and explains what is public vs private per role. Public feed (visible to all incl. guests) comes first, then — for members/bosses/professor — a single framed **workspace**
- **The private workspace is ONE surface, not a wall of cards** (`components/ui.jsx` `ToolBlock`, `components/DeptTools.jsx`): dept tools render as flat labelled blocks inside one `.panel.ws`. HR/Events keep in-workspace tabs; **Finance shows pipeline + budget together** (the whole money picture, not hidden behind a tab). Goals/Team/Tasks are compact blocks (empty states are one-liners, not 300px panels)
- **Finance redesigned as a real ledger**: **sponsor pipeline** is a compact table (Sponsor · Value · Status · delete) with a live status select for managers and a real derived summary ("N open · X TND **secured (won)**"); **budget** is a ledger with an Income/Expense/Balance strip (tabular figures, green/red by sign) and a Date/Label/Amount entries table. All totals computed from real rows — no invented numbers. Add-sponsor & add-entry are inline forms
- **Posts are compact & scannable** (`components/PostFeed.jsx`): a labelled "… · public" section head carries the primary *New offer/announcement* action; each post shows a **vote-tally proportion bar** (green/red split + counts), a *who voted* toggle, and a **collapsible comment thread** — instead of an always-open card. Finance composer nudges structured titles ("Sponsor — amount …")
- **Dashboard answers "what needs attention → where next"** (`pages/Dashboard.jsx`): removed the fake stat tiles (e.g. an "Announcements" tile whose value was text) and filler panels ("Quick actions", full team lists). Each role now leads with the **membership-application review queue**, then role-relevant real panels. Professor's outdated "Reports arrive in Sprint 5" empty state → a real **Reports** link + graphs. Team lists became a compact avatar row pointing to the dedicated `/members` directory. Keeps the dark-navy identity but uses small-caps section eyebrows, hairline dividers, tabular money and tables to read as a *tool*, not a template
- **Verified in the browser (0 console errors, clean build)**: Finance CRUD (add/delete sponsor, budget entries) + vote round-trip (vote → tally updates → unvote) as manager & member; read-only guest (vote disabled, workspace hidden, Members removed from nav) & professor (workspace visible, no write controls, badges not selects); department pages HR/Events/Media render the workspace with correct tabs; Professor & Finance-Manager dashboards. Test data cleaned from the demo DB

**2026-10-15 — Sprint 7: Professor dashboard graphs + testing + deployment ✅**
- **Dashboard graphs** (`GET /api/reports/charts`, Professor-only): six real-data charts on the Professor's home — posts per month, chat messages per month (SVG bar charts), members-by-role (donut), tasks-by-status / posts-by-type / applications-outcome (horizontal bar lists). Year selector; hand-rolled SVG charts in `components/Charts.jsx` (no charting library — keeps the bundle lean and the palette on-brand)
- **Charts endpoint** aggregates straight from SQLite (posts/messages by month for the chosen year + role/type/status/outcome distributions); Leader/Co-Leader/Guest blocked (403)
- **Deployment (single process)**: Express now serves `client/dist` when present + an SPA fallback so any non-API GET returns `index.html` (react-router deep links work); API/`/uploads`/`/socket.io` paths are excluded so API 404s stay JSON. Client API base centralized in `api.js` → `BASE` = `http://localhost:4000` in dev, `''` (same-origin) in production; `socket.js`, image/attachment URLs, chat/reports/media uploads all use it. `JWT_SECRET` + `PORT` read from env
- **Full permission regression (28 checks, all pass)**: reports/chats read+write matrix per role, department tool write rules (HR/Events/Media/Finance managers + leaders write, members/guests blocked), posts/vote/comment rules (guest+professor read-only), member management (member/professor cannot promote, leader can with a department). Browser-tested the production build served from `:4000` (login → chat, 0 console errors)

**2026-10-15 — Sprint 6: Media albums · HR · Events · Finance department tools ✅**
- **Department tools injected into each dept's private space** (`components/DeptTools.jsx`, gated by `deptPerms.js`: *manage* = Leader/Co-Leader or that dept's manager; *view* = + members of the dept + Professor; guests blocked). Roadmap panel now only lists sprints not yet delivered
- **HR**: attendance grid per meeting date (Present/Late/Absent, upsert `ON CONFLICT`, summary counts, read-only badges for non-managers) · meeting conclusions (create/delete) · rule-break alerts (member + severity minor/major/critical). Members see their own attendance read-only + the "only the HR manager or leaders can mark" note
- **Events**: itineraries (title + date + step list) and a decoration checklist with click-to-cycle status (todo → in progress → done)
- **Media**: private albums (created by the Media manager/leaders) with image upload (multer, 20MB, images only) → each picture can be **shared to the department's public feed** as a post (`shared_post_id` prevents double-share → 409); other depts get 403 (album privacy)
- **Finance**: sponsor pipeline (lead → contacted → negotiating → won/declined, status select for managers) + budget (income/expense entries with live balance). Published sponsor offers remain on the public feed as posts (Sprint 1)
- All routes API-tested: cross-department write/read 403, guest 403, leader/professor cross-read OK; browser-tested each manager's tools + a member's read-only view (0 console errors)

**2026-10-15 — Sprint 5: Finance module + Professor reports ✅**
- **Reports are Professor-only** (`routes/reports.js`, `requireProfessor`): `GET /api/reports/data` (JSON preview) + `GET /api/reports/pdf` (pdfkit download). Three report shapes — **monthly global**, **full year**, and **per-department** — each aggregating membership, communications (posts/votes/comments/chat), events, tasks, applications for the chosen window
- Events are club-wide (the calendar has no `department_id`), so they count globally in every report; "new members this period" excludes guests to stay consistent with "active members"
- **Client `pages/Reports.jsx`**: period (month/year) + scope (whole club / dept) selectors, live preview cards, and a **Download PDF** button (fetch → blob → save, JWT attached). `/reports` route + nav item are Professor-only (`RequireProfessor`)
- **Finance private tools**: sponsor pipeline + budget tracker (`routes/finance.js`, tables `sponsors` + `budget_entries`) — the Finance manager/leaders write, Finance members + leaders + Professor read, guests 403

**2026-10-15 — Sprint 4: chat + Jitsi video meetings ✅**
- **Four chat levels** (`/api/chat`, `messages` + `chat_reads` tables): **global** (all members) · **managers** (4 managers + Leader/Co-Leader + Professor) · **department** (that dept's members + leaders) · **private 1↔1** (any two non-guests, opened from the Members directory)
- **Professor rules** (README): reads every chat, **writes only in the managers chat** (composer replaced by a "Supervisor view" note elsewhere); Guests blocked from chat entirely (403 + nav hidden)
- **Room access enforced server-side** (API-tested): member cannot read/send in managers (403), cannot read another dept's chat (403), cross-dept assignment impossible; leader/co-leader + professor see all dept rooms
- **Live via Socket.io**: messages pushed to `room:<key>` (group) / `dm:<a>:<b>` (private) on send; unread badges + last-message previews update through a `chat:activity` push to each recipient's room
- **Attachments** (multer, max 15MB): images render inline, pdf/zip/mp4 as file links; professor included in the managers room on connect
- **Video meetings (Sprint 4 test)**: a "Meet" button in group chats opens a live **Jitsi** embed (unique room name per chat, plus an open-in-new-tab fallback)
- **UI**: chat = rooms list (unread badges, previews) + conversation (bubbles, sender names, timestamps, image/file attachments); responsive single-column on mobile; the Members/department "Message" links route into a private conversation
- Fixed: GET /messages now shapes rows to the same `{sender:{...}}` format as POST/socket (was flat, crashed the Avatar); the professor's room list now includes the managers chat (frontend filter bug)
- Demo seed: global/managers/HR-dept conversations + a leader↔member DM; read-pointers set so unread badges start at 0 and grow live

**2026-10-15 — Sprint 3: department tasks + notifications core ✅**
- **Tasks** live in each department's private space (`/api/tasks`): title, description, assignee (dept members only), due date, status todo/doing/done
- **Permissions** (API-tested): read = dept members + leaders + professor (guests 403, cross-dept 403); create/edit/delete = dept manager + Leader/Co-Leader; **members may only move the status of their own tasks** (403 on anything else); assignee must belong to the same department (400)
- **Notifications core** (new table + `/api/notifications` + live Socket.io push): task assigned · task completed (→ creator + dept manager) · new application (→ Leader + Co-Leader + dept manager) · application accepted/refused (→ applicant) · comment on your post (→ author)
- **Socket.io is now authenticated** (JWT verified on handshake, each user joins room `user:<id>`); connection lifetime tied to the auth session (connect on login, disconnect on logout)
- **UI**: bell in the topbar (always visible; slim bar on desktop) with unread badge, dropdown inbox (mark one / mark all read, click = navigate + read), live toast bottom-right; department Tasks panel with status tabs + assign dropdown + checkbox-to-done; dashboards show real "My tasks" + real open-task counts
- Demo seed: 3 tasks (HR doing, Media todo, Events done)

**2026-10-15 — Calendar redesign: month agenda grid (user request)**
- `/calendar` is now a real month agenda: every day of the month is visible (7×6 grid, weeks start Monday)
- Days with events are **marked**: accent dot per event (max 3), bold day number; past events = grey dot; today = accent outline; selected day = highlighted
- Click any day → panel below shows that day's events (title, time, location, author) or an honest "No event on this day" state
- ‹ › month navigation + "Today" button; Leader's "Add date" form pre-fills the selected day
- Guests/members see the full agenda read-only (no add/delete, lock note)

**2026-10-15 — Sprint 2: member management + calendar + applications ✅**
- **Member management** (Leader/Co-Leader only): ⚙ modal on the Members page → change role (guest / member / manager), assign department, remove from club. Protections: cannot touch yourself, Leaders/Co-Leaders/Professor, or roles outside the list (no accidental "new leader"); removing a member who authored posts/comments → clean 409
- **Global calendar** (`/calendar`, new page + nav): Leader/Co-Leader add & remove dates (title, date, time, location, description), everyone else (incl. Guests) views; upcoming/past split; dashboards show "Upcoming dates" from the real API
- **Guest → member applications**: Guests apply from their dashboard (department + message, one pending at a time); Leader/Co-Leader or the department's manager Accept/Refuse; accepted guests become members of that department instantly; history shown with reviewer + status badges; Professor sees the list read-only
- **Auth fix**: `authenticate` now re-reads role/department from the DB on every request → promotions/demotions/removals take effect immediately, no re-login needed
- Professor remains read-only everywhere (403 on manage/remove/review/calendar edits) — enforced & API-tested
- Demo data: 3 calendar dates seeded; application history kept as showcase (Lina applied → accepted → restored to guest for demo)

**2026-10-15 — Sprint 1: announcements + votes + comments** ✅
- Posts on every department public feed: type = announcement / clip (Media) / sponsor offer (Finance)
- **Votes**: Yes/No, 1 per user, changeable (click again = remove), **transparent** (voter names shown under the buttons)
- **Comments** thread on every post; delete for author / Leader / Co-Leader
- **Permissions enforced & tested**: Professor = read-only (no post/vote/comment/delete, 403), Guests = read-only (403 on vote/comment), department members can post only in their own department (403 cross-dept)
- Image upload on posts (max 15MB, png/jpg/gif/webp) served from `/uploads`
- Demo feed seeded: Media clip + Finance sponsor offer with votes/comments
- Decision: **guests and the professor cannot vote or comment** (read the public feed, that's all)

**2026-10-15 — Browser review + usability fixes (v1.2)**
- Fixed hard-refresh bug: app no longer bounces to /login while the session check loads (was losing the user's page on every refresh)
- Added client-side guest guards on /members and /chat (defense in depth with the API 403)
- Signed-in users visiting /login are sent to the dashboard
- Mobile: tables now scroll + hide the department column on small screens (undefined `hide-sm` class fixed)
- Dashboard API failures now show an honest error banner with a Retry button instead of fake "no data" empty states
- Verified live in a browser: login, role dashboards, guest guards, search/filters, click-to-chat, error recovery, department pages — 0 console errors

**2026-10-15 — UI/UX redesign (v1.1)**
- Full frontend redesign: design tokens (deep navy/slate/white/blue accent), one panel/table/list system, lucide-react icons (no emoji navigation)
- Sidebar: grouped nav (Overview / Club / Departments), role-aware links, clear active state, mobile drawer + topbar
- Role-aware dashboards: manager (own dept), leader/co-leader/professor (club overview + goals + per-dept table), member (dept + tasks), guest (public view only)
- Members moved off the dashboard to a dedicated page with search + role/department filters
- Department pages: per-department identity (HR/Events/Media/Finance), private space with honest "arrives in Sprint X" roadmap, Materials = understated Coming Soon
- Private chat redesigned as a proper conversation frame
- Backend untouched; all data from real API; no fake controls

**2026-10-15 — v2 restructure**
- Materials department → "Coming Soon"
- Each department: public home + private space; each has its own tasks
- Professor sees graphs/goals/tasks + downloads reports; can WRITE in managers chat
- Directory hidden from guests; click user = private chat
- 4 chat levels; votes transparent + changeable; leader owns calendar + goals
- Albums private to Media; HR marks attendance manually
- Report frozen until project end; all changes go to this README first
