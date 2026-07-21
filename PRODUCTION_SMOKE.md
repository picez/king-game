# Card Majlis — Production smoke checklist

A **10–15 minute** post-deploy pass. Run it after every production deploy (Render or
VPS). It confirms the six-game platform, rooms/stats/social, and the optional avatar
upload are live — **without** reading the full deployment docs.

- Full deploy guides: [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md) · [`DEPLOYMENT.md`](DEPLOYMENT.md)
- Deep QA (per-game, edge cases): [`QA_CHECKLIST.md`](QA_CHECKLIST.md)
- Release notes: [`CHANGELOG.md`](CHANGELOG.md). Confirm the deploy matches the intended
  release: `curl -s $HOST/health/diagnostics` → `version` should read **`0.4.2`** (tag `v0.4.2`).

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
> **v0.4.2 adds no migrations** — 0009 is still the latest. v0.4.2 is **mobile app readiness** (Stages
> 33.0–33.6): a **docs + PWA** patch — Android **TWA** strategy/scaffold/runbook, the **iOS PWA-only**
> decision, and a web-only **iOS "Add to Home Screen" hint**. **No native app is built or submitted, no
> dependency, no schema change**; the only runtime change is the iOS install hint. The prior v0.4.1
> **Achievements expansion** (14→29 badges, derived from existing stats — see §7) and v0.4.0 Tutorials are
> intact. The v0.3.7 Syrian 51 release records its stats under the free-text `game_type='fifty-one'`.

---

## 0. v0.4.2 release smoke (fast targeted pass — mobile app readiness)

v0.4.2 is a **docs + PWA** patch (Stages 33.0–33.6): the **Android TWA** strategy/scaffold/runbook, the
**iOS PWA-only** decision, and a web-only **iOS "Add to Home Screen" hint**. **No native app is built or
submitted, no schema change**; the released six-game state and the v0.4.1 achievements are intact. The
only runtime change to smoke is the **iOS hint**. Android TWA scaffold hygiene is §10b; iOS PWA + hint is
§10c; achievements §7; tutorials §5c; 51 §5b.

- [ ] `curl -s $HOST/health/diagnostics` → `version` = **`0.4.2`**, `commit` matches the deploy,
      `db.enabled: true` (`db` status), **`games.count: 6`** with `ids` including **`fifty-one`**,
      `voice.ice` = `stun_only`|`turn_configured`, `avatarUploads` present.
      Then **`npm run db:migrate`** if any new migration (none in 0.4.2 — latest stays `0009`).
- [ ] **iOS install hint (Stage 33.6, the only runtime change):** on **iOS Safari**, the **menu** shows a
      dismissible **"Install Card Majlis — Tap Share, then Add to Home Screen"** card — **not** during a
      game, **not** once installed (standalone), and it **stays hidden after ✕** (persisted). No fake
      install button. On Android/desktop it does **not** appear (that path keeps the Chrome install card).
- [ ] **Android TWA (owner machine, optional — no app is shipped in this release):** `android-twa\
      check-env.ps1` → JDK **PASS** (17+); `npx @bubblewrap/cli@latest init --manifest
      https://king-game-cqgd.onrender.com/manifest.webmanifest` (package `com.cardmajlis.app`) →
      `.\gradlew.bat assembleDebug` → `adb install -r app\build\outputs\apk\debug\app-debug.apk`. The
      debug APK is **debug-signed → shows a Custom Tab URL bar** until a real `assetlinks.json` matches;
      then smoke **Google login**, **online rooms**, **voice mic**, **hand drag**, **tutorials**. (§10b.)
- [ ] **iOS PWA smoke:** Safari → **Share → Add to Home Screen** → launches **standalone**; **Google
      login**, an **online room** (`wss://…/ws`), **voice** mic prompt, and a **tutorial** all work; the
      install hint is hidden in standalone. (§10c.)
- [ ] **Asset Links caveat:** the repo ships **only** `assetlinks.example.json` (placeholder). A real
      `/.well-known/assetlinks.json` is added **only** after enrolling in **Play App Signing** and using
      that certificate's **SHA-256** (not the upload/debug key) — until then `…/assetlinks.json` is a
      **404** and the TWA runs as a Custom Tab. (See [`android-twa/README.md`](android-twa/README.md).)
- [ ] **Achievements expansion (Stage 32.1, DB-backed):** signed in with real/seeded stats, Profile →
      **Achievements** shows **29** badges (dynamic `n/29`) at **360/390** with no horizontal overflow
      (Arabic RTL mirrors). A first win in **Deberc / Tarneeb Pairs / Preferans / 51** flips that game's
      new **winner** badge; **Six-Game Regular** unlocks after playing every game; **All-Rounder** still
      needs a win in all six; **Tarneeb Soloist** stays separate from Pairs; **Uncommon** badges show a
      green accent. (Full detail §7.)
- [ ] **Tutorials (all 6):** the main menu shows a **🎓 Tutorials** tile → a hub listing **all 6 games**,
      **every** row **Start**-able (no "Coming next"). Open **each** tutorial and step to **Done** — King,
      Durak, Deberc, Tarneeb, Preferans, 51 — highlighted cards + short captions; Back/Next/Skip/←→/Esc
      work; Done/Skip return to the hub (never a live game). **No network call** fires (DevTools quiet).
      **360/390 no horizontal overflow**; **Arabic RTL** mirrors and card runs still read low→high. (§5c.)
- [ ] **Hand drag (all 6 games):** in each game **drag a card** within your hand (touch/mouse/pen) to
      reorder; a quick **tap still plays/selects**. After a manual reorder a **newly drawn card lands on
      the LEFT**; **↺ Auto-sort** resets. It is **display-only** — nothing is sent to the server and
      opponents' views never change. No horizontal overflow at 360/390; on a **touch device** the drag
      works and **Arabic (RTL)** reads correctly.
- [ ] **Team names (Tarneeb / Deberc Pairs):** the two teams read like **"Alex & Dina"** vs
      **"Niko & Yara"** in the lobby, HUD and finished screens (fallback **"Team Alex"** while a seat is
      empty). **Solo** modes show individual names.
- [ ] **51 polish (Stages 30.13–30.15):** before opening, **plain take-discard is blocked** — you can
      only take the discard top via **"Take & open 51"** (it must be in your ≥51 opening). After
      opening, an **opened player can Replace a table joker** with the exact card it stands in for
      (wrong rank/suit or unopened is refused). The setup/host sheets offer the **elimination score
      210/310/410/510** (default 510), the lobby shows **`☠ <score>`**, and it survives **rematch**.
      Public-meld cards are **readable — no overlap/clip, no 360/390 overflow**; signed-in **51 stats**
      still record. (Full detail §5b.)
- [ ] **Deberc rule fixes (Stage 30.16):** the **🔄 Swap low trump** button appears **only** when the
      exposed table card is a **real trump** and your 7/6 was **dealt to hand** (not from the прикуп);
      a **5-card Палтіна beats a 4-card Палтіна** regardless of top card; **Бела** is declared **at play
      time** (🔔 toggle + a trump **K/Q**) and scores **20 only if that trick is won**; the played
      **table cards are ~10% smaller** (trump/stock unchanged). (More detail in the Deberc rule-fix
      item further down §0, and the six-game smoke §5.)
- [ ] **51 (Syrian 51) is a released 6th game (v0.3.7):** `GET /api/games` lists `fifty-one` as
      `status:'available'`, `supportsLocal/Online:true`; the **Local and Host pickers** show 51 as a
      normal, selectable option with **no** "Experimental" / "Coming soon" tag and its own PNG emblem;
      it appears in the **favorite-game** picker and the Profile **stats/leaderboard** selectors. Full
      local + online play, stats, favorite and achievement smoke is in **§5b**.
- [ ] **51 game emblem static asset (v0.3.7):** `curl -sI $HOST/visual/icons/game-fifty-one.png` →
      **`200`**, `content-type: image/png`, an immutable/`max-age` cache header, and a size **< 150 KB**
      (the two-fanned-cards emblem, ~26 KB). It renders in the picker/lobby (not the emoji fallback).
- [ ] **Durak trump/deck + final-defence reveal (v0.3.4):** on the Durak table the **face-up trump +
      draw pile are visibly larger** (~+22%) with no 360/390 overflow; and when the **last attack is
      beaten** (or the defender takes), the completed **attack+defence pair stays on the felt ~2 s**
      before the table clears — you can see the card that won the final bout (local + online).
- [ ] **Per-turn timer in every online game (v0.3.4, repositioned in 29.5):** host an online **Durak /
      Deberc / Tarneeb / Preferans** room with a **host timer set (30/60/90)** → a **⏱ Ns** pill shows
      at the **bottom of the table** (moved from top-centre in Stage 29.5) and counts down each turn;
      with the timer **off** it does **not** appear; local play shows none. The **low-time sound**
      alert still fires **only on your turn**.
- [ ] **Tarneeb Solo trick UI (v0.3.4):** during a **Solo** game the standings strip shows **all 4
      players' live trick count (🃏 N)**, and a **larger dedicated "review my tricks" button** sits
      under the standings (reachable on 360/390). **Pairs** is unchanged (compact topbar team badge).
- [ ] **Arabic RTL (v0.3.4):** with the language set to Arabic, the **timer pill**, the **Tarneeb Solo
      standings**, and the **Durak table** (larger trump/deck + lingering last bout) all mirror
      correctly with **no horizontal overflow** at 360/390.
- [ ] **Reaction anchor cross-device (Stage 29.5, v0.3.5):** with **2 devices** in a **Tarneeb**
      game (Pairs or Solo), each sends a reaction → it floats over **that sender's own visible seat**
      on *both* screens (not the opposite seat). Spot-check one non-mirrored game (Durak/Deberc) as a
      control. This is the mirror-fix — the sender always saw it right; the *other* viewer was wrong.
- [ ] **Timer in the social cluster (Stage 29.7, v0.3.6):** in an online game with a host timer,
      the **⏱ pill sits in the bottom-right control cluster** (just above voice/emoji/chat), with a
      **bigger clock + countdown**, and **pulses when low**. It is **never over** the table cards, hand,
      or bid/trump action bars at 360/390 (a tap lands on the control/card underneath). Timer **off** →
      no pill. Low-time sound **only on your turn**.
- [ ] **Tarneeb ranked score table (Stage 29.7; compact/centered 29.8, v0.3.6):** the HUD is a
      **compact, centered table** (capped width + subtle card) sorted by total score — columns
      **# · player/team · ▶bid · 🃏tricks · ★score**. The declarer/high-bidder row shows **▶ + amount**;
      **Solo** lists 4 players by name (no Team A/B), **Pairs** lists Us/Them. Your row is tinted, the
      acting row washed + ●, the leader shows 👑. Rows do **not** reorder mid-trick; no 360/390 overflow.
- [ ] **Tarneeb match target (Stage 29.8, v0.3.6):** host a Tarneeb room, pick **🎯 61** in the
      Host sheet → the room-browser/lobby line shows **`· 🎯 61`**; after Start the in-game 🎯 reads
      **61** and the match ends at 61. Works for **Pairs and Solo**; a legacy client (no target) →
      **41**. Rematch keeps the chosen target. Per-hand scoring unchanged.
- [ ] **Tarneeb scoring (v0.3.3) — Pairs AND Solo:** in the hand-complete panel, a declarer who
      takes **exactly** the bid scores **bid×2** (bid 7 → **+14**, with the "✨ exact bid double"
      note); **more** than the bid scores the **actual tricks** (bid 7, 10 tricks → **+10**); a
      **failed** contract is unchanged (declarer −bid; defenders bank their tricks). A signed-in
      **Solo** game's per-seat delta reflects the corrected score in the **Solo** stats tab (Pairs
      tab still separate/unchanged).
- [ ] **Deberc table sizing (v0.3.3 + Stage 30.16):** on the Deberc table the **played trick cards are
      slightly smaller** (Stage 30.16 shaved a further ~10%) and the **face-up trump + stock deck are
      ~20% larger**; no horizontal overflow at 360/390 and no overlap with the hand/actions/seats.
- [ ] **Deberc rule corrections (Stage 30.16):** (a) the **🔄 Swap low trump** button shows **only**
      when the exposed table card is a **trump** and your 7/6 was **dealt to hand** (not from the
      прикуп) — otherwise absent, and the online server rejects the swap; (b) a **5-card Палтіна beats a
      4-card Палтіна** regardless of top card; (c) **Бела** is declared **at play time** via the **🔔
      Declare Bela** toggle on a trump **K/Q** and scores **20 only if that trick is won** (no
      declaring in the meld phase). Play a full local hand exercising all three, then a 2-tab online
      hand to confirm the server accepts the same declareBela play and shows the public бела note.
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
      Tarneeb, Preferans & 51); no console errors (DevTools → Console).
- [ ] `curl -s $HOST/api/games` → `{ "games": [ … ] }` with **6** ids
      `king, durak, deberc, tarneeb, preferans, fifty-one`, every one `"status":"available"` and
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

## 5. Six-game smoke (Local + Host)

For **each** of King, Durak, Deberc, Tarneeb, Preferans, 51:

- [ ] **Local** sheet lists the game (icon + `👥 <players> · <meta>`), selectable — no
      "Coming soon"/"Experimental" tag.
- [ ] **Host** sheet lists the game; **Create room** succeeds and the Lobby opens.
- [ ] **Add bots → Start** deals a hand and the game screen renders (bidding/play as
      appropriate). Seat counts: King 3–4, Durak 2–5, Deberc 3–4, Tarneeb 4, Preferans 3, 51 2–4.
- [ ] Each game shows its **own PNG emblem** (King crown / Durak / Deberc gem / Tarneeb
      star / Preferans top hat / 51 two fanned cards) — not a bare emoji.
- [ ] **Cards render, never blank (Stage 25.8):** every dealt/table card shows artwork or its
      **rank+suit text** fallback — no blank rectangles (even right after a deploy, before the
      card art is cached).
- [ ] **Last-card reveal delay (Stage 25.8):** the final card of a trick/bout stays readable
      (~1 s) before play advances in every game — King/Deberc (server pause), Tarneeb/Preferans
      (client review), Durak (bout lingers before the table clears).
- [ ] **Drag hand ordering (Stage 30.12b):** in each game you can **drag a card** in your hand
      (touch/mouse/pen) to reorder — the card lifts, an insertion bar shows the drop, release commits;
      a **quick tap still plays**. **↺ Auto-sort** resets; a newly drawn card lands at the **far left**.
      Display-only (no reducer/action/`ACTION_REQUEST` change) — opponents never see your order. No
      overflow at 360/390.
- [ ] **Team names (Pairs, Stage 30.12b):** Tarneeb/Deberc **Pairs** show partnerships by player name
      (**"Alex & Dina"**) in the lobby grid, Tarneeb HUD and finished screen — not abstract "Team A/B"
      (fallback "Team Alex" / localized Team A/B). **Solo** modes show individual names, no team labels.

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

### 5b. 51 (Syrian 51) — release extras (Stage 30.7)

> 51 is now `available` — the create/join/play/emblem basics are covered by the six-game smoke §5
> above. This section is the 51-specific release extras: online flow, favorite, achievement,
> All-Rounder, and score-only stats under `game_type='fifty-one'` (**no DB migration** — latest 0009).

- [ ] **Picker (no Experimental tag):** both the **Local** and **Host** pickers list **51** as a normal,
      selectable option — **no** "Experimental" / "Coming soon" tag, not dimmed, with its own PNG emblem.
      `GET /api/games` shows `fifty-one` with `status:"available"`, `supportsLocal/supportsOnline/supportsBots: true`.
- [ ] **Local play + core rules:** start a local **2-player** game (1 deck + 2 jokers) and a **4-player**
      game (2 decks + 2 jokers). A turn is **draw → optionally meld → discard**; **before opening** you
      **cannot** take from the **discard pile** (it stays locked) and cannot lay a meld — you may only
      **open** once your first lay-down totals **≥ 51**. At round end a **never-opened** loser scores a
      flat **100** and a **joker left in hand** scores **25**; emptying your hand wins the round (0), and
      a running penalty of **510** eliminates a player. Finish screen wears the shared ornamental frame.
- [ ] **Meld/opening rules (Stage 30.9):** a **joker sits at any position** — `7♠ 8♠ 🃏` = 7-8-9,
      `🃏 8♠ 9♠` = 7-8-9, `Q♠ K♠ 🃏` = Q-K-A (30), `🃏 2♠ 3♠` = A-2-3 (6); `K♠ A♠ 🃏` stays invalid. The
      primary button reads **"Open (n/51)"** until you open, then **"Lay meld"** — after opening you can lay
      **any** valid meld (e.g. a 15-pt 4-5-6 run) with **no** further 51 requirement, plus lay off + take discard.
- [ ] **Ace-low lay-off + meld layout (Stage 30.10):** add an **Ace to a public `2-3-4`** run → it becomes
      **`A-2-3-4`** (Ace-first, value 10); adding a King to `A-2-3` stays invalid. Public-meld cards are a
      **clean, non-overlapping, unclipped** row with the Add button below — **no horizontal overflow** at
      360/390 with 4 players and several melds.
- [ ] **Discard-to-open + bigger meld cards (Stage 30.13):** before opening, plain **Take discard** is
      disabled; **tap the discard top** (gold ring) + hand cards to build a **≥ 51 opening including the
      top**, then **"Take & open 51"** opens and removes the top. You can't take the discard bare while
      unopened. After opening, Take discard works normally. Meld cards are **bigger/clearly separated**,
      no overlap, no 360/390 overflow (4-5-card runs, multiple blocks).
- [ ] **Joker replacement + readable melds + help (Stage 30.14):** as an **opened** player holding the
      exact card a table joker stands in for (`J♥` vs a joker representing `J♥`), the meld shows
      **"🃏 Replace joker"** → pressing it puts your card in the joker's slot and the **joker lands in
      your hand**; the meld's value is unchanged. It is **absent** when unopened, when it isn't your
      turn, at the draw step, or with a merely near-miss card (`J♠` / `10♥`) — and you must still
      **discard** to end the turn. Public-meld cards are **large, gapped, never overlapping/cropped**
      at 360/390 with **Add / Replace joker in a row under** them; the ❓ **help sheet** shows **Card
      values** + **Melds** (`A-2-3` = 6, `Q-K-A` = 30, `K-A-2` invalid, joker in hand 25) in all 4
      languages. Online: the meld change is public to both tabs, the taken joker stays private.
- [ ] **Elimination score (Stage 30.15):** the **Local** and **Host** 51 setup sheets show a score
      picker **210 / 310 / 410 / 510** (default **510**). Start a local match at **210** → a player is
      eliminated once their penalty reaches **210**, not 510. Host an online room at **310** → the lobby
      meta reads `🀄 Rummy · Melds · ☠ 310` for the host and joiners; **Play again** keeps the same score.
      A room created before this change still shows **☠ 510** and plays as before.
- [ ] **Online create/join/play (2 tabs + optional bot):** Host a 51 room → the lobby reads
      **"🀄 Rummy · Melds"** (plus **☠ <score>**, not a King "Fixed order" label) with 2–4 seats. Join from a second tab;
      each client sees **only its own hand** (opponents show 🂠counts, the draw pile is face-down). A
      normal turn **draw → (open ≥51 / add) → discard** applies over the wire; the acting player's
      buttons are enabled, the waiter's are disabled.
- [ ] **Server-driven flow:** bots auto-play; the **between-rounds summary** appears and the **server**
      starts the next round (there is **no client "Next round" button** online). At match end the last
      seat standing wins; **Play again** (rematch) restarts the room; **reconnect** after a reload
      restores own hand only.
- [ ] **Favorite + achievement:** Profile → **Favorite game** now offers **51** (picker defaults to it
      next time); after a signed-in human-vs-human **51 win** the **51 Winner** badge (🀄) is earned in
      Profile → Achievements, and **All-Rounder** now also requires a 51 win (**6 games**).
- [ ] **Stats (needs Postgres):** after a **signed-in** online 51 game with **2+ humans and no bots**,
      Profile → **Stats → 51** shows games / win-rate / avg-penalty / eliminations, and **Leaderboard →
      51** lists the player (own row highlighted). A game **with a bot** or a **guest** records nothing.
      `curl -sI $HOST/api/games/fifty-one/stats` → 200 (signed-in). **Latest DB migration stays 0009**
      (51 stats reuse the free-text `game_type` — no migration).
- [ ] **Mobile/RTL:** 360/390 portrait — hand scrolls, meld/draw/discard controls reachable, **no
      horizontal overflow**; Arabic RTL reads correctly.

### 5c. Tutorials (Stages 31.1–31.2, unreleased — client-only)

> No backend — tutorials are 100% client-side scripted demos (no server/stats/account). This smoke just
> confirms the deployed bundle serves the menu section and every tutorial renders.

- [ ] **Menu → 🎓 Tutorials** opens the hub listing **all 6 games**, and **every** row (King, Durak,
      Deberc, Tarneeb, Preferans, 51) shows **Start** (with a **⏱ ≈ Ns** chip) — no "Coming next" left.
      No network call fires opening a tutorial (DevTools → Network stays quiet).
- [ ] **Each tutorial runs end-to-end** (Step 1 → last) with highlighted cards + short captions:
      51 (7, A-2-3/Q-K-A/K-A-2✗/joker), Durak (6, attack-defense/Trump♥), King (6, lead badge + winner),
      Deberc (7, Терц + **Палтіна**, 5>4, exchange, Bela), Tarneeb (6, bid/trump/void→trump/scoring),
      Preferans (6, declarer/talon/10 tricks; variants noted as "not in the app yet").
      **Back/Next/Skip/Done** + **←/→/Esc** work; **Done/Skip** return to the hub (never a live game).
- [ ] **Mobile 360/390:** no horizontal overflow on the hub or any step; Arabic RTL mirrors, card runs
      still read low→high. (Automated: `node scripts/tutorial-shots.mjs <preview-url>` — a step per game.)

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
- [ ] **Achievements expansion (Stage 32.1):** the grid shows **29** badges (dynamic `n/29` count) at
      **360/390** with no horizontal overflow (RTL Arabic mirrors). After a first win in **Deberc /
      Tarneeb Pairs / Preferans / 51** the game's new **winner** badge turns gold; **All-Rounder** still
      needs a win in all six games. **Uncommon** badges render with a green accent.

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

### 10a. Android TWA readiness (Stage 33.1 — no app built yet)

> The Android app is a planned **TWA** ([`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md)); nothing is submitted.
> This checks the deployed PWA meets the wrapper's web prerequisites.

- [ ] `curl -s $HOST/manifest.webmanifest` → the **`description` names all six games** (King, Durak,
      Deberc, Tarneeb, Preferans & 51); `name`/`short_name` = **Card Majlis**; `start_url`/`scope` = `/`;
      `display` = `standalone`; 192 + 512 + **maskable** icons.
- [ ] **No real Asset Links shipped yet:** `curl -sI $HOST/.well-known/assetlinks.json` → **404**
      (expected — the real file is added only at store setup with the Play App-Signing SHA-256). The
      repo carries only `assetlinks.example.json` (a placeholder template).
- [ ] **Installability:** Lighthouse/DevTools → *Application → Manifest* shows no installability errors;
      the app installs and launches standalone (the TWA reuses exactly this).

### 10b. Android TWA scaffold + build runbook + owner triage (Stage 33.2/33.3/33.8 — config-only, no app built)

> The TWA config scaffold + owner build runbook + build-log template live at [`android-twa/`](android-twa/).
> The native Gradle project/APK/AAB is **not** generated (toolchain absent — `check-env.ps1` reports the JDK
> gap). Full first-run device checklist: [`QA_CHECKLIST.md`](QA_CHECKLIST.md) "Manual — PWA / mobile →
> Android TWA first run".

- [ ] **Scaffold hygiene:** `git ls-files android-twa` lists only `twa-manifest.json`, `check-env.ps1`,
      `.gitignore`, `README.md`, `BUILD_LOG_TEMPLATE.md` — **no** `app/`, `gradlew`, `*.gradle`, `*.apk`,
      `*.aab`, or `*.keystore` (guarded by `src/pwa.test.ts`).
- [ ] **Config matches manifest:** `twa-manifest.json` `packageId` = `com.cardmajlis.app`, `host`/`startUrl`
      / theme `#0d4f28` / `standalone` / `portrait` / icons match `public/manifest.webmanifest` and
      `assetlinks.example.json` (guarded by `src/pwa.test.ts`).
- [ ] **Env check runs read-only:** `pwsh android-twa/check-env.ps1` (or `powershell -File …`) prints
      PASS/WARN/FAIL and installs nothing; JDK must be PASS (17+) before a build. It also runs
      **config-sanity** (packageId / webManifestUrl / README uses `@bubblewrap/cli`, no wrong `npx
      bubblewrap init`).
- [ ] **Build command sanity:** the runbook `init`s from the **web** manifest URL
      (`…/manifest.webmanifest`), **not** `twa-manifest.json` (which `build`/`update` read). Guarded:
      `src/pwa.test.ts` (README init command + `twa-manifest.webManifestUrl` in sync with `host`).
- [ ] **Owner build log (33.8):** the owner runs the build and fills
      [`android-twa/BUILD_LOG_TEMPLATE.md`](android-twa/BUILD_LOG_TEMPLATE.md) (check-env → init → gradle →
      adb + full-screen-vs-Custom-Tab). A debug-signed APK showing a **Custom Tab URL bar is expected**
      until a real `assetlinks.json` matches the Play App-Signing SHA. Only **text logs** are shared.
- [ ] **Production full-screen path (33.9):** to make it launch full-screen, follow the ordered runbook in
      [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) **§9** — custom domain → OAuth redirect → PWA verify →
      signed AAB → **Play App-Signing SHA-256** → real `assetlinks.json` (deployed, never committed) →
      verify with `curl`/`Invoke-WebRequest` + `adb shell pm get-app-links com.cardmajlis.app`. The
      upload/debug key SHA will **not** verify; a wrong/stale `assetlinks.json` can be cached.

### 10c. iOS PWA (Stage 33.5 decision — PWA-only, no App Store app)

> Decision: **iOS stays PWA-only** ([`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) §8); any App Store/Capacitor
> wrapper is deferred to 33.8 (after Android is validated + a custom domain + store assets). The iOS PWA
> meta already ships — nothing to build. Device smoke: [`QA_CHECKLIST.md`](QA_CHECKLIST.md) "Manual — PWA /
> mobile → iOS PWA".

- [ ] **iOS meta present:** `index.html` has `apple-touch-icon`, `apple-mobile-web-app-capable`,
      `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, and `viewport-fit=cover`
      (guarded by `src/pwa.test.ts`).
- [ ] **Standalone detection:** an installed iOS PWA (`navigator.standalone`) hides the install card and
      keeps the "Update available" pill (guarded: `pwaClient.isStandaloneDisplay(false, true) === true`).
- [ ] **iOS A2HS hint (Stage 33.6):** on iOS Safari, the menu shows a dismissible "Share → Add to Home
      Screen" hint; it is suppressed in-game, once installed, and after dismiss (guarded:
      `shouldOfferIosHint` + `isIosUserAgent` + separate `IOS_HINT_DISMISS_KEY` in `src/pwa/pwaClient.test.ts`).

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
