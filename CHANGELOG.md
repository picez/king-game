# Changelog

All notable, user-facing changes to **Card Majlis**. This is a concise release
snapshot, not the full stage-by-stage history (see the git log for that).

The format loosely follows [Keep a Changelog](https://keepachangelog.com/); the
project uses [Semantic Versioning](https://semver.org/). The running version is
also reported at `GET /health/diagnostics` (`version` field).

## [Unreleased]

### Added

- **Friends & room invites** (Stage 25.1–25.2): add friends, see who's online, invite
  them straight into your room (invite carries only a room code + display name).
- **In-room voice chat** (Stage 25.3–25.5): opt-in WebRTC mesh voice in online rooms —
  Join/Mute/Leave, per-peer state, autoplay-blocked fallback. No audio is stored, recorded,
  or sent through the server (peer-to-peer, signaling relay only).

### Hardened (voice, Stage 25.5)

- **Reconnect resync:** a dropped/reconnected socket rebuilds the voice mesh automatically —
  stale peer connections closed, remote audio sinks removed, mute preserved, no duplicate peers.
- **ICE config seam:** `VITE_VOICE_ICE_SERVERS` optionally supplies a **TURN** relay for
  strict-NAT users; STUN-only by default. **TURN credentials are env-only, never committed**
  and are redacted from diagnostics.
- **Runtime TURN config (Stage 25.6):** `GET /api/voice/ice-config` serves ICE servers from the
  server env `VOICE_ICE_SERVERS` — add/rotate TURN **without a client rebuild** (build-time env
  stays a fallback). `/health/diagnostics` reports `voice.ice: stun_only|turn_configured` (no
  credential); the Lobby shows a small STUN/TURN indicator. Provider guidance (Metered/Twilio/
  Cloudflare/coturn) + short-lived-credential path documented.
- **Permission UX:** mic-denied shows a browser-settings hint; background/PWA never auto-rejoins.

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
