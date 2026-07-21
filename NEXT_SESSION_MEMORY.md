# Card Majlis next-session memory

Use this file as the first read after archiving this chat. It is intentionally short.

## Product state
- Repo: `C:\ClaudeCode\builder-agent\projects\king-game`, branch `main`, direct push workflow.
- Current release: `v0.4.8` (Stage 37.1), commit `3b67876`.
- Product: Card Majlis, **7 released games**: King, Durak, Deberc, Tarneeb, Preferans, Syrian 51, **Poker (No-Limit Texas Hold'em, Stage 37.4, Unreleased)**. Poker is 2–6 players (the shared room cap `MAX_PLAYERS` rose 5→6); local+online+bots+redaction+stats+leaderboard+favorite+4 achievements+tutorial+PNG emblem; achievements catalog 48→52; All-Rounder now needs all 7 games; no DB migration; `POKER_RULES.md`/`POKER_PLAN.md`.
- Latest DB migration: `0009`; do not add migrations casually.
- Dependencies are intentionally stable; do not run `npm install` unless explicitly approved. `package-lock.json` must keep `"libc"` count `0`.

## Current feature baseline
- Achievements: **48 total** (34 released + 14 Unreleased Stage 37.3), grouped by Global + each game; **no `All` tab**; default group is Global; styled horizontal chip scroll. The Stage 37.3 pack is backed by real per-round/per-hand/per-game telemetry added to the JSONB stats (no DB migration); 51 telemetry lives on `FiftyOneState.telemetry`.
- Recent reconnect work: 5-minute orphan room TTL, same-user cross-device room discovery/reclaim via `FIND_MY_ROOMS -> MY_ROOMS -> RECLAIM_ROOM`.
- Syrian 51: released local+online+stats+achievement; configurable elimination score 210/310/410/510; Count cards calculator; discard-to-open; joker replacement; meld cards use uniform slots.
- Tutorials: scripted tutorials for all 6 games, not live practice.
- Android: TWA config/build path exists; debug APK was built and launched in emulator as Custom Tab. Fullscreen TWA still needs custom domain + Play App-Signing SHA-256 + real `assetlinks.json`.
- iOS: PWA-only for now; no native wrapper yet.

## Important rules / gotchas
- Always read the relevant `*_RULES.md` before changing game rules.
- King/Deberc/Tarneeb/51 rules have many owner corrections; do not infer from generic card-game rules.
- Deberc display term is `Paltina` / `Палтіна`; internal stats field may still be `platina`.
- Tarneeb scoring: exact bid doubles; overbid scores actual tricks; fail is negative bid. Target score is configurable.
- 51 deck: 2 players = 1 deck + 2 jokers; 3-4 players = 2 decks + 2 jokers. Opening 51 is once, then free meld/layoff. Joker in hand penalty = 25.
- Online state must remain server-authoritative and redacted; never leak hands, reconnect tokens, user ids, or private auth data in room lists.
- **Turn timer is authoritative (Stage 37.5):** the room owns `turnDeadlineAt` + `turnTimerRevision` (persisted); minted ONLY on a real gameplay transition (`beginTurnDeadline`), never on connection events. Every `STATE_UPDATE` carries `RoomTimerInfo {deadlineAt, revision, serverNow}`; the client derives remaining from the deadline vs `Date.now()` (skew-safe, no local per-second decrement). Server arms ONE absolute-deadline `setTimeout` with a revision guard (no stale double-move); `resolveHumanFireAt` handles the room-timer-vs-substitute precedence (substitute is server-only, starts on disconnect, cancels on reconnect, never extends the room timer). Reload/reconnect never resets/extends. `applyTimeoutAction` audited across all 7 games (no botAction null-gap; Durak defence got a `TAKE_CARDS` fallback).

## Open / likely next work
- Owner may bring real bug reports from daily play; fix those before speculative polish.
- Manual smoke still most valuable: same-user phone reconnect, 5-minute bot reconnect, achievements mobile/RTL, 51 calculator/meld layout.
- The owner-requested achievement pack is now **fully implemented (Stage 37.3, catalog 34→48)** with real
  telemetry — King perfect-negatives/trump-sweep/trump-fewest, Durak win/lose-by-sixes, Deberc
  no-Бейт-win/negative-final/no-meld, Tarneeb clean-contract/bid-13-win, 51 first-move/never-opened/
  two-jokers/no-100. Durak "sixes" = final bout all-sixes taken by the fool (owner-confirmed, no rule
  existed). Deberc «Бейт» = об'яз under-score = internal `hvTeam` (labels swapped, DEBERC_RULES §7).
  Details in `ACHIEVEMENTS_PLAN.md §8`. No badges are deferred now.

## Workflow reminders
- User often asks for “prompt”; when they do, provide only a Claude prompt and do not edit files.
- If user asks to implement, act directly: read code, patch, test, commit, push.
- Use `rg` first. Use `apply_patch` for edits.
- Run `npm run verify` for runtime changes; `git diff --check`; confirm `libc=0`.
- Commit and push to `origin/main` unless user says otherwise.
- Do not bump version/tag unless doing an explicit release stage.
