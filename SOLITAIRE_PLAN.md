# Solitaire section — plan (owner request 2026-11-27)

Owner picks: **Klondike, Spider, FreeCell, Pyramid, TriPeaks, Yukon, Forty Thieves** + **Hearts**
(Hearts is a 4-player trick game, not a solitaire: it ships in the same section as "you vs 3 bots",
last, on the trick-taking core). Scope: **everything in the first release** — play, stats,
achievements, rules + tutorials, server-verified leaderboards, deal of the day. Menu: its own
**🃏 Solitaire** tile.

## Architecture

Solitaires are NOT entries of `GAME_TYPES` (no rooms, no WebSocket, no bots, no online seats); they
have their own catalog `src/solitaire/catalog.ts`. Everything rule-related is pure and shared by the
client and the server.

```
src/solitaire/
  cards.ts         SCard {id, suit, rank 1..13, up}; n-deck build; seeded shuffle (core/rng mulberry32)
  pileKit.ts       generic pile game: piles by id, pick/drop rules, auto-flip, stock — used by
                   Klondike, Spider, FreeCell, Yukon, Forty Thieves
  klondike.ts …    one file per variant: deal(seed, opts) / moves / apply / won / hint / autoPlay
  pyramid.ts, triPeaks.ts   positional layouts (covered-by geometry), own move shapes
  registry.ts      variant key → engine (klondike-1, klondike-3, spider-1/2/4, freecell, …)
  replay.ts        verify(variant, seed, moves) → {won, moves} — the server's anti-cheat
  daily.ts         deal-of-the-day seed = hash(variant + UTC date)
  stats.ts         local per-variant stats (played, won, streak, best time, best moves)
src/ui/solitaire/  hub (game list, daily, records, leaderboards) + one lazy game screen
server/            migration 0016_solitaire.sql, /api/solitaire/* (start token, result, boards)
```

**Moves are JSON** (`{t:'move', from:'t3', n:2, to:'f0'}` …), so a finished game is `seed + moves`.
The server replays it with the same engine before a result counts. Time is measured server-side:
`POST /api/solitaire/start` returns a signed token with the seed + start time; the result's duration
is `max(claimed, finish − start)` bounded below by a per-move floor.

**Phone UX:** tap a card → it goes to the best legal destination (foundation first); if it has
several, tap selects and the next tap on a pile drops it. Undo, hint, auto-finish, new deal,
restart. Cards scale to fit 7–10 columns at 360 px.

## Stages

**Status (2026-11-27): all five stages shipped** — S1 `9305780`, S2+S3 `21e8082`, S4 `7e50911`, S5 (Hearts) next commit.
Hearts is built as one more variant of the same Engine contract: the bots play deterministically
inside `apply`, so `seed + your moves` replays the whole game and ranks like a solitaire.

| Stage | Content |
|---|---|
| S1 | pure core + all 7 engines + replay + daily seeds, exhaustive unit tests |
| S2 | 🃏 tile, hub, game screen (all 7 boards), local stats, win screen, i18n ×4, layout gate |
| S3 | server: migration, start/result with replay verification, leaderboards (time / moves / wins / daily), stats sync |
| S4 | achievements group, rules in the help hub, tutorials, admin (results, delete a cheated result) |
| S5 | Hearts vs 3 bots (trick core, AI, stats, achievement, tutorial) |

Each stage: targeted tests + `npm run verify`, commit + push to `main`.
