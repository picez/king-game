# Changelog

All notable, user-facing changes to **Card Majlis**. This is a concise release
snapshot, not the full stage-by-stage history (see the git log for that).

The format loosely follows [Keep a Changelog](https://keepachangelog.com/); the
project uses [Semantic Versioning](https://semver.org/). The running version is
also reported at `GET /health/diagnostics` (`version` field).

## [Unreleased]

### Fixed

- **Deberc Solo is now actually playable online (Stage 28.2).** Despite the Stage 28.0 labels,
  every hosted Deberc room was still forced to 4 seats (`server/wsHandlers.ts` hard-coded
  `playerCount = maxPlayers` and ignored the client's value), and the lobby drew the Team A/Team B
  2×2 grid for *any* Deberc room — so Solo was invisible in practice. Now: the online **Host** sheet
  has an explicit **Solo (3) / Pairs (4)** mode picker (defaulting to Solo); the server honors an
  in-range host `playerCount` (falling back to the catalog max, so other games and older clients are
  unchanged); and the lobby renders **individual seats + an "every player for themselves" hint** for
  3-seat Solo rooms while keeping the **Team A/B grid** for 4-seat Pairs. The seat cap and start
  gate now come from the room's own player count (Solo needs 3, Pairs needs 4). The Deberc score
  table / finished screen already showed per-player standings; the win celebration now reads as an
  individual win in Solo. **Engine, scoring, stats data model, and 4-player Pairs are unchanged; no
  protocol or DB change** (the `playerCount` field already existed on `CREATE_ROOM`).

### Added (foundation, not yet playable)

- **Tarneeb solo — pure core (Stage 28.1).** A `variant: 'pairs' | 'solo'` flag on `TarneebState`
  and `START_GAME`, **defaulting to `'pairs'`**, adds a 4-player cutthroat (every-player-for-self)
  game: per-seat scoring (declarer makes it → +bid, defenders +0; declarer fails → −bid, each
  defender +its own tricks; first to 41, ties are not a finish), a solo bot that assumes no partner,
  and variant-agnostic redaction. Trick legality (follow-suit + trump obligation) is the **same**
  `legalPlays` as pairs. **Not exposed anywhere yet** — no game picker entry, no online rooms, no
  stats, and the lobby/team UI is unchanged. Released Tarneeb **pairs** is byte-for-byte unaffected
  (a legacy state with no `variant` reads as pairs). Covered by `src/games/tarneeb/solo.test.ts`;
  the local-only playable prototype is the next stage. See `TARNEEB_SOLO_PLAN.md`.

### Fixed

- **Static file-like 404s + HEAD (Stage 28.1b).** A missing path with a file extension
  (`/cards/faces/AS.png`, `/assets/typo.js`) previously fell through to the SPA `index.html`, so it
  returned `200 text/html` instead of a real **404** — which masked broken/misnamed assets and made
  the bandwidth/cache smoke checks false positives. The static handler now 404s any missing
  *extension-bearing* path (`text/plain`, `no-store`) while extension-less routes (`/`, `/profile`,
  `/?room=CODE`) still fall back to the shell. `HEAD` requests now return the full headers
  (Content-Type, Cache-Control, ETag, Last-Modified, Content-Length) with **no body**. Card faces
  are `{suit}-{rank}.png` lower-cased (`spades-a.png`), documented with real example URLs.

### Performance

- **Static bandwidth cut (Stage 28.1).** The server previously sent every non-hashed static
  asset — the ~10 MB of card-face art, the menu hero, felt, icons, sounds, stickers — with
  `no-cache` **and no validator**, so a browser re-downloaded all of it on *every* visit (the main
  driver of Render HTTP egress). Now `server/httpStatic.ts` uses three Cache-Control tiers: hashed
  `/assets/*` stay `immutable`; static media is `public, max-age=604800` (a week, then a cheap
  ETag **304**); the app shell (`index.html`/`sw.js`/`manifest`) stays `no-cache`. Every response
  also carries an **ETag + Last-Modified** (conditional `If-None-Match` → 304, empty body), text is
  **gzip**'d on the fly, and previously-missing MIME types (`.webp`/`.webm`/`.mp3`/`.gif`/`.jpg`)
  are now correct instead of `application/octet-stream`. **No gameplay, protocol, or dependency
  change.** Trade-off documented in `RENDER_DEPLOY.md`: an in-place asset swap can take up to a
  week to reach clients (rename or bump the SW cache version to force it).

### Changed

- **Deberc — explicit Solo / Pairs modes (Stage 28.0).** The seat count has always *been* the
  mode (3 = every-player-for-self, 4 = fixed 2×2 pairs); now the setup and lobby **name it**.
  Local setup shows **"Solo · 3 players"** and **"Pairs · 4 players"** mode cards instead of bare
  3/4 tabs, and the online lobby game-line reads **"· Solo"** or **"· Pairs"** from the room's
  seat count. **No engine, scoring, or stats change** — label only.

### Added (foundation, not yet playable)

- **Tarneeb solo — implementation-ready spec.** [`TARNEEB_SOLO_PLAN.md`](TARNEEB_SOLO_PLAN.md)
  fixes the design for a future **4-player cutthroat** solo variant (Variant B), including the
  individual scoring model (declarer ±bid; set defenders earn defensive credit by their own
  tricks). A `soloGuard.test.ts` pins the released **4-player 2×2 pairs** behaviour so the future
  build can add a `variant` flag without touching the shipped team game, its stats, or its
  leaderboard. **Released Tarneeb is unchanged and remains team-only; solo is not implemented.**

## [0.3.1] — 2026-07-12 — Gameplay polish & friends/voice fixes

A patch release rolling up the **Stage 27.x gameplay polish** and the post-v0.3.0 **friends /
voice / invite** fixes. Additive and fairness-safe: **no new features, no schema/migration
changes** (0009 stays the latest), **no dependency changes**. `/health/diagnostics` `version`
reads `0.3.1`.

### Audit (Stage 27.6 — gameplay polish audit)

- **Post-27.x regression audit — no gameplay bugs found.** Verified the 27.0–27.5 changes left
  the five released games stable: Tarneeb and Deberc legality share **one source of truth**
  (`legalPlays`) between the table UI and the reducer, so the server accepts exactly what the UI
  offers (no authority drift) and illegal plays return the same state; Deberc's trump exchange
  stays reducer-gated; online turn-authority, friends-invite visibility, invite-accept join,
  bot/human rematch and reconnect all hold; cards never render blank; the Tarneeb team-tricks
  viewer reads only public data. Locked with a focused audit test; no runtime code changed.

### Changed (Stage 27.4 — clockwise & table-clarity audit)

- **Play now reads clockwise in every game.** Audited all five (`CLOCKWISE_AUDIT.md`); King,
  Durak, Deberc and Preferans were already clockwise. **Tarneeb** read counter-clockwise on
  screen and was corrected **UI-only** — the turn now sweeps to your left, with your partner
  still opposite at the top. Dealing, partnerships, play order and scoring are unchanged.
- **King now flags the led card** of the current trick with the same "1" badge + ring the other
  games use, so it's always clear who led. (The winning card already pulses when a trick is
  taken.) Reveal delay stays a readable ~2 s across every game.

### Added (Stage 27.3 — Tarneeb team-tricks review)

- **Tarneeb: view your team's taken tricks** — a "🃏 Team tricks" button opens a review of every
  trick your side has won this hand (winner + the 4 cards in play order, lead card flagged);
  opponents show as a count only. Display-only (the played cards are already public), so no rules,
  scoring, or stats change; works local and online.

### Added (Stage 27.2 — Deberc trump exchange)

- **Deberc trump exchange** — before the first card, the holder of the lowest trump (7 in
  3-player, 6 in 4-player) can swap it for the face-up table trump ("🔄 Swap low trump" on their
  declaring turn). The exposed card enters their hand and the low trump becomes the new table
  trump — the hand keeps the same number of cards, once per hand, optional. A public note shows
  the swap; no hidden hand is revealed. Bots do it automatically. Enforced in the pure reducer, so
  online validates identically.

### Changed (Stage 27.1 — menu sections + sender-anchored reactions)

- **Profile is split into clear sections** — Account, Friends, Statistics, Achievements and
  Leaderboards are each their own tappable section (with the incoming friend-request badge on
  Friends) instead of one crowded tab strip that overflowed on small phones.
- **Reactions & stickers float over the sender's seat** — an emoji/sticker now pops near the
  player who sent it (bottom for you, others around the table) instead of always at the centre.
  It reuses the existing public seat info — no protocol change.

### Changed (Stage 27.0 — game rules + table clarity)

- **Tarneeb:** the **minimum bid is now 3** (auction 3–13; scoring unchanged), and the **trump
  obligation** is enforced — void in the led suit while holding a trump means you **must trump**
  (you may discard another suit only when void in both). Enforced in the reducer (online too).
- **Deberc:** the 50-point run is spelled **"Палтіна" (Paltina)** everywhere (display only); the
  **skip-meld** button is red; **table cards are larger**.
- **Every game:** the **last card of a trick/bout now lingers ~2 seconds** (normalized) before play
  advances — including online Tarneeb/Preferans, which previously had no delay. The **card that led**
  the current trick shows a small **"1" badge + ring** so it's always clear who led.
- Deferred (with design notes in `RULES_UX_TODO.md`): profile/menu section split, Deberc trump
  exchange, Tarneeb "view my tricks", solo/individual variants, clockwise audit, reactions-over-sender.

### Fixed

- **Friend invite "Join" now works** (Stage 26.1): tapping **Join room** on an invite actually
  joins the inviter's room instead of doing nothing — at the menu it joins directly; from inside
  another room it confirms before leaving; in the same room it dismisses. The `?room=` deep-link
  still prefills the Join sheet. The invite still carries only a room code.
- **Tarneeb help text corrected** (Stage 27.8): the in-game "How to play" now says the auction
  **starts at 3** (3–13, all four languages), matching the shipped rule — the old "7–13" predated
  the Stage 27.0 minimum-bid change. Text only; no rule change.

## [0.3.0] — 2026-07-12 — Social & voice release

Adds the social layer on top of the five-game platform: **friends, room invites, online
rematch, and opt-in in-room voice chat** — plus a round of account/avatar production fixes
and gameplay polish. Additive and fairness-safe: no gameplay/scoring change; friends need
Postgres + migration `0009_friends.sql`.

### Added

- **Friends & presence** (Stage 25.1–25.9): add friends **by code** (never by email); an
  app-level presence connection shows who's **online** and drives an incoming-request **badge**
  on the Profile tile + Friends tab. Signed-in only; presence is per-instance.
- **Room invites**: a signed-in host can invite a friend into the current room from an
  **always-visible "Invite friends"** block in the Lobby (online friends first). The target gets
  a **Join/Dismiss** toast that reuses the `?room=` flow (never auto-joins); failures (offline /
  not friends / not in a room) surface a small non-fatal notice. The invite carries only a room
  code + display name.
- **Online rematch / Play again**: after a game finishes, Play again restarts the **same game in
  the same room** (same options/seats) instead of leaving to the menu. One human + bots restarts
  immediately (bots are always ready); multiple humans must **all** press Play again (no
  auto-start) and see who wants a rematch. In-memory only; a fresh game records its own stats.
- **In-room voice chat** (Stage 25.3–25.6, opt-in): a room-scoped **WebRTC mesh** (≤5) —
  Join/Mute/Leave in the Lobby card + a compact in-game mic, a safe status/debug block (Mic /
  Peers / ICE state / Audio), and reconnect that rebuilds the mesh. **No audio is stored,
  recorded, or sent through the server** (peer-to-peer; the server only relays signaling).
  STUN-only by default; a deployment adds a **TURN** relay via `VOICE_ICE_SERVERS` (runtime,
  `/api/voice/ice-config`) or `VITE_VOICE_ICE_SERVERS` (build-time) — credentials are env-only,
  never committed, and redacted from diagnostics. `/health/diagnostics` reports
  `voice.ice: stun_only|turn_configured`.

### Fixed

- **Account / auth resilience** (Stage 24.2–24.5): a transient DB blip on `/api/me` no longer
  dead-ends the Profile (falls back to a guest view); a missing migration surfaces a clear
  `503 migration_required` instead of masquerading as a guest; live, secret-free auth
  diagnostics help pinpoint an unreachable/cross-origin API base.
- **Avatar upload production** (Stage 24.6–24.8): the "Uploading…" button can no longer hang
  (client timeout always settles); every server phase (body read / ffmpeg / DB write) is bounded
  with a distinct safe error; the browser now **compresses the image before upload** (a multi-MB
  photo POSTs a ~KB WebP), making a Render timeout unlikely.
- **Cards never render blank**: a slow / stalled / broken card image now falls back to the
  rank+suit text (shown until the artwork actually paints) instead of a blank card.
- **Last-card reveal delay**: the final card of a trick/bout lingers ~1 s so it can be read before
  play advances — in every game, now including Durak (its bout lingers before the table clears).
- **Voice audio reliability**: ICE candidates that arrived before the remote description are now
  buffered (they used to be dropped, stalling the connection); remote audio sinks are attached to
  the DOM for reliable mobile playback; a "TURN may be required" hint shows when every peer fails.

### Notes

- Real **cross-network voice** is a manual check (CI has no mic); strict/symmetric-NAT users need
  a **TURN** relay to connect P2P (otherwise they fall back to text chat).
- Production with Postgres must run **`npm run db:migrate`** after deploy (Friends need `0009`).

## [0.2.0] — 2026-07-11 — Five-game platform release

First tagged snapshot of the rebranded **Card Majlis** card lounge — five games,
online play, profiles, stats, and an installable PWA.

### Highlights

- **Rebrand:** the product is **Card Majlis** (internal ids stay `king` /
  `king-card-game` for compatibility).
- **Five games, all fully playable** (local pass-and-play **and** online):
  **King**, **Durak**, **Deberc**, **Tarneeb**, **Preferans** — each with bots.
- **Online rooms:** host/join by 4-letter code, invite links (`?room=CODE`),
  team lobby, reconnect + server restart recovery, AI substitute for a
  disconnected player, room browser with filters and auto-refresh.
- **Room social:** whitelisted emoji reactions, chat, and media stickers
  (server-validated, no uploads/URLs).
- **Identity & profile:** guest play, optional Google sign-in, 3-tier avatars
  (emoji / local image / server upload), favorite game, appearance (card back +
  face themes), animation and sound-alert preferences.
- **Progress:** per-game stats, public leaderboards, and derived achievements
  with an unlock toast.
- **PWA:** installable app shell, user-controlled "Update available" refresh,
  offline pill, and mobile safe-area / touch polish.
- **Ops:** optional **Docker** runtime with `ffmpeg` for server avatar upload;
  a safe public **`GET /health/diagnostics`** snapshot (build/commit, uptime,
  DB + avatar readiness, room + socket counts, game ids — no private data).

### Security & privacy

- Server-authoritative game state with per-client redaction (no hand leaks).
- WSS + CSRF protection, `scrypt` password hashing, per-connection and per-IP
  rate limits, origin allowlist.
- Diagnostics and logs expose only aggregate/routing info — never user ids,
  emails, room codes, session ids, tokens, chat, or cards.

### Known limitations

- **Single Node instance** — rooms/social live in one process; horizontal
  scaling needs sticky sessions or a shared store.
- **Postgres required** for profiles, auth, stats, and leaderboards; without
  `DATABASE_URL` those `503` and local/guest/online play still works.
- **Avatar upload needs `ffmpeg`** at runtime — the native Render runtime has
  none, so uploads `503` there; use the shipped Docker runtime (or `FFMPEG_PATH`).
- **No moderation console** yet (chat/stickers are whitelisted, not moderated).
- **Preferans post-MVP variants** (misère, распасы, whist, Sochi, 4-player) are
  documented but not implemented.

[0.2.0]: https://github.com/picez/king-game/releases/tag/v0.2.0
