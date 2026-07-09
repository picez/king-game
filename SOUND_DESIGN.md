# Sound Design — Card Majlis (Stage 15.0)

> **Planning doc only. Stage 15.0 adds NO runtime code, NO audio assets, and NO
> dependencies.** It defines the product stance, the default decision, the event →
> sound map, the preference model, the asset strategy, a staged rollout (15.1–15.5),
> and the test/QA plan. Implementation stages must follow this doc and keep
> gameplay/rules/scoring/AI, server/WS/protocol, DB/stats/auth **unchanged** — sound
> is purely **client-side feedback**.

Card Majlis is a card lounge for **King, Durak, Deberc, Tarneeb**. The visual
direction is the "Levantine Card Lounge" (dark-green felt + brass/gold + walnut, see
[`VISUAL_DIRECTION.md`](VISUAL_DIRECTION.md)); the sound direction mirrors it: **warm,
tactile, understated** — a soft card tap, a felt slide, a brass tick, a warm chime.

---

## 1. Product stance

- **Optional, subtle, short.** Every sound is a brief (< ~350 ms) tactile confirmation
  of something the player just did or just saw. No looping music in MVP. No ambience.
- **No autoplay surprise.** Audio is never armed until the **first user gesture** (a
  tap/click), per browser autoplay policy. Before that, the engine is a no-op.
- **Never carries hidden information.** A sound may only accompany something ALREADY
  visible in the UI. It must never reveal an opponent's card, a hidden hand, a value,
  or a turn the UI doesn't already show. Fairness first — sound is redundant feedback,
  never a channel. (Corollary: online play sounds the SAME for everyone based on the
  redacted state each client already renders; the server never emits or gates sound.)
- **No dependency on server/protocol/game state on the wire.** Sound is derived
  locally from the state the client already has. No WS message, no reducer, no
  timing dependency (a sound must never gate or delay a state transition — mirrors the
  WinnerCelebration rule from Stage 13.7).
- **Respectful by default** (see §2): a card game is often opened in public / shared
  spaces; unexpected noise is worse than silence.

---

## 2. Recommended default — **OFF**

**Decision: sound ships DEFAULT OFF for everyone** (existing users AND new users),
surfaced as an unobtrusive opt-in toggle in Profile → (Appearance or a new "Sound"
row). No first-run nag, no autoplay.

**Why default-off (not default-subtle):**
- **Public spaces.** Card games are played on a bus, in an office, in a majlis — a
  device suddenly ticking/chiming is embarrassing and annoying. Silence is the safe,
  respectful default.
- **Browser autoplay restrictions.** Audio can't play until a user gesture anyway, so
  a "default-subtle" would still be silent on load — meaning the only reliable way to
  make sound feel intentional is an explicit opt-in.
- **Reversible + low-friction.** The toggle lives in Profile; a curious player enables
  it in two taps. We can revisit "default-subtle for signed-in users who opted into
  other polish" later with real usage data — but MVP is off.
- **No regression risk.** Default-off guarantees existing users notice zero change.

When enabled, the first playable sound still waits for the next user gesture (the
same tap that toggled it counts as the gesture, so enabling → next click already
sounds).

---

## 3. Sound categories / event map

Priorities: **P0** = core tactile MVP (ship first in 15.4); **P1** = nice polish (later
in 15.4 / a follow-up); **P2** = optional, only if cheap and unobtrusive.

Character vocabulary: *soft card tap*, *felt slide*, *brass tick*, *warm chime*,
*low thud*, *soft error blip*. "Throttle" = a min-interval / debounce so rapid repeats
(e.g. dealing 13 cards) don't stack into noise.

### 3.1 UI

| event | sound id | prio | character | max dur | max vol | throttle |
|---|---|---|---|---|---|---|
| Button / primary action click | `ui-click` | P0 | soft card tap | 90 ms | 0.5 | 40 ms debounce |
| Select / segmented change | `ui-select` | P1 | brass tick | 90 ms | 0.4 | 40 ms |
| Sheet / drawer open | `ui-open` | P2 | felt slide (up) | 160 ms | 0.4 | — |
| Sheet / drawer close | `ui-close` | P2 | felt slide (down) | 160 ms | 0.4 | — |
| Error / rejected action / rate-limit | `ui-error` | P1 | soft error blip | 160 ms | 0.5 | 300 ms |

### 3.2 Cards (shared across games)

| event | sound id | prio | character | max dur | max vol | throttle |
|---|---|---|---|---|---|---|
| Deal a card (per card, staggered) | `card-deal` | P1 | soft card tap | 80 ms | 0.35 | **staggered** — one per dealt card, ≥ 40 ms apart; hard-cap ~6 in a burst |
| Play a card to the table | `card-play` | P0 | card tap + felt | 130 ms | 0.5 | 60 ms |
| Collect / sweep a trick | `card-collect` | P0 | felt slide / gather | 200 ms | 0.5 | 120 ms |
| Reveal trump | `card-trump` | P1 | warm chime (short) | 240 ms | 0.5 | — |

### 3.3 Game-specific (all reuse the shared card sounds; these are the ACCENTS)

Only fire on events the local client already renders; never on a hidden opponent action
beyond what the redacted state shows (e.g. Durak "trump-show transfer" already surfaces
a public `lastTrumpShow` banner — sound is fine; a hidden hand change is not).

- **King** — `king-mode-start` (P1, warm chime — a mode/round begins) · kitty exchange
  → reuse `card-play` (P2) · trick win → `card-collect` (P0) · game finish → `finish-win`
  / `finish-neutral` (§3.5).
- **Durak** — attack → `card-play` (P0) · defend/beat → `card-play` (P0) · take →
  `card-collect` low variant `durak-take` (P1, low thud — you picked up) · transfer →
  `card-play` (P1) · **trump-show transfer** → `card-trump` (P1, on the public
  `lastTrumpShow`).
- **Deberc** — bid → `ui-select` (P2) · meld declared (terz/platina/bella) →
  `deberc-meld` (P1, brass tick, ×1 per declaration, throttled) · **bella** →
  `card-trump` variant (P2) · **deberc jackpot** → `finish-win` (P0, the match-ending
  flourish).
- **Tarneeb** — bid → `ui-select` (P2) · pass → `ui-click` (P2) · trump chosen →
  `card-trump` (P1) · trick won → `card-collect` (P0) · **exact-bid ×2** →
  `tarneeb-double` (P1, warm chime accent, on the hand-complete "Exact bid ×2" badge).

### 3.4 Social

| event | sound id | prio | character | max dur | max vol | throttle |
|---|---|---|---|---|---|---|
| Incoming chat message | `chat-message` | P2 | brass tick (very soft) | 120 ms | 0.3 | 500 ms; **suppress for your own** sent message |
| Sticker sent / received | `chat-sticker` | P2 | soft pop | 160 ms | 0.35 | 500 ms |
| Reaction pop (emoji float) | `reaction-pop` | P2 | soft pop | 140 ms | 0.3 | 300 ms |

### 3.5 Finish (aligns with WinnerCelebration kinds, Stage 13.7)

| result kind | sound id | prio | character | max dur | max vol |
|---|---|---|---|---|---|
| `win` / `teamWin` | `finish-win` | P0 | warm chime (2–3 gentle notes) | 700 ms | 0.6 |
| `draw` / `fool` / `loss` | `finish-neutral` | P1 | single soft chime / low note | 500 ms | 0.4 |

Finish sounds are **one-shot** (never looped) and fire ONCE on entering the finished
screen — mirroring the celebration's "settle, don't loop" rule.

---

## 4. Accessibility / preferences

- **Separate from animation.** Sound preference is its OWN setting, independent of the
  animation-intensity preference ([`animation-preference-setting`] / motion store).
  Reduced-motion does **not** auto-mute sound, and muting sound does not change motion.
- **Proposed values:** `off` | `subtle` | `full`.
  - `off` (default) — engine is a permanent no-op.
  - `subtle` — P0 sounds only, at ~60% of the max volumes above.
  - `full` — P0 + P1 (+ P2 where enabled), at the listed max volumes.
  - A **volume slider is post-MVP** (values above are the ceiling for `full`).
- **User-gesture requirement.** The engine lazy-inits its `AudioContext` (or unlocks
  `<audio>`) only after the first user gesture; before that, `play()` is a no-op. This
  satisfies iOS/Android/desktop autoplay policies without a "tap to enable audio" nag.
- **Tab hidden → mute? YES.** When `document.visibilityState === 'hidden'`, suppress
  playback (a backgrounded tab making noise is jarring, and mobile browsers throttle it
  anyway). Resume silently when visible. No queue/backlog is played on return.
- **Fairness restated.** No sound conveys information not on screen (§1).
- **Haptics / vibration:** **post-MVP, mobile-only, explicit opt-in**, its OWN setting
  (never bundled with sound-on). Not designed here beyond: gated behind a gesture, off
  by default, `navigator.vibrate` with a graceful no-op where unsupported.

---

## 5. Asset strategy

- **Procedural / generated, royalty-free only.** No copyrighted or third-party samples.
  Prefer generating short SFX (e.g. an offline WebAudio render script, or a one-off
  generator committed as a build-time script like `scripts/gen-visual-assets.mjs`),
  then exporting fixed files. **No new runtime dependency** — decode/play uses the
  built-in Web Audio / `<audio>` APIs.
- **Format:** ship **`.webm` (Opus)** as the primary + **`.mp3`** as the fallback
  (`<audio>`/`AudioBuffer` picks what the browser supports — Opus/webm covers Chrome/
  Firefox/Android, mp3 covers Safari/iOS). Decide the exact pair in 15.1 after a quick
  support check; if one format covers everything at budget, ship one.
- **Loudness:** normalize all SFX to a consistent perceived loudness (target ≈ −16 to
  −20 LUFS-ish, peaks ≤ −3 dBFS); no harsh transients or clipping; short fade-out tails
  to avoid clicks.
- **Budget:** each SFX **< 30 KB** where possible; **total MVP sound budget < 500 KB**
  (all formats combined). The P0 set is ~6 sounds → comfortably under budget.
- **Naming convention** (flat, kebab-case, under `public/sounds/`):
  `public/sounds/ui-click.webm`, `public/sounds/card-play.webm`,
  `public/sounds/card-collect.webm`, `public/sounds/finish-win.webm`, … (+ `.mp3`
  siblings). A manifest (e.g. `src/audio/soundManifest.ts`, mirroring
  `src/visual/visualAssets.ts`) lists id → path(s) + maxBytes for a guard test.
- **Fallback:** if a file 404s or fails to decode, the engine **silently no-ops** for
  that id (never throws, never blocks gameplay) — exactly like the card-back/art image
  fallbacks.

---

## 6. Implementation plan (rollout)

Each stage is small, independently shippable, and keeps gameplay/server/DB unchanged.

- **15.1 — Assets + manifest. ✅ DONE.** Generated a royalty-free MVP SFX set —
  **12 ids** (broadened past the original P0 six to cover the whole event map):
  `ui-click, ui-open, ui-error, card-deal, card-play, trick-collect, trump-reveal,
  bid-tick, chat-pop, reaction-pop, finish-win, finish-neutral`. Each ships as
  **`.webm` (Opus) + `.mp3`** under `public/sounds/` — **24 files, ~55 KB total**
  (well under the 500 KB budget; largest single file ~9 KB, under the 30 KB per-file
  cap). Deterministic dep-free synth in `scripts/gen-sound-assets.mjs` (`npm run
  sounds`; procedural WebAudio-style render → ffmpeg webm/mp3, no npm dependency).
  Manifest at `src/audio/soundAssets.ts` (`SOUND_ASSETS`, `getSoundAsset`, `SoundId`);
  guard tests assert every declared file exists in both formats, is non-empty, under
  maxBytes, total under budget, plus a runtime-not-wired guard (no browser audio API
  used, no importer of the manifest yet). **No engine / no playback yet.**
  > Two ids differ from this section's earlier prose (§3): the shipped `trick-collect`
  > / `trump-reveal` are the same sounds as `card-collect` / `card-trump` in §3.2 —
  > the manifest ids are canonical for 15.2+.
- **15.2 — Preference setting + minimal engine (preview-only). ✅ DONE.** Added the
  `off | subtle | full` **sound preference** in Profile → Appearance (its own row; a
  segmented control, no native select) plus a **minimal client-side engine**, wired to a
  single explicit-gesture **"Preview sound"** button and NOTHING else. Details:
  - **Storage decision: LOCAL-ONLY** under `cardMajlis.sound.v1`, default **off**. We
    deliberately did **not** add profile/DB sync — sound is device-contextual (a quiet
    phone on a bus, a loud desktop) and keeping it local means **no `user_settings`
    column, no migration, and no WS/`messages.ts` field** to leak. Mirrors the connection
    setting's device-local rationale, not the visual prefs' server sync.
  - **Model** (`src/audio/soundPreference.ts`): `normalizeSoundPreference` → `off` fallback;
    `soundTierVolume` (off 0 / subtle 0.5 / full 1.0); `load/saveSoundPreference`.
  - **Store** (`src/audio/soundPreferenceStore.ts`): external store like the animation
    store (`useSyncExternalStore`, no provider); stamps `data-sound` on `<html>` for
    inspection only (no CSS keys off it). Read by the engine at play time.
  - **Engine** (`src/audio/soundEngine.ts`): `playSound(id)` — **lazy** (creates no
    `HTMLAudioElement` until the first play), hard no-op when `off` / tab hidden /
    unknown id / throttled (per-id `SOUND_THROTTLE_MS`), picks webm→mp3 by `canPlayType`,
    swallows `play()` rejections. Browser audio API lives **only** here. The env
    (preference/hidden/now/createAudio) is injectable so tests mock audio — **no test
    requires real playback**. This front-loads a trimmed version of what 15.3 expands
    (P0 preload, richer gesture-unlock).
  - **Wiring boundary:** the ONLY caller of `playSound` is the Profile preview button
    (silent + disabled when `off`). No card/game/chat/finish events are wired — that stays
    Stage 15.4. Guard tests in `soundAssets.test.ts` lock: audio API only in the engine,
    manifest imported only by the engine, `soundEngine` imported only by `ProfilePanel`,
    and `messages.ts` carries no sound field.
- **15.3 — Wire minimal P0 gameplay events. ✅ DONE.** With the engine already shipped
  (15.2), this stage wires a small, safe P0 event set as **client-side UI feedback** —
  no reducers/rules/server/protocol change, and nothing sounds for hidden info (every
  cue reacts to state THIS client already sees). Still default **off**.
  - **Hook** (`src/audio/useSoundEvents.ts`): `useSoundEvents({ tableCount?, trumpVisible? })`
    diffs against the previous render via a ref and plays on the VISIBLE transition —
    `tableCount` ↑ → **card-play**, `tableCount` ↓ → **trick-collect**, `trumpVisible`
    false→true → **trump-reveal**. Plus `useFinishSound(celebratory)` — plays once per
    finished-screen mount. Dedupe: no previous snapshot ⇒ nothing plays, so a fresh mount
    or a reconnect-into-progress never replays a historical burst; only single-step
    transitions fire and the engine throttles same-id repeats. Pure decision core
    (`soundEventsFor` / `finishSoundFor`) is unit-tested in the node env; the hooks are
    thin wrappers.
  - **Wired per game** (the shared `*GameScreen`, so local **and** online both get it):
    - **King** (`GameScreen`): `card-play`/`trick-collect` from `currentTrick.plays.length`;
      `trump-reveal` from `trumpSuit` null→set. Finish via WinnerCelebration.
    - **Durak** (`DurakGameScreen`): `card-play`/`trick-collect` from the table card count
      (`Σ attacks + defenses`). **Trump reveal SKIPPED** — Durak's trump is fixed at deal
      and always visible (no null→value transition). Finish via WinnerCelebration.
    - **Deberc** (`DebercGameScreen`): `card-play`/`trick-collect` from `currentTrick.plays.length`;
      `trump-reveal` from `trumpSuit` null→set (after bidding). Finish via WinnerCelebration.
    - **Tarneeb** (`TarneebGameScreen`): `card-play`/`trick-collect` from the VISIBLE trick
      (`(reviewTrick ?? currentTrick).plays.length` — the ~1.1s freeze then clear);
      `trump-reveal` from `trumpSuit` null→set. Finish via WinnerCelebration.
  - **Finish** (`src/ui/components/WinnerCelebration.tsx`): single integration point — all
    4 finished screens mount it with a `kind`, so `useFinishSound(isCelebratoryKind(kind))`
    plays `finish-win` for win/teamWin and `finish-neutral` for draw/fool/loss, once.
  - **Deliberately NOT wired** (would be noisy): `ui-click` on buttons, `card-deal` per
    dealt card, `bid-tick` per bid, `ui-error`, `chat-pop`, `reaction-pop`. Left for later.
  - **Guards** (`soundAssets.test.ts`): audio API only in the engine; manifest only in the
    engine; `playSound` only in the hook + Profile preview; the hook only in the 4 game
    screens + WinnerCelebration; **no core/server/games/net/hooks module imports the audio
    layer**; `messages.ts` still sound-free.
- **15.4 — Expand (P1/P2), carefully.** Add P1/P2 cues (deal, bid-tick, chat/reaction pops,
  error) incrementally, each verified for no hidden-info leak and no server change.
- **15.5 — QA.** Manual matrix: iOS Safari + Android Chrome + desktop; first-gesture
  unlock; tab-hidden mute/resume; off/subtle/full; rapid-deal throttle; no double-sound
  online; budget check. Update QA_CHECKLIST.

---

## 7. Acceptance criteria (this Stage 15.0)

- ✅ No runtime code changed in Stage 15.0.
- ✅ No audio assets added.
- ✅ No dependency additions.
- ✅ Clear event → sound map with ids, priorities, character, duration, volume,
  throttling (§3).
- ✅ Clear default decision: **default OFF**, opt-in in Profile (§2).
- ✅ Clear privacy/fairness statement: sound never carries hidden info; client-side
  only; no server/WS/state change (§1).
- ✅ Clear rollout stages 15.1–15.5 (§6).
- ✅ Clear preference model (off/subtle/full, separate from motion) + test plan (§4, §6).

[`animation-preference-setting`]: src/ui/components/motionPreferenceStore.ts
