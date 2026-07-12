# Changelog

All notable, user-facing changes to **Card Majlis**. This is a concise release
snapshot, not the full stage-by-stage history (see the git log for that).

The format loosely follows [Keep a Changelog](https://keepachangelog.com/); the
project uses [Semantic Versioning](https://semver.org/). The running version is
also reported at `GET /health/diagnostics` (`version` field).

## [Unreleased]

### Fixed

- **Friend invite "Join" now works** (Stage 26.1): tapping **Join room** on an invite actually
  joins the inviter's room instead of doing nothing — at the menu it joins directly; from inside
  another room it confirms before leaving; in the same room it dismisses. The `?room=` deep-link
  still prefills the Join sheet. The invite still carries only a room code.

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
