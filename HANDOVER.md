# ISIGK Robotics Club — Hardening & Handover

**Date:** 2026-10-18
**Scope:** finish, secure and prepare the existing platform for free-tier deployment
**Repo:** `C:\Users\USER\Desktop\club_robotic` (git repo, branch `main`)
**Status:** code complete + verified locally · **not yet deployed**

> This pass kept the real project and the existing stack (React/Vite client +
> Express/libsql server). Nothing was rewritten into a demo. Every change below
> is uncommitted on `main`.

---

## 0. Update — Phase 2 (multi-club) · Phase 3 (home feed) · Phase 4 (post types) · Phase 5 (meetings) · Phase 6 (department albums) · Phase 7 (settings/themes) — 2026-10-18

The platform is now **multi-tenant** (one install hosts many clubs, scoped by
`club_id` end to end), its **landing page is a club-wide feed**, posts carry
**media types + Yes/No/Maybe reactions**, the club can run **live meetings**
(`/meetings`) with host-approved joining and a per-meeting chat, **every
department has its own photo album**, and the whole UI has **light/dark themes
plus a Settings page and published Terms & Privacy**.

- **First page = Sign in / Create a club.** `POST /api/auth/create-club`
  (public `/signup`) creates a club, its five starter departments, and its
  first **Supervisor** (the founder). The old one-time `signup-supervisor`
  endpoint is **removed**. Inside a club, accounts are still only made on the
  **Supervisor → Leader → everyone else** chain (`POST /api/users`) — the
  Supervisor may also add **further Supervisors** (a club may have several).
- **Isolation** is enforced server-side: `authenticate` carries `club_id`;
  every query is club-filtered; department lookups use
  `deptPerms.getDept(slug, clubId)` / `deptInClub(deptId, clubId)`; users,
  applications, tasks and reports are club-scoped; chat socket rooms are
  `room:<clubId>:<key>`. A foreign-club row answers **404**.
- **DB migration** (additive, id-preserving): `departments` rebuilt once with
  `club_id` + `UNIQUE (club_id, slug)`; `club_id` added to root/standalone
  tables; legacy data folded into a default club "ISIGK Robotics".
- **Home feed (phase 3)**: route **`/`** is now `pages/Feed.jsx` — every
  department's posts in one newest-first timeline (`GET /api/posts/feed`,
  club-scoped, cursor-paginated, readable by guests; each card links to its
  department). The dashboard moved to **`/dashboard`**. The composer is reused
  with a department picker.
- **Post types & reactions (phase 4)**: a post is **text / image / video /
  poll** (`posts.type`); image & video store a public file, polls store 2–6
  options (`poll_options`) with one choice per member (`poll_votes`). Reactions
  are **Yes / No / Maybe** (`votes.value`), one per member, changeable. The
  `posts` and `votes` tables are rebuilt once (ids preserved) to widen their
  `CHECK`s; old `announcement/clip/offer` posts fold into `text`/`image`.
- **Client**: `/signup` is the "Create your club" form; the app shell shows the
  signed-in user's club name.
- **Meetings (phase 5)**: `/meetings` lists live rooms (**global / department /
  private**). **Only leadership may start one**; anyone who can see it may **ask
  to join** — a request stays `pending` until the **host** accepts. The
  `origin` column (`host` / `invited` / `requested`) is what stops a requester
  from letting themselves in: only an **invited** person may answer their own
  invite. Each meeting has its **own chat** (`meeting_messages`) readable and
  postable by **accepted participants only**; ending a meeting closes posting
  but keeps the transcript. All new tables, club-scoped, no legacy migration.
- **Department albums (phase 6)**: albums are no longer Media-only —
  `routes/media.js` resolves its target department from `department_id`
  (defaulting to **Media** for old callers). Any member browses a department's
  albums (guests 403); **that department's manager or a club leader** manages
  them (create / upload / delete a picture / delete an album / share to feed).
  `DELETE /api/media/albums/:id` unlinks an album's files. Client:
  `AlbumsGallery` + the renamed `AlbumTools` now render on **every** department
  page.
- **Settings, themes & policies (phase 7)**: the UI is fully token-driven, so
  dark mode is one `:root[data-theme="dark"]` block in `index.css` (plus
  `--on-accent` / `--avatar-ink` so filled controls and role avatars stay
  legible). `src/theme.jsx` stores `system | light | dark` in `localStorage`,
  applies it as `<html data-theme>` **before first paint**, and follows the OS
  live; a top-bar Sun/Moon toggle plus the **`/settings`** page drive it.
  Settings also offers a **Reduce motion** switch (`data-motion="reduced"`),
  account details and policy links. **`/terms`** is a public Terms / Acceptable
  Use / Privacy page, linked from `/login` and `/signup`. **No API change.**
- **Cross-tenant fix**: `routes/goals.js` was still global — a no-filter
  `GET /api/goals` returned **every club's** goals, and read/write accepted any
  `department_id`. Both are now gated by `deptInClub()` (foreign dept → **404**)
  and the unfiltered list is joined through `departments` and filtered by
  `club_id`. Regression-tested in the permissions suite.
- **Tests**: **61/61** pass across nine suites (incl. two-club isolation, the
  legacy-migration suite, the home-feed tests, the phase-4 reaction/poll/type
  tests, the phase-5 **meetings** suite, and the phase-6 **albums** suite).
  `vite build` clean, `oxlint` 0 errors. (Local/CI sets `ISIGK_NO_RATELIMIT=1` so
  suites aren't rate-limited.) Phase 7 is client-only (theme/settings/terms), so
  it adds no server tests and the count is unchanged.

---

## 1. What was wrong (audit findings)

| # | Finding | Severity |
|---|---------|----------|
| 1 | **CORS was a no-op.** `corsCheck` had the wrong signature, so the `cors` package ignored it and every response carried `Access-Control-Allow-Origin: *`. | High |
| 2 | **`npm test` crashed** — the test file was ESM inside a CommonJS package and used a non-existent helper API. Zero real coverage. | High |
| 3 | **Supervisor sign-up was "open forever"** — any internet visitor could self-promote to full access on a public URL. | High |
| 4 | **JWT secret had a public fallback** (`'isigk-robotics-dev-secret-change-in-prod'`) — forgeable tokens if the env was missing. | High |
| 5 | **Calendar was anonymous-public** (`GET /api/events` had no auth), wrong for a club-internal calendar. | Medium |
| 6 | **No brute-force protection** on login/sign-up. | Medium |
| 7 | **No self-service profile** (a required feature was missing). | Medium |
| 8 | Uploads accepted any client-supplied extension. | Low |
| 9 | `vercel.json` combined `functions` **and** `builds`, which Vercel documents as invalid, and had no explicit install step for the two sub-packages. | Medium |

Items 1, 2 and 5's *fix* were partially in place from the prior (uncommitted)
session; this pass completed them, added real tests, and fixed the rest.

---

## 2. Files changed

### Server (`platform/server/`)
| File | Change |
|------|--------|
| `index.js` | Fixed `corsCheck` to `(origin, callback)`; explicit `CORS_ORIGIN` allowlist (+ localhost only in dev); baseline security headers (`nosniff`, `X-Frame-Options`, `Referrer-Policy`); `/api/health` now reports `auth_configured` + `demo`. |
| `middleware/auth.js` | **Fail-closed** `JWT_SECRET` resolution: env → `.jwt-secret` file → generated (dev only); on hosted/prod with nothing set it becomes `null` and auth answers **503** instead of using a public default. |
| `middleware/rateLimit.js` | **NEW** — in-memory fixed-window limiter + `clientIp()` (reads `x-forwarded-for` behind Vercel). |
| `routes/auth.js` | Login rate-limited (10/IP+email, 40/IP); `POST /api/auth/create-club` (Phase 2) creates a club + its first Supervisor (rate-limited); 503 when auth isn't configured. |
| `routes/users.js` | **NEW** self-service profile: `PATCH /api/users/me` (name + bio) and `POST /api/users/me/password` (current password required). Role/department stay leader-only. |
| `routes/events.js` | `GET /api/events` now `authenticate`-gated (every member incl. guests reads; anonymous 401); multi-day `end_date` with validation. |
| `storage.js` | Upload **extension allowlist** + path-traversal guard; random on-disk names; signed private URLs unchanged. |
| `routes/storage.js` | Cron endpoint returns 404 unless `CRON_SECRET` matches (fail-closed). |
| `db.js` | `DB_PATH` parent-dir creation; demo seeding OFF on `VERCEL`/`NODE_ENV=production`; additive migrations only. |
| `routes/reports.js` | `tasksByStatus` statuses aligned to `todo/doing/done`. |
| `package.json` | `test` script fixed to `node --test test/*.test.js`. |
| `test/` | **NEW** CommonJS suite (6 files + `helpers.js`). |
| `middleware/auth.js`, `index.js` | (as above) |

### Client (`platform/client/src/`)
| File | Change |
|------|--------|
| `pages/Profile.jsx` | **NEW** — profile + password page (any signed-in user). |
| `App.jsx` | `/profile` route + sidebar "My profile" item. |
| `auth.jsx` | `refreshUser()` re-reads `/auth/me` after a profile save. |
| `api.js` | Central 401 handling (expired token clears session → `/login`); error carries `.status`. |
| `pages/Login.jsx` | Sign-up CTA wording → "Create a club — start your own club, you become its Supervisor". |
| `pages/Signup.jsx` | Phase 2: **"Create your club"** form (club name + your name/email/password) → `/auth/create-club`. |
| `pages/Calendar.jsx`, `Chat.jsx`, `Dashboard.jsx`, `DepartmentHome.jsx`, `Members.jsx`, `Reports.jsx`, `Storage.jsx`, `components/ui.jsx`, `index.css` | Supporting fixes carried from the prior session (calendar auth, layout/UI). |

### Root
| File | Change |
|------|--------|
| `vercel.json` | Removed the invalid `functions`+`builds` mix; added `installCommand` for both sub-packages; added `favicon.svg`/`icons.svg` static routes. |
| `README.md` | §2 one-time bootstrap + new server-side enforcement section; §11 auth row; §13/§15 env + API tables; new 2026-10-18 decisions entry; stale "open always" entry marked **SUPERSEDED**. |
| `PROJECT_REPORT.txt` | Trust chain, API overview, security model, deployment env, test coverage, routing diagram and changelog updated to match. |

---

## 3. Database migrations

**No destructive changes.** All schema changes are additive and run idempotently
at boot (`db.js`):
- `events.end_date` (multi-day events) — additive column.
- Any demo/seed gating only affects fresh installs (`ISIGK_DEMO_ACCOUNTS=0`
  seeds just the 5 departments; no users/content).

No table was dropped and no column was removed. Existing `club.db` files keep
working; Turso needs nothing manual.

---

## 4. Verification results

| Check | Command | Result |
|-------|---------|--------|
| Server test suite | `cd platform/server && npm test` | ✅ **61 / 61 passed** (9 suites, isolated temp DBs + ports 4310–4318) |
| Client production build | `cd platform/client && npm run build` | ✅ passes (1980 modules, no errors) |
| Lint | `cd platform/client && npx oxlint` | ✅ **0 errors** (31 pre-existing style warnings) |
| Server syntax | `node --check` on every server `.js` | ✅ clean |
| `vercel.json` | JSON parse | ✅ valid |

Suites: `auth` · `signup_chain` (fresh DB, 0 demo accounts; create-club +
two-club isolation) · `migration` (legacy DB → one club, ids preserved) ·
`calendar` (auth + role matrix) · `permissions` (role/IDOR matrix) ·
`workflows` (post/vote/comment, tasks, profile) · `security` (CORS allowlist,
signed uploads, extension/traversal, cron secret, JSON-not-HTML errors, no
password-hash leaks).

**Could not test:** the missing-`JWT_SECRET` 503 path inside the suite (a
local `.jwt-secret` file always exists here), and the **live Vercel deploy**
(not performed — see §6).

---

## 5. Security review — unresolved items

Carried or newly identified, in priority order:

1. **Rate limiter is per-instance.** On Vercel each function instance has its
   own counter, so it is a best-effort brake, not a global limit. For strict
   enforcement use Upstash (already in the stack) or Vercel Firewall.
2. **No token revocation.** A 7-day JWT stays valid after a password change or
   account removal isn't reflected until the next request's DB re-read (role is
   re-read, so removal *is* effective — but the token itself isn't revoked). Add
   a `token_version`/`jti` deny-list if needed.
3. **No email verification / password reset.** Registration takes an email as-is.
4. **No CSP.** The client loads the Jitsi iframe and inline styles, so a strict
   CSP belongs at the host/proxy layer, not in Express.
5. **Uploads** rely on an extension allowlist + (for images) `sharp`
   re-encode; there is no content sniffing or AV.
6. **No department-info edit endpoint** (pre-existing gap: managers can't edit
   their department's title/description via the API).
7. **`.jwt-secret` file** is used for self-host rotation only; rotate by
   replacing the env var and redeploying.
8. **Supervisors can be added, but not removed.** A club may have several
   Supervisors: an existing Supervisor creates them from the Members page
   (`POST /api/users`, role `supervisor`). Like Leader/Co-Leader they are
   protected from demotion and deletion, so a mistakenly-added Supervisor
   cannot be dropped yet (peer removal would need FK cleanup across
   meetings/notifications). The Leader/Co-Leader cabinet controls remain
   the next step.
9. **`create-club` is intentionally open.** Anyone may create a *new* club
   (they become its Supervisor and get nothing else); it is rate-limited
   (5/IP) but a determined visitor can still create clubs. Add a captcha or
   invite gate if the site is public.
10. **Drive backup is whole-database, not per-club.** The operator Storage
    panel/backup covers every club on the instance; a Turso-native per-club
    export is future work.
11. **Video uploads are capped at 50 MB, and Vercel caps a serverless body at
    ~4.5 MB** — so large videos won't upload on Vercel free tier (self-hosting
    is fine). A direct-to-Vercel-Blob upload (client PUTs the file, server
    stores only the URL) is the fix; not done yet. Images are unaffected.
12. **Meetings** are text-first: the chat is built in, but the optional video
    room is an **embedded `meet.jit.si` iframe** (an external service — no
    recording, and it needs the browser to allow the embed). Meeting chats
    have no attachments and no moderation tools yet; ended meetings keep their
    transcript readable by their participants.
13. **Department albums are visible to every club member** (guests excluded) —
    the same rule the Media albums always had. If a department's photos should
    be **private to that department** instead, the only change needed is the
    `GET /api/media/albums` guard (swap the guest check for `canViewDept`).
14. **The theme is per device/browser**, not stored on the account — it lives in
    `localStorage` (so it can apply before sign-in). Choosing dark on a phone
    does not change the desktop. Persisting it server-side would need a small
    `users` column + an endpoint; deliberately skipped to avoid a migration.
    The app also has no custom colour/contrast options beyond light/dark, and the
    Terms page text is generic (each operator should review it for their context).

---

## 6. Deploying (free tier) — Render (full product) or Vercel (serverless)

> **Not performed.** These are the exact steps for the user. The code is pushed
> to `origin/main`; use **6.0 (Render)** for the full product. **6.1–6.6 (Vercel)**
> work, but Vercel cannot run Socket.io with this code (see 6.1).

### 6.0 Option A — Render (recommended: live chat + large uploads)

Render runs a normal long-lived Node process, so **Socket.io works** and the
4.5 MB serverless body cap does not apply. The repo ships **`render.yaml`**.

1. **Turso** (free 5 GB, no card): `turso db create isigk-club`;
   `turso db show isigk-club --url`; `turso db tokens create isigk-club`.
2. **Vercel → Storage → Blob** (free Hobby 1 GB): create a store and copy
   `BLOB_READ_WRITE_TOKEN`.
3. **Render → New → Blueprint** → select `med-tlili/robotic_club`; `render.yaml`
   sets Node 22, the build (`client ci --include=dev + build`, `server ci --omit=dev`),
   the start command (`node platform/server/start-prod.js`), the health check, and
   asks for `TURSO_URL`, `TURSO_AUTH_TOKEN`, `BLOB_READ_WRITE_TOKEN`.
   `JWT_SECRET` is generated; `ISIGK_DEMO_ACCOUNTS=0` is preset.
4. Deploy → `https://<service>.onrender.com/api/health` should return
   `{"status":"ok","auth_configured":true,"demo":false}`.
5. Open `/signup` → create the club, then run **6.5** (skip the Vercel-specific
   notes).

**Free-tier caveats:** 750 instance-hours/month · sleeps after 15 min without
traffic, ~30–60 s to wake (Socket.io reconnects automatically) · Turso and Blob
persist everything, so no Render disk is needed. Optional monthly backup: point
an external cron at `GET /api/storage/cron-sync` with
`Authorization: Bearer <CRON_SECRET>`.

### 6.1 Option B (Vercel) — push the code

> **Caveat:** Vercel loads `index.js` via `module.exports` and the boot code
> returns before `server.listen()` (`if (process.env.VERCEL) return;`), so
> **Socket.io never starts**. Chat history and sending work over HTTP, but a
> sent text message only appears after reload and notifications are not live.
> Use 6.0 for the full product.
```bash
git add platform vercel.json README.md PROJECT_REPORT.txt HANDOVER.md
git commit -m "Security hardening, multi-club, home feed, post types + reactions, meetings"
git push
```
Careful: `git status` also shows **unrelated untracked media/artifacts** at the
repo root (`1012.mp3`, `*.mp4`, `layers/`, `robotics_club_video/`, `src/`,
`build_*.py`, `*.png`, `*.pptx`, `*.pdf`, `MONTAGE_README.txt`). Review before
committing — the commands above only add the platform + docs.

### 6.2 Create the project
1. Vercel → **Add New → Project** → import `med-tlili/robotic_club`.
2. Root Directory: **repository root** (leave default). Framework preset:
   **Other** (the root `vercel.json` drives `builds` + `routes`).

### 6.3 Add the backing services (Vercel Marketplace → each installs into the project)
- **Turso** → sets `TURSO_URL` + `TURSO_AUTH_TOKEN`
- **Vercel Blob** → sets `BLOB_READ_WRITE_TOKEN`
- **Upstash Redis** → sets `REDIS_URL` (live chat across instances; optional but recommended)

### 6.4 Environment variables (Project → Settings → Environment Variables)

| Variable | Required | Value |
|----------|----------|-------|
| `JWT_SECRET` | **YES** | long random string (`openssl rand -hex 48`) — without it auth answers 503 |
| `ISIGK_DEMO_ACCOUNTS` | recommended | `0` (no public `password123` demo accounts) |
| `CRON_SECRET` | if using the backup cron | another long random string |
| `CORS_ORIGIN` | no | comma-separated browser origins; leave unset for same-origin |
| `TURSO_URL` / `TURSO_AUTH_TOKEN` | yes | set automatically by the Turso integration |
| `BLOB_READ_WRITE_TOKEN` | yes | set automatically by the Blob integration |
| `REDIS_URL` | no | set automatically by the Upstash integration |
| `ISIGK_DRIVE_*` | no | only for Google Drive backups (see README §13) |

### 6.5 Deploy & smoke-test (do this once, right after the first deploy)
1. `https://<app>.vercel.app/api/health` → `{ "status":"ok", "auth_configured":true, "demo":false }`
2. Open `/` → the login page renders (static build OK).
2b. Sign in → `/` is the **Home feed** (all departments' posts, newest first);
    "New post" opens the composer with a department picker. A guest sees the
    feed read-only (no "New post", reactions disabled).
2c. In the composer pick **Poll**, add two options, publish → the poll shows
    clickable options with live counts; a reaction button set is **Yes / Maybe /
    No** (click again to undo). An **Image** post renders its picture; a
    **Video** post renders a player (keep it small — see §5 item 11).
2d. Open **Meetings** → "Start a meeting" (as Leader/Co-Leader/Manager) →
    publish a club-wide one. As another member, "Ask to join" → the meeting
    stays **Waiting**; as the host, **Accept** the request → that member can
    now read and post in the meeting chat. Confirm a member who was never
    accepted gets an error instead of the chat.
3. `/signup` → **Create your club** (club name + your name/email/password) →
   you land signed-in as that club's **Supervisor**.
4. Sign out; `/signup` again → a *second* club is created for a different email
   (multi-club); its Members list contains only its own people.
5. As Supervisor → **Members → Create account** → role **Leader** → log in as
   Leader; optionally add a **second Supervisor** and confirm both belong to
   the club.
6. `/calendar` loads; `/profile` saves a name/bio and changes a password.
7. Upload an image to a **department album** (its manager account) → the card
   shows a cover and the picture opens (Blob backend + signed URLs). Confirm
   another department's manager **cannot** add to it.
8. Open **Settings** → switch to **Dark** (whole UI recolours, top-bar toggle
   agrees), reload (stays dark), switch back to **System**; toggle **Reduce
   motion**. Open **`/terms`** while **signed out** (`/terms` directly) → the
   policy page renders.

### 6.6 Known deploy risks (verify in step 6.5)
- `vercel.json` uses Vercel's **legacy `builds` model** (still supported,
  documented as "legacy"). Static files are expected under
  `/platform/client/...` and the function at `/platform/server/index.js`.
  **If the SPA is blank or `/assets/*.js` 404s**, change the last three routes
  to root paths:
  ```json
  { "src": "/assets/(.*)",  "dest": "/assets/$1" },
  { "src": "/(.*)",         "dest": "/index.html" }
  ```
  (framework preset routes use root paths, so this is the alternative if the
  sub-directory namespace doesn't apply).
- Function **maxDuration** can no longer be set in `vercel.json` (incompatible
  with `builds`). If the Drive-backup cron times out, set it in
  **Project → Settings → Functions**. Normal API requests are fast.
- WebSockets on Hobby are capped at 300 s; the client auto-reconnects.

---

## 7. How to run locally

```bash
# API (dev, demo data)
cd platform/server && node index.js          # → http://localhost:4000
# App
cd platform/client && npm run dev            # → http://localhost:5173

# tests
cd platform/server && npm test
```

Demo accounts (password `password123`) exist only with `ISIGK_DEMO_ACCOUNTS`
unset — `supervisor@isigk.tn`, `leader@isigk.tn`, `member@isigk.tn`, `guest@isigk.tn`, …
