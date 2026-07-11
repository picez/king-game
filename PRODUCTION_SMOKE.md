# Card Majlis — Production smoke checklist

A **10–15 minute** post-deploy pass. Run it after every production deploy (Render or
VPS). It confirms the five-game platform, rooms/stats/social, and the optional avatar
upload are live — **without** reading the full deployment docs.

- Full deploy guides: [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md) · [`DEPLOYMENT.md`](DEPLOYMENT.md)
- Deep QA (per-game, edge cases): [`QA_CHECKLIST.md`](QA_CHECKLIST.md)
- Release notes: [`CHANGELOG.md`](CHANGELOG.md). Confirm the deploy matches the intended
  release: `curl -s $HOST/health/diagnostics` → `version` should read **`0.2.0`** (tag `v0.2.0`).

Set your host once and reuse it below:

```bash
HOST=https://<your-service>.onrender.com      # no trailing slash
```

> **Avatar upload** needs a **Docker runtime with ffmpeg** *and* Postgres. On the native
> `runtime: node` service (the default), avatar upload is **expected to return `503`** —
> that is a PASS for the native path, not a bug. Everything else works either way.

---

## 1. Build / boot (Render dashboard → Logs)

- [ ] Deploy finished **Live** (no build error).
- [ ] Boot log shows, in order:
  ```
  [King] server-authoritative server listening on 0.0.0.0:<PORT> (production)
  [King] serving static client from .../dist (single-service mode; WS on /ws)
  [King] database: DATABASE_URL set — /health probes Postgres      # (or: disabled (no DATABASE_URL))
  [King] avatar uploads: ffmpeg found — uploads work when DATABASE_URL is set
  #  ^ Docker runtime. Native runtime logs: avatar uploads: ffmpeg NOT found … (expected → 503)
  ```

## 2. Health

- [ ] `curl -s $HOST/health` → `{"status":"ok","db":"disabled"|...,"rooms":N,"uptime":N}`
      (`db` is `disabled` without Postgres; it probes Postgres when `DATABASE_URL` is set).
- [ ] `curl -s $HOST/health/diagnostics` → a safe operational snapshot (Stage 24.0):
      `status`, `version` + short `commit` (if the build env sets `RENDER_GIT_COMMIT`),
      `uptime`, `db: enabled|disabled|error|migration_required`, `rooms {total,open,inGame}`,
      `connections`, `games {count,ids}`, and `avatarUploads {status,reason,ffmpeg,database}`.
      Confirms the build/commit, room + socket load, and avatar readiness at a glance.
      `db:error` = a configured DB whose probe failed; `db:migration_required` = reachable but
      a required `user_settings` column is missing → **run `npm run db:migrate`** (see
      RENDER_DEPLOY). Either way `/api/me` never traps the Profile. **Privacy:** aggregate
      counts / booleans / public game ids only — **no** user/room/session/email/token/chat/card
      (one cheap `select 1` + `information_schema` column check, cached ~30 s).
- [ ] `curl -s $HOST/api/me` → **`200 {"authenticated":false}`** before login. If it is
      **`503 {"error":"migration_required"}`**, run `npm run db:migrate` (Render Shell / Job);
      `503 {"error":"db_error"}` is a transient Postgres blip — retry.

## 3. Static app + game catalog

- [ ] `$HOST/` loads the **Card Majlis** menu (subtitle lists King, Durak, Deberc,
      Tarneeb & Preferans); no console errors (DevTools → Console).
- [ ] `curl -s $HOST/api/games` → `{ "games": [ … ] }` with **5** ids
      `king, durak, deberc, tarneeb, preferans`, every one `"status":"available"` and
      `supportsLocal/supportsOnline/supportsBots: true`. No private fields (`rulesDoc` absent).

## 4. Auth

- [ ] Guest identity works out of the box (a name + emoji avatar appear top-left).
- [ ] **If Google sign-in is enabled** (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` +
      `PUBLIC_BASE_URL` set): "Sign in with Google" completes and the display name/avatar
      persist. **If not configured:** `curl -s $HOST/auth/google/start` → `503 oauth_disabled`
      (expected) and the app still works as guest.

## 5. Five-game smoke (Local + Host)

For **each** of King, Durak, Deberc, Tarneeb, Preferans:

- [ ] **Local** sheet lists the game (icon + `👥 <players> · <meta>`), selectable — no
      "Coming soon"/"Experimental" tag.
- [ ] **Host** sheet lists the game; **Create room** succeeds and the Lobby opens.
- [ ] **Add bots → Start** deals a hand and the game screen renders (bidding/play as
      appropriate). Seat counts: King 3–4, Durak 2–5, Deberc 3–4, Tarneeb 4, Preferans 3.
- [ ] Each game shows its **own PNG emblem** (King crown / Durak / Deberc gem / Tarneeb
      star / Preferans top hat) — not a bare emoji.

## 6. Rooms / invite

- [ ] Room browser lists your open room with the correct game icon + meta + player count.
- [ ] Lobby **Copy link** produces exactly `"<origin>/?room=<CODE>"` — **only** the room
      code (no token/session/userId).
- [ ] Opening that link in a second tab prefills the Join sheet with the code (does **not**
      auto-join); joining works.
- [ ] **Leave lobby** before start frees the seat.

## 7. Stats / leaderboard (needs Postgres + migrations)

- [ ] Finish a **human-vs-human** online game (two signed-in tabs, **no bots**).
- [ ] Profile → **My stats** → that game shows a non-empty record; **Leaderboard** lists
      your row (highlighted "you"). (Bot games / no Postgres → empty is expected.)
- [ ] Profile → **Achievements** → at least "First Win" is earned after a win.

## 8. Avatars

**Docker runtime + Postgres (uploads ON):** signed in,

- [ ] Profile → avatar → **Synced** → choose a small **png/jpg/webp** → **200** and the
      avatar updates. `curl -s $HOST/api/me` (with your session cookie) shows
      `"avatarImageUrl":"/api/avatar/<uuid>.webp?v=1"`.
- [ ] `curl -sI $HOST/api/avatar/<uuid>.webp` → `200`, `content-type: image/webp`,
      `x-content-type-options: nosniff`.
- [ ] Your uploaded avatar shows on your **lobby seat** (other clients see it too).
- [ ] **Delete** → `200 { "avatarImageUrl": null }`; the seat falls back to the emoji.

**Native runtime (uploads OFF — expected):**

- [ ] Upload attempt → clean **`503`** and the inline message "Avatar processing is
      unavailable on this server." — **no crash**; emoji avatars keep working everywhere.

**Never-stuck (any runtime):** the **"Upload synced avatar"** button must ALWAYS return to
its normal label after an attempt — it never stays on "Uploading…". The client aborts after
30 s (`AVATAR_UPLOAD_TIMEOUT_MS`) → an inline **timeout** message; a 503 → **unavailable**;
an offline/network failure → **network**; and the **same file can be re-selected** to retry
(the input is reset). Check `curl -s $HOST/health/diagnostics` → `avatarUploads.status` is
`enabled` only when `ffmpeg:true` **and** `database:true`; otherwise uploads answer `503` fast.

## 9. Social

- [ ] In an online room, **chat** delivers to the other client.
- [ ] **Sticker** picker + a **reaction** float both work and never cover the hand/table
      (check at a 360/390-wide window). Media is whitelist-only (no free URLs/uploads).

## 10. PWA — install / update / offline / icons

- [ ] Browser tab shows the **favicon**; `curl -sI $HOST/icons/icon-192.png` and
      `.../icon-512.png` → `200`.
- [ ] **Install:** on Android Chrome (not already installed), a bottom **"Install Card
      Majlis — Play faster from your home screen"** card appears with **Install** + **✕**.
      Install adds it to the home screen; **✕** dismisses it (stays hidden afterwards).
      It never shows during a game, and iOS Safari shows no card (expected — use Share →
      Add to Home Screen there).
- [ ] **Update:** after deploying a new build, reopening the installed app shows a thin
      top **"Update available"** pill with **Refresh**. Tapping Refresh reloads into the
      new version; **nothing auto-refreshes mid-game**.
- [ ] **Offline:** toggle the device offline → a thin **"You're offline. Local games may
      still work."** pill shows at the top (never covering the ✕ / hand / actions); it
      auto-hides when back online. Local play still starts offline.
- [ ] **Installed feel (Stage 23.0):** launch from the home screen (standalone). On a
      notched phone the **hand + action bar + social FABs clear the home indicator**, the
      **top pills clear the notch**, there is **no horizontal scroll**, and rotating to
      landscape shows **no blocker** (content just adapts).

## 11. Security spot-checks

- [ ] Invite URL contains **only** `?room=CODE` (re-confirm from §6).
- [ ] `curl -sI $HOST/api/avatar/not-a-real-id.webp` → **`404`** (client falls back to
      emoji; never a stack trace).
- [ ] No opponent hand leaks: in a 2-human room, each client only ever sees its **own**
      cards (others show face-down counts).
- [ ] Server logs show **no errors/stack traces** during the smoke; browser Console clean.

---

**If every box is checked, the deploy is production-ready.** Anything unexpected →
see [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md) (deploy/ffmpeg/DB) or
[`QA_CHECKLIST.md`](QA_CHECKLIST.md) (feature detail).
