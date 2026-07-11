# Card Majlis — Project Overview

A concise "what this is and how it fits together" for the whole project. For the
running feature list see [`MVP_STATUS.md`](MVP_STATUS.md); for manual test steps see
[`QA_CHECKLIST.md`](QA_CHECKLIST.md); deep dives are linked inline.

> **Release:** **v0.2.0** — five-game platform release (2026-07-11). See
> [`CHANGELOG.md`](CHANGELOG.md); the running version is also at `GET /health/diagnostics`.

> **Naming:** the product is **Card Majlis** (Stage 14.0 rebrand). "King" now names
> only the *King game*. Internal ids stay legacy on purpose — package `king-card-game`,
> `king.*`/`cardMajlis.*` localStorage keys, `game_type='king'`, the `[King]` server log
> prefix, and the `king-game` repo — with **no rename/migration**.

## What it is

A mobile-first web **card lounge** for five games, playable **local pass-and-play** or
**server-authoritative online**. React + TypeScript (Vite) client; a single Node
(`ws`) server hosts the client, the `/ws` socket, and the `/api/*` HTTP surface on one
origin. Postgres is **optional** — with no `DATABASE_URL` the app runs fully on
file/memory storage and every `/api/*` returns a clean `503` (play unaffected).
Installable **PWA**: a network-first service worker (offline app shell), a
non-intrusive **install** card, a user-controlled **"Update available"** refresh (no
auto-refresh mid-game), and an **offline** hint.

## Supported games (all released, local + online)

| Game | Players | Notes |
|------|---------|-------|
| **King** | 3–4 | Trick-avoidance; Dealer's-Choice or fixed order — [`KING_RULES.md`](KING_RULES.md) |
| **Durak** | 2–5 | Simple + Transfer variants — [`DURAK_RULES.md`](DURAK_RULES.md) |
| **Deberc** | 3–4 | 3 = solo, 4 = 2×2 teams; melds/bella/jackpot — [`DEBERC_RULES.md`](DEBERC_RULES.md) |
| **Tarneeb** | 4 | Fixed 2×2 partnerships, bid-and-trump — [`TARNEEB_RULES.md`](TARNEEB_RULES.md) |
| **Preferans** | 3 | Solo contract auction + 2-card talon, 32-card — [`PREFERANS_RULES.md`](PREFERANS_RULES.md) |

Each records its own per-`game_type` **stats + leaderboard** (DB-backed, score-only —
never cards). Deberc adds an aggregate combination breakdown.

**Preferans / Преферанс** (5th game) is **released** (Stage 19.7): `status: available`,
local + online, score-only stats/leaderboard, a favorite-game option, and a "Preferans
Declarer" achievement. A 3-player, each-for-self contract-bidding trick game with a talon;
shared UI in `src/ui/preferans/` (+ the `PreferansOnlineGame` adapter). Post-MVP variants
(misère, распасы, whist/pass, Sochi pool/mountain scoring, 4-player) remain documented,
not built. [`PREFERANS_RULES.md`](PREFERANS_RULES.md) / [`PREFERANS_PLAN.md`](PREFERANS_PLAN.md).

## Core architecture

- **Server-authoritative online:** one reducer per game runs on the server; each client
  gets a **per-viewer redacted** snapshot (never another player's hand). Seat/reconnect
  authority is `clientId` + a hashed reconnect token; the session cookie only *names* a
  player for stats. Design: [`ONLINE_ARCHITECTURE.md`](ONLINE_ARCHITECTURE.md).
- **Rooms:** host/join by 4-char code; a room browser (filter by game, sort, 9s
  auto-refresh); **invite links** `<origin>/?room=<CODE>` that prefill the Join sheet
  (never auto-join); server-side **AI bots**; reconnect/restart restore; orphan-room
  cleanup + AI substitution for a disconnected human's turn.
- **Team lobby (Deberc/Tarneeb):** the lobby groups seats into Team A (0 & 2) / Team B
  (1 & 3), shows empty seats + You/Partner — presentational only.
- **Room social:** ephemeral in-memory reactions + chat + whitelisted stickers (lost on
  restart; mediaId-only, server-validated — no uploads).

## Online / security model

Single-service, single Node instance. WSS in production; **CSRF** = SameSite=Lax + an
`Origin` allow-check on mutations; session token stored **hashed** (revocable); room
passwords hashed with **scrypt**; per-connection **and** per-IP rate limits; profanity/
URL filtering on chat. See [`ARCHITECTURE_DB_AUTH.md`](ARCHITECTURE_DB_AUTH.md) §5.

## Profile & personalization

- **Identity:** guest sessions + **Google sign-in** (OAuth Authorization-Code + PKCE;
  we store no Google tokens). Display name + whitelisted **emoji** avatar (the server-safe
  identity everyone sees).
- **Avatars (three tiers):** emoji fallback → a **local custom image** (device-only, never
  uploaded) → a **server-synced uploaded avatar** shown on other players' seats. Upload is
  a processed 192×192 WebP in Postgres, served same-origin `/api/avatar/<id>.webp?v=n`;
  it needs `ffmpeg` at runtime (see Deployment). Full plan: [`AVATAR_UPLOAD_PLAN.md`](AVATAR_UPLOAD_PLAN.md).
- **Appearance:** card-back styles, card-face themes, animation-intensity preference
  (reduced-motion aware). Visual direction: [`VISUAL_DIRECTION.md`](VISUAL_DIRECTION.md).
- **Sound:** **alert-only, default OFF** — the only wired cue is a low-time turn warning
  (opt-in off/subtle/full). Plan: [`SOUND_DESIGN.md`](SOUND_DESIGN.md).
- **Achievements:** 11 badges derived purely from stats + a post-game "unlocked" toast.
- **Preferences** sync to the profile when signed in, else stay device-local.

## Deployment

- **Render (hosted, simplest):** one Web Service, `runtime: node` — client + WS + API on
  one domain. **Caveat:** the native runtime has **no ffmpeg**, so avatar upload returns a
  clean `503` (everything else works); enable it by switching the Render Runtime to
  **Docker** (the repo ships a `Dockerfile` with ffmpeg) or by setting `FFMPEG_PATH`.
  Postgres is optional. Guide: [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md).
- **VPS (HTTPS/WSS):** Caddy/nginx + systemd/pm2 — [`DEPLOYMENT.md`](DEPLOYMENT.md).
- **CI toolchain:** **Node 22 / npm 10**, install with `npm ci`; the committed
  `package-lock` is maintained with npm 10 (never commit npm-11 lockfile churn).
- **After a deploy:** run the 10–15 min [`PRODUCTION_SMOKE.md`](PRODUCTION_SMOKE.md)
  checklist (health / 5 games / rooms / stats / avatars / social / security).
- **Diagnostics:** `GET /health` (liveness + DB probe) and `GET /health/diagnostics`
  (safe operational snapshot — build/commit, uptime, DB + avatar readiness, room + socket
  counts, available game ids; aggregate-only, no private data). Handy for a quick prod
  check without the Render dashboard.

## Current limitations

- **Single Node instance** — horizontal scaling needs Redis/pub-sub or sticky sessions.
- **Ephemeral rooms** on the free tier unless `ROOM_STORAGE=pg` (Postgres); **ephemeral
  social** (chat/reactions lost on restart).
- **Avatar upload needs ffmpeg** at runtime (native Render has none → `503`; use the
  shipped Docker runtime to enable it); no content moderation console yet; no
  idle/slowloris timeout on body reads (infra concern).
- Public screens advance on a server timer (no manual skip online).

## Useful scripts

`npm run dev` (client) · `npm run server` (dev server) · `npm run server:prod` ·
`npm run build` · `npm run verify` (typecheck + tests + build + e2e, sequential) ·
`npm test` · `npm run e2e` · `npm run soak` / `soak:deberc` (bot soak) ·
`npm run db:migrate` · asset generators: `npm run icons` / `sounds` / `visuals` /
`visuals:webp`.
