# 🤖 ISIGK Robotics Club — Management Platform

> **Single source of truth** for the project: idea, roles, features, decisions, tech, how to run, and sprint status.
> The LaTeX report (`rapport/`) is **frozen** until the project ends — it will be updated from this README at the end.

---

## 1. 🎯 Vision

One web platform where the whole club — **Supervisor → Leader → Co-Leader → Managers → Members → Guests** — manages departments, communicates and organizes events. Replaces scattered WhatsApp groups, Excel files and folders.

**Pain points solved:** scattered communication, no member registry, manual event org, untracked materials, invisible finances, no remote collaboration.

---

## 2. 👥 Roles & Permissions

| Role | Powers |
|------|--------|
| **Supervisor** | Sees **everything**: graphs, goals, all department tasks, all chats. **Read-only on management** (no posts/comments, no member edits, no tasks/calendar/department tools) — with **two writes: creating Leader accounts** (the root of the onboarding chain) **and adding further Supervisors** (a club may have several). **Takes part in every chat** like a member and **can vote** on posts. Can **download reports** (monthly / full year / per department) |
| **Leader** | Full control: all departments, all chats, **assigns goals**, **owns the global calendar** (members view only), promotes/removes users, **creates every other account** (Co-Leader, Managers, Members, Guests) |
| **Co-Leader** | Same powers as the Leader — including creating accounts |
| **Manager** (HR / Events / Media / Finance) | Own department: public home content, private space, tasks, his department chat |
| **Member** | Belongs to 1 department: tasks, chats, votes, sees directory |
| **Guest** | Public home pages only: **NO member directory**, limited access |

**"Bosses"** = Supervisor + Leader + Co-Leader → access everything.

### 🔒 Enforcement (server-side, not UI)

Permissions are enforced **in the API**, never by hiding buttons — the client mirrors them only for a clean UI. Standing rules:

- **Role is always re-read from the DB on every request** (JWT carries only `id`); a promotion, department change or removal applies immediately, no re-login, and a tampered token can't inflate a role.
- **No privilege escalation**: public endpoints only ever mint `supervisor` (once, as a new club's founder) — never `leader`/`manager`. Account creation is role-gated (`POST /api/users`: Supervisor → Leader **+ further Supervisors**; Leader/Co-Leader → everyone else; all others 403, and a Leader can mint neither a Leader nor a Supervisor). A signed JWT is **never** trusted for role.
- **No IDOR**: every list/read/write is scoped to the caller's role, department and ownership (calendar edits = Leader/Co-Leader, tasks/hand-offs = dept managers, reports = Supervisor, private uploads = HMAC-signed URL holders), so changing an `:id` in the URL cannot reach another department's or user's data.
- **Calendar**: readable by every **authenticated** member (guests included — they're club members); anonymous callers get 401. Writes are Leader/Co-Leader only.
- **Auth hardening**: `JWT_SECRET` is required in production (fail-closed → auth routes answer 503 rather than fall back to a public default); login and sign-up are **rate-limited** per IP (+ per IP/email); passwords are bcrypt(10); directory/API responses never include password hashes.
- **CORS** is an explicit allowlist (`CORS_ORIGIN`, comma-separated) plus localhost in dev — a fixed `corsCheck` signature means no accidental `Access-Control-Allow-Origin: *`; baseline security headers (`nosniff`, `X-Frame-Options`, `Referrer-Policy`) ship on every response.
- **Uploads** are validated by extension allowlist + random on-disk names; public feed images are served directly, private album/chat files only behind 24h HMAC-signed URLs.

**Multi-club — create the club, or sign into one (no free role escalation).** One install hosts **many clubs**; every piece of club data is scoped by `club_id` and a signed-in user only ever sees **their own** club. The first page (**Sign in** / **Create a club**) lets **anyone create their own club**: `POST /api/auth/create-club` (public **`/signup`** page) creates the club, gives it its five starter departments, and makes the founder its **first Supervisor** — this grants no power over any *other* club. Inside a club, accounts are created only on the chain **Supervisor → Leader → everyone else** (Members page · API `POST /api/users`); the club starts with a single Supervisor, and any existing Supervisor can **add further Supervisors** (a club may have several) — a Leader can create neither. There is no public path to a role inside an existing club.

**Home feed.** The landing page (**`/`**, *Home*) is the club's feed: **every department's posts in one newest-first timeline** (`GET /api/posts/feed`). Posts still belong to a department (each card links to it, and the department page shows the same posts), so the composer on Home asks which department the post goes to — limited to the departments you may publish into. The dashboard moved to **`/dashboard`**.

**Post types & reactions.** A post is one of four **types** — **text**, **image**, **video** or **poll** (`posts.type`); image/video posts carry a file in the public tree, a poll carries 2–6 options. Every post takes a one-per-member **reaction: Yes / No / Maybe** (`votes.value`, changeable, transparent), and polls additionally take **one option per member** (`poll_votes`). Comments stay as before. Posting, reacting and poll-voting are enforced server-side (guests are read-only; the Supervisor reacts but does not post).

**Meetings.** `/meetings` lists the live rooms (club-wide, a department, or private). **Only leadership may start one** (Supervisor, Leader, Co-Leader, department Manager); a plain member or a guest is refused. Anyone who can see a meeting may **ask to join** — and *asking is not joining*: the row stays `pending` until the **host** accepts (`origin` distinguishes a person the host **invited**, who answers their own invite, from someone who **requested**, whom only the host may admit). Several meetings run at once, each with its **own chat** that only accepted participants may read or post (`meeting_messages`); ending a meeting closes the chat but keeps the transcript readable. Every action is club-scoped, and a non-participant never sees the chat preview or unread count.

---

## 3. 🏢 Departments

| Dept | Public home page shows | Private space (members only) |
|------|------------------------|------------------------------|
| **HR** | Announcements + **photo album** | Meeting conclusions, **manual attendance**, rule-break alerts, tasks |
| **Events** | Announcements + **photo album** | **Event itinerary/journey**, decoration planning, tasks |
| **Media** | Clips for social media with 👍/👎 vote + comments + **photo album** | Album/photo management (create, upload, share to public), tasks |
| **Finance** | **Sponsor offers** (money **or goods**) with vote + comments + **photo album** | Sponsor pipeline (money/goods), budget/expenses, tasks |
| **Materials** | ⏳ **Coming soon** | — (deferred to PROD) |

Each department = **public home page** (like a profile, visible to everyone incl. guests) + **private space** (chat + tasks, members + bosses only).

**Photo albums.** *Every* department also has its own album(s) on its home page — **any club member can browse them** (guests excluded); that **department's own manager** (and club leaders) create albums, upload/delete pictures and share a picture to that department's public feed. See §7.

---

## 4. 💬 Chat rules

| Chat | Who participates |
|------|------------------|
| 💬 **Global** | Everyone (all roles), **Supervisor included** |
| 👔 **Managers** | 4 Managers + Leader + Co-Leader + Supervisor |
| 🏢 **Department** | Members of that department + Leader/Co-Leader + Supervisor |
| 🔒 **Private 1↔1** | Two users — opened by **clicking a member in the directory** |

**Anyone who can open a chat can write in it — the Supervisor chats like any member** (his read-only rule applies to *content management*: creating posts, commenting, tasks, members, calendar, department tools — he can still **vote**). Chat supports **file & image attachments**. Bosses see all chats.

---

## 5. 🗳️ Votes, Calendar, Goals, Reports

- **Votes (on home-page posts):** Yes/No, **1 per user**, **changeable** anytime, **transparent** (everyone sees who voted what). Available to **every member, Supervisor included** — guests can't vote. Posts also have **comments** (members only).
- **Global calendar:** only the **Leader** adds/edits event dates; **members view only**.
- **Goals:** the **Leader assigns goals** to each department (shown on the department home page).
- **Supervisor reports:** from the calendar he downloads the **monthly global report** and the **full-year report**; from each department he downloads that **department's report**.

## 6. 👥 Members directory

- Visible to **all users except guests** (guests see a locked notice).
- **Clicking a member opens a private chat** with him.

## 7. 🖼️ Albums (every department)

- **Every department has its own album(s)**, shown as cards at the top of its **public home page** (`GET /api/media/albums?department_id=…`).
- **Browsable by every club member**; **guests excluded** (403).
- **Managed** by that department's manager **and club leaders** — create an album, upload pictures, delete a picture or a whole album, and **share a picture to that department's public feed**.
- Pictures are stored privately (`uploads/private`) and served only through 24h **signed URLs**; "share to feed" **copies** the file into the public tree as an `image` post of that department.
- Legacy: calling the endpoint **without** `department_id` still targets the **Media** department.
- Purpose: each team keeps its own photo record — the Media team, for instance, reviews clips/photos here before publishing.

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
- **Supervisor dashboard**: graphs, goals, tasks, **reports** (monthly/yearly/department)
- In-app notifications

## 10. ⏳ PROD (later)

Materials inventory & loans · video meetings (Jitsi test) · email/Telegram alerts · kanban board · member dues · purchase requests · sub-channels · post-event reports · social planner · FR/EN · notification preferences

---

## 11. 🛠️ Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | React 19 + Vite (light theme — engineering brand), react-router-dom |
| Backend | Node.js + Express 5 |
| Database | SQLite via **@libsql/client** — same code on a local file (`file:club.db`) or **Turso** online (`TURSO_URL` + `TURSO_AUTH_TOKEN`) |
| Real-time | Socket.io (in-memory adapter locally; Redis adapter + Upstash on Vercel) |
| Auth | JWT + bcryptjs — role re-read from the DB on every request, fail-closed `JWT_SECRET`, login/sign-up rate limiting (`middleware/rateLimit.js`) |
| Uploads (Sprint 2+, reworked 2026-10-15) | multer → local `uploads/public`+`uploads/private`, or **Vercel Blob** on the hosted build (`BLOB_READ_WRITE_TOKEN`) · feed images guest-viewable · album photos & chat attachments behind 24h HMAC-signed URLs · `sharp` thumbnails · client re-encodes images >3.5 MB (max 2048 px WebP) |
| Backups (2026-10-16) | `npm run backup` → local `platform/backups/` · monthly snapshot on **Google Drive** — rclone locally, pure-Node Drive REST on Vercel (`driveClient.js`, service account or `drive-auth.js` refresh token) · daily Vercel Cron runs it once a month · Storage page `/storage` with quota-limit alerts (amber ≥80%, red ≥95%) |
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
            ├── theme.jsx         # light/dark + reduced-motion (localStorage)
            ├── api.js            # fetch helper w/ JWT
            ├── roles.js          # role/dept labels, colors, icons
            ├── components/ui.jsx # Avatar, RolePill, Panel, EmptyState…
            └── pages/            # Login, Signup, Terms, Feed (Home), Dashboard, Settings, Members, DepartmentHome, Chat, Meetings, MeetingRoom…
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

**Production env:** `JWT_SECRET` → **required** (a long random string; without it the server refuses to authenticate — auth routes answer 503 instead of falling back to a forgeable default) · `ISIGK_DEMO_ACCOUNTS=0` → *no demo accounts/content are seeded* (real install: **no club at all** until the first visitor opens `/signup` and **creates the club** — they become its Supervisor — then builds it) · `DB_PATH` → where `club.db` lives (default: `platform/server/club.db` — point it at your persistent disk) · `PORT` · `CORS_ORIGIN` → comma-separated extra allowed browser origins (optional; same-origin deployments need nothing) · `CRON_SECRET` → guards the backup cron (Vercel).

### ☁️ Hosted club — Vercel (recommended: works everywhere, no PC to keep on)

The site is a single Vercel project: the Express API (with Socket.io) as a serverless
function + the built React client as static files. One-time setup (~15 minutes):

1. **Import the repo** on vercel.com → *Add New → Project* → `med-tlili/robotic_club`
   (the root `vercel.json` already knows how to build both halves).
2. **Databases & stores** (Vercel Marketplace → each installs into the project):
   * **Turso** (hosted SQLite) → sets `TURSO_URL` + `TURSO_AUTH_TOKEN`
   * **Vercel Blob** → sets `BLOB_READ_WRITE_TOKEN` (all uploads land there)
   * **Upstash Redis** → sets `REDIS_URL` (live chat across server instances)
3. **Environment variables** (Project → Settings → Environment Variables):

   | Variable | Value |
   |----------|-------|
   | `ISIGK_DEMO_ACCOUNTS` | `0` (no public demo accounts on the real club) |
   | `JWT_SECRET` | a long random string — **required**; without it auth answers 503 (fail-closed) |
   | `CRON_SECRET` | another long random string (guards the backup cron) |
   | `CORS_ORIGIN` | *optional* — comma-separated browser origins if you serve the client from a different domain |
   | `ISIGK_DRIVE_SA_JSON` *or* `ISIGK_DRIVE_CLIENT_ID`+`ISIGK_DRIVE_CLIENT_SECRET`+`ISIGK_DRIVE_REFRESH_TOKEN` | Google Drive backups — see below |

4. **Deploy** → open the URL → **`/signup` → Create your club** (you become its Supervisor) → the Leader and the rest of the club follow (same chain as self-hosting). Anyone can create their *own* club; it never grants access to another.

**Drive backups on Vercel** (rclone can't run there — the API talks to Drive directly):
create a Google Cloud project → enable the **Drive API** → either a *service account*
key (share your `ISIGK-Club-Backups` folder with its email, paste the JSON as
`ISIGK_DRIVE_SA_JSON`) **or** an OAuth *Desktop app* client — then run
`cd platform/server && node drive-auth.js` once locally, paste the printed refresh
token into the env vars. The Storage page's setup panel shows the same steps.
A daily Vercel Cron checks "is this month backed up yet?" and runs the push once
a month (Hobby plans allow daily crons only — the handler skips the other days).

Notes: uploads over ~4.5 MB are rejected by Vercel (the app re-encodes large images
automatically; keep videos small) · live chat works through the Redis adapter ·
the hosted database is backed up to Drive monthly; everything is restoreable from
`club-export.json` + the uploads tree.

### 🖥️ Self-host (own machine or school server)

```bash
git clone https://github.com/med-tlili/robotic_club.git
cd robotic_club/platform/server
npm install        # API dependencies (libsql + sharp ship prebuilds)
npm start          # production mode: no demo data, JWT secret generated once → .jwt-secret
```

That's it — the UI build (`client/dist`) is committed. Then:

1. Open the site → **`/signup`** → **Create your club** (club name + your details) → you are its **Supervisor**
2. As Supervisor: **Members → Create account** → role **Leader** (or add another **Supervisor** to share the role)
3. As Leader: create everyone else and start using the club

Notes: the database and `uploads/` appear next to the server on first run — **back them up** (the Drive panel does this automatically once rclone is configured on the host) · the server serves the API + the UI on one port (`PORT`, default 4000) · rebuild the UI only after changing client code: `cd platform/client && npm install && npm run build`. Local demo with seeded accounts: `npm run start:demo`.

### 📡 No hosting? YOUR PC is the server (members connect over WiFi)

Every member can use the site from their own computer/phone **on the same network** (school or home WiFi) — no cloud host needed:

1. **Start it** — double-click `START-SERVER.bat` in the project folder (first run installs dependencies, then the server starts and prints `📡 Club members open: http://…:4000`). Leave that window open.
2. **Firewall (once, as Administrator):**
   ```powershell
   New-NetFirewallRule -DisplayName "ISIGK Club - port 4000" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Any
   ```
3. **Members open** the printed address, e.g. `http://192.168.1.11:4000` (find it anytime with `ipconfig` → *IPv4 Address* under your WiFi adapter).

Rules of this mode:
- Your PC must be **on with the server window open** while others use it.
- The IP is assigned by your router and can change after a reboot → in the router's **DHCP settings, reserve** the address for this PC so the club link never breaks.
- Everyone must be on the **same network**. Members at home on mobile data/other WiFi can't reach it directly — if the club needs that, add a tunnel (Tailscale gives every member a fixed private address for free; Cloudflare tunnel gives a public link). Ask and it can be wired up.

## 14. 🔑 Demo accounts (password: `password123`)

| Email | Role |
|-------|------|
| supervisor@isigk.tn | Supervisor |
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
| `/api/auth/login` | POST | anyone (rate-limited) |
| `/api/auth/create-club` | POST | **anyone** — creates a NEW club and makes you its first Supervisor (rate-limited) |
| `/api/auth/me` | GET | logged in |
| `/api/users` | GET | logged in, **not guest** |
| `/api/users/me` | PATCH | logged in — edit **own** name + bio |
| `/api/users/me/password` | POST | logged in — change **own** password (current required) |
| `/api/users/:id` | GET | logged in, **not guest** |
| `/api/users` | POST | Supervisor → Leader **+ Supervisor** · Leader/Co-Leader → everyone else |
| `/api/departments` | GET | logged in — the departments **of your club** |
| `/api/departments/:slug` | GET | logged in — your club's department (member list decided server-side by role) |
| `/api/departments/:slug/private` | GET | department members + bosses |
| `/api/events` | GET | **any authenticated member** (guests included) — anonymous 401 |
| `/api/events` | POST | Leader / Co-Leader |
| `/api/posts/feed` | GET | logged in (guests included) — **the club home feed**: every department's posts, `?limit=20&before_id=` |
| `/api/posts?department_id=` | GET | logged in — one department's feed |
| `/api/posts` | POST | dept members / Leader / Co-Leader — `type` = `text` \| `image` \| `video` \| `poll` |
| `/api/posts/:id/vote` | POST | logged in, not guest — reaction `yes` \| `no` \| `maybe` |
| `/api/posts/:id/poll-vote` | POST | logged in, not guest — one poll option per member |
| `/api/posts/:id/comments` | POST | dept members / Leader / Co-Leader |
| `/api/meetings` | GET | logged in, not guest — the meetings you may see (live first) |
| `/api/meetings` | POST | **leadership only** (Supervisor / Leader / Co-Leader / Manager) — `scope` = `global` \| `department` \| `private` |
| `/api/meetings/:id` | GET | logged in, not guest — must be visible to you |
| `/api/meetings/:id/join` | POST | logged in, not guest — asks the **host** to let you in |
| `/api/meetings/:id/requests/:userId` | POST | the **host** accepts/declines a request |
| `/api/meetings/:id/respond` | POST | an **invited** person accepts/declines their own invite |
| `/api/meetings/:id/invite` | POST | the **host** invites members |
| `/api/meetings/:id/leave` · `/end` | POST | a participant leaves · the host ends |
| `/api/meetings/:id/messages` | GET · POST | **accepted participants only** (the meeting chat) |
| `/api/media/albums?department_id=` | GET | logged in, not guest — a department's albums (default: Media) |
| `/api/media/albums` | POST | that department's manager or a club leader — `department_id` + title |
| `/api/media/albums/:id/media` | POST | ditto — upload a picture (multipart `file`, ≤20 MB, images only) |
| `/api/media/albums/:id` · `/media/:id` | DELETE | ditto — delete an album (+ files) · delete a picture |
| `/api/media/media/:id/share` | POST | ditto — share a picture to that department's public feed |
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
| **S7** | Supervisor dashboard graphs + testing + deployment | ✅ **DONE** (2026-10-15) |
| **PROD** | Features of §10 | ⬜ |

---

## 17. 📜 Decisions log

**2026-10-18 — SETTINGS · DARK/LIGHT MODE · POLICY & TERMS (phase 7)**
- **Light & dark themes.** The whole UI is token-driven, so dark mode is a single `:root[data-theme="dark"]` token block in `index.css` (surfaces, text, borders, accent/status, sidebar, role tints) — **no component knows which theme is active**. Two new tokens keep fills legible on a brighter dark palette: `--on-accent` (the text that sits *on* a filled accent/status control) and `--avatar-ink` (the initial on a role-tinted avatar). A few hard-coded `var(--ink)` / `var(--cobalt)` **text** colours were switched to the themeable `--text` / `--accent` so nothing disappears on a dark surface.
- **A tiny theme store** (`src/theme.jsx`): the choice is `system | light | dark`, kept in `localStorage` and applied as `<html data-theme>`; `initTheme()` runs in `main.jsx` **before first paint** (no flash), and on “system” it follows the OS live. A **top-bar Sun/Moon toggle** switches instantly; the full control lives in Settings.
- **Settings page** (`/settings`, `pages/Settings.jsx`, nav item for everyone): **Appearance** (System / Light / Dark cards), **Accessibility** (a `Reduce motion` switch → `<html data-motion="reduced">`; the CSS also honours the OS `prefers-reduced-motion`), **Account** (name / email / role / club + a link to the profile editor) and **Policies**.
- **Policy & Terms** (`/terms`, `pages/Terms.jsx`) is a **public page** (no login needed, so `/login` and `/signup` link to it): Terms of Service, Acceptable Use, and a Privacy section stating plainly what is stored — bcrypt password hashes, club-scoped content, signed private links, the session token.
- **Verified**: `vite build` clean · `oxlint` **0 errors** · live preview on a throwaway demo DB — the login page is light by default, `/terms` renders while signed out, the Settings cards + switch work, choosing **Dark** flips the tokens (`body` `#0f1729` / text `#e6ecf7`, panels `#18213a`, sidebar `#0b1220`), survives a reload, role pills and avatar initials stay readable, and the top-bar toggle + motion switch both persist (device left on **System**) — **0 console errors**. No server/API change, so the suite stays **61/61**.

**2026-10-18 — DEPARTMENT PHOTO ALBUMS (phase 6)**
- **Albums are no longer Media-only.** `routes/media.js` is now department-parameterised: every endpoint resolves its target department from `department_id` (query on GET, body on POST) and, for backwards compatibility, **defaults to the club's Media department** when omitted — so the existing `/media/*` calls and their tests keep working unchanged.
- **Who may do what**: any club member may **browse** a department's albums (guests → 403); only **that department's own manager or a club leader** may create an album, upload/delete a picture or an album, or **share to the feed** (`canManageDept` on the album's own department). Every id is resolved through a `JOIN departments … club_id` filter, so a foreign album/department answers **404**.
- **New endpoint** `DELETE /api/media/albums/:id` removes an album **and unlinks every picture's files** (rows cascade). Sharing now creates the `image` post in the **album's** department instead of hard-coded Media.
- **Client**: `AlbumsGallery` takes a `dept` prop and renders on **every** department home page; the workspace tool was renamed **`MediaTools → AlbumTools`** and is shown for every department (create / upload / delete picture / delete album / share). A small `isigk:albums` window event keeps the public gallery in sync with the workspace after any change.
- **Verified**: **61/61** server tests green (new **`albums`** suite — per-department scoping, manager/leader-only management, browsing + guest 403, upload → share-to-feed + double-share 409, picture/album delete, cross-club 404) · live preview: created an album as the HR manager, uploaded a PNG through the UI and watched the public gallery update **live** (signed cover URL, "1 photo in 1 album"), confirmed Media/Finance show their own galleries and a guest sees none — 0 console errors · `vite build` clean · `oxlint` 0 errors.

**2026-10-18 — SECURITY FIX · `GOALS` WAS NOT CLUB-SCOPED**
- `routes/goals.js` predated multi-club: `GET /api/goals` **without** a `department_id` returned **every club's goals**, and both `GET ?department_id=` and `POST` accepted **any** department id — a cross-tenant read **and** write. Fixed with `deptPerms.deptInClub()`: a foreign/unknown department answers **404**, and the no-filter listing is now joined through `departments` and filtered by the caller's `club_id`. Regression test added to the **permissions** suite (a second club reads **zero** goals and cannot read or write into the first club's department).

**2026-10-18 — MEETINGS (phase 5)**
- **New tables**: `meetings` (title, description, `scope` = `global | department | private`, `department_id`, `started_by`, `status` = `live | ended`), `meeting_participants` (unique per meeting+user, with `role` host/participant and `origin` **host | invited | requested**), `meeting_messages` (the per-meeting chat) and `meeting_reads` (unread pointer). All are new + club-scoped, so **no legacy migration** was needed.
- **Only leadership starts a meeting**: Supervisor, Leader, Co-Leader or a department Manager (`POST /api/meetings`, 403 otherwise; guests 403 everywhere). Creating announces the meeting to the right audience — every non-guest for `global`, the department + bosses for `department`, the invitees for `private`.
- **Joining is approved by the host** — the core rule. `POST /:id/join` only creates a **requested / pending** row; it never grants access. The host accepts/declines via `POST /:id/requests/:userId`. The `origin` column is what closes the obvious hole: an **invited** person answers their own invite (`POST /:id/respond`), but a **requested** person calling `respond` is refused (403) — *you cannot let yourself in* (regression-tested).
- **Visibility is server-side**: `global` → any non-guest in the club; `department` → that department's members plus the bosses; `private` → only host + invited. A foreign or non-visible meeting answers **404** (no existence leak), and club isolation is asserted.
- **Per-meeting chat**: only accepted participants (or the host) may `GET`/`POST /:id/messages`; a pending or outsider is 403. Ending a meeting stops posting but keeps the transcript readable. Live pushes use the existing socket (`meet:activity` for list/participant changes, `meet:message` for the chat, delivered to each participant's `user:<id>` room).
- **Privacy fix**: the last-message preview and unread count are only computed for people who may read the chat — a pending/outsider sees neither (regression-tested).
- **Client**: `pages/Meetings.jsx` (list + a leadership-only create form with scope + invite chips) and `pages/MeetingRoom.jsx` (people, host request queue, invite, optional Jitsi video with a **deterministic** room name, and the meeting chat). Nav gains **Meetings** for non-guests; routes are wrapped in `RequireMember`.
- **Verified**: **55/55** server tests green (new **`meetings`** suite — creation rules, request→accept→chat, department visibility, private invite/accept, invite + leave, and cross-club isolation) · live preview on a throwaway demo DB: the list card showed the host/scope/live state, the room showed participants + the host request queue, the request was accepted and a chat message posted, a plain member could chat while a non-participant got 403 on read/post and could not self-accept — 0 console errors · `vite build` clean · `oxlint` 0 errors.

**2026-10-18 — POST TYPES + YES/NO/MAYBE REACTIONS (phase 4)**
- **Post types are now the *media kind*: `text | image | video | poll`** (`posts.type`; the old `announcement/clip/offer` labels are gone). `posts` gained a `video` column; image/video posts store their file in the public uploads tree, poll posts store **2–6 options** in a new `poll_options` table. The DB `CHECK` on `posts.type` is baked in, so a legacy `posts` table is **rebuilt once** (ids preserved) with the old labels folded: a post that had an image → `image`, otherwise `text`.
- **Reactions replace Yes/No votes: `yes | no | maybe`** on every post (`votes.value`), still one-per-member, changeable (click again = remove) and transparent (who reacted). The `votes` `CHECK` is rebuilt once to admit `maybe`.
- **Polls** are their own post type: one choice per member, changeable, in a new `poll_votes` table (`UNIQUE(post_id, user_id)`); options and votes cascade on delete. `POST /api/posts/:id/poll-vote`.
- **Server-enforced**: guests are read-only (no post, reaction, poll vote or comment); the Supervisor reacts but does not post/comment; only a department's members or Leader/Co-Leader may post (to their own department, or any active department for leaders). A wrong-type file is refused (`image`/`video` need the matching file, `text` refuses one).
- **Composer** (shared by Home and the department page) now picks a **type** (Text / Image / Video / Poll); polls get an option editor, image/video get a file picker (video: mp4/webm).
- **Verified**: **48/48** server tests green (new: reaction change Yes→Maybe, poll create/vote/change/un-vote/refusals, media-must-match-type, and the legacy-DB rebuild proving `maybe` + `poll` are accepted after migration) · live preview on a throwaway demo DB: the poll card rendered its options with live counts and a changeable vote, reactions showed Yes/Maybe/No, the composer exposed the four types, a UI-published post appeared instantly, and a video post rendered a `<video>` element — 0 console errors · `vite build` clean · `oxlint` 0 errors.
- **Caveats**: video uploads via the API are capped at 50 MB, but **Vercel's serverless body limit (~4.5 MB) means large videos need a direct-to-Blob flow** — self-hosting is unaffected. Only the Media "share to feed" reuses the old pipeline (it now creates an `image` post).
- **Superseded**: the earlier "announcements / clips / sponsor offers" post taxonomy (see the 2026-10-1x entries below).

**2026-10-18 — HOME FEED (phase 3: "everything the club posts")**
- **New landing page: `Home`** (`pages/Feed.jsx`, route **`/`**). It shows **every department's posts in one newest-first timeline** — the club-wide feed — instead of a per-department list. The old dashboard moves to **`/dashboard`** (the sidebar now reads **Home · Dashboard · My profile**).
- **New endpoint `GET /api/posts/feed`** (`?limit=20&before_id=`): joins `posts → departments` and filters by the caller's `club_id`, so it can only ever return the caller's club. Cursor-paginated by post id for stable paging. Readable by anyone signed in (guests included), like any feed; each card carries its **department** and links to the department page.
- **Posting from Home**: the composer is reused as-is (`components/PostFeed.jsx` now exports `PostCard` + `Composer`); a **department picker** lists only the departments the user may publish into (Leader/Co-Leader → any active department; Manager/Member → their own) — the server still enforces the rule. Post types and the Yes/No/Maybe reaction change are **phase 4**.
- **Verified**: **45/45** server tests green (new: the feed aggregates several departments, is 401 anonymous, is readable by a guest, paginates by cursor, and is **isolated per club** — a brand-new club's feed is empty) · live preview on a throwaway demo DB: Home rendered both demo posts (Finance + Media) with their department chips and Yes/No votes, the composer listed the 4 active departments, and the guest view showed the read-only banner with votes disabled — 0 console errors · `vite build` clean · `oxlint` 0 errors.
- **Not yet done (next)**: making a post *without* choosing a department, the richer post types (image / video / poll / text), **Yes / No / Maybe** reactions, and a true infinite scroll.

**2026-10-19 — PLURAL SUPERVISORS (user request: "clubs can have multiple supervisors")**
- A club may now have **more than one Supervisor**. `POST /api/users` lets an existing Supervisor create **Supervisor** accounts in addition to the **Leader** (`allowed = ['supervisor','leader']`); the old blanket `role === 'supervisor'` rejection was removed, so a Supervisor sending `role: supervisor` now succeeds (**201**).
- **No escalation path is opened.** Only a Supervisor can mint a Supervisor; a Leader/Co-Leader still gets **403** (the role is now a *known* role, so the answer is the accurate "your role may not create this" 403 rather than the previous 400 "unknown role"), and public registration still mints nothing but the club founder's first Supervisor. `PATCH /api/users/:id/role` is unchanged — Supervisor is **not** a valid target, so nobody can be *promoted* into it either.
- **Client (Members page)**: the Supervisor's create modal now offers **Leader** or **Supervisor** (was a role locked to Leader), the header button reads **Create account**, and the footnote explains "creating the Leader and further Supervisors".
- **Verified**: **61/61** server tests green — the `signup_chain` suite gains "a supervisor adds a co-supervisor → 201, same club, can log in" and now asserts a Leader → Supervisor attempt → **403** · `vite build` clean · `oxlint` 0 errors.
- **Known limitation**: a Supervisor still cannot be **demoted or removed** — like the Leader/Co-Leader they are protected from `PATCH …/role` and `DELETE /api/users/:id`. Peer removal would need FK cleanup across meetings/notifications and is not implemented.

**2026-10-18 — MULTI-CLUB FOUNDATION + CREATE-THE-CLUB (user decision: "many clubs")**
- **One install = many clubs.** New `clubs` table; a `club_id` now scopes `users`, `departments`, `events`, `messages`, and the department-tool tables (`attendance`, `meeting_notes`, `alerts`, `itineraries`, `decorations`, `sponsors`, `budget_entries`). Everything else is reachable through a department or a user and is filtered by the caller's club. `departments.slug` is now unique **per club** (`UNIQUE (club_id, slug)`) so two clubs may both have an `hr`.
- **First page = Sign in / Create a club.** `POST /api/auth/create-club` (public `/signup`) creates a club + its five starter departments and makes the founder its **first Supervisor**; it grants no power over any other club. Replaces the old one-time `signup-supervisor` bootstrap (which is **removed**). Inside a club, accounts are still only created on the **Supervisor → Leader → everyone else** chain (`POST /api/users`); plural Supervisors are the **next step** (today the club has exactly one).
- **Tenant isolation is enforced server-side**: `authenticate` now carries `club_id`; every list/read/write adds a club filter, department lookups go through `deptPerms.getDept(slug, clubId)` / `deptInClub(deptId, clubId)`, users/applications/tasks/reports are club-scoped, and chat socket rooms are namespaced `room:<clubId>:<key>` so two clubs never share a `global` room. A foreign-club row looks like a 404, never a 403 detail.
- **DB migration (additive, id-preserving)**: `departments` is rebuilt **once** to add `club_id` + per-club slug (every id kept); `club_id` columns are added where missing; then, on a database that has data but no club yet, all rows are **folded into a single default club** ("ISIGK Robotics") and the club points at its first Supervisor. No-op on a fresh or already-migrated database.
- **Demo / dev**: a fresh install with `ISIGK_DEMO_ACCOUNTS` builds one demo club (its own departments + the `password123` accounts). Production (`ISIGK_DEMO_ACCOUNTS=0`) builds **no club** — the first visitor creates it.
- **Verified**: **43/43** server tests green across seven isolated suites (incl. two-club isolation, cross-club `PATCH /users/:id` → 404, and a dedicated legacy-migration suite) · a synthetic **legacy** database migrated with ids preserved, a legacy post still resolving, and a second club reusing the `hr` slug · `vite build` clean · `oxlint` 0 errors.

**2026-10-18 — ROLE RENAME: `professor` → `supervisor` (user decision)**
- The top role — the club's founder/overseer — is now **Supervisor** (previously *Professor*). Renamed across the **database, API, server permissions, the client and these docs**; the demo account is `supervisor@isigk.tn` (`password123`), the bootstrap endpoint is `POST /api/auth/signup-supervisor`, the dashboard-graphs component is `SupervisorGraphs.jsx`, and the CSS token is `--role-supervisor`.
- **DB migration (additive, id-preserving)**: `db.js` detects the old `CHECK(role IN ('professor',…))` and rebuilds the `users` table **exactly once** — every id/column preserved, existing `professor` rows folded into `supervisor`, foreign keys suspended for the swap and restored after. It is a **no-op on a fresh database** and on an already-migrated one.
- **Behaviour is unchanged in this step**: the Supervisor keeps the old Professor's powers (read-only on management, single write = creating the Leader, votes + chats like a member). Making Supervisors **plural** and giving them club-creation powers belongs to the **multi-club** phase below.
- **Target product agreed (roadmap)**: many clubs per site · first-run **create-the-club** wizard (founder becomes its first Supervisor) · Facebook-style **home feed** aggregating everyone's posts · post types **image / video / poll / text** with **Yes / No / Maybe** reactions · first-class **meetings** (named video rooms + join-approval + meeting chat, started by leadership only) · department albums · **Settings + dark/light mode + Policy & Terms**.
- **Verified**: 37/37 server tests green after the rename · a legacy-schema database migrated with **id preserved, role folded, child foreign key intact, new value accepted** · `vite build` clean · `oxlint` 0 errors.

**2026-10-18 — SECURITY HARDENING + PROFILE MANAGEMENT (build hardening pass: real tests, one-time bootstrap restored, permission/IDOR review)** *(the one-time supervisor bootstrap described here was later replaced by the create-club flow — see the multi-club entry above; the rate-limit/headers/profile work still stands)*
- **Supervisor sign-up reverted to the ONE-TIME bootstrap** — supersedes the 2026-10-17 *"open, always"* entry below (user had second thoughts once the public-URL risk was spelled out). `/signup` now works **only while the club has zero supervisors**; after that `POST /api/auth/signup-supervisor` answers **403** on every database, forever. A race guard drops the losing account if two requests pass the check at once, so "exactly one bootstrap supervisor" holds. README §2/§15 updated; the client shows the "already has a Supervisor" panel on a 403. **Rationale**: the root of the trust chain must not be claimable by any internet visitor — privileged roles only via Supervisor → Leader → everyone else.
- **Profile management added** (was the last missing required feature): **`PATCH /api/users/me`** (own name + bio, 2–80 chars, bio ≤500) and **`POST /api/users/me/password`** (current password required, new ≥6, must differ) + a new **`/profile`** page (sidebar → *My profile*) where every signed-in user — guests included — edits their own record. **Role and department are deliberately not self-editable** (they stay on the Leader-only endpoints). Client `auth.refreshUser()` re-reads `/auth/me` after a save.
- **Calendar access corrected**: `GET /api/events` now requires a session (401 anonymous) and is readable by **every authenticated member, guests included** — the previous anonymous-public read was wrong for a club-internal calendar. Writes stay Leader/Co-Leader. Client `Calendar.jsx` routes to it behind the auth guard.
- **CORS was a silent no-op — fixed**: `corsCheck` had the wrong signature, so the `cors` package ignored it and served `Access-Control-Allow-Origin: *` for every origin. Corrected to `(origin, callback)` and reused by both `app.use(cors(...))` and Socket.io. Now an explicit allowlist (`CORS_ORIGIN`, comma-separated) + localhost in dev only. Baseline security headers added (`nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`).
- **Auth hardening**: `JWT_SECRET` is **fail-closed in production** — no env and no `.jwt-secret` file → `null`, and every auth route answers **503** instead of falling back to the old public default string anyone could forge tokens with. Added an in-memory **rate limiter** (`middleware/rateLimit.js`, 15-min fixed window) on login (10/IP+email, 40/IP) and sign-up (5/IP), reading `x-forwarded-for` behind Vercel. `/api/health` now reports `auth_configured` and `demo`.
- **Uploads hardened**: multer now validates an **extension allowlist** (plus random on-disk names) so a client can't pick a dangerous `.<ext>`; path traversal blocked; private files stay behind 24h HMAC signatures.
- **Tests rebuilt as a real suite** (the old one was a broken ESM file — `npm test` crashed): six CommonJS suites in `platform/server/test/` each boot an **isolated** server (own temp DB + uploads dir + port 4310–4315, cloud env stripped) — **37/37 green**: auth/validation, the sign-up chain (fresh DB: 0 demo accounts), calendar permissions, the permission/IDOR matrix, end-to-end workflows (post/vote/comment, tasks, profile), and security (CORS allowlist, signed uploads, extension/traversal, cron secret, JSON-not-HTML errors, no password-hash leaks). `npm test` script fixed to `node --test test/*.test.js`. `vite build` clean, `oxlint` 0 errors.
- **Deploy readiness** (unchanged stack, free tier): Vercel + Turso + Vercel Blob + Upstash; the only *new* mandatory env var is `JWT_SECRET` (plus `CRON_SECRET` if the backup cron is wanted). No destructive schema change; `db.js` keeps additive migrations only.

**2026-10-17 — HOSTING PIVOT: Vercel (online) replaces the LAN/PC server — one codebase, two backends (user: "i want the site online on vercel")**
- Cloudflare ruled out (no Express/Socket.io on Workers); **Vercel** chosen — Express runs as a serverless function, Socket.io works on all plans (Hobby caps a WS at 300s — engine.io auto-reconnects and every handler is reconnect-safe). `vercel.json` builds the server function + the static client, routes API/socket/uploads to Express, everything else to the SPA, and registers the backup cron
- **Database: @libsql/client everywhere** — the exact same code runs on `file:club.db` (self-host/dev, unchanged behavior) or **Turso** online (`TURSO_URL`+`TURSO_AUTH_TOKEN`). better-sqlite3 left the runtime (kept as a devDependency only for the local regression scripts). The whole server went **async** (168 await sites — codemod + hand fixes, `node --check` fail-fast for missed async signatures); `db.js` keeps the same facade (`prepare().get/.all/.run`, `exec`) now Promise-based behind a `ready` gate, plus `backup()` (VACUUM INTO, local) and `exportSnapshot()` (JSON dump of every table, the Turso build's snapshot format). Bind quirk fixed centrally: `NaN`/`undefined` → NULL (old better-sqlite3 semantics; libsql threw RangeError). New JSON error handler — API failures never come back as HTML
- **Uploads: Vercel Blob backend in `storage.js`** (auto-selected when `BLOB_READ_WRITE_TOKEN` is set) — same random names, same HMAC-signed URL API, zero route changes (custom multer engine keeps `req.file.filename`). Public files redirect to the store; **private files are proxied** after the signature check so the store URL never reaches the browser. Client now re-encodes images >3.5 MB in the browser (max 2048 px, WebP) so phone photos fit Vercel's 4.5 MB body cap — hosted video uploads must stay under it
- **Chat across instances**: `@socket.io/redis-adapter` + Upstash (`REDIS_URL`) — events reach sockets connected to other function instances; without the env the in-memory adapter is used (local/single-instance)
- **Drive backups on Vercel**: rclone can't run there → `driveClient.js`, a pure-Node Drive REST client — service account (`ISIGK_DRIVE_SA_JSON`) or OAuth refresh token (`node drive-auth.js` prints the consent link and exchanges the code once). Same monthly `ISIGK-Club-Backups/YYYY-MM` layout; the cloud DB snapshot goes up as `club-export.json` instead of club.db. Local rclone path untouched (still the default without creds). Vercel Hobby allows daily crons only → `GET /api/storage/cron-sync` (guarded by `CRON_SECRET`) runs the push once a month and skips the other days
- **Entry point**: `module.exports = readyApp` — Vercel needs the handler synchronously; it simply holds each request until schema+seed are done (local boot still uses `server.listen`)
- **Verified locally on the same code (file backend + fake rclone remote): 173/173** across five suites — api_smoke 79 (every route family, every role's permissions, uploads, reports, PDF, socket handshake) · media 30 (upload → thumb → signed URLs → share-to-feed → delete, signature tampering/expiry) · storage 25 (sync/re-sync/clear/quota/alerts) · account_chain 25 · supervisor_signup 14 · `vite build` clean
- Trade-offs accepted: hosted uploads capped at ~4.5 MB per file; Hobby WS capped at 300s (silent auto-reconnect); Drive push re-uploads the month's files monthly (simple and self-healing); restore from `club-export.json` is a manual script (documented in the panel/README)

**2026-10-17 — MEMBER ACCESS MODE: the Supervisor's PC IS the server (no cloud hosting)**
- Decision: no web host — the club laptop runs `START-SERVER.bat` (double-click → dependency check → `npm start`) and members open `http://<LAN-IP>:4000` from their own PCs/phones on the same WiFi
- Firewall: inbound TCP 4000 allowed via the `ISIGK Club - port 4000` rule (added as admin) · startup now prints every LAN address (`📡 Club members open: …`)
- Verified: `http://192.168.1.11:4000` → **HTTP 200** from the machine (Wi-Fi adapter address)
- Trade-offs accepted: the laptop must stay on/running the app; the DHCP address can change (reserve it in the router); same-network only — internet-wide access (members at home) would need a tunnel (Tailscale/Cloudflare), offered but not built
- `192.168.56.1` in the log is the VirtualBox adapter — members get the `192.168.1.x` address

**2026-10-17 — PRODUCTION READY: demo data cleared, pushed to GitHub**
- **Repo**: https://github.com/med-tlili/robotic_club (`main`, 68 files: `platform/` server+client incl. the built `client/dist`, `rapport/` LaTeX+PDF, root README). **Never committed**: `club.db*`, `uploads/`, `backups/`, `node_modules/`, `.jwt-secret` (git-ignored). Author set to the GitHub noreply address (account email-privacy protection)
- **`npm start` is now the production entry** (`start-prod.js`): seeds **nothing but the 5 departments** (`ISIGK_DEMO_ACCOUNTS=0`) and generates a persistent random `JWT_SECRET` → `.jwt-secret` on first boot (overridable via env). `npm run start:demo` keeps the seeded demo for local play
- **Deploy = 3 commands**: clone → `cd platform/server && npm install && npm start` → open `/signup` as the Supervisor. README §13 documents it
- **Local machine cleared for the transition**: the demo DB + test media were *moved* (not deleted) to `platform/server/club-demo-backup.db` / `uploads-demo-backup/` — restore by moving them back and running `npm run start:demo`. The local server now runs in production mode: empty club, open supervisor sign-up, Drive backups still connected
- **Verified on the production instance**: 5 departments · 0 users/posts/messages/events · public API serves departments · supervisor sign-up works on the empty DB · probe account removed, DB pristine

**2026-10-17 — Google Drive backups CONNECTED to the real account (live)**
- **Setup done**: the club's dedicated Google account was created, `rclone config create gdrive drive scope=drive` + one browser consent (`rclone about gdrive:`) — token + refresh token saved in `rclone.conf`, no server env needed (default remote `gdrive:ISIGK-Club-Backups` matches). The Storage page's setup panel disappears automatically once the remote answers
- **First real backup**: leader clicked *Run backup now* → `club.db` + all `uploads/` (public + private + thumbs, 14 files / 2 MB) landed in **`ISIGK-Club-Backups/2026-10/`** · Storage page shows the true quota (**2 MB of 15 GB — "Healthy"**) · *"Last backup 17/10/2026 01:27:44 — ok"* · month row *2026-10 · 2 MB · 14* · Dashboard warn banner correctly absent at 0%
- **Heads-up (2026)**: rclone warns its *shared* Google OAuth client is being retired during 2026 — current backups keep working; if/when it nags, the fix is a personal `client_id`/`client_secret` in the remote (rclone.org/drive → "making your own client id"), a 5-minute Google Cloud Console step
- Re-running the monthly backup replaces the month's copy; *Clear month* only touches the off-site copy — the live site's files are never at risk

**⚠️ SUPERSEDED (2026-10-18) — 2026-10-17 — Supervisor sign-up is now OPEN, always (user: "remouve the idea of fresh install only i want to sign up")**
- **What changed**: the fresh-install gate is gone — **`/signup` works at any time on any database**: fill name/email/password → Supervisor account → straight into the app. Multiple supervisors are allowed (they're just parallel full-access accounts). The page lost its status check, its Supervisor/Leader toggle remnants and the "already has a Supervisor" banner
- **Removed**: the no-supervisor-exists 403 in `POST /api/auth/signup-supervisor` and the whole `GET /api/auth/signup-status` endpoint (404 now). `ISIGK_DEMO_ACCOUNTS` / `DB_PATH` stay (still useful: production installs shouldn't seed the public `password123` demo accounts)
- **Tradeoff, accepted (user decision)**: on a public URL anyone who opens `/signup` becomes a Supervisor — full access to everything. If the club ever wants it restricted again, the one-line exists-check is one `if` away (or an env/setup-code gate)
- **Verified**: 14/14 open-signup suite **on the live demo DB** — validation 400s · duplicate email 409 · **signup → 201 while two supervisors already exist** · both new supervisors log in and read the directory · `signup-status` + invites → 404 · demo DB restored to exactly 9 users · regressions 25/25 + 32/32 · browser: `/signup` on the demo shows a plain always-working form (no banner, no code field) → signed up through the UI → **landed on the Supervisor dashboard** ("Club overview"), 0 console errors · clean `vite build`

**2026-10-17 — Leader invite codes + leader self-signup REMOVED — the Supervisor creates the Leader (user request: "remouve the leader invite code and sign up cause the supervisor will create the leader account")**
- **What changed**: the chain is back to its simplest form — **Supervisor → "Create leader account" (Members page) → Leader → creates everyone else**. Superseded: the invite-code system from the two entries below
- **Deleted**: `routes/invites.js` (issue/list/revoke endpoints) + its mount · `leader_invites` table (schema + dropped from the demo DB) · `POST /api/auth/signup-leader` · Members page *Invite leader* button + `InviteModal` · the Leader tab, invite-code field and leader path on `/signup`
- **Kept**: the **Supervisor bootstrap signup** (`/signup` = supervisor-only now; fresh-install one-time rule, `ISIGK_DEMO_ACCOUNTS=0` production seed, `DB_PATH`) — the login page's visible **Sign up** button stays, its subtitle now "Fresh install — create the club's Supervisor account"
- **Verified**: fresh-install suite updated to the direct chain — 22/22: 404 on both removed endpoints · supervisor signup → 201 · **supervisor creates the leader directly → 201** · leader logs in → creates a member → member logs in · page APIs 200 on the empty DB · demo regressions 25/25 (account chain) + 32/32 (media) · demo server also returns 404 on both removed endpoints · `vite build` clean (bundle shrank ~4 kB)

**2026-10-17 — Supervisor sign-up: the one-time fresh-install bootstrap (user request: "yeah do supervisor sign up")**
- **The problem it solves**: the Supervisor is the root of the trust chain — nobody is above him to invite him, so on a brand-new production install (no accounts at all) *somebody* must be able to become the first Supervisor. Rule: **this sign-up opens exactly once — while `role='supervisor'` count is 0 — and closes forever** (`GET /api/auth/signup-status` → `supervisor_open`; `POST /api/auth/signup-supervisor` → 403 with "already has a Supervisor… fresh install" the moment one exists). On a live club nobody can ever slip in
- **Demo seed made production-honest**: the old seed *always* created the 9 demo accounts (published `password123` passwords!) which would have blocked the bootstrap on every fresh DB. Now `ISIGK_DEMO_ACCOUNTS=0` seeds **only the 5 departments** — users, posts, events, tasks, messages all skip → the real production install starts empty and fills up with real people. Default unchanged (demo ON for local dev). `DB_PATH` env added (point `club.db` at the persistent disk; also used to run an isolated fresh-install instance for testing)
- **Bug found on the way**: the demo **events** seeder called `.id` on a `db.prepare()` *Statement* instead of `.get().id` — dormant on the demo DB (events already existed) but it would have **crashed every truly fresh install** at boot; fixed while gating the seeder
- **Client**: the login page now carries an **obvious Sign-up button** (bordered full-width row: *Sign up — Supervisor (fresh install) or Leader (with invite code)*) → **`/signup`**. The page shows a **Supervisor / Leader toggle at all times** so the feature is never invisible: on a fresh install it lands on **Supervisor mode** (no code field, "closes as soon as one Supervisor exists" note); on a live club the Supervisor tab stays visible but explains itself — an info banner: *"This sign-up only opens on a brand-new install — your club already has a Supervisor. Sign in with your account instead."* (first version hid the tab when closed — the feature became undiscoverable; user: "where is the sign up"). Leader mode submits to `/auth/signup-leader`, Supervisor mode to `/auth/signup-supervisor`, both auto-login via `signIn()`
- **Verified (isolated fresh instance: `DB_PATH`+`ISIGK_DEMO_ACCOUNTS=0` on :4100)**: 23/23 — 5 departments seeded, **zero** users/content · status `supervisor_open: true` · validation 400s · first signup → **201 role supervisor + token** · status flips false · second attempt → **403** with the fresh-install message · he logs in · **full chain runs on the empty DB**: invite code → leader self-signup → member created → logs in · every page API returns 200 on the empty DB (posts/tasks are department-scoped — the test's bare calls got the designed 400, not a crash). Demo DB (:4000): `supervisor_open: false` + 403 → UI shows **no toggle**, leader-only form; login shows the new link. Browser: fresh instance shows the toggle with Supervisor preselected and the "closes as soon as one Supervisor exists" note; Leader tab reveals the code field and vice-versa; 0 console errors · regressions 21/21 + 25/25 + 32/32 green · `vite build` clean
- **Full entry path now**: fresh host (`ISIGK_DEMO_ACCOUNTS=0`) → first visitor signs up as **Supervisor** at `/signup` → invite/create the **Leader** → Leader creates **everyone else**

**2026-10-17 — Leader sign-up page, gated by Supervisor-issued invite codes (user request: "add sign up for the leader")**
- **Why gated**: the platform is public (guests browse), so an open "become Leader" form would let *any visitor on the internet* claim leadership of the club — one line of signup UI vs. the entire trust chain. The compromise: the **Supervisor still roots the trust**, but the Leader types his own name/email/password instead of the Supervisor choosing them
- **Server**: `leader_invites` table (code · created_by · expires_at · used_at) + `routes/invites.js` — **POST/GET/DELETE `/api/invites/leader`, Supervisor-only**: generate an 8-hex code (shown as `XXXX-XXXX`, stored plain — signup normalizes the input, the display formats it), active list, revoke. **`POST /api/auth/signup-leader`** (public): validates fields first (a bad form never burns the code), then the code — single use, 7-day expiry, email uniqueness (409) — creates the leader, **consumes the code, and returns a token** so the new Leader lands straight in the app
- **Client**: login page gained *"Leading the club? Sign up as Leader"* → **`/signup`** (standalone, same card style as login: name, email, password, mono invite-code field) · Members page: Supervisor sees a second header button **Invite leader** → modal with *Generate a new code*, the list of active codes (mono, expiry date) and revoke · auth context gained `signIn(token, user)` for the direct session
- **Both chains now**: Supervisor → *Create leader account* (direct) **or** → *Invite leader* → `/signup` (self-registration) → Leader → creates everyone else
- **Verified**: 21/21 signup regression — 403s for member/leader on issue+list · supervisor issues `XXXX-XXXX` · bad code / missing name / short password / bad email → 400 **without burning the code** · existing email → 409 · valid signup → **201 with role leader + working token** · code reuse → 400 · revoke → 400 · expired (row tampered to the past) → 400 · used/revoked/expired codes vanish from the active list · self-registered leader creates a member (chain runs) · that member logs in · supervisor's direct path still 201 · demo DB pristine after cleanup. Browser: leader has **no** Invite button · login shows the signup link · supervisor generates `51B3-D5F5` in the modal → logged out → filled `/signup` → **auto-landed on the Leader dashboard** ("Lead the club") with Create-account powers and no Invite button — 0 console errors, clean `vite build`
- **Fix found by the test**: codes were stored dashed (`AE5E-E9A3`) while signup normalized the input to plain (`AE5EE9A3`) → every lookup missed; store plain, format on read

**2026-10-17 — Onboarding chain: the Supervisor creates the Leader, the Leader creates everyone else (user request)**
- **Problem**: no endpoint could create an account — every user came from the seed. Request: *"add create leader account and then the leader will create the other members"*
- **Rule (API `POST /api/users`, mirrored on the Members page)**:
  - **Supervisor → Leader accounts only** — his single write on management (everything else stays read-only): the root of the chain
  - **Leader/Co-Leader → every other account**: Co-Leader, Manager (with department), Member (with department), Guest. A leader attempting `role: leader` gets 403 (*"Leader accounts are created by the Supervisor"*)
  - **Manager/Member/Guest → 403. No self-registration exists** — `/api/auth` has only login + me
  - Validation matches the role-change rules: name ≥2 chars, email format + **unique (409)**, password ≥6 (bcrypt cost 10), department required for member/manager with **Materials excluded**; the Supervisor creating a member → 403 (chain, not just validation)
  - Hierarchy protection unchanged: created leaders are undeletable through the API like the seeded one
- **UI (Members page)**: header button — Supervisor sees **Create leader account** (role locked to Leader, no department field, hint: *"the chain starts with you"*); Leader/Co-Leader see **Create account** (role select Co-Leader/Manager/Member/Guest + department when needed, hint: *"Leader accounts come from the Supervisor"*); directory footnote explains each side of the chain
- **Verified**: 25/25 chain regression — 403 matrix (guest/member/manager) · supervisor→leader **201** · supervisor→member 403 · leader→leader 403 · leader→coleader/manager/member/guest **201** · dept rules 400 (missing, Materials) · duplicate 409 · short password/bad email 400 · every created account logs in with the password its creator set · a created Co-Leader creates a member → **the chain extends** · leader cannot delete the supervisor-created leader · directory shows the new leader · demo DB left pristine after cleanup. Browser: supervisor creates "Test Leader Pro" → Leader pill in the directory; leader creates "Test Member UI" (HR default) → appears → removed via the existing Manage-modal confirm; plain member sees **no** button — 0 console errors in every state, clean `vite build`

**2026-10-16 — Off-site backups: monthly Google Drive snapshots + a Storage page with limit alerts (user request)**
- **User proposal**: "I create a drive account and save on it monthly; if it reaches the limit it shows a limit alert on the web, and the leader clears the old images." Offered three shapes — **chosen: "Both — backups now, live storage later"** — Drive holds *backups* today (serving keeps the local signed-URL design), while the storage layer stays isolated so live Drive/R2/B2 serving can swap in during PROD (§10) without touching features
- **Why backups first, not Drive-as-image-host**: Drive image links are unofficial/hotlink-unfriendly and need "anyone with the link" sharing — *weaker* than the signed URLs just built — and pruning files the site still references would break every picture. Here pruning only ever removes **off-site copies**; the live site is never touched. The local `npm run backup` stays the quick-rollback copy, Drive is the off-site copy
- **How**: **rclone** (`winget install Rclone.Rclone`) talks to one **fresh dedicated Google account** (empty = the whole 15 GB belongs to the club). `server/driveBackup.js` stages `club.db` (SQLite online backup) + `uploads/` and `rclone sync`s it to `<remote>/YYYY-MM` — **one snapshot per month**, re-running replaces the month instead of stacking copies. Bookkeeping in new `drive_backups` table (month · path · size) + a `settings` kv (last sync time/status/error)
- **`/storage` page** (sidebar → Overview; Leader/Co-Leader act, **Supervisor read-only**, API mirrors this): real quota from `rclone about` → usage bar + status line always in **words**, never colour alone (healthy / "Approaching the limit — clear old months" ≥80% amber / "Nearly full" ≥95% red), last-backup time incl. failures, months table (size · files) with **Clear month** (confirm dialog → `rclone purge` + rows) and **Run backup now**
- **Limit alert on the web**: boss dashboard shows an amber/red banner with "Open Storage" when the quota crosses the thresholds; leaders/coleaders also get a notification on crossings and on failed syncs (a silently failing monthly backup is the worst kind)
- **First run**: rclone installed but no account linked → the page shows the exact 4 steps (fresh Google account → install → `rclone config create gdrive drive scope=drive` + `rclone about gdrive:` for the one-time browser login → Run backup) plus the `schtasks` monthly schedule line; `npm run sync-drive` is the CLI entry for the scheduler
- **Config (env, optional)**: `ISIGK_DRIVE_REMOTE` (default `gdrive:ISIGK-Club-Backups`), `ISIGK_DRIVE_TOTAL_BYTES` (quota display override), `ISIGK_DRIVE_WARN_PCT` / `ISIGK_DRIVE_CRIT_PCT` (80 / 95)
- **Verified**: 25/25 storage API regression against a local fake remote (401/403 matrix incl. supervisor read-only · sync → month folder with club.db + uploads on the "drive" · re-sync replaces, never duplicates · clear purges folder + rows · 400 on double-clear and bad month format). Browser: leader at 82% → amber bar + amber dashboard banner → **Run backup from the UI** (row `2026-10 · 1 MB · 8 files`, "Last backup — ok") → **Clear month** via confirm dialog → empty state; supervisor view has no action buttons; red `crit` state at 95%; healthy state shows **no** banner (no false alarms); out-of-box setup panel renders all 4 commands — 0 console errors in every state, `vite build` clean, media regression still 32/32

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

**2026-10-15 — Rule change: the Supervisor can vote on posts (user request)**
- **Old rule**: `canWrite()` in `routes/posts.js` was `role !== 'guest' && role !== 'supervisor'`, and it gated posting, voting *and* commenting — so the Supervisor couldn't vote. `PostFeed.jsx` mirrored it with `canInteract`, which disabled the Yes/No buttons and rendered a "Supervisor view — you can't vote or comment" note
- **New rule**: **voting is separated from content authoring**. A new `canVote()` (`role !== 'guest'`) now guards `POST /api/posts/:id/vote`, so the Supervisor votes like any member; `canWrite()` is unchanged and still blocks him from creating posts and commenting
- **Client** (`components/PostFeed.jsx`): `canInteract` split into `canVote` (Supervisor included) and `canComment` (Supervisor excluded) — the buttons enable for him, and the read-only note now says he can vote but not comment
- **Why**: votes are the club's opinion signal, not content creation; the Supervisor already sees every tally on his dashboard graphs, and being able to vote keeps that honest without loosening authoring rules
- **Verified**: 21/21 permission checks — Supervisor vote → 200 and the tally moves (yes+1, then switch to `no` with yes reverted, then un-vote restoring the original counts exactly) · guest vote 403 · Supervisor comment 403 · Supervisor create-post 403 · member comment 201. Browser-tested on `:4000` as the Supervisor on the Finance feed: buttons enabled, click → `voted-yes` class + "Yes 0 → Yes 1"; test votes removed from the demo DB

**2026-10-15 — Finance: a sponsor can give GOODS, not only money (user request)**
- **Old model**: the sponsor pipeline had a single `value` (TND) column, so a company donating food, drinks, laptops, print or stand material had nowhere to go — it either got a fake 0 TND or a wrong number in the money total
- **New model** (`sponsors` table, non-destructive migration in `db.js`): `kind` (`money` | `goods`, default `money` so existing rows stay valid) + `details` (free text for what was actually given). `value` stays the money amount
- **API** (`routes/finance.js` `POST /sponsors`): validates per kind — a money sponsor needs `value > 0`, a goods sponsor needs `details`; goods are stored with `value = 0` so they can never leak into a money sum. `GET` returns `kind`/`details`; status changes and delete unchanged; permissions unchanged (Finance manager/leaders write, dept members + bosses read, guests 403)
- **UI** (`components/DeptTools.jsx` `SponsorsLedger`): the Add-sponsor form gets a **Money / Goods** segmented control that swaps the second field — *Amount (TND)* vs *What they give* (with real examples: "20 laptops · meals for the tournament · print & stand material"). The ledger's "Value" column became **Contribution**: money rows show tabular TND, goods rows show a `Package` icon + the description. The header summary now splits honestly: money is summed (`5,000 TND secured`), goods are **counted, never priced** (`+ 1 goods donation`)
- **Also**: the public Finance feed composer nudge updated to "Sponsor — money or goods (…)" (`components/PostFeed.jsx`)
- **Verified in the browser as Amel (Finance Manager) on `:4000`**: Money↔Goods toggle swaps fields and the submit guard follows (amount required for money, description required for goods) → created a goods sponsor ("Delta Foods — meals + drinks for the regional tournament") → it renders with the goods tag and **no TND** → set it to Won → summary became "1 open · 5,000 TND secured **+ 1 goods donation**" (the existing money total untouched) → deleted it and the summary reverted to "1 open · 5,000 TND secured". 0 console errors; clean `vite build`

**2026-10-15 — Media: album cards on the department home page, open to all members (user request)**
- **Old rule**: albums were reachable only inside the Media **private workspace** (`MediaTools`), so only the Media team, bosses and supervisor ever saw them — other departments' members couldn't open them at all
- **New rule**: `GET /api/media/albums` is now readable by **every logged-in member** regardless of department; **guests stay blocked** (403). Creating albums / uploading / deleting / sharing to the public feed remain manager+leader powers (`canManageDept`), unchanged
- **New surface** (`components/AlbumsGallery.jsx`, rendered from `pages/DepartmentHome.jsx`): a card grid placed **at the top of the Media page, above the public feed** — a cover photo per album (`object-fit: cover`, 16:10, or a placeholder icon when empty), title, description, "N photos · added YYYY-MM-DD", and a header count ("1 photo in 1 album"). Clicking a card expands its photos **inline** (no modal); the private workspace below still holds the management tools, so the page reads public → members → private
- **Permissions cross-checked in the browser as Omar (HR member)** — a member outside Media sees the cards and can open the album, which was the whole point of the request; Media-manager-only controls correctly absent
- **Design**: white surfaces on Mist White, Cool Gray borders, 6px radius, cobalt hover on the title, `.eyebrow.members` in cobalt to sit between the teal *public* and amber *private* eyebrows — no new colours, no card shadows
- **Verified**: 12/12 album permission checks (member/supervisor/leader 200 · guest 403 · member create 403 · manager create 201); geometry read back off the rendered DOM (2-col grid, 12px gap, 254×338 cards, 253px cover, `object-fit: cover`); albums render above the feed; empty-album placeholder + inline expand + empty state all work; 0 console errors

**2026-10-15 — Rule change: the Supervisor can send messages in every chat (user request)**
- **Old rule**: Supervisor read-only in chat — he could write only in the Managers chat (server: `canSend()` in `routes/chat.js`; client: a "Supervisor view" note that hid the composer everywhere else)
- **New rule**: **chat is communication, not management** — the Supervisor posts in the global, department and private chats like any member. His read-only stance is unchanged for *content management* (creating/deleting posts, commenting, members, calendar, tasks, department tools) — see the entry below for the vote change
- **Server** (`routes/chat.js`): `canSend()` now simply returns `canRead()` — room membership is unchanged, only the write flag. Guests still 403 on every chat route, members still blocked from the managers room and from foreign department rooms, private threads still 1↔1
- **Client** (`pages/Chat.jsx`): the composer renders for everyone who reaches a conversation; the read-only note became a generic defensive fallback ("You can read this conversation but cannot write in it.") — unreachable in practice since guests are routed away from `/chat`
- **Verified**: 14/14 chat permission checks — Supervisor POST → 201 in all four room kinds (global, managers, `dept:<id>`, private); member → managers 403 (read + write), member → foreign dept 403, guest → global 403 (read + write + room list). Browser-tested on the production build (`:4000`) as the Supervisor: composer present in the global chat, Send disabled until text, message renders as a cobalt "mine" bubble; 0 console errors. All test messages deleted from the demo DB

**2026-10-15 — Visual identity: light-theme-first engineering brand + chat as a full working surface**
- **Why**: the platform still read as a generic dark admin template (near-black panels, neon-ish accents, pill badges) and the chat sat as a centered 1060px card with dead space around it — it didn't feel like a precision/engineering club tool. Redesign brief: light theme first, one fixed brand palette, engineering-document feel (workbenches, tables, lists, timelines) — explicitly *not* sci-fi (no gradients, neon, glassmorphism, pill badges, circuit-pattern backgrounds, robot art, invented stats)
- **Brand palette as tokens** (`client/src/index.css`): **Ink Navy `#172B4D`** (sidebar, headings, body text) · **Cobalt Blue `#2457C5`** (primary buttons, active nav, links, focus) · **Circuit Teal `#168C88`** (positive/technical accents, used sparingly; text variant deepened to `#0F7A75` for AA) · **Amber `#E7A23B`** (pending/attention; text variant `#8A5A12`) · **Cool Gray `#D8E0EA`** (borders/separators) · **Mist White `#F7F9FC`** (main background) + white content surfaces. Exposed as `--ink/--cobalt/--teal/--amber/--gray/--mist` beside the working aliases (`--bg`, `--surface*`, `--text*`, `--border*`, `--accent*`, `--success/warning/danger`) so no route had to be rewritten
- **Ink Navy sidebar = the only dark plane** (`.sidebar` + scoped `--side-*` tokens): cobalt brand mark with a small inline-SVG `.brand-circuit` trace under the wordmark (the *only* circuit detail in the app), small-caps section eyebrows, cobalt active nav with a solid left bar. Role colours re-darkened so white initials and role text both pass AA; badges and role pills squared (3px) instead of 999px pills; radius cut to 6px/4px; login page gets a faint engineering grid
- **Charts re-palletted** (`components/Charts.jsx`, `SupervisorGraphs.jsx`): `#1e3a8a` → `var(--ink)`, bar accents → `#2457C5`, legend dots from the brand vars — no decorative/invented graphs, real aggregated data only
- **Chat rebuilt as ONE surface** (`pages/Chat.jsx`, `.panel.chat`): a single grid panel = **284px room rail** (head + scrolling rooms/private list, active room = white with a cobalt inset bar) beside the **conversation column** (`.chat-head` with icon/title/role badge + Meet, `.msg-list`, `.chat-foot`). Two separate cards → one tool. Messages **group**: consecutive same-sender messages drop the repeated avatar/name and show the time only on the last one; own messages are cobalt-filled bubbles capped at `min(76%, 620px)` for readability; `.chat-composer` replaced the generic `.composer` (composer class kept for Calendar/PostFeed)
- **Chat covers the page** (user report: *"why is the chat centered, why doesn't it cover the page"*): `Layout` in `App.jsx` adds `page-wide` on `/chat` (drops the shared 1060px measure) and `shell-full` (`height:100vh; overflow:hidden`) so the page itself never scrolls — the rail and the message list scroll *inside* the surface (`.main`/`.page-wide`/`.chat-layout` became flex columns with `min-height:0`, `.panel.chat` uses `flex:1` instead of viewport math). Verified: `scrollHeight == innerHeight`, panel spans the content column top bar → 16px above the fold, ≤820px collapses to one column (rail **or** conversation with a back button)
- **Verified in the browser**: supervisor read-only footer ("Supervisor view") vs leader composer (Send disabled until text) + `mine` bubble rendering; dashboard/finance/calendar/members spot-checked after the theme flip; 0 console errors; clean `vite build`

**2026-10-15 — Product/UX redesign: role-aware workspace, real Finance ledger, no template filler**
- **Why**: the app read as a generic dark admin dashboard — every block was an equal rounded card, the Finance Manager's real tools (pipeline/budget) sat at the bottom of a ~1200px scroll behind two ~300px empty panels, public/private was an ambiguous "Public page / Private space" pill toggle, and money/votes were under-prioritised. Redesigned around actual workflows, not colours
- **Department page = public feed → private workspace, in one column** (`pages/DepartmentHome.jsx`): dropped the `.grid-2` two-column layout (it collapsed under ~960px and pushed the workspace below the whole feed). Header now states the department's *purpose*; a one-line **scope legend** replaces the pills and explains what is public vs private per role. Public feed (visible to all incl. guests) comes first, then — for members/bosses/supervisor — a single framed **workspace**
- **The private workspace is ONE surface, not a wall of cards** (`components/ui.jsx` `ToolBlock`, `components/DeptTools.jsx`): dept tools render as flat labelled blocks inside one `.panel.ws`. HR/Events keep in-workspace tabs; **Finance shows pipeline + budget together** (the whole money picture, not hidden behind a tab). Goals/Team/Tasks are compact blocks (empty states are one-liners, not 300px panels)
- **Finance redesigned as a real ledger**: **sponsor pipeline** is a compact table (Sponsor · Value · Status · delete) with a live status select for managers and a real derived summary ("N open · X TND **secured (won)**"); **budget** is a ledger with an Income/Expense/Balance strip (tabular figures, green/red by sign) and a Date/Label/Amount entries table. All totals computed from real rows — no invented numbers. Add-sponsor & add-entry are inline forms
- **Posts are compact & scannable** (`components/PostFeed.jsx`): a labelled "… · public" section head carries the primary *New offer/announcement* action; each post shows a **vote-tally proportion bar** (green/red split + counts), a *who voted* toggle, and a **collapsible comment thread** — instead of an always-open card. Finance composer nudges structured titles ("Sponsor — amount …")
- **Dashboard answers "what needs attention → where next"** (`pages/Dashboard.jsx`): removed the fake stat tiles (e.g. an "Announcements" tile whose value was text) and filler panels ("Quick actions", full team lists). Each role now leads with the **membership-application review queue**, then role-relevant real panels. Supervisor's outdated "Reports arrive in Sprint 5" empty state → a real **Reports** link + graphs. Team lists became a compact avatar row pointing to the dedicated `/members` directory. Keeps the dark-navy identity but uses small-caps section eyebrows, hairline dividers, tabular money and tables to read as a *tool*, not a template
- **Verified in the browser (0 console errors, clean build)**: Finance CRUD (add/delete sponsor, budget entries) + vote round-trip (vote → tally updates → unvote) as manager & member; read-only guest (vote disabled, workspace hidden, Members removed from nav) & supervisor (workspace visible, no write controls, badges not selects); department pages HR/Events/Media render the workspace with correct tabs; Supervisor & Finance-Manager dashboards. Test data cleaned from the demo DB

**2026-10-15 — Sprint 7: Supervisor dashboard graphs + testing + deployment ✅**
- **Dashboard graphs** (`GET /api/reports/charts`, Supervisor-only): six real-data charts on the Supervisor's home — posts per month, chat messages per month (SVG bar charts), members-by-role (donut), tasks-by-status / posts-by-type / applications-outcome (horizontal bar lists). Year selector; hand-rolled SVG charts in `components/Charts.jsx` (no charting library — keeps the bundle lean and the palette on-brand)
- **Charts endpoint** aggregates straight from SQLite (posts/messages by month for the chosen year + role/type/status/outcome distributions); Leader/Co-Leader/Guest blocked (403)
- **Deployment (single process)**: Express now serves `client/dist` when present + an SPA fallback so any non-API GET returns `index.html` (react-router deep links work); API/`/uploads`/`/socket.io` paths are excluded so API 404s stay JSON. Client API base centralized in `api.js` → `BASE` = `http://localhost:4000` in dev, `''` (same-origin) in production; `socket.js`, image/attachment URLs, chat/reports/media uploads all use it. `JWT_SECRET` + `PORT` read from env
- **Full permission regression (28 checks, all pass)**: reports/chats read+write matrix per role, department tool write rules (HR/Events/Media/Finance managers + leaders write, members/guests blocked), posts/vote/comment rules (guest+supervisor read-only), member management (member/supervisor cannot promote, leader can with a department). Browser-tested the production build served from `:4000` (login → chat, 0 console errors)

**2026-10-15 — Sprint 6: Media albums · HR · Events · Finance department tools ✅**
- **Department tools injected into each dept's private space** (`components/DeptTools.jsx`, gated by `deptPerms.js`: *manage* = Leader/Co-Leader or that dept's manager; *view* = + members of the dept + Supervisor; guests blocked). Roadmap panel now only lists sprints not yet delivered
- **HR**: attendance grid per meeting date (Present/Late/Absent, upsert `ON CONFLICT`, summary counts, read-only badges for non-managers) · meeting conclusions (create/delete) · rule-break alerts (member + severity minor/major/critical). Members see their own attendance read-only + the "only the HR manager or leaders can mark" note
- **Events**: itineraries (title + date + step list) and a decoration checklist with click-to-cycle status (todo → in progress → done)
- **Media**: private albums (created by the Media manager/leaders) with image upload (multer, 20MB, images only) → each picture can be **shared to the department's public feed** as a post (`shared_post_id` prevents double-share → 409); other depts get 403 (album privacy)
- **Finance**: sponsor pipeline (lead → contacted → negotiating → won/declined, status select for managers) + budget (income/expense entries with live balance). Published sponsor offers remain on the public feed as posts (Sprint 1)
- All routes API-tested: cross-department write/read 403, guest 403, leader/supervisor cross-read OK; browser-tested each manager's tools + a member's read-only view (0 console errors)

**2026-10-15 — Sprint 5: Finance module + Supervisor reports ✅**
- **Reports are Supervisor-only** (`routes/reports.js`, `requireSupervisor`): `GET /api/reports/data` (JSON preview) + `GET /api/reports/pdf` (pdfkit download). Three report shapes — **monthly global**, **full year**, and **per-department** — each aggregating membership, communications (posts/votes/comments/chat), events, tasks, applications for the chosen window
- Events are club-wide (the calendar has no `department_id`), so they count globally in every report; "new members this period" excludes guests to stay consistent with "active members"
- **Client `pages/Reports.jsx`**: period (month/year) + scope (whole club / dept) selectors, live preview cards, and a **Download PDF** button (fetch → blob → save, JWT attached). `/reports` route + nav item are Supervisor-only (`RequireSupervisor`)
- **Finance private tools**: sponsor pipeline + budget tracker (`routes/finance.js`, tables `sponsors` + `budget_entries`) — the Finance manager/leaders write, Finance members + leaders + Supervisor read, guests 403

**2026-10-15 — Sprint 4: chat + Jitsi video meetings ✅**
- **Four chat levels** (`/api/chat`, `messages` + `chat_reads` tables): **global** (all members) · **managers** (4 managers + Leader/Co-Leader + Supervisor) · **department** (that dept's members + leaders) · **private 1↔1** (any two non-guests, opened from the Members directory)
- **Supervisor rules** (README): reads every chat, **writes only in the managers chat** (composer replaced by a "Supervisor view" note elsewhere); Guests blocked from chat entirely (403 + nav hidden)
- **Room access enforced server-side** (API-tested): member cannot read/send in managers (403), cannot read another dept's chat (403), cross-dept assignment impossible; leader/co-leader + supervisor see all dept rooms
- **Live via Socket.io**: messages pushed to `room:<key>` (group) / `dm:<a>:<b>` (private) on send; unread badges + last-message previews update through a `chat:activity` push to each recipient's room
- **Attachments** (multer, max 15MB): images render inline, pdf/zip/mp4 as file links; supervisor included in the managers room on connect
- **Video meetings (Sprint 4 test)**: a "Meet" button in group chats opens a live **Jitsi** embed (unique room name per chat, plus an open-in-new-tab fallback)
- **UI**: chat = rooms list (unread badges, previews) + conversation (bubbles, sender names, timestamps, image/file attachments); responsive single-column on mobile; the Members/department "Message" links route into a private conversation
- Fixed: GET /messages now shapes rows to the same `{sender:{...}}` format as POST/socket (was flat, crashed the Avatar); the supervisor's room list now includes the managers chat (frontend filter bug)
- Demo seed: global/managers/HR-dept conversations + a leader↔member DM; read-pointers set so unread badges start at 0 and grow live

**2026-10-15 — Sprint 3: department tasks + notifications core ✅**
- **Tasks** live in each department's private space (`/api/tasks`): title, description, assignee (dept members only), due date, status todo/doing/done
- **Permissions** (API-tested): read = dept members + leaders + supervisor (guests 403, cross-dept 403); create/edit/delete = dept manager + Leader/Co-Leader; **members may only move the status of their own tasks** (403 on anything else); assignee must belong to the same department (400)
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
- **Member management** (Leader/Co-Leader only): ⚙ modal on the Members page → change role (guest / member / manager), assign department, remove from club. Protections: cannot touch yourself, Leaders/Co-Leaders/Supervisor, or roles outside the list (no accidental "new leader"); removing a member who authored posts/comments → clean 409
- **Global calendar** (`/calendar`, new page + nav): Leader/Co-Leader add & remove dates (title, date, time, location, description), everyone else (incl. Guests) views; upcoming/past split; dashboards show "Upcoming dates" from the real API
- **Guest → member applications**: Guests apply from their dashboard (department + message, one pending at a time); Leader/Co-Leader or the department's manager Accept/Refuse; accepted guests become members of that department instantly; history shown with reviewer + status badges; Supervisor sees the list read-only
- **Auth fix**: `authenticate` now re-reads role/department from the DB on every request → promotions/demotions/removals take effect immediately, no re-login needed
- Supervisor remains read-only everywhere (403 on manage/remove/review/calendar edits) — enforced & API-tested
- Demo data: 3 calendar dates seeded; application history kept as showcase (Lina applied → accepted → restored to guest for demo)

**2026-10-15 — Sprint 1: announcements + votes + comments** ✅
- Posts on every department public feed: type = announcement / clip (Media) / sponsor offer (Finance)
- **Votes**: Yes/No, 1 per user, changeable (click again = remove), **transparent** (voter names shown under the buttons)
- **Comments** thread on every post; delete for author / Leader / Co-Leader
- **Permissions enforced & tested**: Supervisor = read-only (no post/vote/comment/delete, 403), Guests = read-only (403 on vote/comment), department members can post only in their own department (403 cross-dept)
- Image upload on posts (max 15MB, png/jpg/gif/webp) served from `/uploads`
- Demo feed seeded: Media clip + Finance sponsor offer with votes/comments
- Decision: **guests and the supervisor cannot vote or comment** (read the public feed, that's all)

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
- Role-aware dashboards: manager (own dept), leader/co-leader/supervisor (club overview + goals + per-dept table), member (dept + tasks), guest (public view only)
- Members moved off the dashboard to a dedicated page with search + role/department filters
- Department pages: per-department identity (HR/Events/Media/Finance), private space with honest "arrives in Sprint X" roadmap, Materials = understated Coming Soon
- Private chat redesigned as a proper conversation frame
- Backend untouched; all data from real API; no fake controls

**2026-10-15 — v2 restructure**
- Materials department → "Coming Soon"
- Each department: public home + private space; each has its own tasks
- Supervisor sees graphs/goals/tasks + downloads reports; can WRITE in managers chat
- Directory hidden from guests; click user = private chat
- 4 chat levels; votes transparent + changeable; leader owns calendar + goals
- Albums private to Media; HR marks attendance manually
- Report frozen until project end; all changes go to this README first
