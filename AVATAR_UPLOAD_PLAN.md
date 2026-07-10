# Server Avatar Upload — Design Plan (Stage 17.0, DOCS-ONLY)

> **Status: PLAN ONLY. No upload/runtime code, no DB migration, no API route, no
> dependency is added by this stage.** This document decides the design, storage,
> security model, data model, API surface, WS/room impact, client UX, testing, and
> a staged rollout for a **server-synced custom avatar** — the next step after the
> Stage 14.1 **local-only** custom avatar. Implementation begins in Stage 17.1.

## 0. Where we are today (baseline)

- **Stage 14.1 — local-only custom avatar.** A user may pick a PNG/JPEG/WebP image;
  it is canvas **re-encoded** (EXIF + original bytes stripped), center-cropped to
  192×192, capped, and stored **only on this device** in `localStorage`
  (`cardMajlis.customAvatar.v1`). It is **never uploaded, never in the WS room
  protocol / game state, never in the DB**. Pure model in `src/net/customAvatar.ts`;
  browser re-encode in `src/ui/components/customAvatarImage.ts`; rendered ONLY on
  "me" surfaces via `src/ui/components/MyAvatar.tsx` (`AccountBar`, Profile preview).
- **The identity everyone else sees online is the whitelisted EMOJI.** Room member
  payloads carry `avatar` = a sanitized emoji id only (`sanitizeAvatar()` in
  `src/core/avatars.ts`; applied in `src/net/serverCore.ts`). No image bytes and no
  URL ever ride the socket.
- **`avatarUrl` already exists — and means something else.** `GET /api/me` returns
  `avatarUrl: account?.picture ?? null`, i.e. the **Google provider picture URL**
  (`auth_accounts.picture_at_provider`, a *remote* URL, marked "informational; not
  the game avatar" in `src/net/profileApi.ts`). **Any upload work must not silently
  repurpose this field** — see §5 for the naming decision.
- **API shape we must match** (`server/api.ts`): one `http.Server` hosts static
  client + `/api/*` + `/ws`; every `/api/*` route is **DB-gated** (clean `503
  db_disabled` when `DATABASE_URL` is unset); repos are **dynamically imported** only
  on a DB path; auth = opaque **session token in an httpOnly cookie, hashed in the
  DB**; CSRF = **SameSite=Lax + an `Origin` allow-check on every mutation**;
  credentialed CORS echoes a specific origin (never `*`); JSON bodies are capped at
  **`MAX_BODY_BYTES = 16 KB`** (too small for an image — a dedicated multipart cap is
  required, see §3/§6).
- **Deploy reality** (`render.yaml`, `RENDER_DEPLOY.md`): the production service runs
  on Render's **free tier with NO persistent disk** — the local filesystem is
  **ephemeral** and wiped on restart/redeploy (that is exactly why `rooms.json` does
  not survive there). **Render PostgreSQL** is the only durable store currently
  available without a paid add-on. This directly drives the storage recommendation
  in §2.
- **Migrations** are additive numbered `.sql` files under `server/db/migrations/`
  applied in filename order and written idempotently (`… IF NOT EXISTS`). Latest is
  `0007_card_face_theme.sql`; avatar work would add **`0008_*`** (additive only).

---

## 1. Product decision

- **Server avatar upload is OPTIONAL.** The app is fully usable without it; nothing
  about gameplay, guest play, or no-DB deploys changes.
- **Emoji avatar remains the fallback** and the always-safe cross-device identity.
  A user with no uploaded image (or whose image fails to load) shows their emoji.
- **The user can remove an uploaded avatar** at any time, reverting to the emoji.
- **Online rooms may show an uploaded avatar thumbnail only AFTER server-side
  validation + processing** — never the raw uploaded bytes, never before re-encode.
- **No raw original images are stored.** Only the server-processed, re-encoded
  derivative is persisted; the uploaded original is discarded after processing.
- **No remote URL input.** A user cannot point their avatar at an arbitrary
  `http(s)://` image (SSRF / content-spoofing / privacy-leak vector). The only
  avatar image the server serves is one it processed itself.
- **No SVG / GIF.** SVG is a script/XSS vector; GIF (animation / polyglot risk) is
  out of scope. Accepted inputs are **PNG / JPEG / WebP raster only** (matches 14.1).
- **No base64 / image bytes in the WebSocket protocol.** Rooms reference a
  **same-origin URL** only (§7). Upload is HTTP-only.
- **Signed-in only.** Upload requires a real (DB-backed) session; **guests get the
  local-only avatar** (14.1) and a sign-in hint, never a server upload.

---

## 2. Storage options

We processed derivatives (small square WebP). Three candidate homes:

| Option | What | Pros | Cons |
| --- | --- | --- | --- |
| **A. Object storage / persistent disk** — files under `/uploads/avatars/<id>.webp` | Processed file on a Render **persistent disk** (paid) or an S3-compatible bucket (e.g. Cloudflare R2 / AWS S3) | Cheap to serve, offloads bytes from the DB, natural CDN/edge caching, versioned keys are trivial | Free Render tier has **no disk** (bytes vanish on redeploy); a bucket adds an **external dependency + credentials + egress cost** and a new failure mode |
| **B. Database blob** — tiny processed WebP in Postgres (`bytea`) with a hard cap | One 128–192 px WebP (~≤64 KB) per user in a dedicated `user_avatars` table | **Durable on the existing Render Postgres with zero new infra**; same-origin serving via an app route; transactional with the user row; survives redeploys on the free tier | Bloats the DB / backups; serving requires an app round-trip (no direct CDN origin); not ideal past a few thousand users |
| **C. External CDN/storage later** | Bucket + CDN in front | Best at scale (offloaded, edge-cached, cheap) | Premature now: infra, credentials, cache-invalidation, and cost for a feature with unproven demand |

### Recommendation for MVP

**Adopt a small storage-driver abstraction, and ship Option B (Postgres `bytea`,
hard-capped) as the default MVP driver.** Rationale:

1. The current production target is the **free Render tier with no persistent disk**,
   so Option A's file path would **silently lose avatars on every redeploy** — a
   worse UX than not shipping. Option B reuses the **Postgres we already provision**
   for stats/auth and is genuinely durable there.
2. Avatars are **tiny** (a 192×192 WebP at ~≤64 KB). A dedicated `user_avatars` table
   (one row per user, `bytea` + content-type + version + updated_at) keeps the blob
   **out of the hot `user_settings` row** and out of every settings read.
3. Same-origin serving through a small app route (`GET /api/avatar/<id>.webp`, §6)
   gives us **full control of headers** (content-type, `X-Content-Type-Options`,
   long immutable cache keyed on a **version** in the URL) with no third party.

**The driver seam** (`server/avatarStore.ts`, interface like `putAvatar(userId,
webp) → version`, `getAvatar(userId, version) → {bytes, contentType} | null`,
`deleteAvatar(userId)`) means Stage 17.1 can add a **disk driver** (`/uploads/
avatars/`, chosen when `AVATAR_DIR` is set + a disk is mounted) or an **object-store
driver** (R2/S3, chosen when bucket env is present) **without changing the API,
client, or room payload** — a config choice, not a rewrite. **Object storage (A/C)
is the recommended target once a paid disk/bucket exists or traffic grows.**

**Hard cap regardless of driver:** reject any processed output over the size cap
(§3) and store nothing larger; never store the original.

---

## 3. Image processing pipeline (server-side)

All processing happens **on the server**, on the uploaded bytes, independent of the
client's own re-encode (the client 14.1 re-encode is a UX nicety, **never trusted**).

1. **Accept only** `image/png`, `image/jpeg`, `image/webp` (matches
   `ACCEPTED_AVATAR_MIME`). Everything else → `400 unsupported_type`.
2. **Max upload size: 2 MB** (matches `MAX_AVATAR_INPUT_BYTES`). Enforced by a
   **streaming byte counter** that aborts early — the 16 KB JSON `MAX_BODY_BYTES`
   does NOT apply to this route; a **separate multipart cap** of 2 MB is used, and a
   `Content-Length` over cap is rejected before reading the body.
3. **Validate magic bytes**, not just the declared MIME/`Content-Type` (§4).
4. **Decode server-side** and **strip all metadata** (EXIF/GPS/ICC/text chunks) — the
   re-encode inherently drops them; verify the encoder emits no passthrough metadata.
5. **Center-crop to a square**, then **resize** to **192×192** (default; 256×256 is a
   config option). Downscale only — never upscale a tiny source beyond its size.
6. **Re-encode to WebP** (JPEG fallback for any driver/consumer that needs it),
   quality ≈ 0.82 (matches `AVATAR_EXPORT_QUALITY`).
7. **Max processed output: 80–120 KB** (target ≤64 KB for a 192px WebP). If the
   re-encode exceeds the cap, **re-encode at a lower quality/size**; if still over,
   reject `413 avatar_too_large` rather than store an oversized blob.
8. **Deterministic, non-guessable identity.** The stored row is keyed by `user_id`;
   the **served URL carries a random, unguessable `version`** (e.g. a short
   `crypto.randomUUID()`-derived token) so `/api/avatar/<id>.webp?v=<token>` changes
   on every replace — enabling immutable caching (§7) and preventing URL-guessing of
   *someone else's next* avatar. **No user-controlled filename ever touches storage.**
9. **Old-avatar cleanup on replace.** Replacing overwrites the single `user_avatars`
   row (Option B) or deletes the old key (disk/object driver) in the same operation —
   one avatar per user, no orphans.
10. **Lifecycle:** **sign-out does NOT delete** the server avatar (it is account
    state, not session state). **Account deletion** (future GDPR flow) deletes the
    avatar row/file alongside the user (the `user_avatars` row cascades on
    `users` delete, mirroring existing `onDelete: 'cascade'` tables).

**Library note (17.1 decision, not this stage):** server decode/resize/encode needs
an image library. `sharp` is the obvious choice but pulls a native binary — the
17.1 spike must confirm it builds on Render's Node runtime, else fall back to a
pure-WASM encoder. **No dependency is added in 17.0.**

---

## 4. Security

Consistent with the existing API's guarantees (`server/api.ts`,
`ARCHITECTURE_DB_AUTH.md §5`):

- **Auth required.** Upload/delete resolve the session cookie → `userId`; no session
  → `401 unauthenticated`. No DB → `503 db_disabled`.
- **CSRF / session protection identical to today:** httpOnly hashed session cookie,
  **SameSite=Lax**, and the **`Origin` allow-check on every mutation**
  (`isOriginAllowed` against `ALLOWED_ORIGINS`) — a cross-site `POST` is `403
  bad_origin` before any body is read.
- **Rate-limit uploads.** A small per-user/per-session token bucket (e.g. N uploads
  per minute/hour) rejects abuse with `429`. Mirrors the spirit of the existing WS
  rate limiting; tunable via env.
- **Validate magic bytes, not the MIME header.** Sniff the leading bytes
  (PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF….WEBP`) and require them to match
  an accepted type; a lying `Content-Type` is rejected.
- **Reject SVG / GIF / polyglots.** No SVG (script vector), no GIF, and reject files
  whose magic bytes disagree with their container or that carry trailing/secondary
  payloads (polyglot). The **re-encode is the ultimate defense** — we serve only our
  own freshly-encoded WebP, never a byte of the upload.
- **No path traversal.** Storage keys derive **only** from the server-side `userId` +
  a server-generated `version`; no user input reaches a filesystem path. The disk
  driver additionally reuses the existing `DIST`-style `normalize()`+prefix guard
  (`server/httpStatic.ts`) so a served path can never escape the avatar root.
- **Safe serving headers** on `GET /api/avatar/...`:
  - `Content-Type: image/webp` (or `image/jpeg`) — the exact stored type.
  - `X-Content-Type-Options: nosniff`.
  - `Content-Disposition: inline` (a thumbnail, not a download).
  - `Cache-Control: public, max-age=31536000, immutable` — safe because the URL is
    **version-stamped** (a replace mints a new `?v=`), so caches never serve a stale
    or wrong image.
  - No `Set-Cookie`, no credentials on this read (it is public to room participants).
- **No user-controlled file names** anywhere (see §3.8).
- **Never log raw images or base64.** Logging stays first-line-only + truncated
  (matches the existing `/api error` logging), and image bytes are excluded from all
  logs/metrics.
- **Moderation risk (documented, MVP mitigation).** Uploaded avatars can be
  offensive/abusive. **MVP mitigation = type/size restrictions + the user can
  remove/reset their own avatar + a report path is out of scope now.** Because the
  served URL is same-origin and version-stamped, an admin can later purge one user's
  avatar by deleting its row. **Future work:** an admin/moderation tool to blank an
  avatar, an automated-classifier pre-check, and a report button — explicitly
  deferred past the 17.x rollout.

---

## 5. Data model

- **New table `user_avatars`** (Option B), one row per user:
  - `user_id uuid PK REFERENCES users(id) ON DELETE CASCADE`
  - `content_type text NOT NULL` (`image/webp` | `image/jpeg`)
  - `bytes bytea NOT NULL` (the processed derivative; hard-capped)
  - `version text NOT NULL` (unguessable token; part of the served URL)
  - `width integer NOT NULL`, `height integer NOT NULL`
  - `updated_at timestamptz NOT NULL DEFAULT now()`
  - Keeping the blob **out of `user_settings`** means every settings read stays cheap
    and unchanged. (A disk/object driver would store bytes externally and keep only
    `content_type`/`version`/`updated_at` here — same table, `bytes` nullable.)
- **`user_settings` gets one small additive column: `avatar_image_version text`**
  (nullable) — a fast "does this user have an uploaded avatar, and which version"
  flag, so `/api/me` and room seating can build the URL without touching the blob
  table. Null = no uploaded avatar → emoji fallback. **Emoji stays in the existing
  `user_settings.avatar` column, untouched, as the fallback field.**
- **Field-naming decision (avoids the §0 collision).** `GET /api/me` keeps
  `avatarUrl` = the **Google provider picture** for back-compat, and adds a **new,
  explicit field** for the uploaded game avatar:
  - `settings.avatarImageUrl: string | null` — a **same-origin** URL
    `"/api/avatar/<userId>.webp?v=<version>"` (null when unset).
  - Client precedence for "me": **uploaded image → local-only 14.1 image → emoji**
    (documented in §8). For **other players**: uploaded image (if the room payload
    carries it, §7) → emoji.
- **URL form:** same-origin `"/api/avatar/<userId>.webp?v=<version>"`. (An opaque
  `"/api/avatar/<opaqueId>.webp"` is an acceptable alternative; either way it is
  **same-origin and server-minted**, never a remote or user-supplied URL.)
- **Migration is additive only** (`0008_avatar_upload.sql`): `CREATE TABLE IF NOT
  EXISTS user_avatars …` + `ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS
  avatar_image_version text`. No column is dropped or retyped; a no-DB / older deploy
  is unaffected.
- **Guests:** no server upload. A guest (`is_guest = true`) keeps the local-only 14.1
  avatar; the upload endpoints are signed-in-account only.

---

## 6. API design

All new routes are **DB-gated**, **session-required**, and **Origin-checked** exactly
like the existing mutations. They live in the same `handleApiRequest` dispatcher.

- **`POST /api/me/avatar`** — upload/replace.
  - Body: `multipart/form-data` with a single `file` part (PNG/JPEG/WebP, ≤2 MB).
    Uses a **dedicated 2 MB multipart cap**, NOT the 16 KB JSON `MAX_BODY_BYTES`.
  - Runs the §3 pipeline + §4 validation; stores the derivative; mints a new
    `version`; sets `user_settings.avatar_image_version`.
  - `200 { avatarImageUrl }` on success. Errors: `400 unsupported_type` /
    `400 invalid_image`, `413 avatar_too_large`, `401 unauthenticated`,
    `403 bad_origin`, `429 rate_limited`, `503 db_disabled`.
- **`DELETE /api/me/avatar`** — remove the uploaded avatar.
  - Deletes the blob/file + clears `avatar_image_version`. `200 { avatarImageUrl:
    null }`. Falls back to the emoji everywhere. Idempotent (deleting when none →
    still `200`).
- **`GET /api/avatar/<userId>.webp?v=<version>`** — public read (§4 headers). Serves
  the processed bytes; **404 → the client falls back to the emoji** (§8). No session
  required (public to room participants); no cookies echoed.
- **`GET /api/me`** — **extended, not repurposed.** Continues to return `avatarUrl`
  (Google picture) unchanged, and now also `settings.avatarImageUrl` (§5). Existing
  clients ignoring the new field keep working.
- **`PATCH /api/settings` carries NO binary.** It never accepts image data; at most it
  could accept `avatarImageVersion: null` as an *alternative* delete signal, but the
  canonical remove path is `DELETE /api/me/avatar`. Binary only ever flows through
  `POST /api/me/avatar`.
- **No upload through the WebSocket.** The `/ws` protocol gains no image/base64
  message. Upload/replace/delete are HTTP-only.

---

## 7. WS / room payload

- **Room member payload may include an `avatarImageUrl` — a same-origin, versioned
  URL — ONLY once the image is server-validated and stored.** It is derived
  server-side from `user_settings.avatar_image_version` when the server names a seat
  for a signed-in user (the server already resolves the session user id for seating;
  it never trusts a client-sent URL). The existing **emoji `avatar` stays** as the
  fallback and for bots/guests.
- **Never base64 / image bytes on the wire.** The payload carries at most a short URL
  string; clients fetch the thumbnail over HTTP (cacheable) — the socket stays small.
- **Privacy:** an uploaded avatar is **public to room participants** (same visibility
  as the emoji/display name today). This is stated in the UI (§8) so a user knows
  uploading makes the image visible to people they play with. No avatar is exposed
  outside a room the user is in, beyond the public `GET /api/avatar` read (which is
  unguessable-versioned but not access-controlled — acceptable for a game avatar).
- **Cache invalidation:** the **version in the URL** is the invalidation mechanism —
  a replace mints a new `?v=`, so browser/CDN `immutable` caching is safe and a new
  avatar shows immediately without stale-cache flicker.

---

## 8. Client UI plan

- **Profile → Avatar section** gains a clear split:
  - **"This device" (local-only, 14.1)** — the existing local image path stays,
    labelled so users know it does not sync.
  - **"Synced avatar" (new)** — upload / replace / remove, **signed-in only**. A
    **guest sees a sign-in hint** instead of the upload control (mirrors how synced
    settings already gate on sign-in). Copy notes the image becomes **visible to
    players in your rooms**.
  - **Upload progress + error states**: pending spinner, and specific messages for
    too-large / unsupported-type / rate-limited / offline. **Remove** reverts to the
    emoji.
- **Precedence for "me"** (`MyAvatar`): **synced uploaded image → local-only 14.1
  image → emoji**. (Design choice to confirm in 17.2: whether a synced avatar should
  visually win over a device-local one; default = synced wins when present.)
- **Lobby / game seats** show a seat's `avatarImageUrl` when present, else the emoji —
  a small shared `<SeatAvatar>` that renders the image with an **`onError` → emoji**
  fallback so a 404 / network failure never shows a broken image.
- **Image fallback on 404** is mandatory everywhere an uploaded URL is rendered.

---

## 9. Testing plan

- **Unit (pure, no network/DB):**
  - MIME + **magic-byte** validation accepts png/jpeg/webp, rejects svg/gif/lying
    Content-Type/polyglot.
  - Size checks reject > 2 MB input and > cap processed output.
  - **Filename/key generation is safe** (no user input, no traversal, unguessable
    version).
  - URL normalization builds a correct same-origin `/api/avatar/<id>.webp?v=…` and
    parses it back.
- **API (integration):**
  - **Auth required** — `POST`/`DELETE` without a session → `401`; no DB → `503`;
    cross-origin mutation → `403`.
  - Upload a valid image → `200` + a working `GET /api/avatar/...` (correct
    content-type + `nosniff` + immutable cache).
  - **Reject** SVG / GIF / oversize / bad magic bytes with the right 4xx.
  - `DELETE` removes and reverts to emoji; a second `DELETE` is idempotent.
  - **Replace cleans up** the old blob/file/row (no orphan; version changes).
  - Rate limit trips `429` past the threshold.
- **Privacy / boundary guards:**
  - **No base64 / image bytes in any WS message** (extend the existing off-wire
    guard tests that already assert no `avatarImage`/`avatar_data` on the socket).
  - **No raw/user-controlled file names** in storage keys or logs; **no image bytes
    logged**.
  - No-DB and guest paths never expose an upload route as usable.
- **Visual (360 / 390 + RTL):**
  - Profile signed-in: upload → preview + AccountBar update, remove, error states.
  - Guest: sign-in hint (no upload control).
  - Online seat renders `avatarImageUrl` and **falls back to emoji on a forced 404**.

---

## 10. Rollout stages

- **17.0 — this plan (docs-only).** No code.
- **17.1 — server storage + processing + API, behind tests. ✅ DONE.** Shipped:
  additive idempotent migration `0008_avatar_upload.sql` (`user_avatars` blob table,
  one row per user + denormalised `user_settings.avatar_image_version`); repository
  `server/db/userAvatars.ts` (raw `bytea` via postgres.js: upsert/get/serve-by-id/
  delete, version bump on replace, settings mirror); pure `src/net/avatarImage.ts`
  (magic-byte detection, WebP-dimension reader, single-file multipart parser,
  same-origin URL builder, UUID-only path parser = traversal-safe); `POST`/`DELETE
  /api/me/avatar` (signed-in only, guests 403, Origin-checked, in-memory rate limit
  → 429, 2 MB cap) + public `GET /api/avatar/<id>.webp` (`nosniff` + immutable cache,
  404→emoji); `/api/me` gains `avatarImageUrl` (distinct from the OAuth `avatarUrl`).
  **No UI wiring, no WS/room-payload change** — the feature is inert to users until 17.2.

  **Image-processing dependency decision:** processing uses **ffmpeg via
  `child_process`** (fixed `pipe:0`→`pipe:1` argv, no shell/path), NOT a new npm
  dependency. Rationale: this repo already invokes ffmpeg in its asset scripts, and
  its CI `npm ci` is sensitive to native-module lockfile churn (the documented `libc`
  problem) — adding `sharp` would risk breaking CI, so we reused the ffmpeg binary
  that dev + the GitHub ubuntu runner already provide. **Runtime caveat:** on a host
  without ffmpeg (e.g. a bare Render instance), `POST /api/me/avatar` returns `503`
  and the feature simply stays off — zero impact on gameplay or the rest of the API.
  A future swap to a bundled/WASM processor (or a vetted `sharp`) can replace the
  processor behind the same API. Validated: `npm run verify` green; unit + ffmpeg
  processing tests pass; the DB round-trip test is CI-gated (Postgres).
- **17.2 — Profile UI upload / remove. ✅ DONE.** The Profile avatar section is now
  grouped into **Emoji / Synced avatar / This device**. The **Synced avatar** area is
  signed-in only (guests see a sign-in hint), with an "Upload synced avatar" button
  (busy/`Uploading…` + disabled state), a "Remove synced avatar" button when one
  exists, and inline error messages mapped from the API (`too_large` / `unsupported_type`
  / `rate_limited` / **503 → "Avatar processing is unavailable"** / sign-in / generic).
  Client adaptor `src/net/avatarApi.ts` (`uploadAvatar` multipart FormData — **no JSON
  base64** — + `deleteServerAvatar`); `useAccount` exposes `avatarImageUrl` and
  `uploadAvatarImage`/`removeAvatarImage` (dedicated endpoints, **never** `PATCH
  /api/settings`), re-hydrating `/api/me` after each. `MyAvatar` now resolves a
  **server `avatarImageUrl` → local custom image → emoji** priority with an `onError`
  fallback (a 404 degrades to the next candidate), used on the Profile summary +
  preview and the AccountBar. The local-only 14.1 path ("Choose local image") is fully
  intact. **Still NO lobby/game-seat avatar and NO WS/room-payload change** — the
  uploaded image shows only on "me" surfaces until 17.3.
- **17.3 — room / lobby / game seats show `avatarImageUrl`. ✅ DONE.** The room
  member payload (`RoomMember` / `snapshot()`) gained an OPTIONAL **same-origin**
  `avatarImageUrl`. The WS layer stamps it on the seated member from the authenticated
  user's avatar row: `attachIdentity` resolves the URL ONCE (`resolveAvatarImageUrl`,
  DB-gated, never on every broadcast) and re-broadcasts so seats update a beat later.
  Bots/guests/no-upload → absent (emoji). The snapshot + persistence restore both gate
  on **`isSafeAvatarImageUrl`** (same-origin `/api/avatar/<uuid>.webp[?v=n]`), so a
  legacy/tampered/remote value degrades to the emoji; a stale URL (avatar deleted)
  404s → emoji, and a fresh reconnect re-stamps. A new **`<SeatAvatar>`** renders the
  image with an `onError` → emoji fallback and the SAME same-origin gate client-side;
  it is used on **lobby seats** (all games) and the **King table** (via a
  `seatIndex → URL` map on `GameContext`, built in `OnlineGame` from the snapshot).
  Durak/Deberc/Tarneeb tables show name-only today (no avatar surface) — unchanged. The
  local-only image is **never** shown to other players; **no bytes on the wire**, no
  DB schema change, no gameplay change.
- **17.4 — QA + security audit. ✅ DONE.** Targeted audit of the 17.1–17.3 surface.
  **Hardening fixes applied:** (1) ffmpeg now runs under a **watchdog timeout**
  (`AVATAR_FFMPEG_TIMEOUT_MS`, default 8 s) that **SIGKILLs a hung process** + a
  **stdout cap** that kills a runaway stream — a malformed/hostile input can no longer
  wedge a request or leak a child; (2) the upload handler **rate-limits FIRST**
  (in-memory, keyed by the server-resolved userId) before any DB query or body read,
  and rejects an oversized **Content-Length** before reading a byte; (3) the serve
  route **clamps the Content-Type** to a known-safe image type (never echoes a stored
  value) alongside `nosniff`; (4) the rate-limit map **self-bounds** (`MAX_TRACKED_USERS`).
  **Audit confirmed (no change needed):** auth+Origin on POST/DELETE, guest 403,
  multipart-only 415, 2 MB cap, magic-byte (not MIME) validation, svg/gif/polyglot
  rejection + re-encode neutralisation, fixed `pipe:0→pipe:1` argv (no shell/path/
  filename), `unique(user_id)` + `ON DELETE CASCADE` + opaque avatar-row id (never the
  userId) + versioned cache-bust, snapshot/restore same-origin sanitisation, the OAuth
  picture never copied into `avatarImageUrl`, no image bytes/base64 on the wire or in
  logs, and a 404 → emoji client fallback. Verified with `npm run verify` + a live
  HTTP smoke (GET avatar → 404 text/plain with no DB; traversal path not served;
  malformed POST does not crash the process).

## Remaining limitations (post-17.4)

- **ffmpeg must be present at runtime.** Processing shells out to the `ffmpeg` binary
  (see §3 for why not `sharp`). On a host without it, `POST /api/me/avatar` returns a
  clean `503` and the feature stays off — no crash, no impact elsewhere. Render's plain
  Node runtime does **not** ship ffmpeg; see RENDER_DEPLOY.md for how to add it / verify.
- **No idle/slowloris timeout on the request body read** (shared by the whole API, not
  avatar-specific). Per-IP / connection-rate limiting remains an infra/proxy concern
  (already noted in MVP_STATUS "known limitations").
- **No content moderation.** MVP mitigation stays type/size limits + user remove/reset;
  an admin blank tool + classifier is still **future** (not scheduled this line).
- **Single-instance rate limit + storage.** The in-memory limiter and Postgres-`bytea`
  store fit one Node instance; horizontal scale would move both to shared infra.

---

## Non-goals for the whole 17.x line

Remote-URL avatars, SVG/GIF/animated avatars, base64-on-WS, image bytes in
`user_settings`, a public avatar directory, automated content moderation, and
guest-account uploads are all **out of scope**. Emoji remains the universal fallback.
