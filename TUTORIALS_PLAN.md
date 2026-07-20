# Tutorials — Design Plan (Stage 31.0)

> **STATUS: SHIPPED for all 6 games (Stages 31.1–31.2); RELEASED in v0.4.0 (Stage 31.3).** The framework
> + hub + player are implemented (`src/tutorials/`, `src/ui/tutorials/`, the `'tutorials'` StartMenu
> pane), and **every game has a full scripted tutorial** — 51 + Durak (31.1), King + Deberc + Tarneeb +
> Preferans (31.2) — shipped as the headline of the **v0.4.0** minor release (Stage 31.3 QA/bump). No
> “Coming next” placeholders remain. This document stays the source of truth for the design; if code and
> doc disagree, update this doc first.

Owner requirement (Stage 31.0):

- A dedicated **“Tutorial”** entry in the main menu.
- For **each game**, a real step-by-step tutorial that **explains and shows** the gameplay.
- **≤ 2 minutes per game.**
- The point is to **ease new players in** — approachable, skippable, no commitment.

Related current-state docs: [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md), [`MVP_STATUS.md`](MVP_STATUS.md),
[`QA_CHECKLIST.md`](QA_CHECKLIST.md), the quick-rules hub (`src/games/gameHelp.ts` +
`src/ui/components/GameHelpModal.tsx` + `help.<id>.<section>` i18n), and the six rules docs
(`KING_RULES.md`, `DURAK_RULES.md`, `DEBERC_RULES.md`, `TARNEEB_RULES.md`, `PREFERANS_RULES.md`,
`51_RULES.md`). This feature is **distinct from Help**: Help is a static reference sheet; a Tutorial is a
guided, animated walk-through.

---

## 1. Product design (Scope A)

### 1.1 Menu entry

Add a fourth action tile to the main menu (`StartMenu.tsx`, `pane === 'menu'`, inside `.action-tiles`),
alongside Local / Host & Join / Profile:

```
🎓  Tutorials            (menu.tutorialsTitle)
    Learn any game in 2 min   (menu.tutorialsSub)
```

- New `Pane` value **`'tutorials'`** in `StartMenu`’s `type Pane`. The tile does `setPane('tutorials')`.
- Placement: **second tile**, right after **Local** (a new player’s natural next step is “teach me”,
  before Host/Join). Keep Profile last.
- The tile reuses the existing `.tile` styling (icon + title + sub). No badge.

### 1.2 Tutorial hub (`pane === 'tutorials'`)

A simple sheet (reuse the `.sheet` / `.sheet__head` pattern already used by Profile/Host) listing the
**6 games**, in catalog order (`GAME_TYPES`):

| Element | Source |
|---|---|
| Game **icon** | `GameIcon` / `GAME_EMOJI[game]` (existing) |
| Game **name** | `t('gameType.<id>')` (existing) |
| **“What you’ll learn”** one-liner | new `tutorial.<id>.learn` i18n key |
| **Duration** chip (`≤ 2 min` / `~90s`) | `tutorials[<id>].durationLabelKey` |
| Tap target | opens the **Tutorial player** for that game |

- **Back** button → `setPane('menu')`.
- **Progress (optional, post-MVP):** a small “✓ done” tick per game, persisted in `localStorage`
  (client-only, like the favorite game). NOT in the MVP — the hub is stateless at first.
- The hub is reachable **without an account** and **offline** (no network, no stats).

### 1.3 Tutorial player

A full-screen, mobile-first player that walks one game’s script:

- **Step card / caption** — a short title + 1–2 line body, anchored so it **never covers the table**
  (bottom sheet on portrait; see §4).
- **Deterministic fake board** — a generic “tutorial board” renders the step’s **scene snapshot**
  (seats, trump, a trick or melds, and the learner’s hand) from a static spec — **not** a live game
  screen. See §2.
- **Highlight** — a ring/glow on the card(s) or area a step points at (a played card, a legal move, the
  trump badge, a meld).
- **Controls** — **Back / Next / Skip / Done**:
  - **Next** advances one step (disabled → nothing on the last step; becomes **Done**).
  - **Back** goes one step back (disabled on step 1).
  - **Skip** exits the whole tutorial immediately → back to the **hub** (not a live game).
  - **Done** on the last step → back to the **hub**, with an optional “Play <game>” shortcut that
    routes into the existing **Local** setup for that game.
- **No network, no account, no stats writes, no achievements** (MVP). Nothing is sent to the server;
  no private data is created or read.

### 1.4 Scripted demos, not live games

Every tutorial is a **scripted demo**:

- **Deterministic** scene snapshots + captions authored by hand — no random deal, no shuffle, no rng.
- **No server**, **no reducer side effects**, **no private data**.
- Optional light “tap here” interactions (tap the highlighted card to advance) are **cosmetic** — they
  never run a real reducer or mutate authoritative state.
- Reuse **presentational** components (`CardView`, felt/seat CSS, `GameIcon`) where practical; do **not**
  mount `DurakGameScreen` / `DebercGameScreen` / etc. or run their reducers.

---

## 2. Architecture options (Scope B)

| # | Approach | How | Pros | Cons |
|---|---|---|---|---|
| **1** | **Scripted snapshots** | Tutorial scripts (TS) define scenes = static board snapshots + captions + highlights; a generic `TutorialBoard` renders them with `CardView`. | Safest, fastest to build; stable at 360/390; zero rule side effects; trivially deterministic; no per-game screen coupling. | Board is a *simplified* rendering, not the exact game screen; scene specs authored by hand. |
| **2** | **Replay real reducer actions** | A fixed seed + a scripted action list is fed through each game’s **pure reducer**; the tutorial renders the resulting states via the real game screens. | Most realistic (exact table); reuses real screens. | Fragile — 6 different screens/reducers to drive; step captions must track reducer phases; higher risk of a rule/UI change breaking a tutorial; harder to keep to ≤2 min; RTL/animation edge cases per screen. |
| **3** | **Hybrid** | Snapshots for explanation + small reducer snippets to demonstrate move legality (e.g. “these cards are legal”). | Realistic legality without full screen coupling. | Two systems to maintain; more surface than needed for a 2-min intro. |

### Recommendation — **Option 1 (scripted snapshots) for the MVP.**

Rationale: the goal is a **≤ 2-minute, mobile-stable, side-effect-free** intro. Scripted snapshots give
full control of pacing and visuals, never touch reducers/network/stats, and are the least fragile as the
games evolve. A reducer-backed **“Practice mode”** (Option 2/3) is a **strong future** step once the
scripted tutorials exist — see §8.

**Purity note:** if a script ever wants to *show* legality, it may call a game’s **pure** helper
(e.g. `legalPlays`, `resolveMeld`) read-only to compute a highlight — that stays pure and deterministic
and is allowed. It must never dispatch an action or hold live game state.

---

## 3. Per-game script outlines (Scope C)

Each script is **6–8 steps**, ~12–18 s each → **≤ 2 min**. Every step lists its **scene**, the **UI
highlight target**, and the **takeaway** (what the learner should remember). Copy lives in i18n
(`tutorial.<id>.<stepId>.title` / `.body`), authored short (see §4). The scenes reuse the generic
`TutorialBoard` layouts: `trick` (opponents + a center trick + my hand), `meld` (melds/hand), `bidding`
(seats + bid chips), `hand-only` (just my hand + a banner).

### 3.1 King — target ~90 s, 6 steps

| # | Step | Scene | Highlight | Takeaway |
|---|---|---|---|---|
| 1 | Goal | hand-only + scoreboard banner | score row | Avoid penalties — **lowest** total wins. |
| 2 | A trick | `trick`, 4 cards played | winning card | Highest card of the **led suit** takes the trick. |
| 3 | Follow suit | `trick` mid-play + my hand | legal (led-suit) cards | You **must follow** the led suit if you can. |
| 4 | Contracts change | `hand-only` + icon row | contract chips | Each round has a different “avoid” goal (no hearts, no queens, no King of Hearts, …). |
| 5 | Trump round | `trick` with a trump winning | the trump card + badge | In the **Trump** round the highest trump wins and you score **positive**. |
| 6 | Winner | scoreboard | lowest row | After all rounds, the **lowest total wins**. Tap **Play King** to try it. |

*Visual moments:* the trick resolving (step 2), the trump beating a higher plain card (step 5).

### 3.2 Durak — target ~90 s, 6 steps

| # | Step | Scene | Highlight | Takeaway |
|---|---|---|---|---|
| 1 | Goal | hand-only | hand | Don’t be the **last** holding cards — that player is the *durak*. |
| 2 | Roles | `trick` (attacker vs me) | attacker + defender labels | One player **attacks**, the next **defends**. |
| 3 | Beat it | attack card + my hand | beating cards | Beat with a **higher card of the same suit** or **any trump**. |
| 4 | Trump wins | attack + a trump defence | trump badge | A **trump** beats any non-trump. |
| 5 | Take it | attack you can’t beat | “Take” pile | Can’t beat them all → **pick the cards up**. |
| 6 | Empty out | hand shrinking → empty | empty hand | Empty your hand to be safe; **last with cards loses**. Tap **Play Durak**. |

*Visual moments:* a defence beating an attack (step 3), taking the pile (step 5).

### 3.3 Deberc — target ~120 s, 7 steps

| # | Step | Scene | Highlight | Takeaway |
|---|---|---|---|---|
| 1 | Goal | hand-only + score banner | target | Win trick points + melds up to the match target (510 / 1020). |
| 2 | Choose trump | `bidding` (6-card hand) | table trump card | Bid on your 6 cards to set **trump**, then take your прикуп. |
| 3 | Combinations | `meld` | Terce / Палтіна | **Terce** (3-run, 20) and **Палтіна** (4+ run, 50) — a **longer** Палтіна beats a shorter one. |
| 4 | Trump exchange | `meld` + table trump | your 7/6 + table card | Swap your **low trump (7 or 6)** for the table card — only if it’s a real trump you were **dealt**. |
| 5 | Bela on play | `trick`, playing trump K/Q | the K/Q + “Declare Bela” | **Bela** (trump K+Q) is declared **as you play** the K or Q — scores **20 only if you win that trick**. |
| 6 | Trick play | `trick` | led suit / trump | Follow suit; if void you **must trump**; the highest trump wins. |
| 7 | Scoring | scoreboard | last-trick +10 | Card points + **10 for the last trick** + melds. Tap **Play Deberc**. |

*Visual moments:* the length-first Палтіна comparison (step 3), the Bela K/Q winning its trick (step 5).

### 3.4 Tarneeb — target ~100 s, 6 steps

| # | Step | Scene | Highlight | Takeaway |
|---|---|---|---|---|
| 1 | Goal | scoreboard banner | target 41 | First **team to 41** wins; partners sit opposite. |
| 2 | Bidding | `bidding` | bid chips 3–13 | Bid **3–13** tricks or pass; bids must **rise**, a pass is final. |
| 3 | Trump + lead | `bidding` → trump chosen | trump suit | The **top bidder** names trump and leads. |
| 4 | Trump obligation | `trick` | led suit / trump | Follow suit if you can; **any trump beats non-trumps**. |
| 5 | Exact vs miss | scoreboard | bid vs tricks | Make your bid → score the tricks; hit it **exactly → doubled**; miss → **defenders** score. |
| 6 | Pairs vs Solo | seats diagram | teams / solo | **Pairs** = 2×2 partners; **Solo** = every player for themself. Tap **Play Tarneeb**. |

*Visual moments:* a rising bid (step 2), an exact-bid double vs a miss (step 5).

### 3.5 Preferans — target ~90 s, 6 steps (kept light per owner)

| # | Step | Scene | Highlight | Takeaway |
|---|---|---|---|---|
| 1 | Goal | scoreboard banner | target 10 | First to the **target (10)** wins. |
| 2 | Roles | seats (3) | declarer vs 2 defenders | Each hand: **one declarer** vs **two defenders**. |
| 3 | Contract | `bidding` | level 6–10 × suit / NT | Bid a **contract** — a level (6–10) and a suit or **No-Trump**. |
| 4 | Talon | `hand-only` | talon + buried 2 | The bid winner takes the **talon** and buries **2** cards. |
| 5 | Play 10 tricks | `trick` | trick count | All play **10 tricks**; meet your contract level. |
| 6 | Score | scoreboard | contract value | Take at least your level to score it; miss → each defender scores. Tap **Play Preferans**. |

*Note:* keep Preferans intentionally brief — surface the loop, not every contract nuance (owner ask).

### 3.6 51 (Syrian 51) — target ~120 s, 7 steps

| # | Step | Scene | Highlight | Takeaway |
|---|---|---|---|---|
| 1 | Goal | hand-only | hand | Be **first to empty your hand**; lowest running penalty survives. |
| 2 | A turn | `meld` + discard pile | draw → discard | Each turn: **draw**, optionally **meld**, then **discard one**. |
| 3 | Melds | `meld` | a run + a set | **Runs** (A-2-3 … Q-K-A, never K-A-2) and **sets**; a joker fits **any** position. |
| 4 | Open with 51 | `meld` | ≥51 total | Your **first** melds must total **51+** to open — once per round. |
| 5 | Discard-to-open | discard top + hand | discard top ring | Before opening you may take the **discard top only if you open with it** that turn. |
| 6 | Joker swap | `meld` with a joker | the joker | Once opened, swap a table **joker** for the exact card it stands in for and take the joker. |
| 7 | Elimination | scoreboard | ☠ score | Reach the **elimination score** (host-set 210/310/410/510) → out; last player wins. Tap **Play 51**. |

*Visual moments:* a joker landing at the end of a run (step 3), the discard-to-open pickup (step 5).

---

## 4. UI / UX constraints (Scope D)

- **Mobile-first 360 / 390 portrait** is the primary target; everything must fit without horizontal
  scroll.
- **Arabic RTL**: all layout uses logical direction (the app already flips on the Arabic dictionary).
  Captions, controls, and the board mirror correctly; card **runs still read low→high** in the reading
  direction. No hard-coded left/right that breaks RTL.
- **Captions are short** — a **title (≤ ~40 chars)** + **body (≤ ~2 short lines)**. No huge paragraphs.
- **The step card never blocks the table**: on portrait it is a **bottom sheet / caption bar**; the
  board stays visible above it. No full-screen modal over the demo.
- **Cards & highlights never overlap** — reuse the meld/table sizing already tuned for 360/390; a
  highlight is a ring/glow around an existing card box, not an overlay that covers neighbours.
- **Next / Back / Skip / Done buttons ≥ 44 px** touch targets, in a fixed control row.
- **Exit any time** — Skip (and the top-left ✕) leaves immediately. If the tutorial was opened from the
  **game picker/hub**, **Back returns to the tutorial hub — never into a live game**.
- **Respects reduced motion** — animated “visual moments” degrade to a static highlighted snapshot when
  the OS/user prefers reduced motion.
- **No account / network gating** — the whole flow works signed-out and offline.

---

## 5. Data / i18n model (Scope E)

Proposed pure types (final shape refined in 31.1; no engine imports — mirrors `gameHelp.ts`):

```ts
// src/tutorials/types.ts
import type { GameType, Suit, Rank } from '../games/catalog'; // or models/types for Suit/Rank

/** One tutorial per game — the catalog key is the GameType. */
export type TutorialId = GameType;

/** A single face-up card face to render (no engine Card object needed). */
export interface TutorialCardFace {
  suit: Suit | null;   // null = joker / back
  rank: Rank | null;   // null = joker / back
  joker?: boolean;
  faceDown?: boolean;  // render a back (opponent hand / draw pile)
}

/** A seat around the felt in a scene (opponent or the learner). */
export interface TutorialSeat {
  pos: 'bottom' | 'left' | 'top' | 'right'; // logical; flips under RTL
  nameKey?: string;      // i18n key for a demo name ("You" / "Bot")
  handCount?: number;    // face-down count for opponents
  bidKey?: string;       // optional bid/label chip (bidding scenes)
  isMe?: boolean;
}

/** A card sitting in the centre (a trick play or a laid meld card). */
export interface TutorialCardSpot {
  id: string;            // stable slot id, e.g. 'center.0', 'meld.a.1'
  card: TutorialCardFace;
  bySeat?: TutorialSeat['pos'];  // who played it (for trick layout)
  lead?: boolean;        // the led card of a trick
  winner?: boolean;      // the winning card (for the resolve moment)
}

/** The deterministic snapshot a step renders. NO rng, NO reducer. */
export interface TutorialScene {
  layout: 'trick' | 'meld' | 'bidding' | 'hand-only' | 'scoreboard';
  trump?: Suit | null;           // shows the trump badge when set
  seats: TutorialSeat[];
  center?: TutorialCardSpot[];    // trick cards / meld cards
  myHand?: TutorialCardFace[];    // the learner's hand (real faces)
  bannerKey?: string;             // optional table banner (e.g. a score strip)
  scoreboard?: { rowKey: string; value: string; highlight?: boolean }[];
}

/** A thing a step points at, drawn as a ring/glow (never an overlay that covers cards). */
export interface TutorialHighlight {
  target:
    | { kind: 'card'; id: string }        // a center/meld slot id
    | { kind: 'hand'; index: number }     // a card in myHand
    | { kind: 'seat'; pos: TutorialSeat['pos'] }
    | { kind: 'trump' }
    | { kind: 'banner' }
    | { kind: 'scoreRow'; rowKey: string };
  pulse?: boolean;   // animate (respect prefers-reduced-motion)
}

export interface TutorialStep {
  id: string;              // stable within a game, e.g. 'goal', 'trick', 'open51'
  titleKey: string;        // tutorial.<id>.<stepId>.title
  bodyKey: string;         // tutorial.<id>.<stepId>.body
  scene: TutorialScene;
  highlight?: TutorialHighlight[];
  actionHintKey?: string;  // optional "tap the glowing card" hint (cosmetic)
  /** Optional cosmetic tap target that advances the step; never runs a reducer. */
  tapAdvance?: TutorialHighlight['target'];
}

export interface Tutorial {
  id: TutorialId;
  learnKey: string;           // tutorial.<id>.learn — the hub one-liner
  durationLabelKey: string;   // e.g. tutorial.duration.90s / .2min
  steps: TutorialStep[];      // 6–8
}

export type TutorialCatalog = Record<GameType, Tutorial>;
```

### 5.1 i18n keys

- Menu: `menu.tutorialsTitle`, `menu.tutorialsSub`.
- Hub: `tutorial.hubTitle`, `tutorial.<id>.learn`, `tutorial.duration.90s`, `tutorial.duration.2min`.
- Player controls: `tutorial.next`, `tutorial.back`, `tutorial.skip`, `tutorial.done`,
  `tutorial.playGame` (with the game name interpolated), `tutorial.stepOf` (“Step {n}/{total}”).
- Steps: `tutorial.<id>.<stepId>.title` + `tutorial.<id>.<stepId>.body` (+ optional
  `tutorial.<id>.<stepId>.hint`).
- **All keys in en / uk / de / ar** (i18n parity test will enforce this, like the help keys).

---

## 6. File / module plan (implementation-ready, for 31.1+)

Mirrors the pure-catalog + generic-presentational-component split that `gameHelp.ts` + `GameHelpModal`
already use.

| File | Kind | Responsibility |
|---|---|---|
| `src/tutorials/types.ts` | pure types | the model in §5 (no engine imports). |
| `src/tutorials/scripts/<game>.ts` (×6) | pure data | the 6–8 `TutorialStep`s per game (scenes + keys). |
| `src/tutorials/catalog.ts` | pure | `TUTORIALS: TutorialCatalog`, `getTutorial(id)`, `allTutorialKeys()` (for i18n parity), `tutorialDurationSec(id)` (sum for a guard). |
| `src/ui/tutorials/TutorialHub.tsx` | presentational | the 6-game list; opens the player. |
| `src/ui/tutorials/TutorialPlayer.tsx` | presentational | steps + controls (Next/Back/Skip/Done). |
| `src/ui/tutorials/TutorialBoard.tsx` | presentational | renders a `TutorialScene` via `CardView` + felt CSS. |
| `src/styles/tutorial.css` | style | hub + player + board + highlight ring (theme + RTL aware). |
| `src/ui/StartMenu.tsx` | edit | new `'tutorials'` pane + the menu tile. |
| i18n dictionaries ×4 | edit | all keys in §5.1. |

**Boundary:** `src/tutorials/**` and `src/ui/tutorials/**` import **no** `net/`, `server/`, `db/`, and
run **no** reducers (a pure legality helper read-only is the only exception, §2). This is guard-tested.

---

## 7. Testing / guard plan (for the build stages)

Source-guard + pure-data tests in the house style (see `handOrderWiring.test.ts`, `gameHelp.test.ts`):

1. **Catalog completeness** — every `GameType` has a tutorial with **6–8 steps**; each step has a
   `titleKey`, `bodyKey`, and a valid `scene.layout`.
2. **Duration budget** — a per-game estimate (steps × per-step seconds) is **≤ 120 s** (a guard so a
   script can’t silently balloon past the 2-minute promise).
3. **i18n parity** — `allTutorialKeys()` resolves in **en / uk / de / ar** (no missing/orphan keys).
4. **Purity / no-network** — `src/tutorials/**` + `src/ui/tutorials/**` import no `net|server|db`
   transport, dispatch no actions, write no stats/achievements, use no `localStorage` in the MVP
   (progress is post-MVP), and contain no `Math.random` / rng.
5. **Highlight integrity** — every `highlight.target` / `tapAdvance` references a slot that exists in
   that step’s scene (no dangling `card.id` / `hand.index`).
6. **UX invariants (source guard)** — the player renders Next/Back/Skip/Done; Skip/Done route to the
   **hub**, never a live game; controls use ≥44px classes.
7. **(When visuals land)** extend the `scripts/fifty-one-shots`-style harness or a small screenshot
   check at **360/390** for the hub + one player step per game — no overlap / no horizontal overflow,
   Arabic RTL included.

---

## 8. Boundaries, non-goals, and future

**In this MVP:**

- 6 scripted tutorials, a hub, a player, menu entry. Client-only, offline, signed-out friendly.

**Explicitly NOT in the MVP (future stages):**

- **Practice mode** (Option 2/3): a reducer-backed, playable sandbox with legality enforcement and
  “undo” — the natural sequel once scripted tutorials exist.
- **Progress / completion state** (per-game ✓, “resume tutorial”) — optional `localStorage`, post-MVP.
- **Tutorial achievements / stats** — none at MVP; only added later if explicitly requested
  (would reuse the derived-achievement pattern, no DB writes). See
  the wishlist note (`[[deberc-wishlist-achievements-tutorial]]`).
- **Voice / video / real-time coaching**, per-variant deep dives (e.g. every King contract, every
  Preferans contract) — out of scope; tutorials teach the **loop**, Help + rules docs carry detail.

**Hard boundaries (all stages of this feature):** no DB migration, no new dependency, no stats/schema
change, no gameplay/rule change, no server/protocol change. The existing six-game release state stays
intact.

---

## 9. Suggested rollout

| Stage | Deliverable |
|---|---|
| **31.0** | This plan (design only). ✅ |
| **31.1** | **✅ DONE.** Framework shipped: `src/tutorials/` + UI (`TutorialHub` / `TutorialPlayer` / `TutorialBoard`), `styles/tutorials.css`, the `'tutorials'` StartMenu pane + tile, i18n ×4, guard tests. **51 (7 steps)** + **Durak (6 steps)** scripted; the other four were **“Coming next”** placeholders. |
| **31.2** | **✅ DONE.** **King (6)**, **Deberc (7)**, **Tarneeb (6)**, **Preferans (6, light)** scripted → **all 6 enabled**, no placeholders. Added a minimal generic `TutorialScene.trick` (standard-trick centre row: lead badge + winner ring) reused by King/Tarneeb/Preferans. i18n ×4 (incl. `tutorial.seat.partner`, `tutorial.role.declarer`). Guards extended (all-6-enabled, 5–8 steps + ≤120 s, dup step ids, "Палтіна" spelling, Preferans-no-unsupported-variants). Visual smoke (`scripts/tutorial-shots.mjs`) confirms **0 horizontal overflow** at 360/390 for the hub + a step per game. |
| **31.3+** | (Optional/future) Practice mode, progress ticks; Arabic RTL screenshot automation (today RTL is source-guarded via `dir="ltr"` card rows + logical CSS + manual QA). |

> **Implementation note (31.1):** the scene model landed slightly leaner than §5 — a flat
> `TutorialScene` (`layout` + `seats` / `pairs` / `melds` / `discardTop` / `drawCount` / `chips` /
> `hand`) with flat-id `TutorialHighlight { targetId }`, which was enough for 51 + Durak and keeps the
> renderer simple. The §5 tagged-union highlight can return if a later game needs it.

Each build stage keeps to the boundaries in §8 and runs the guards in §7 + `npm run verify`.
