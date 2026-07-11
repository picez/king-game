# Friends — design plan (Stage 25.0)

> **STATUS: Design only. No code exists yet.** This document is the source of truth for
> the **Friends** feature. When it is implemented, the DB migration, repositories, API
> routes, WS presence/invite messages, UI, and tests must follow this file. When the
> design changes, update this file **first**, then the code. Paired with
> [`VOICE_CHAT_PLAN.md`](VOICE_CHAT_PLAN.md) (they share the 25.x rollout).

Card Majlis today has **guest + Google identity**, per-game stats, online rooms with
invite links (`?room=<CODE>`), and ephemeral room social (reactions + chat). Friends adds a
**persistent, signed-in-only** social graph so players can see who's online and pull an
online friend straight into their current room — reusing the existing invite/join flow.

---

## 1. Goals

- A **friend** relationship between two signed-in accounts (Google-linked; guests excluded).
- Send / accept / decline / remove friend requests.
- A **Friends list** in the Profile screen: online friends first, offline below.
- **Presence** (online/offline) for friends, driven by live authenticated WS connections.
- **Invite an online friend to my current room** — delivered as a notification that opens
  the EXISTING Join flow with the room code; never an auto-join.
- **Privacy-first:** never expose a user's email to other users; add-by-**friend code**, not
  by email or free-text search (no account enumeration).

## 2. Non-goals (MVP)

- No group calls / friend chat **outside** a room (room chat + voice stay room-scoped).
- No push notifications (in-app + WS only; a friend request is seen next time you open the app).
- No cross-instance presence — presence is **per server instance** (single-instance today).
- No follower/blocklist moderation console (a minimal **block** is a post-MVP note, §9).
- No friend leaderboards / activity feed / "recently played with".

## 3. Rollout (shared 25.x with voice)

| Stage | Scope |
|------|-------|
| **25.1** ✅ **DONE** | Friends **DB + API + presence backend** — migration `0009_friends.sql` (friend_code + friendships), repo `server/db/friends.ts`, `/api/friends` · `/request` · `/accept` · `/decline` · DELETE `/:userId` (signed-in only), in-memory `server/friendsPresence.ts` attached on the authed WS lifecycle, pure `src/net/friendCode.ts`, client `src/net/friendsApi.ts`, rate limit `server/friendsRateLimit.ts`. No UI, **no WS friend/voice messages yet** (`FRIEND_PRESENCE`/`FRIEND_INVITE` land in 25.2). |
| **25.2** ✅ **DONE** | Friends **UI + room invite** — Profile **Friends tab** (`FriendsPanel`: code+Copy, add-by-code, accept/decline, online-first list, Remove), guest CTA. Room invite: WS **`FRIEND_INVITE`** (client→server, verified: authed + in-room + `areFriends` + target online, rate-limited) → **`FRIEND_INVITE_RECEIVED`** toast (Join reuses the `?room=CODE` flow — never auto-joins) → **`FRIEND_PRESENCE`** push on connect/disconnect. Invite surface = the Lobby's collapsible Friends panel (signed-in). Code is the sender's OWN room (never a client value); no email/token on the wire. |
| 25.3 | Voice **signaling WS protocol** (see [`VOICE_CHAT_PLAN.md`](VOICE_CHAT_PLAN.md)). |
| 25.4 | Voice **WebRTC UI**. |
| **25.5** | **Production hardening** (rate limits, presence cleanup, abuse guards, block MVP, docs/smoke) — spans both features. |
| **25.9** ✅ **DONE** | **Lobby invite visibility (real fix)** — 25.8 rendered the invite block as a SIBLING after the full-height lobby screen, so it fell **below the fold** and looked missing. It is now passed INTO the `Lobby` card (`inviteSlot`) and rendered right after the players — always on-screen. Added explicit **loading** ("Loading friends…") and **API-error + Retry** ("Could not load friends") states alongside the guest / no-friends / list states. Guard: the invite variant is inside the lobby card, never a `<details>`. (Shipped with the online **rematch** flow — see MVP_STATUS.) |
| **25.8** ✅ **DONE** | **Lobby invite made visible** — the room Lobby now shows an **always-visible** compact `FriendsPanel variant="invite"` (was a collapsed `<details>`, easy to miss, and hidden entirely for guests). Online friends first, a clear **Invite** button per online friend, a disabled Invite (offline hint) otherwise, and explicit empty states: **guest → "Sign in to invite friends"**, **signed-in no-friends → "Add friends in Profile to invite them"**. Invite still goes through `FRIEND_INVITE` (server takes the sender's own room); the target sees the Join/Dismiss toast; the sender sees the 25.7 non-fatal failure notices. Mobile/RTL safe (compact card, no overflow at 360/390). |
| **25.7** ✅ **DONE** | **Friends production bugfix pass** — presence + invites + request badge. **Root cause of "no online status":** the client only opened a WS when entering a room, so a signed-in user at the menu was offline and the Profile Friends tab got no live pushes (the server already attaches presence to ANY authed socket). Fix: an app-level **`usePresence`** connection (one lightweight socket while signed-in at the menu; sends nothing room-related, listens for `FRIEND_PRESENCE` + `FRIEND_INVITE_RECEIVED`, re-fetches `/api/friends`). **Request badge:** red `notif-badge` on the Profile menu tile + the Friends tab (`incoming.length`), clears on accept/decline/refresh; safe with no-DB/guest (count 0). **Explicit online/offline chip** + online-first (unchanged sort). **Invite UX:** in-room online friend → active Invite; offline → disabled Invite (hint); menu (no room) → a "create/join a room to invite" hint. **Invite failures now surface** a non-fatal toast via new ErrorCodes `FRIEND_NOT_ONLINE` / `NOT_FRIENDS` / `NOT_IN_ROOM` (server sends the reason back to the sender; `verifyFriendInvite` reason → `inviteReasonToErrorCode`). Menu also shows the received-invite toast (Join reuses `?room=`). No email/token/session on the wire. |

Each stage ships behind `verify` green and is additive (no gameplay/room-protocol break).

---

## 4. Data model (migration `0009_friends.sql`)

Signed-in accounts only. One row per **directed** request; an accepted request is the
friendship (queried in both directions). `users.id` is `uuid PRIMARY KEY` (migration 0001),
so both FKs cascade on account deletion.

```sql
-- 0009_friends.sql  (idempotent; ADD ... IF NOT EXISTS style like 0005–0008)

-- Stable, shareable friend code so users add each other WITHOUT exposing email or
-- allowing account enumeration. 8 chars, Crockford-ish alphabet, unique.
ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code text UNIQUE;
-- (Backfilled lazily on first Friends-screen open, or in the migration for existing rows.)

CREATE TABLE IF NOT EXISTS friendships (
  requester_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending',      -- 'pending' | 'accepted' | 'blocked'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)                -- no self-friending
);

-- Fast "my friends / my incoming requests" in both directions.
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id, status);
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships (requester_id, status);
```

**Invariants (enforced in the repo, not just SQL):**
- At most ONE relationship per unordered pair. Before inserting `(A→B)`, check for an existing
  `(A→B)` OR `(B→A)` row; if `(B→A)` is already `pending`, **accepting** is just flipping that
  row to `accepted` (mutual). Never create a reciprocal duplicate.
- `status`:
  - `pending` — `requester_id` asked `addressee_id`; shows in the addressee's **incoming** list.
  - `accepted` — friends (either side may remove → DELETE the row).
  - `blocked` — post-MVP (§9); requester_id blocked addressee_id (hidden, no requests).
- **Cascade:** deleting a user removes all their friendship rows (both directions).
- **Remove friend** = `DELETE FROM friendships` for the pair (either direction).

## 5. Repositories (`server/db/friends.ts`, DB-gated + never-throw at the API edge)

Pure-ish DB helpers (dynamic `getDb()` import like the rest of `server/db/*`):

- `ensureFriendCode(userId)` → `string` — generate + persist a unique code if absent.
- `resolveFriendCode(code)` → `userId | null`.
- `listFriends(userId)` → `{ userId, displayName, avatar, avatarImageUrl, since }[]` (accepted).
- `listIncomingRequests(userId)` / `listOutgoingRequests(userId)`.
- `requestFriend(requesterId, addresseeId)` → `'created' | 'already' | 'auto_accepted'` (the
  last when a reciprocal pending row existed).
- `acceptRequest(userId, otherId)` / `declineRequest(userId, otherId)` — only the **addressee**
  may accept/decline.
- `removeFriend(userId, otherId)` → boolean.
- `areFriends(a, b)` → boolean (used to authorise a room invite).

**Emitted fields NEVER include email** — only `displayName`, the whitelisted emoji `avatar`,
and the same-origin `avatarImageUrl` (already public on lobby seats). `friend_code` is returned
ONLY to its owner (for sharing), never listed for others.

## 6. HTTP API (`server/api.ts`, session-required, CSRF-guarded like the rest)

All routes require a signed-in **non-guest** session (`requireUser` + `!isGuest`); a guest or
no-DB deploy gets `403 guest_forbidden` / `503 db_disabled` (consistent with avatars/settings).

| Method + path | Body | Returns | Notes |
|---|---|---|---|
| `GET /api/friends` | — | `{ friends:[…], incoming:[…], outgoing:[…], friendCode }` | one call powers the whole panel; presence is layered on the client from WS |
| `POST /api/friends/request` | `{ friendCode }` | `{ status }` | resolve code → addressee; rate-limited; self / already-friends / not-found → safe codes |
| `POST /api/friends/accept` | `{ userId }` | `{ ok:true }` | only the addressee of a `pending` row |
| `POST /api/friends/decline` | `{ userId }` | `{ ok:true }` | addressee declines (row deleted) |
| `DELETE /api/friends/:id` | — | `{ ok:true }` | remove an accepted friend (either direction) |

`:id` and body `userId` are the **other user's `users.id`** (a uuid the client already learned
from `GET /api/friends`) — never an email. The friend **invite to a room** is a **WS** message,
not HTTP (§8), because it targets a live socket and rides the existing room session.

**Safe error codes** (no secrets): `not_found` (bad friend code), `self` (own code),
`already` (already friends/pending), `not_guest_only`→`guest_forbidden`, `rate_limited`,
`db_disabled` / `db_error` / `migration_required` (reuses the Stage 24.3–24.5 classification).

## 7. Presence model (in-memory, per server instance)

Presence is **live authenticated WS connections**, not a DB column (so it is always fresh and
needs no write on every connect/disconnect):

- The server keeps `presence: Map<userId, Set<WebSocket>>`. On a WS connection whose session
  resolves to a `userId` (existing `resolveSessionUserId` on upgrade — guests resolve to null
  and are ignored), add the socket; on `close`/heartbeat-terminate, remove it.
- A user is **online** iff `presence.get(userId)?.size > 0`.
- On a presence change (first socket added / last socket removed), the server pushes a
  `FRIEND_PRESENCE` update to that user's **online friends** (look up accepted friendships,
  fan out to their live sockets). On connect, the server also sends the new client a snapshot
  of which of THEIR friends are currently online.
- **Single-instance limitation (documented):** presence is per-process. With horizontal
  scaling, a friend on another instance shows offline until a shared presence store
  (Redis pub/sub) is added — a post-MVP item, same limitation as rooms/social today.

Presence carries only `{ userId, online: boolean }` — no email, no room code, no IP.

**Client presence socket (Stage 25.7):** the server attaches presence to ANY authenticated
socket, but the client historically only opened one when entering a ROOM — so a signed-in user
at the menu was invisible. `usePresence` (mounted in `StartMenu` while signed-in) opens one
lightweight socket at the menu so the user is genuinely "online" and the Friends tab / request
badge update live. During an online game the room socket owns presence and the menu is unmounted,
so there is never a duplicate presence socket for the same user.

## 8. WS protocol additions (`src/net/messages.ts`)

Friends messages ride the **same authenticated `/ws` socket** already used for rooms (the
socket's session → userId is resolved on upgrade). All are additive union members; unknown
messages are ignored by older clients (forward-compatible).

**Client → server**
- `{ t: 'FRIEND_INVITE', toUserId, code }` — "invite this friend to room `code`". The server
  verifies (a) the sender is signed-in, (b) `areFriends(sender, toUserId)`, (c) the sender is
  actually a member of room `code`, (d) the target is online → then forwards.

**Server → client**
- `{ t: 'FRIEND_PRESENCE', updates: [{ userId, online }] }` — presence snapshot / deltas.
- `{ t: 'FRIEND_INVITE_RECEIVED', fromUserId, fromName, code, at }` — shown as a dismissible
  in-app toast/banner with **Join** / **Ignore**. Join opens the EXISTING Join flow prefilled
  with `code` (the same path as an `?room=` link) — **never auto-joins**. Carries the inviter's
  `displayName` (already visible on seats), NEVER their email.
- Friend graph changes (request received / accepted) MAY reuse a light
  `{ t: 'FRIEND_UPDATE' }` nudge telling the client to re-`GET /api/friends`, keeping the WS
  payload minimal (no friend list on the wire).

**Why WS invite (not a new HTTP route):** the invite targets a **live** connection, must check
room membership, and must not create a persistent record — exactly the ephemeral, socket-bound
shape of reactions/chat. It reuses the room **code** (already the public join secret) so the
invite carries **no token / userId in any URL** — it only nudges the recipient to run the
normal Join flow.

## 9. Security & privacy

- **Add-by-friend-code only** — no email lookup, no displayName search → no account
  enumeration and no email exposure. The friend code is a rotating-capable, per-user secret
  shown only to its owner.
- **Email is never sent to another user** — not in `GET /api/friends`, not in any WS payload.
  Friends see `displayName` + `avatar`/`avatarImageUrl` + presence only (all already public on
  lobby seats).
- **No arbitrary room join:** a friend invite only NUDGES; the recipient must click Join and
  goes through the normal gate (password / seat availability). No invite can seat a user.
- **Authorisation:** accept/decline only by the addressee; invite only between confirmed
  friends where the sender is in the room; remove only by a party to the friendship.
- **Rate limits** (reuse the in-memory token-bucket pattern from `avatarRateLimit` / WS
  limits): friend **requests** (e.g. 20/hour/user), room **invites** (e.g. 10/min/user), and
  the friend-invite WS message shares the per-connection message limiter. A flood of requests
  to one addressee is also capped per (requester→addressee) pair.
- **Block (post-MVP):** `status='blocked'` hides the blocker from the blocked user's presence
  and rejects their requests/invites. Not in MVP; the schema already reserves the status.

## 10. UX

- **Friends panel** — a new tab in the Profile screen (`ProfileMenu`), alongside Profile /
  My stats / Achievements / Leaderboard. Sections: **Requests** (incoming, Accept/Decline),
  **Online** (friends with a green presence dot, "Invite to room" when applicable), **Offline**
  (muted, below). A **"Your friend code: XXXX-XXXX"** row with Copy/Share, and an **"Add
  friend"** input that takes a code.
- **Invite to room** — the "Invite to room" button appears on an **online** friend's row ONLY
  when the local user is **in a lobby or game room**; it sends `FRIEND_INVITE`. Disabled with a
  hint otherwise ("Join or host a room to invite friends").
- **Invite received** — a non-blocking toast/banner (reusing the PWA-pill / AchievementToast
  pattern): "Alex invited you to a game" · **Join** / **Ignore**. Never covers the hand/actions.
- **Guests** — the Friends tab shows the existing "Sign in with Google" CTA (friends need an
  account), local play unaffected.
- **Mobile / PWA** — the panel and toast respect the Stage 23.0 safe-area + 44px tap targets;
  no overlap with the hand/action bar or the social FABs; no horizontal overflow at 360/390.
- **i18n** — all strings in `en/uk/de/ar`.

## 11. Testing plan

- **Pure helpers:** friend-code normalisation/validation; the "existing reciprocal pending →
  auto-accept" resolution logic; presence set add/remove → online boolean.
- **API tests** (mock req/res like `avatarApi.test`): auth/permission (guest→403, no-DB→503),
  accept-only-by-addressee, self-request/already/not-found codes, remove either direction, and
  **no email in any response body** (privacy scan).
- **WS presence/invite tests:** presence fan-out to online friends only; `FRIEND_INVITE`
  rejected when not-friends / not-in-room / target-offline; `FRIEND_INVITE_RECEIVED` carries a
  code + displayName but **no email / token**.
- **Source guards:** `messages.ts` friend payloads carry no email/token; the friend list never
  rides `UPDATE_SETTINGS`/room state.
- **e2e smoke:** two signed-in sessions (DB-gated, skips without `TEST_DATABASE_URL`) — request
  → accept → presence online → invite to room → recipient's Join sheet prefilled (no auto-join).
- **Visual smoke:** Friends panel at 360/390 + RTL, online-first ordering, invite toast not
  covering the hand.

## 12. Open decisions (for the owner, before 25.1)

- Friend code format + rotation (fixed vs regenerate-on-demand).
- Request cap numbers (per hour / per pair).
- Whether an accepted friendship stores a `since` timestamp for display (nice-to-have).
