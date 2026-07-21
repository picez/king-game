# Achievements Expansion — Design Plan (Stage 32.0)

> **STATUS: FIRST WAVE SHIPPED (Stage 32.1); RELEASED in v0.4.1 (Stage 32.2).** The §4 subset — **15 new
> derived badges** (catalog **14 → 29**) — is implemented in `src/stats/achievements.ts` with i18n ×4 and
> tests, and shipped as the **v0.4.1** patch release (Stage 32.2 QA/bump). This doc stays the source of
> truth for the design; if code and doc disagree, update this doc first. The remaining ✅ badges (§3,
> held) and ❌ badges (need a new stat field) stay for later waves.

The achievement system is a **pure, derived-from-stats** catalog (`src/stats/achievements.ts`): every
badge is a **null-safe boolean predicate over the read-only aggregate stats** the Profile already
fetches (`AllStats`). There is **no server push, no write path, and no card-level / private / social
data** — a locked/unlocked flag is just a function of public counters. This expansion keeps every one of
those invariants.

Related: [`MVP_STATUS.md`](MVP_STATUS.md), [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md), the stats client
`src/net/statsApi.ts`, and the current catalog + tests (`src/stats/achievements.ts`,
`src/stats/achievements.test.ts`).

---

## 1. Audit — the current system (Scope A)

### 1.1 Current catalog — **14 badges** (`ACHIEVEMENTS`, `src/stats/achievements.ts`)

| id | scope | rarity | condition (current) |
|---|---|---|---|
| `first-win` | global | common | `totalWins ≥ 1` |
| `veteran` | global | rare | `totalGames ≥ 25` |
| `centurion` | global | epic | `totalGames ≥ 100` |
| `all-rounder` | global | epic | a win in **every** of the 6 games |
| `king-winner` | king | common | `king.gamesWon ≥ 1` |
| `durak-survivor` | durak | common | `durak.gamesWon ≥ 1` |
| `tarneeb-declarer` | tarneeb | common | `tarneeb.handsAsDeclarer ≥ 1` |
| `tarneeb-contractor` | tarneeb | rare | `tarneeb.contractsMade ≥ 5` |
| `tarneeb-soloist` | tarneeb | common | `tarneebSolo.gamesWon ≥ 1` (separate solo dimension) |
| `preferans-declarer` | preferans | common | `preferans.handsAsDeclarer ≥ 1` |
| `deberc-meld-maker` | deberc | rare | `deberc.combinations.total ≥ 10` |
| `deberc-bella` | deberc | rare | `deberc.combinations.bella ≥ 1` |
| `deberc-jackpot` | deberc | epic | `deberc.jackpotCount ≥ 1` |
| `fifty-one-winner` | fifty-one | common | `fiftyOne.gamesWon ≥ 1` |

### 1.2 Categories today

- **Global / account aggregates** (4): `first-win`, `veteran`, `centurion`, `all-rounder`.
- **Per-game** (10): King ×1, Durak ×1, Tarneeb ×3 (incl. the separate **Solo** dimension), Preferans
  ×1, Deberc ×3, 51 ×1.
- **All-Rounder** — one win in every of the 6 canonical games (`wonEveryGame`); the Tarneeb **Solo**
  dimension is deliberately **excluded** from `totalWins` / `totalGames` / `wonEveryGame`, so Solo is
  never required for All-Rounder and never double-counts.

**Rarity tiers today:** `common | rare | epic` (no `uncommon`). Icons are emoji only.

**Gaps worth noting:** **Deberc, Tarneeb (pairs), Preferans and 51 have no basic "won a game" badge** —
their only per-game badges are skill/meld/declarer ones. Durak and King each have a single win badge.

### 1.3 Available stats per game (the raw material — `src/net/statsApi.ts`)

Every game exposes `gamesPlayed / gamesWon / gamesLost / winRate / lastGameAt`, plus:

| Game | Extra fields usable for badges |
|---|---|
| **King** | `roundsPlayed`, `totalScore`, `averageScore`, `bestScore`, `worstScore`, `trumpRoundsPlayed`, `negativeRoundsPlayed`, `surrenderedCount` (+`surrenderedSupported` flag), `modeBreakdown[modeId]{rounds,totalScore,averageScore}` |
| **Durak** | `foolCount` (=losses), `drawCount`, `foolRate` |
| **Deberc** | `jackpotCount`, `jackpotRate`, `combinations{terz, platina, bella, total, handsPlayed, handsWithMeld, meldRate}` |
| **Tarneeb** (pairs) | `handsPlayed`, `handsAsDeclarer`, `contractsMade`, `contractsFailed`, `contractSuccessRate`, `totalTeamScore`, `averageTeamScore`, `bestGameScore`, `worstGameScore` |
| **Tarneeb Solo** | same shape, **separate** `tarneebSolo` dimension (never in aggregates) |
| **Preferans** | `gamesDrawn`, `handsPlayed`, `handsAsDeclarer`, `contractsMade`, `contractsFailed`, `contractSuccessRate`, `totalScore`, `averageScore`, `bestGameScore`, `worstGameScore` |
| **51** | `roundsPlayed`, `timesEliminated`, `totalPenalty`, `averagePenalty`, `bestPenalty` |

### 1.4 What is possible **without a DB migration**

Anything expressible as a boolean over the fields in §1.3 — counts (play/win N), thresholds
(contract-success %, best penalty), aggregate combination counts (Deberc terz/bella), declarer counts,
etc. **This is a large, safe space** and covers the whole proposed pack below (§3, "available = yes").

### 1.5 What needs **new stats fields** (→ deferred, NOT in the first expansion)

| Desired idea | Why it can't be derived today | Future field needed |
|---|---|---|
| Deberc **Solo-win** / **Pairs-win** split | Deberc records a single `game_type='deberc'` aggregate — solo (3p) and pairs (4p) wins are merged | a solo/pairs split (new `game_type` or a sub-counter) |
| Tarneeb **Exact bid** badge | `contractsMade` counts made contracts, not *exact-hit* bids | an `exactBids` counter |
| Tarneeb **Target climber** (win at a high target) | the chosen finish target isn't stored in stats | a per-target win counter |
| King **win streak** / any streak | no streak/history is stored (only aggregates) | a `bestWinStreak` counter |
| Durak **flawless / never-fool run** | same — no streak tracking | streak counter |
| 51 **Quick opener** / **Joker trader** | opening speed and joker-replacement aren't counted | per-event counters |
| 51 **won-with-low-penalty** (win *and* penalty≤X in the same game) | `bestPenalty` isn't win-conditioned | a `bestWinningPenalty` field |
| **Tutorial Graduate** | tutorials store **no progress** (Stage 31.x is stateless by design) | a client tutorial-completion store (post-MVP, see `TUTORIALS_PLAN.md` §8) |
| Social / friends badges | friends data is presence/relationship, **not** aggregate stat counters, and must stay off badges | (intentionally never — keep badges stats-only) |

**Rule:** none of the above ships in the first expansion. Each is listed here so a later wave can add
the field *then* the badge, deliberately.

---

## 2. Design principles (Scope B)

1. **Derived from existing stats only** — a badge is a pure predicate over `AllStats`; **no** new DB
   column, route, or write path in the first expansion.
2. **No server-pushed achievements** — evaluation stays 100% client-side, like today.
3. **No private/card-level data** — only public aggregate counters; never hands, seeds, or event logs.
4. **No luck-only impossible events** unless already tracked (e.g. Deberc `jackpot` is fine — it's a
   counted aggregate; a "win with a specific card" is not).
5. **Anti-grind / anti-skew:** thresholds stay modest and meaningful (play 10 / win 5 / a real skill %
   over a **minimum sample** so 1/1 = 100% can't unlock a "reliable" badge). No badge feeds `totalWins`
   / `totalGames`, so adding badges **cannot skew** the aggregate badges or All-Rounder.
6. **Balanced mix:** each game gets a basic **win** badge + one **regular** (play-N) or **skill** badge;
   plus a couple of **global** milestones. Include: first-win/game-first-win, consistency (win-N),
   mode/skill-specific, and **social only if a stat exists** (today: none → none). **Tutorial completion
   only once tutorial progress exists** (not now).
7. **Rarity tiers:** introduce **`common | uncommon | rare | epic`** (adds `uncommon` to the current
   three). Roughly: common = "did the thing once / a few times", uncommon = "did it a fair bit / a
   modest skill gate", rare = "sustained skill or 25+ wins", epic = "mastery / 100+ games / all-games".
8. **Icons:** emoji only, one glyph, visually distinct from siblings (no image assets).
9. **All-Rounder stays canonical** — still one win in each of the 6 games; the Solo dimension stays out
   of every aggregate.

---

## 3. Proposed achievement pack (Scope C)

**~23 proposed**, grouped by game. "Now?" = derivable from today's stats. `pseudo` is against `AllStats`
using the existing null-safe helpers (`won(s.x)=s.x?.gamesWon ?? 0`, `played(s.x)=s.x?.gamesPlayed ?? 0`,
`totalWins`, `totalGames`). Every predicate must be **null-safe** (missing game → locked).

### 3.1 Global

| id | title | rarity | icon | pseudo | now? | future field |
|---|---|---|---|---|---|---|
| `six-game-regular` | Six-Game Regular | uncommon | 🎲 | `played(king)≥1 && played(durak)≥1 && played(deberc)≥1 && played(tarneeb)≥1 && played(preferans)≥1 && played(fiftyOne)≥1` | ✅ | — |
| `champions-circle` | Champion's Circle | rare | 🏆 | `totalWins(s) ≥ 25` | ✅ | — |
| `table-regular` | Table Regular | uncommon | 🪑 | `totalGames(s) ≥ 50` | ✅ | — |
| `tutorial-graduate` | Tutorial Graduate | uncommon | 🎓 | finished all 6 tutorials | ❌ | tutorial-completion store |

### 3.2 King

| id | title | rarity | icon | pseudo | now? | future |
|---|---|---|---|---|---|---|
| `king-regular` | King Regular | common | ♚ | `played(king) ≥ 10` | ✅ | — |
| `king-champion` | King Champion | rare | 🏰 | `won(king) ≥ 10` | ✅ | — |
| `king-trump-tactician` | Trump Tactician | uncommon | ⚔️ | `(s.king?.trumpRoundsPlayed ?? 0) ≥ 20` | ✅ | — |
| `king-streak` | King Streak | rare | 🔥 | win 5 King in a row | ❌ | `bestWinStreak` |

### 3.3 Durak

| id | title | rarity | icon | pseudo | now? | future |
|---|---|---|---|---|---|---|
| `durak-defender` | Defender | uncommon | 🛡️ | `won(durak) ≥ 5` | ✅ | — |
| `durak-regular` | Fool Me Not | common | 🃏 | `played(durak) ≥ 10` | ✅ | — |

### 3.4 Deberc

| id | title | rarity | icon | pseudo | now? | future |
|---|---|---|---|---|---|---|
| `deberc-winner` | Deberc Winner | common | 🎴 | `won(deberc) ≥ 1` | ✅ | — |
| `deberc-regular` | Deberc Regular | common | 🧩 | `played(deberc) ≥ 10` | ✅ | — |
| `deberc-terz-collector` | Terz Collector | uncommon | 📇 | `(s.deberc?.combinations.terz ?? 0) ≥ 10` | ✅ | — |
| `deberc-solo-win` / `deberc-pair-win` | Solo/Pairs Win | uncommon | 🎴 | win a 3p-solo / 4p-pairs match | ❌ | solo/pairs split |

### 3.5 Tarneeb

| id | title | rarity | icon | pseudo | now? | future |
|---|---|---|---|---|---|---|
| `tarneeb-winner` | Contract Keeper | common | ♠️ | `won(tarneeb) ≥ 1` | ✅ | — |
| `tarneeb-sharp-bidder` | Sharp Bidder | rare | 🎯 | `(m=s.tarneeb?.contractsMade ?? 0), (f=s.tarneeb?.contractsFailed ?? 0); m+f ≥ 10 && (s.tarneeb?.contractSuccessRate ?? 0) ≥ 70` | ✅ | — |
| `tarneeb-solo-regular` | Solo Regular | uncommon | 🥷 | `played(s.tarneebSolo ?? null) ≥ 10` | ✅ | — |
| `tarneeb-exact-bidder` | Exact Bidder | rare | 🎯 | hit the bid exactly N times | ❌ | `exactBids` |
| `tarneeb-target-climber` | Target Climber | rare | 🧗 | win at a high finish target | ❌ | per-target win counter |

### 3.6 Preferans

| id | title | rarity | icon | pseudo | now? | future |
|---|---|---|---|---|---|---|
| `preferans-winner` | Preferans Winner | common | 🏅 | `won(preferans) ≥ 1` | ✅ | — |
| `preferans-contract-regular` | Contract Regular | uncommon | 📜 | `(s.preferans?.contractsMade ?? 0) ≥ 10` | ✅ | — |
| `preferans-reliable` | Reliable Declarer | rare | 🧮 | `(m=s.preferans?.contractsMade ?? 0)+(f=s.preferans?.contractsFailed ?? 0) ≥ 10 && (s.preferans?.contractSuccessRate ?? 0) ≥ 70` | ✅ | — |

### 3.7 51 (Syrian 51)

| id | title | rarity | icon | pseudo | now? | future |
|---|---|---|---|---|---|---|
| `fifty-one-regular` | 51 Regular | common | 🧧 | `played(fiftyOne) ≥ 10` | ✅ | — |
| `fifty-one-champion` | 51 Champion | rare | 🏮 | `won(fiftyOne) ≥ 5` | ✅ | — |
| `fifty-one-low-penalty` | Low-Penalty Master | uncommon | 🧊 | `s.fiftyOne?.bestPenalty != null && s.fiftyOne.bestPenalty ≤ 50` | ✅ | — |
| `fifty-one-quick-opener` | Quick Opener | uncommon | ⚡ | open on the first eligible turn N times | ❌ | opening-speed counter |
| `fifty-one-joker-trader` | Joker Trader | rare | 🃟 | replace a table joker N times | ❌ | joker-replacement counter |

**Available now (✅): 20** — Global 3, King 3, Durak 2, Deberc 3, Tarneeb 3, Preferans 3, 51 3.
**Deferred (❌): ~9** — tutorial-graduate, king-streak, deberc-solo/pairs split, tarneeb-exact-bidder,
tarneeb-target-climber, fifty-one-quick-opener, fifty-one-joker-trader (+ any streak variants).

---

## 4. First-implementation subset — Stage 32.1 (Scope D) — ✅ SHIPPED

**Shipped 15 new badges** (all ✅ available, no migration, no tutorial progress, no event history). Chosen
so **every game gains its missing basic win badge** (Deberc/Tarneeb/Preferans/51 have none today) plus
one regular/skill badge, with two global milestones — balanced and non-grindy:

| # | id | scope | rarity | why |
|---|---|---|---|---|
| 1 | `six-game-regular` | global | uncommon | tried every game (distinct from All-Rounder's *win* each) |
| 2 | `champions-circle` | global | rare | 25 total wins milestone (between first-win and all-rounder) |
| 3 | `king-regular` | king | common | play-10 depth badge |
| 4 | `king-champion` | king | rare | win-10 skill badge |
| 5 | `durak-defender` | durak | uncommon | win-5 |
| 6 | `durak-regular` | durak | common | play-10 |
| 7 | `deberc-winner` | deberc | common | **fills the missing Deberc win badge** |
| 8 | `deberc-terz-collector` | deberc | uncommon | 10 terces (combination depth) |
| 9 | `tarneeb-winner` | tarneeb | common | **fills the missing Tarneeb-pairs win badge** |
| 10 | `tarneeb-sharp-bidder` | tarneeb | rare | ≥70% contract success over ≥10 decided (min-sample gated) |
| 11 | `preferans-winner` | preferans | common | **fills the missing Preferans win badge** |
| 12 | `preferans-contract-regular` | preferans | uncommon | make 10 contracts |
| 13 | `fifty-one-regular` | fifty-one | common | play-10 |
| 14 | `fifty-one-champion` | fifty-one | rare | win-5 |
| 15 | `fifty-one-low-penalty` | fifty-one | uncommon | bestPenalty ≤ 50 (a clean game) |

**Result:** catalog grows **14 → 29** (safe, all derived). The remaining ✅ badges from §3
(`table-regular`, `king-trump-tactician`, `deberc-regular`, `tarneeb-solo-regular`, `preferans-reliable`)
are held for a **later wave** to avoid over-adding at once — they need no new fields when their turn
comes. The ❌ badges wait for their stat field.

**Skew check:** none of the 15 touch `totalWins` / `totalGames` / `wonEveryGame`, so `first-win`,
`veteran`, `centurion` and `all-rounder` are **unchanged**; All-Rounder still needs one win per canonical
game. New badges are independent booleans → adding them can't alter existing unlocks.

---

## 5. Tests plan for Stage 32.1 (Scope E)

Extend `src/stats/achievements.test.ts` (+ i18n parity) with:

1. **Unique ids** across the whole catalog (existing check; keep).
2. **Count bound widened** — the current `8–14` bound becomes e.g. `14–32` (must cover 29). Update the
   `has N badges` test and any hard-coded count.
3. **Rarity includes `uncommon`** — the rarity-validity check adds `'uncommon'` to the allowed set (type
   `Rarity` gains `'uncommon'`).
4. **i18n complete** — every new `ach.<id>.title` / `ach.<id>.desc` key exists in **en / uk / de / ar**
   (the existing dictionary-parity test enforces this; add the keys or it fails).
5. **Derived only from `AllStats`** — a source guard: `achievements.ts` imports nothing from
   `net/`(fetchers)/`server`/`db`; each `evaluate` is a pure function of `AllStats`.
6. **Null-safe** — with `AllStats` where a game is `null`, no evaluator throws and its badges are locked
   (drive `evaluateAchievements` over a "all null" snapshot).
7. **Per-badge unlock/lock** — for each new badge, one snapshot that unlocks it and one that doesn't
   (e.g. `deberc-winner` locked at `won(deberc)=0`, unlocked at `1`; `tarneeb-sharp-bidder` **locked**
   at made=1/failed=0 despite 100% rate because sample < 10).
8. **All-Rounder + aggregates unchanged** — a snapshot with the new game-specific badges earned but a
   game unwon keeps `all-rounder` locked; `totalWins`/`totalGames` equal the old formula.
9. **No total-skew** — adding the new badges does not change `totalWins`/`totalGames` results.

---

## 6. Boundaries & future waves

**Stage 32.1 (build) will:** add the 15 §4 badges + their i18n (×4) + tests. **No** DB migration, **no**
new stats field, **no** server route, **no** tutorial-progress dependency, **no** social/private data,
**no** version bump beyond normal release cadence.

**Future waves (each needs its listed field first):** the held ✅ badges (a quick, migration-free wave),
then the ❌ badges as their counters land — Deberc solo/pairs split, Tarneeb exact-bid, streaks, 51
quick-opener/joker-trader, and **Tutorial Graduate** once tutorial completion is persisted (see
`TUTORIALS_PLAN.md` §8). Social badges remain intentionally **out** — badges stay stats-only.

---

## 7. Stage 37.0 — grouped UX + honesty audit of the owner's requested badges

**UX (shipped, corrected in Stage 37.2):** the Profile Achievements grid is filtered by a styled chip strip
— **All · Global · King · Durak · Deberc · Tarneeb · Preferans · 51**, each with an icon + its own
earned/total. The **All** chip is first and the default; it shows the **full catalog of all 34 badges**
(earned + locked) in catalog order. Global + each game show just their bucket. (Stage 37.0 had wrongly
dropped the All chip and opened on Global; 37.2 restored it after owner feedback — see the note below.) The
strip scrolls **inside itself** (styled scrollbar), so 360/390 + Arabic RTL never overflow the page.

**New badges IMPLEMENTED (derived from EXISTING stats — no new fields, no migration) → catalog 29 → 34:**

| id | game | condition (existing stat) |
|---|---|---|
| `king-all-negatives` | King | all six `modeBreakdown[negativeMode].totalScore < 0` (conceded in every negative round) |
| `deberc-platina-collector` | Deberc | `combinations.platina >= 3` |
| `deberc-multi-meld` | Deberc | `combinations.total > combinations.handsWithMeld` (a hand held 2+ melds, by pigeonhole) |
| `tarneeb-negative-game` | Tarneeb | `worstGameScore < 0` (finished a game with a negative team total) |
| `tarneeb-all-bids-down` | Tarneeb | `contractsMade === 0 && contractsFailed >= 3` |

**DEFERRED — the owner's other requests need per-round / per-hand telemetry the aggregate stats do not
carry today.** Each is listed with the **exact field(s)** a future summarizer would have to record (all
addable to the JSONB `stats` object without a DB migration, but they are new write-paths + tests, so a
separate slice):

- **King — perfect negative rounds** (finish a no-tricks / no-hearts / no-jacks / no-queens / king-heart /
  last-two round taking NONE of the penalised cards): needs `perfectNegativeRounds: Record<modeId, count>`
  (a per-round "scored 0 in a negative mode" counter). *Aggregate `totalScore` can't isolate a single
  perfect round.*
- **King — trump round, take all tricks**: needs `trumpSweeps` (per-round: tricks-taken === max).
- **King — trump round, fewer tricks than a rival (comedy)**: needs per-round tricks-taken vs the field
  (`trumpLowestCount`), a per-round comparison not kept.
- **Durak — lose to / win by a "погони" six attack (comedy ×2)**: needs the last bout's card ranks +
  attacker/loser mapping — `lastAttackAllSixes` + `loserWasYou`/`loserWasThem`. The final state has this;
  the summarizer does not record it.
- **Deberc — win without a "бейт"** (term to be confirmed in `DEBERC_RULES.md` before naming): needs a
  per-game flag (`wonWithoutBete`). **Not implemented — the term must be verified first, not invented.**
- **Deberc — finish a game with a negative score (comedy)**: needs `worstGameScore` (Deberc stats have no
  final-score aggregate yet — add `bestGameScore`/`worstGameScore` like Tarneeb).
- **Deberc — a whole game with NO combination (comedy)**: needs `gamesWithNoMeld` (per-game, not derivable
  from the cumulative meld totals).
- **Tarneeb — a game with zero failed contracts**: needs `cleanContractGames` (per-game count; the
  cumulative `contractsFailed` can't isolate one clean game). *NB: an overall "never failed a contract" is
  derivable but was intentionally NOT added — it changes the requested per-game semantics.*
- **Tarneeb — bid 13 and win (epic)**: needs the winning bid value (`maxWinningBid` / a bid histogram) —
  no bid detail is aggregated.
- **51 — finish a round on the first move**: needs per-round move count (`instantRoundWins`).
- **51 — never open (≥51) in a whole game (comedy)**: needs `gamesNeverOpened` (per-game opened flag).
- **51 — two jokers in one deal**: needs per-hand joker usage (`maxJokersInHand`). *Also note the MVP meld
  rule caps ONE joker per meld, so this must be counted per-hand, not per-meld.*
- **51 — never take a 100 (unopened) penalty in a game (comedy)**: needs `gamesWithNoHundred` (a per-round
  penalty-100 flag folded per game).

**Rarity:** reused the existing `common | uncommon | rare | epic` (no `legendary` tier added). All-Rounder,
`totalWins`, `totalGames`, and the totals are **unchanged**; every new evaluator is null-safe.
