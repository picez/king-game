# Card Majlis — Production smoke checklist

A **10–15 minute** post-deploy pass. Run it after every production deploy (Render or
VPS). It confirms the five-game platform, rooms/stats/social, and the optional avatar
upload are live — **without** reading the full deployment docs.

- Full deploy guides: [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md) · [`DEPLOYMENT.md`](DEPLOYMENT.md)
- Deep QA (per-game, edge cases): [`QA_CHECKLIST.md`](QA_CHECKLIST.md)
- Release notes: [`CHANGELOG.md`](CHANGELOG.md). Confirm the deploy matches the intended
  release: `curl -s $HOST/health/diagnostics` → `version` should read **`0.3.4`** (tag `v0.3.4`).

Set your host once and reuse it below:

```bash
HOST=https://<your-service>.onrender.com      # no trailing slash
```

> **Avatar upload** needs a **Docker runtime with ffmpeg** *and* Postgres. On the native
> `runtime: node` service (the default), avatar upload is **expected to return `503`** —
> that is a PASS for the native path, not a bug. Everything else works either way.

> **Run migrations after every deploy (Postgres only).** If `DATABASE_URL` is set, run
> **`npm run db:migrate`** (Render Shell / Job) so the schema is current — **profiles/settings
> (0005–0008)** and **Friends (`0009_friends.sql`)**. A missing column surfaces as
> `/api/me → 503 migration_required`; Friends calls degrade to `503`/empty until 0009 is applied.
> **v0.3.4 adds no migrations** — 0009 is still the latest (the Durak reveal + online-timer polish
> is display-only; Tarneeb Solo stats reuse the existing schema under `game_type='tarneeb-solo'`).

---

## 0. v0.3.4 release smoke (fast targeted pass)

What v0.3.4 (Durak final-defence reveal + online timer polish, Stage 29.2) specifically touches,
plus the v0.3.3 correctness checks and v0.3.2 platform checks it rides on. All v0.3.4 changes are
**display-only** (no rules/scoring/schema change). The numbered sections cover each in depth.

- [ ] `curl -s $HOST/health/diagnostics` → `version` = **`0.3.4`**, `commit` matches the deploy,
      `db.enabled: true`, **`games.count: 5`**, `voice.ice` = `stun_only`|`turn_configured`,
      `avatarUploads` present. Then **`npm run db:migrate`** if any new migration (none in 0.3.4).
- [ ] **Durak trump/deck + final-defence reveal (v0.3.4):** on the Durak table the **face-up trump +
      draw pile are visibly larger** (~+22%) with no 360/390 overflow; and when the **last attack is
      beaten** (or the defender takes), the completed **attack+defence pair stays on the felt ~2 s**
      before the table clears — you can see the card that won the final bout (local + online).
- [ ] **Per-turn timer in every online game (v0.3.4):** host an online **Durak / Deberc / Tarneeb /
      Preferans** room with a **host timer set (30/60/90)** → a **⏱ Ns** pill shows at the top-centre
      and counts down each turn; with the timer **off** it does **not** appear; local play shows none.
      The **low-time sound** alert still fires **only on your turn**.
- [ ] **Tarneeb Solo trick UI (v0.3.4):** during a **Solo** game the standings strip shows **all 4
      players' live trick count (🃏 N)**, and a **larger dedicated "review my tricks" button** sits
      under the standings (reachable on 360/390). **Pairs** is unchanged (compact topbar team badge).
- [ ] **Arabic RTL (v0.3.4):** with the language set to Arabic, the **timer pill**, the **Tarneeb Solo
      standings**, and the **Durak table** (larger trump/deck + lingering last bout) all mirror
      correctly with **no horizontal overflow** at 360/390.
- [ ] **Tarneeb scoring (v0.3.3) — Pairs AND Solo:** in the hand-complete panel, a declarer who
      takes **exactly** the bid scores **bid×2** (bid 7 → **+14**, with the "✨ exact bid double"
      note); **more** than the bid scores the **actual tricks** (bid 7, 10 tricks → **+10**); a
      **failed** contract is unchanged (declarer −bid; defenders bank their tricks). A signed-in
      **Solo** game's per-seat delta reflects the corrected score in the **Solo** stats tab (Pairs
      tab still separate/unchanged).
- [ ] **Deberc table sizing (v0.3.3):** on the Deberc table the **played trick cards are slightly
      smaller** and the **face-up trump + stock deck are ~20% larger**; no horizontal overflow at
      360/390 and no overlap with the hand/actions/seats.
- [ ] **Static bandwidth (§3a):** `curl -sI $HOST/cards/faces/spades-a.png` → `200 image/png` +
      `cache-control: public, max-age=604800` + an ETag; `$HOST/cards/faces/AS.png` → **404**
      (not the html shell); `If-None-Match` repeat → **304**.
- [ ] **Deberc Solo/Pairs:** host a **Solo (3)** room → lobby shows 3 individual seats (no Team
      A/B); a **Pairs (4)** room → Team A/B grid.
- [ ] **Tarneeb Solo (§5a) — cross-device:** host a **Solo** room; the **Join room browser** lists
      it as **"Tarneeb · Solo"**; its lobby shows **4 individual seats (no Team A/B)** + the
      every-player-for-self hint; an **invite/join** from a second device lands in the **same Solo**
      room; **Start** → each client sees **only its own hand**; bidding 3–13 / trump / follow-suit
      all legal; **rematch** restarts a **Solo** room. A **Pairs** room is unchanged (Team A/B grid).
- [ ] **Solo stats + achievement (§7):** a signed-in **Solo** finished game increments the profile
      **Tarneeb → Solo** tab (Pairs tab unchanged) and the **Solo** leaderboard; after a Solo win the
      **"Tarneeb Soloist" 🗡️** badge is earned; **All-Rounder** is unaffected by solo.
- [ ] **Mobile/RTL + social sanity:** 360/390 portrait — Tarneeb host Pairs/Solo picker, solo
      standings, stats Pairs/Solo toggle, achievements grid: no horizontal overflow; Arabic RTL
      reads correctly. Voice/friends still work in a Tarneeb Solo room (no regression from the
      new variant).
- [ ] **Auth:** Google sign-in works; signed-in `/api/me` returns the profile (not `503`).
- [ ] **Avatar:** upload a small/compressed image on a Docker+ffmpeg deploy → appears on your
      seat and others' seats (native `node` runtime → `503` is an expected PASS).
- [ ] **Friends:** add by **friend code**; incoming-request **badge** shows; friends list is
      **online-first**; the Lobby shows the **Invite friends** block; tapping **Join** on an
      invite **actually joins the room** (not just a prefill).
- [ ] **Rematch:** solo + bots → **Play again restarts the same online game** (stays in the room,
      not the menu); multiple humans → it **waits until all are ready**.
- [ ] **Voice:** two clients on the same Wi-Fi hear each other; a cross-network pair needs a
      **TURN** relay if STUN-only fails (falls back to text — expected).
- [ ] **Gameplay 27.x:** Tarneeb bidding **starts at 3**; Tarneeb **trump obligation** (void in
      led + holding trump ⇒ must trump); Deberc **low-trump exchange** (7 at 3p / 6 at 4p); the
      last card of a trick **lingers ~2 s**; **no blank cards** while art loads.
- [ ] **Mobile:** 360/390 portrait + **Arabic RTL** quick pass on menu / profile sections /
      lobby / one in-game table — no horizontal overflow.

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
      `connections`, `games {count,ids}`, `voice {ice}` (Stage 25.6 — `stun_only` or
      `turn_configured`, **never a credential**), and `avatarUploads {status,reason,ffmpeg,database}`.
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

### 3a. Static bandwidth / caching (Stage 28.1 / 28.1b)

> Repeat visits must re-download almost nothing — the ~10 MB of card faces + hero art
> are cached, so only a tiny 304 revalidation goes over the wire. Verify the headers.

**⚠️ Use the REAL asset paths.** Card faces are named `{suit}-{rank}.png` **lower-cased**
(e.g. `spades-a`, `clubs-10`, `hearts-k`) — there is **no** `AS.png` / `10C.png`. A wrong or
missing name now returns a real **404** (Stage 28.1b), *not* the HTML app shell — so if you see
`content-type: text/html` on a `.png` URL, the **filename is wrong**, not the server. Three real
URLs (basename varies per build for the hashed one):
`/cards/faces/spades-a.png` · `/visual/icons/game-king.png` · `/sounds/bid-tick.mp3`.

`curl` (Linux/macOS/Git-Bash):

- [ ] **Hashed bundle is immutable:** `curl -sI $HOST/assets/<index-*.js> | grep -i cache`
      → `cache-control: public, max-age=31536000, immutable`.
- [ ] **Card face is cached a week + real MIME + ETag:**
      `curl -sI $HOST/cards/faces/spades-a.png` → `HTTP/… 200`, `content-type: image/png`,
      `cache-control: public, max-age=604800`, a `W/"…"` `etag`, `last-modified`. (Also
      `/visual/icons/game-king.png` → `image/png`, `/sounds/bid-tick.mp3` → `audio/mpeg` — never
      `application/octet-stream`.)
- [ ] **Missing / wrong file-like path is a 404, NOT the shell:**
      `curl -sI $HOST/cards/faces/NOPE.png` → `HTTP/… 404` + `content-type: text/plain`
      (a 200 `text/html` here is the bug fixed in 28.1b).
- [ ] **App routes still fall back to the shell:** `curl -sI $HOST/profile` and `$HOST/?room=ABCD`
      → `HTTP/… 200`, `content-type: text/html`, `cache-control: no-cache`.
- [ ] **304 revalidation works (the bandwidth win):**
      `curl -sI $HOST/cards/faces/spades-a.png -H 'If-None-Match: <the ETag>'` → **`304`**, empty body.
- [ ] **App shell revalidates:** `curl -sI $HOST/ | grep -i cache` → `no-cache`; same for
      `$HOST/sw.js` and `$HOST/manifest.webmanifest`.
- [ ] **Text is gzipped:** `curl -sI -H 'Accept-Encoding: gzip' $HOST/assets/<index-*.js>`
      → `content-encoding: gzip` + `vary: Accept-Encoding`. A `.png` with the same header is **NOT**
      gzipped (already compressed).
- [ ] **Dynamic stays uncached:** `curl -sI $HOST/api/me` and `$HOST/auth/google/start` → `no-store`.

PowerShell (Windows) — `Invoke-WebRequest -Method Head`:

```powershell
$H = "https://king-game-cqgd.onrender.com"
# Real card face → 200 image/png, week cache, ETag
(iwr "$H/cards/faces/spades-a.png" -Method Head -UseBasicParsing).Headers |
  Format-Table Content-Type, Cache-Control, ETag, Last-Modified
# Wrong/missing name → 404 (NOT the html shell). -SkipHttpErrorCheck on PS7+, or wrap in try/catch:
try { iwr "$H/cards/faces/AS.png" -Method Head -UseBasicParsing } catch { $_.Exception.Response.StatusCode }  # NotFound
# 304 revalidation
$et = (iwr "$H/cards/faces/spades-a.png" -Method Head -UseBasicParsing).Headers.ETag
(iwr "$H/cards/faces/spades-a.png" -Method Head -Headers @{ 'If-None-Match' = $et } -UseBasicParsing).StatusCode  # 304
```

- [ ] **Render usage sanity:** after a day of normal play, Render → Metrics → Bandwidth
      grows far slower than before (repeat sessions hit browser cache, not the origin).

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
- [ ] **Cards render, never blank (Stage 25.8):** every dealt/table card shows artwork or its
      **rank+suit text** fallback — no blank rectangles (even right after a deploy, before the
      card art is cached).
- [ ] **Last-card reveal delay (Stage 25.8):** the final card of a trick/bout stays readable
      (~1 s) before play advances in every game — King/Deberc (server pause), Tarneeb/Preferans
      (client review), Durak (bout lingers before the table clears).

### 5a. Tarneeb Solo mode (Stage 28.4)

- [ ] **Local:** Tarneeb setup shows a **Pairs / Solo** picker (default Pairs). Start **Solo** →
      a 4-player cutthroat table: **no Team A/B labels**, a **4-player standings strip**, own-tricks
      viewer, and at 41 an **individual** winner (🏆 You won / "{name} won"). **Play again** works.
- [ ] **Online host + lobby:** Host sheet Pairs/Solo picker; a **Solo** room's lobby reads
      **"♠️ Solo"** with **4 individual seats** (no team grid); **Pairs** reads "♠️ Pairs" with the
      Team A/B grid. Add bots → Start works for both.
- [ ] **Rematch:** finishing a Solo online match and rematching restarts a **Solo** room (not Pairs).
- [ ] **Stats:** with Postgres, after a signed-in Solo game, Profile → Stats → Tarneeb → **Solo**
      toggle shows the solo aggregates; the **Pairs** toggle is unaffected. Leaderboard → Tarneeb →
      **Solo** ranks solo players. **No new DB migration** — solo reuses the existing schema under
      `game_type='tarneeb-solo'` (latest migration stays **0009**; `curl -sI $HOST/api/games/tarneeb/stats?variant=solo`
      responds 200 for a signed-in user).

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
30 s (`AVATAR_UPLOAD_TIMEOUT_MS`) → an inline **timeout** message; a **408** → "server took
too long to receive the image"; a **503** → **unavailable**; offline → **network**. The safe
error **code** shows in small text; the **same file can be re-selected** to retry.

**Client precompression (Stage 24.8):** the synced upload **compresses in the browser first**
— decode → center-crop → 192×192 → WebP (JPEG fallback) via a quality ladder targeting
**≤ 100 KB** — so even a multi-MB photo POSTs a tiny payload (a ~680 KB PNG → ~1–3 KB WebP).
The button shows **"Preparing image…" → "Uploading…"**. The server still validates magic
bytes / size and re-encodes (authoritative). This makes a Render timeout unlikely.

**Tiny-image happy path (uploads ON):** sign in and upload a **normal photo** (any size up
to the 2 MB input cap) or a known-good png/jpeg/webp:
- [ ] Expect **`200 {"avatarImageUrl":…}` within ~a few seconds** (not 30 s). The Render logs
      show the phase trace ending in `db_write_ok` → `response_sent <ms>` (see RENDER_DEPLOY).
- [ ] `curl -sI $HOST/api/avatar/<uuid>.webp` → `200 image/webp`; the avatar updates on the
      Profile + lobby seat.
- [ ] If it fails, it returns a **safe server error within ~20 s** (408/503) with a visible
      message + code — **never** the client's own 30 s timeout. If you hit
      `processing_unavailable` or `upload_timeout`, read the phase trace to see which phase
      stalled (body read / ffmpeg / db write).

## 9. Social

- [ ] In an online room, **chat** delivers to the other client.
- [ ] **Sticker** picker + a **reaction** float both work and never cover the hand/table
      (check at a 360/390-wide window). Media is whitelist-only (no free URLs/uploads).
- [ ] **Friends presence + badge + invite (Stage 25.2 + 25.7, needs Postgres + 2 signed-in
      accounts):** A adds B by code → B sees a **red badge** on the ⚙️ Profile tile + Friends tab
      and an incoming request; B **Accepts** → badge clears. With both **just on the menu**, each
      shows the other **Online** (chip); closing a tab flips to **Offline** within seconds. A hosts
      a room → the Lobby's **"👥 Invite friends" block INSIDE the lobby card, after the players**
      (Stage 25.9 — visible without scrolling) shows B with **Invite** → B gets a **"Join room" /
      Dismiss** toast (works on the menu too). **Join room actually joins** A's lobby (Stage 26.1 —
      not just a prefilled sheet); from inside another room it **confirms** before leaving; in the
      same room it just dismisses; the `?room=` deep-link still prefills. States: guest → "Sign in
      to invite friends"; loading → "Loading friends…"; error → "Could not load friends" + Retry;
      none → "Add friends in Profile". Inviting offline/non-friend/outside-a-room → a small inline
      notice. No email/token/session on the wire (invite carries a room code only).
- [ ] **Online rematch / Play again (Stage 25.9):** finish an online game. **Play again** restarts
      the **same game in the same room** (NOT back to menu). One human + bots → immediate restart;
      two humans → both must tap Play again (one sees the other's "wants a rematch"), no auto-start.
      `REMATCH_*` frames carry only clientIds + a count (no token/session/email).
- [ ] **Voice chat (Stage 25.4–25.7, opt-in):** in an online Lobby the **Voice chat** card shows
      **Join voice** (default off). It needs **HTTPS** for the mic (`getUserMedia` is blocked on
      plain HTTP). With two contexts in the same room — **two tabs on one PC**, or a **phone +
      desktop on the SAME Wi-Fi** (both connect on STUN) — Join → grant mic → **they hear each
      other** and the card's **status block** reads **Mic: allowed · Peers: 1/1 · Connection: connected ·
      Audio: playing** (the ICE-buffering fix + the DOM-attached audio sink make the mesh connect
      and play; the ICE line shows the raw state new→checking→connected, Audio shows
      playing/blocked/no-track — Stage 25.7/25.8). If every peer is **failed**, the card shows a
      **"TURN may be required"** hint.
      Mute/Leave work; leaving the room drops voice (**no dangling mic indicator**). Deny the mic
      → a clear "permission denied" note **+ a browser-settings hint**, and **text chat still
      works**. **Reconnect (25.5):** briefly drop one client's network while in voice → on
      reconnect the mesh **rebuilds itself** (no duplicate peers, mute preserved); a peer that
      stays down shows **"reconnecting…"/"failed"** and you can Leave + Join again. Backgrounding
      the tab/PWA does **not** auto-rejoin. **STUN-only by default** → some strict-NAT users can't
      connect P2P (expected — text fallback). **No audio/SDP is server-side, no recording, no DB,
      no TURN secret in any log** — the WS carries only signaling strings + clientId/name/muted.
- [ ] **Voice ICE / TURN config (Stage 25.6):** `curl -s $HOST/health/diagnostics` → `voice.ice`
      is `stun_only` (default) or `turn_configured` — **and carries no credential**.
      `curl -s $HOST/api/voice/ice-config` → `{ "iceServers": [...] }` (STUN by default). In the
      Lobby Voice card the small **"Network: STUN"/"TURN + STUN"** indicator matches.
- [ ] **Two-network voice test (only if TURN is configured** via `VOICE_ICE_SERVERS` /
      `VITE_VOICE_ICE_SERVERS`): join the same room from **two genuinely different networks** —
      e.g. one on home Wi-Fi and one on a **phone's mobile data / hotspot** (mobile-carrier CGNAT
      is exactly the strict-NAT case STUN can't traverse). Both **Join voice** → they hear each
      other. With STUN-only this pair typically **fails to connect P2P** and falls back to text;
      with TURN it **connects via the relay**. Confirm `voice.ice=turn_configured` and that **no
      credential appears** in DevTools console / network logs / diagnostics.

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
