# In-room voice chat — design plan (Stage 25.0)

> **STATUS: Design only. No code exists yet.** This document is the source of truth for
> **in-room voice chat**. When it is implemented, the WebRTC client, the WS signaling
> messages, the server relay, the UI, and the tests must follow this file. When the design
> changes, update this file **first**, then the code. Paired with
> [`FRIENDS_PLAN.md`](FRIENDS_PLAN.md) (they share the 25.x rollout).

Card Majlis rooms already carry ephemeral **text chat + reactions** over the authoritative
`/ws` socket. Voice adds **opt-in, room-scoped, peer-to-peer audio** for small tables, using
that same socket ONLY as a signaling channel. **No audio ever touches the server or the DB.**

---

## 1. Goals

- On entering a room, the player may **enable voice or not** (opt-in, never automatic; mic is
  never captured without an explicit tap + the browser permission prompt).
- In the room, **Join / Leave voice** and **Mute / Unmute mic**.
- Audio is **room-scoped** — you only ever hear the other members of your current room.
- **No recording, no persistence** — no audio bytes server-side, nothing in Postgres.
- **MVP = WebRTC mesh** for rooms up to **5 players** (the platform's max seat count), with the
  existing WS as the **signaling** channel and **STUN-only** ICE.
- **Graceful fallback:** if mic permission is denied, WebRTC is unsupported, or NAT traversal
  fails, voice degrades to a clear "unavailable" state and **text chat keeps working**.

## 2. Non-goals (MVP)

- No **SFU / mixing server** — mesh only (fine at ≤5; 5 peers ⇒ ≤4 connections each).
- No **TURN** relay in MVP (STUN-only). TURN is documented as the post-MVP fix for strict-NAT
  users (§7). No audio recording, transcription, moderation, or voice-activity analytics.
- No voice **outside a room** (no friend/global calls — see [`FRIENDS_PLAN.md`](FRIENDS_PLAN.md)).
- No push-to-talk / spatial audio / noise suppression tuning (browser defaults only).
- No cross-instance voice — both peers must be on the **same room** on the **same server
  instance** (rooms are already single-instance).

## 3. Rollout (shared 25.x with friends)

| Stage | Scope |
|------|-------|
| 25.1–25.2 | Friends (see [`FRIENDS_PLAN.md`](FRIENDS_PLAN.md)). |
| **25.3** ✅ **DONE** | Voice **signaling WS protocol** — `VOICE_*` messages (messages.ts), a room-scoped server **relay** `server/voiceSignaling.ts` (join/leave/relay-to-target/mute, returns targeted deliveries; NO audio, NO DB), pure `src/net/voiceSignal.ts` (SDP 16 KB / ICE 4 KB caps + glare `shouldOffer`), per-client signaling limit (`voiceRateLimit.ts`, 120/min), wired in index.ts (verify same-room + size + rate; cleanup on close/leave). Client plumbing in useNetworkGame (`sendVoice*` + `registerVoiceListener`) — **INERT, no WebRTC/media yet**. |
| **25.4** ✅ **DONE** | Voice **WebRTC UI** — `src/voice/webrtc.ts` (STUN-only adapter, the ONLY raw-WebRTC/getUserMedia site) + `VoiceSession` mesh controller (fully unit-tested with mocks) + `useRoomVoice` hook (remote `<audio>` sinks, autoplay-blocked fallback) + `VoiceControl` (Lobby **card** + in-game **compact** mic button in the RoomSocial cluster). Opt-in (mic only on Join), Mute/Unmute, unsupported / permission-denied / connecting states; leaving the room tears voice down. Glare = lower clientId offers. No audio server-side/DB. |
| **25.7** ✅ **DONE** | **Voice connectivity bugfix pass** — fixed the "button works but no audio" class: **ICE candidates that arrive before the remote description are now buffered** (per-peer queue in `VoiceSession`, flushed after `setRemoteDescription`) instead of being dropped — the classic cause of a mesh that never connects. Added a **safe status/debug block** in the Lobby card (Mic allowed/denied · Peers connected/total · Connection connecting/connected/failed · Audio playing/blocked — **no SDP/ICE/identity**) and a **"Connection failed — a TURN server may be required"** hint when every peer is down (`connectionSummary().allFailed`). Compact + lobby controls share one session. Tests: buffered-ICE-before-remote-desc, ontrack→sink, allFailed summary. |
| **25.6** ✅ **DONE** | **TURN provider setup + runtime ICE** — runtime endpoint **`GET /api/voice/ice-config`** (server env `VOICE_ICE_SERVERS`, public, no DB) so a deployment adds/rotates TURN **without a client rebuild**; client `src/voice/iceConfigClient.ts` prefers it, falling back to build-time `VITE_VOICE_ICE_SERVERS` then STUN (`useRoomVoice` resolves on mount, `createPeerConnection(iceServers)`). Diagnostics `voice:{ice:"stun_only"\|"turn_configured"}` (secret-free) + optional UI "Network: STUN/TURN" indicator. Static TURN creds are browser-visible **by design** but never logged / never in diagnostics; short-lived creds are the documented post-MVP step. Provider comparison (§7). Guards: no committed TURN url/cred, no cred in logs/diagnostics, docs cover both envs + endpoint. |
| **25.5** ✅ **DONE** | **Production hardening** — reconnect **resync** (WS reconnect → `VoiceSession.resync()` closes stale PCs + drops audio sinks + re-JOINs with the same mic → fresh `VOICE_PEERS` rebuilds the mesh, no duplicate PCs, mute re-asserted; driven by `connectionEpoch` from useNetworkGame). ICE **config seam** `src/voice/iceConfig.ts` — `VITE_VOICE_ICE_SERVERS` (JSON array) overrides the STUN-only default; TURN credentials are **env-only, never committed**; `redactIceServers` strips secrets for logs. Permission UX: denied → message **+ browser-settings hint**; peer `disconnected` → "reconnecting…" vs `failed`. Page-hidden/PWA-background: **no auto-rejoin** (opt-in preserved). Guards: no committed TURN url/credential across `src/`+`server/`; redaction never leaks the secret. |

Additive and **fairness-safe**: voice never touches game state, redaction, or the reducer.

---

## 4. Architecture (mesh + WS signaling)

```
 Player A ──getUserMedia──▶ RTCPeerConnection(A→B) ──DTLS/SRTP audio──▶ Player B
    │                                   ▲
    │  VOICE_SIGNAL_OFFER/ANSWER/ICE     │  (peer-to-peer, encrypted, never via server)
    ▼                                   │
  /ws socket ───────── server RELAY (room-scoped) ─────────── /ws socket
   (signaling only: SDP + ICE candidates forwarded between two members of the SAME room)
```

- Each member who **joins voice** creates one `RTCPeerConnection` **per other voice member**
  (full mesh). At ≤5 seats that is ≤4 connections/peer — well within browser limits.
- The **server only relays signaling** (SDP offers/answers, ICE candidates) between two clients
  that are members of the **same room**. It parses none of it beyond routing, stores none of it,
  and never sees the audio (which is end-to-end DTLS-SRTP).
- **ICE:** STUN-only by default (public STUN `stun:stun.l.google.com:19302`). A deployment MAY
  override the ICE servers — including a **TURN** relay for strict NAT — either at **runtime** via
  the server env `VOICE_ICE_SERVERS` (served at `GET /api/voice/ice-config`, no rebuild) or at
  **build time** via `VITE_VOICE_ICE_SERVERS` (baked into the bundle). Both are a JSON array of
  `{ urls, username?, credential? }`, parsed by `server/voiceIce.ts` / `src/voice/iceConfig.ts`,
  which fall back to STUN on any malformed/absent value. **TURN credentials come only from the
  host env and are NEVER committed;** they are delivered to the browser (which must authenticate
  to TURN) but never logged and never in diagnostics (`redactIceServers`). See §7.

## 5. WS signaling protocol (`src/net/messages.ts`, additive)

All ride the existing authenticated `/ws` room socket. The server tags each with the sender's
`clientId` + `seatIndex` and forwards ONLY to members of the sender's current room. A `to`
field targets a single peer for the 1:1 SDP/ICE exchange.

**Client → server**
- `{ t: 'VOICE_JOIN' }` — "I'm joining the room's voice session" (after `getUserMedia` succeeds).
- `{ t: 'VOICE_LEAVE' }` — leaving voice (or on unload).
- `{ t: 'VOICE_SIGNAL_OFFER', to, sdp }` — an SDP offer for peer `to`.
- `{ t: 'VOICE_SIGNAL_ANSWER', to, sdp }` — an SDP answer for peer `to`.
- `{ t: 'VOICE_SIGNAL_ICE', to, candidate }` — a trickled ICE candidate for peer `to`.
- `{ t: 'VOICE_MUTE_STATE', muted }` — broadcast my mic mute state (UI dot only; the mic is
  ALSO actually disabled locally — mute is not just cosmetic).

**Server → client**
- `{ t: 'VOICE_PEERS', peers: [{ clientId, seatIndex, muted }] }` — the current voice roster,
  sent on join; drives which peer connections to create.
- `{ t: 'VOICE_PEER_JOINED', clientId, seatIndex }` / `{ t: 'VOICE_PEER_LEFT', clientId }` —
  roster deltas → create / tear down the matching `RTCPeerConnection`.
- `{ t: 'VOICE_SIGNAL_OFFER'|'VOICE_SIGNAL_ANSWER'|'VOICE_SIGNAL_ICE', from, sdp|candidate }` —
  the relayed signal, stamped with the sender's `clientId`.
- `{ t: 'VOICE_MUTE_STATE', clientId, muted }` — a peer's mute state for the UI.

**Glare/负ordering rule:** to avoid two-sided offers, the peer with the **lower `clientId`**
(deterministic) is the **offerer**; the other waits for the offer. Renegotiation on a new joiner
follows the same rule.

**Server relay guarantees:** it validates the sender is a member of a room, that `to`/targets
are members of the **same** room, drops anything else, and never persists or inspects SDP/ICE
beyond routing. `VOICE_*` is rate-limited on the shared per-connection message limiter, with a
tighter cap on ICE bursts.

## 6. Client (Stage 25.4, `src/voice/` — pure hooks + a thin WebRTC layer)

- `useVoice(room, ws)` hook: owns the local `MediaStream` (`getUserMedia({ audio:true })`), a
  `Map<clientId, RTCPeerConnection>`, and the remote `<audio>` sinks. Exposes
  `{ state, join, leave, toggleMute, muted, peers }`.
- **Pure, testable pieces** (no RTC/DOM): `shouldOffer(localId, remoteId)` (lower-id offers),
  the roster→connection **diff** (which PCs to add/remove given `VOICE_PEERS` deltas), and the
  signaling **reducer** (message → action). The `RTCPeerConnection` wiring stays in a thin
  adapter mocked in tests.
- Remote audio plays via hidden `<audio autoplay>` elements (one per peer); local audio is
  **never** looped back.
- Teardown: `leave`, tab unload, room leave, or a seat/member change all close the affected
  peer connections and stop local tracks (mic light off).

## 7. STUN / TURN

- **Default: STUN-only.** Works for most home/mobile NATs (full-cone / restricted). Free, no creds.
- **TURN (opt-in, 25.5–25.6).** Symmetric-NAT / restrictive-firewall users can't P2P over STUN
  alone; a TURN relay is the fix but costs bandwidth and needs credentials.

### 7.1 How to supply ICE servers (two seams)

| Seam | Env | When it applies | Change without redeploy? |
|------|-----|-----------------|--------------------------|
| **Runtime** (preferred) | `VOICE_ICE_SERVERS` (server) | Served at **`GET /api/voice/ice-config`**; the client fetches it on entering a room. | **Yes** — restart the service, no client rebuild. |
| **Build-time** (fallback) | `VITE_VOICE_ICE_SERVERS` (client) | Baked into the bundle; used when the endpoint is unreachable. | No — needs a rebuild. |

Both take the same JSON shape, e.g.
`[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"…","credential":"…"}]`.
The client resolution order is **runtime endpoint → build-time value → STUN default**; any
malformed value safely falls back to STUN (`iceConfig.ts` / `voiceIce.ts` parsers).

> **Static TURN credentials are visible to the browser by design** — the browser must
> authenticate to the TURN server, so the credential is delivered to it (via the endpoint or the
> bundle). That is expected and not a leak. What we DO guarantee: the credential is **never
> logged** and **never** in `/health/diagnostics` (which reports only `voice.ice:
> stun_only|turn_configured`). **Never commit it** — set it only in the host's env / secret store.
> **Post-MVP hardening: short-lived credentials.** Mint per-session TURN credentials on each
> `GET /api/voice/ice-config` (e.g. coturn REST `HMAC(secret, username=expiry)` or a provider
> token) so a leaked credential expires in minutes. `server/voiceIce.ts` is the seam for this.

### 7.2 Provider options (pick one)

| Provider | Free tier | Cost model | Setup effort | Notes |
|----------|-----------|-----------|--------------|-------|
| **Google STUN** (default) | Unlimited STUN | Free | none | STUN only — no relay for strict NAT. |
| **Metered.ca** | ~50 GB/mo (Open Relay has a free global TURN) | Usage ($/GB) after | Low — copy an ICE-servers JSON / call their API | Fastest path to working TURN; supports short-lived creds. |
| **Twilio Network Traversal** | none (pay-as-you-go) | Per-GB relayed | Low — server SDK returns short-lived ICE tokens | Rock-solid, global; best fit for the post-MVP short-lived-cred endpoint. |
| **Cloudflare Calls / TURN** | Generous (TURN pricing per-GB, free allotment) | Per-GB | Low–medium — API issues creds | Good anycast network; issue creds from `voiceIce.ts`. |
| **self-hosted coturn** | your VM cost | fixed VM + bandwidth | Medium–high — run/secure coturn, open 3478/5349, TLS | Cheapest at scale; you own it. Use REST-auth (HMAC) for short-lived creds. |

Recommendation for launch: **Metered.ca or Twilio** for a managed relay with short-lived creds
(no infra to run); **coturn** once relay volume makes a fixed VM cheaper. Until any is configured,
strict-NAT users get the **text-chat fallback** (§8) — voice is never a dead button.

## 8. Fallback & failure states (must be graceful — never a dead mic button)

- **Mic permission denied / dismissed** → voice stays off, a clear "Microphone blocked — using
  text chat" note, Join disabled with a "how to enable" hint. Text chat unaffected.
- **WebRTC unsupported** (`!window.RTCPeerConnection` / `!navigator.mediaDevices`) → the voice
  control is hidden/disabled with "Voice isn't supported on this device"; text chat only.
- **ICE fails / peer never connects** (STUN can't traverse) → after a timeout the peer shows
  "couldn't connect (network)"; the rest of the mesh keeps working; suggest text chat. This is
  the case TURN would fix (§7).
- **Autoplay blocked** → a one-tap "Enable sound" affordance (browsers gate autoplay audio).
- Voice failure NEVER blocks gameplay, the room, or text chat.

## 9. Security & privacy

- **No audio server-side, ever** — media is end-to-end DTLS-SRTP peer-to-peer; the server sees
  only SDP/ICE it forwards. **No recording, no transcription, no DB row.**
- **Room-scoped relay** — the server forwards `VOICE_*` only between members of the **same**
  room; a client cannot signal into a room it isn't in, or to a non-member.
- **No email / identity leak** — `VOICE_*` payloads carry `clientId` + `seatIndex` (already in
  the room snapshot), never email/userId/token.
- **Explicit consent** — the mic is only captured after the user taps Join AND grants the
  browser permission; leaving voice / muting stops or disables the track locally (mute is real,
  not cosmetic).
- **Rate limits** — signaling shares the per-connection WS limiter with a tighter ICE-burst cap;
  `VOICE_JOIN`/`LEAVE` are debounced server-side.
- **Post-MVP moderation** — per-listener **mute another player** (client-side gain=0, no server
  audio), and a host "disable voice for the room" toggle. Not in MVP; noted here.

## 10. UX

- **Opt-in on entry** — the Lobby shows a **"Voice chat: Off"** toggle (default Off). Enabling
  prompts for the mic. Nothing is captured until then.
- **In-game controls** — a compact voice control lives in the existing **RoomSocial** cluster
  (bottom-right, with the reaction/chat FABs): a **mic** button (join/leave + mute/unmute) and
  small per-peer **speaking/muted** dots on seats. It respects the Stage 23.0 safe-area + 44px
  tap targets and never overlaps the hand/action bar (mobile 360/390, RTL-safe).
- **Permission state is always visible** — "Asking…", "Blocked", "Connected (3)", "Muted".
- **Text chat stays** — voice is additive; the chat drawer + reactions are unchanged and are the
  documented fallback.
- **i18n** — all strings in `en/uk/de/ar`.

## 11. Testing plan

- **Pure unit tests:** `shouldOffer` (lower-id offerer), roster→PC diff (add/remove on
  join/leave), the signaling reducer (message → intended action), mute-state propagation.
- **Server relay tests** (mock req/res / ws): `VOICE_SIGNAL_*` forwarded ONLY to same-room
  members; rejected to non-members / cross-room; no persistence; rate-limit trips.
- **Source guards:** `messages.ts` `VOICE_*` carry no email/token/SDP-storage; server never
  writes audio/SDP to a store; no `RTCPeerConnection` usage in the pure modules.
- **Fallback tests:** denied permission / unsupported / ICE-timeout each resolve to the right UI
  state (mockable via injected capabilities), and text chat is never disabled.
- **e2e smoke (no real audio):** two clients `VOICE_JOIN` → the relay exchanges mocked
  offer/answer/ICE → both reach a "connected" signaling state (media stubbed). Confirms routing,
  not sound.
- **Manual browser smoke:** two real tabs, grant mic, hear each other; deny in a third →
  fallback; 360/390 controls don't overlap the hand.

## 12. Open decisions (for the owner, before 25.3)

- STUN server list (Google public vs self-hosted) and whether to ship `VITE_STUN_URLS`.
- Whether TURN is in scope at all for launch (cost) or strictly post-MVP.
- Default: voice **Off** on entry (recommended) vs remember-last-choice per device.
- Max voice participants if ever < seat count (all 5 vs cap at 4 speakers).
