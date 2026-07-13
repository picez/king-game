# Tarneeb Rules (Syrian / Levantine) — v1.3 (MVP spec)

> **v1.3 (Stage 27.0, owner rules):** two corrections — (1) the **minimum bid is now 3**
> (auction range **3–13**; scoring is unchanged, just a wider legal range; bots stay conservative
> and only open at 7+). (2) **Trump obligation on a void (§7):** if you are **void in the led
> suit** but **hold a trump**, you **must play a trump**; you may discard another suit only when
> void in **both** the led suit and trump. Enforced in the pure reducer (`legalPlays`), so online
> play validates it identically.
>
> **v1.2 (Stage 13.4):** exact-bid **double** added (§8) — making a contract with
> **exactly** the bid doubles the hand score (bid 8, 8 → +16; bid 13, 13 → +26);
> overtricks score the tricks won. The Kaboot **bonus** stays **off** in MVP (§9).
>
> **v1.1 (owner decisions 2026-07-08):** Kaboot **off** in MVP — the flat all-13
> bonus is added later as an option (§9). Declarer **leads the
> first trick** (§7). Tie at target → higher score wins, equal → play one more
> hand (§10). **No-Trump** not in MVP (§6). Card assets: reuse King's full 52-card
> deck (§3 / plan §1). All previously-open `[CONFIRM]` items are now resolved.

> **STATUS: Implemented and released** (Stage 13.4). This file is the source of
> truth for the **fourth game** (after King, Durak, Deberc). The pure reducer, UI,
> AI, online redaction, and tests follow this file. When rules change, update this
> file **first**, then the code.
>
> **Variant scope:** Tarneeb has many regional variants. This document fixes
> **"Syrian / Levantine Tarneeb"** as the MVP baseline. Wherever a rule differs
> between regions, the MVP decision is marked **`[MVP]`** and the alternatives are
> recorded as **`[VARIANT]`** (documented, not implemented). Anything needing the
> project owner's decision before coding is marked **`[CONFIRM]`**.
>
> Sources reconciled: Pagat — <https://www.pagat.com/auctionwhist/tarneeb.html> ·
> Wikipedia — <https://en.wikipedia.org/wiki/Tarneeb>

Tarneeb (طرنيب, "the trump") is a **plain-trick, partnership, bid-and-trump**
game in the Auction Whist family. Four players in two fixed partnerships play a
standard **52-card deck**; one side bids a number of tricks (3–13), names a trump
suit, then both sides try to win tricks. A **match** accumulates the scores of
successive **hands** up to a target (default **41**).

---

## 1. Scope

- These are the rules for the **MVP "Syrian Tarneeb"** variant only.
- Every rule with regional variation is explicitly tagged:
  - **`[MVP]`** — the decision the code will implement now.
  - **`[VARIANT]`** — a documented alternative, **not** implemented in MVP.
  - **`[CONFIRM]`** — needs an owner decision before implementation.
- King, Durak, and Deberc are **out of scope** and must not be touched by any
  future Tarneeb work.

---

## 2. Players / Teams / Seating

- **4 players**, exactly. No 2/3/5-player mode. (Solo/individual variants: see
  [§17 Solo / individual variant status](#17-solo--individual-variant-status).)
- **2 fixed partnerships** of 2; partners sit **opposite** each other.
  - **Team A:** seats **0 and 2**.
  - **Team B:** seats **1 and 3**.
- Play and seating order is **counter-clockwise by seat index**: seat 0 → seat 3 →
  seat 2 → seat 1 → seat 0 … (Equivalently, "the player to your right acts after you.")
- **UI (Stage 27.4):** the screen **mirrors** this so play *reads clockwise* for the
  viewer — the local seat is at the **bottom**, the seat that acts next after you is on
  your **left**, your partner is at the **top**, so the turn sweeps bottom → left → top →
  right. This is a display mirror only: the play order, dealing and partnerships above are
  unchanged. Rotate/highlight so the acting seat is always marked. See `CLOCKWISE_AUDIT.md`.

---

## 3. Deck

- **52 cards**, standard. No jokers.
- Suits: **spades ♠, hearts ♥, diamonds ♦, clubs ♣**.
- Rank order, **high → low**: **A K Q J 10 9 8 7 6 5 4 3 2**.
- Tarneeb has **no kitty, no widow, no discard, no draw/stock**. Every card is
  dealt into a hand; all 52 are in play each deal (13 × 4).

---

## 4. Deal

- **First dealer:** chosen at random.
- The deal **passes to the right** (counter-clockwise) after every hand — the
  next dealer is the previous dealer's right-hand neighbour.
- The player to the **dealer's right** receives the first card and **acts first**
  (both in bidding and, if they become declarer's lead, in play — see §7).
- Deal **all** cards: **13 per player**.
- **`[MVP]`** Deal **one card at a time**, counter-clockwise, starting at the
  dealer's right.
- **`[VARIANT]`** Deal in packets (e.g. 13-card blocks, or 4-4-5). Not MVP — the
  final hands are identical, so this is cosmetic only.

---

## 5. Bidding / Auction

- The auction opens with the player to the **dealer's right** and proceeds
  **counter-clockwise**.
- On their turn a player either:
  - **Bids** an integer **3–13** that is **strictly higher** than the current
    highest bid, **or**
  - **Passes**.
- **`[MVP]`** **Once a player passes, they are out** of the auction and cannot
  re-enter.
- The auction **ends** when three players have passed; the remaining bidder wins.
  - (Because bids must strictly increase and passing is final, the auction always
    terminates.)
- The **final (highest) bidder becomes the declarer.**
- **All four players pass** on the first go-round:
  - **`[MVP]`** **Redeal** by the **same dealer** (deal does not rotate on a dead
    hand).
  - **`[VARIANT]`** The dealer is forced to bid **7** ("dealer stuck"). Some
    circles play this; **not MVP**.
- After the auction, the declarer **chooses the trump suit** (§6).
  - The **declarer's team** is the **bidding team**; the other team is the
    **defending team**.
  - The declarer's **partner does not** choose trump and does not bid on the
    declarer's behalf.

---

## 6. Trump / Tarneeb

- The **trump suit ("tarneeb")** is chosen **only after** winning the auction, by
  the declarer alone.
- Any trump card **beats any non-trump** card, regardless of rank.
- Among trumps, **higher rank wins**; among non-trumps, only the led suit can win
  (see §7).
- **`[MVP]`** **No-Trump is excluded.** The declarer must name one of the four
  suits.
- **`[VARIANT]` / future option:** allow a **No-Trump** contract (often scored /
  bid differently). Reserved; not MVP.

---

## 7. Trick Play

- **`[MVP]`** The **declarer leads** the **first** trick. (Note: this can differ
  from the "dealer's right acts first" rule of the auction — once trump is set,
  the lead is the **declarer's**.) *(Owner-confirmed 2026-07-08: declarer leads
  first, for a clear rule aligned with the plan.)* **`[VARIANT]`** some tables
  have the player to the dealer's right lead the first trick even when they are
  not the declarer; **not MVP**.
- Thereafter, the **winner of the previous trick leads** the next one.
- Play proceeds **counter-clockwise**.
- **Follow suit:** a player **must** play a card of the led suit if they hold one.
- **Trump obligation (v1.3):** if a player **cannot follow** the led suit but **holds a trump**,
  they **must play a trump**. They may play any **other** suit as a discard **only** when void in
  **both** the led suit and trump. (Following the led suit still takes precedence when possible; a
  player never has to trump their own partner when they can follow.)
- **Trick winner:**
  - if **any trump** was played, the **highest trump** wins;
  - otherwise, the **highest card of the led suit** wins.
- The winning side **collects** the trick (only the count matters for scoring).
- Exactly **13 tricks** are played per hand; the 13 tricks always sum to 13
  across the two teams.
- **UI (Stage 27.3):** a "🃏 Team tricks" review lets a player look back at every trick **their
  side** has taken this hand (the cards are already public once played); opponents show as a count
  only. Presentational — it changes no rules, scoring, or stats.

---

## 8. Round End / Scoring

After all 13 tricks, count `declarerTeamTricks` and `defenderTeamTricks`
(they sum to 13). Let `bid` be the winning bid (3–13).

**Contract made** — `declarerTeamTricks >= bid`:

- **Exact bid** (`declarerTeamTricks === bid`): the hand score is **doubled** →
  `declarerTeamScore += 2 × bid` (Stage 13.4 exact-bid double).
- **Overtricks** (`declarerTeamTricks > bid`): score the tricks actually won (no
  double) → `declarerTeamScore += declarerTeamTricks`.
- `defenderTeamScore += 0`.

**Contract failed** — `declarerTeamTricks < bid`:

- `declarerTeamScore -= bid`
- `defenderTeamScore += defenderTeamTricks`

> **Note:** on a made contract, hitting the bid **exactly** **doubles** the score
> (`2 × bid`); making it with **overtricks** scores the **tricks actually won**
> (no double). The defending team scores **nothing** on a made contract. On a
> failed contract the bidding team is **set** by the full bid (negative), and the
> defending team banks the tricks they took. The exact-bid double applies **even
> to an all-13 contract** (bid 13, 13 tricks → **+26**); the separate Kaboot
> *bonus* stays **off** in MVP (`kabootMode: 'off'`, §9).

**Examples (exact-bid double on; kaboot bonus off):**

| Bid | Declarer tricks | Declarer Δ | Defender Δ |
|-----|-----------------|-----------|-----------|
| 8   | 8 (exact)       | **+16**   | 0         |
| 8   | 9 (overtrick)   | **+9**    | 0         |
| 9   | 10              | **+10**   | 0         |
| 9   | 9 (exact)       | **+18**   | 0         |
| 9   | 8               | **−9**    | **+5**    |
| 8   | 6               | **−8**    | **+7**    |
| 13  | 13 (exact)      | **+26** (exact ×2; kaboot bonus off, §9) | 0 |

---

## 9. Kaboot / 13 Tricks

> **`[MVP]` decision (owner-confirmed 2026-07-08; updated Stage 13.4): the Kaboot
> BONUS is OFF in MVP, but the exact-bid double (§8) IS on.**
> Winning all 13 tricks earns **no separate flat Kaboot bonus** and **no** instant
> win. It is scored by §8 like any other contract: an all-13 bid made **exactly**
> (bid 13, 13 tricks) is the exact-bid **double** → **+26**; an all-13 made as an
> overtrick of a lower bid scores the tricks won (e.g. bid 7, 13 tricks → **+13**).
> The Kaboot bonus/instant-win table below will be **added later as an option**
> (`kabootMode`, §12), which defaults to `'off'`.

**`[VARIANT]` — kaboot scoring, for the future `kabootMode` option (NOT MVP):**

- *Recommended table:* bid < 13 & all 13 → **+16**; bid = 13 & all 13 → **+26**;
  bid = 13 & failed → declarer **−16**, defenders `2 × defenderTeamTricks`.
- *Simpler table:* winning all 13 **instantly wins the game**; or all 13 just
  **counts as 13** (identical to `'off'`).

**MVP behaviour is `kabootMode: 'off'` = pure §8 (incl. the exact-bid double)** —
there is no separate Kaboot bonus, but an all-13 contract made **exactly** still
doubles to **+26** via §8. Only the extra flat Kaboot bonus / instant-win is off.

---

## 10. Game End

- **`[MVP]`** Default **target score: 41**. The first team to **reach or exceed
  41** wins the match.
- **Negative** running scores are allowed (a set team can go below zero).
- **`[VARIANT]`** target **31** or **61** — documented alternatives.
- `targetScore` is a **setup option** (default 41), configurable later; see §12.
- **`[MVP]`** **Tie / simultaneous crossing** (both teams ≥ target after the same
  hand — e.g. a set pushes both across): the team with the **higher score wins**.
  If the scores are **exactly equal**, the game is **not** finished — **play one
  more hand** and re-check. *(Owner-confirmed 2026-07-08.)*

---

## 11. Legal Action Vocabulary

Reducer actions for the future pure core (names, not signatures):

- `START_HAND` — deal 13 to each, set dealer/first bidder, enter `bidding`.
- `BID` — a legal integer 3–13, strictly above the current high bid.
- `PASS_BID` — permanently drop out of the current auction.
- `CHOOSE_TRUMP` — declarer names the trump suit; enter `playing`.
- `PLAY_CARD` — play one legal card into the current trick.
- `COMPLETE_TRICK` — resolve the 4-card trick, assign the winner, set next leader.
- `COMPLETE_HAND` — after 13 tricks, apply §8/§9 scoring; enter `hand_complete`.
- `START_NEXT_HAND` — rotate dealer to the right, begin the next hand (or, on a
  dead auction, redeal with the same dealer per §5).

Suggested **state phases**:

- `setup` — pre-deal configuration (player count is fixed at 4; options chosen).
- `dealing` — cards being distributed (may be instantaneous in the core).
- `bidding` — auction in progress.
- `choosing_trump` — declarer picking tarneeb.
- `playing` — tricks in progress.
- `hand_complete` — scores applied, waiting to start the next hand.
- `game_finished` — a team reached the target.

---

## 12. Core State Shape Proposal

Descriptive only — **do not implement here.** Names are suggestions for the pure
core (`gameType: 'tarneeb'`):

- `gameType: 'tarneeb'`
- `players[4]` — id/name/seat/isBot.
- `teams` — `{ A: [seat0, seat2], B: [seat1, seat3] }` (fixed).
- `dealerSeat` — rotates counter-clockwise (to the right) each hand.
- `currentSeat` — whose turn it is to act (bid or play).
- `phase` — one of §11's phases.
- `handsBySeat` — the 13-card hands (private per player; redacted online, §13).
- `bids` — the auction history / current bid per seat (with pass markers).
- `highestBid` — current best `{ seat, amount }` (null until first bid).
- `declarerSeat` — winner of the auction (null until decided).
- `declarerTeam` — `'A' | 'B'`.
- `trumpSuit` — chosen suit (null until `choosing_trump` resolves).
- `currentTrick` — cards played so far this trick, with lead suit + leader seat.
- `completedTricks` — resolved tricks (or just per-team counts + last trick).
- `tricksByTeam` — `{ A: number, B: number }` for the current hand.
- `scoresByTeam` — `{ A: number, B: number }` cumulative match score.
- `targetScore` — match target (default 41).
- `handNumber` — 1-based hand counter.
- `options`:
  - `targetScore: 41` (`[VARIANT]` 31 / 61)
  - `kabootMode: 'off' | 'recommended' | 'instant-win'` — **MVP hard-defaults to
    `'off'`** (all-13 = plain +13, §9); other modes are future options.
  - `allowNoTrump: false` — reserved future option, **not in MVP** (§6).

---

## 13. Redaction / Online Privacy

- A player sees **only their own hand**.
- Other players' hands are **hidden**, exposed only as **card counts**.
- **Public** information (visible to all seats and spectators): all **bids** and
  passes, the chosen **trump suit**, the **current trick** on the table,
  **completed-trick counts** per team, and both teams' **scores**.
- There is **no hidden kitty / widow / discard**, so redaction is simple: hide
  `handsBySeat` for everyone but the viewer; replace with counts.
- **Server validation** (authoritative; never trust the client):
  - only `currentSeat` may act (seat derived server-side, not from the payload);
  - a `BID` is 3–13 and strictly above `highestBid`; a passed seat cannot bid;
  - `CHOOSE_TRUMP` is accepted **only** from the declarer, only in
    `choosing_trump`;
  - a played card is actually **in that player's hand**;
  - the **follow-suit** rule is enforced (reject a discard when the led suit is
    held).

---

## 14. AI Requirements

MVP AI aims for **correctness first, strength second** (a legal, non-crashing,
plausible opponent). Heuristics:

- **Bidding:**
  - estimate hand strength from **high cards** (A/K/Q/J) and **long suits**
    (trump potential);
  - **bid ≥ 7** only with enough strength; **pass** otherwise;
  - never bid above what the hand can plausibly take (avoid guaranteed sets).
- **Trump choice (declarer):**
  - pick the **strongest suit** by a mix of **length** and **high-card count**.
- **Play:**
  - **follow suit** with the **lowest useful** card when not trying to win;
  - **try to win** the trick when the team needs tricks (bidding team chasing the
    contract, or defenders taking makeable tricks);
  - **preserve trumps** when possible (don't over-trump needlessly);
  - when **void**, **trump** if strategically useful, otherwise **discard** a low
    card from a weak suit.
- A **bot-only** game must reach `game_finished` deterministically (soak test).

---

## 15. Tests Required Before Implementation Is Accepted

A future implementation is **not accepted** until these pass:

1. Deck has **52 unique** cards.
2. Deal gives **13** cards to each of the 4 players; union is the full deck.
3. Bidding **starts to the right** of the dealer.
4. A bid must be **3–13** and **strictly higher** than the current bid.
5. A player who **passed cannot re-enter** the auction.
6. **All four pass → redeal** by the **same** dealer (deal does not rotate).
7. The **declarer chooses trump**; no other seat can.
8. The **declarer leads** the first trick.
9. **Follow suit** is required when able; a non-following card is rejected.
10. A **trump beats** any led-suit card.
11. With no trump played, the **highest led-suit** card wins.
12. The **trick winner leads** the next trick.
13. **13 tricks** end the hand.
14. **Success scoring:** made contract → declarer scores; **exact bid doubles**
    (`+2×bid`), overtricks score the tricks won (`+tricks`); defenders `+0`.
15. **Failed contract scoring:** declarer `−bid`, defenders `+theirTricks`.
16. **Negative** scores are allowed and tracked.
17. Reaching **target 41** ends the game with the correct winner.
18. **Redaction** hides opponents' hands (counts only) while keeping bids/trump/
    trick/scores public.
19. An **illegal out-of-turn** action is rejected.
20. A **bot-only** game **terminates** (reaches `game_finished`).
21. **Exact-bid double:** made **exactly** on the bid → `+2×bid` (bid 8, 8 → +16;
    bid 13, 13 → +26); overtricks score the tricks won (bid 8, 9 → +9). Kaboot
    **bonus** stays off (no extra flat all-13 bonus / instant win) — §8/§9.
22. **Tie at target:** both teams ≥ target → higher score wins; equal → the game
    continues one more hand (§10).
23. *(future, when kaboot enabled)* **Kaboot** scoring matches §9 under each
    non-`'off'` `kabootMode`.

---

## 16. Implementation Plan

See **[`TARNEEB_PLAN.md`](TARNEEB_PLAN.md)** for the staged plan (10.1 pure core →
10.8 release with stats). **All stages are DONE — Tarneeb is released
(`available`)**: local + server-authoritative online, per-`game_type` stats, and
the same redaction/reconnect guarantees as the other three games.

---

## 17. Solo / individual variant status

**Status (Stage 27.5): the released Tarneeb is team-only and stays that way.** These MVP rules
describe the **4-player, fixed 2×2 partnership** game — that is the only implemented mode, and the
engine, scoring, stats and lobby all assume it. Nothing below changes any rule above.

A "solo / every-player-for-self" Tarneeb was **designed and evaluated** (docs-only), not built —
see **[`SOLO_VARIANTS_PLAN.md`](SOLO_VARIANTS_PLAN.md)**. Three shapes were considered: (A) a
3-player solo game (needs an invented deck/deal since 52 doesn't divide by 3 — not recommended),
(B) a 4-player cutthroat 1-vs-3 game (clean 52/13 deck — preferred *if* a solo mode is ever
added), and (C) keeping Tarneeb team-only for now and adding solo later as a **separate variant**
behind a `variant` flag (default `'team'`). **Decision: C.** A solo mode changes contract scoring
(team → individual), the per-team stats schema, the partner-assuming bot AI and the lobby team-UI,
so it must be its own tested stage that leaves the released 2×2 game — and its existing online
stats/leaderboard — untouched. Meanwhile, players who want an every-player-for-self card game can
use **Deberc's 3-player mode**, which is exactly that today.

**Update (Stage 28.0): foundation laid, still not built.** The chosen shape (Variant B, 4-player
cutthroat) now has an **implementation-ready spec** — see
**[`TARNEEB_SOLO_PLAN.md`](TARNEEB_SOLO_PLAN.md)** — which fixes the one open decision (the
individual scoring model: declarer ±bid, set defenders earn defensive credit by their own tricks).
A `soloGuard.test.ts` pins the released 4-player 2×2 pairs behaviour so the future build can add a
`variant` flag **without** altering the shipped team game. The Deberc 3p/4p modes were, in the same
stage, given explicit **Solo · 3 / Pairs · 4** labels in setup and lobby. **Released Tarneeb is
unchanged and remains team-only; solo is not yet playable.**

**Update (Stage 28.1): solo PURE CORE now exists, still not playable in the UI.** The solo reducer,
per-seat scoring, bots and redaction ship behind a `variant: 'pairs' | 'solo'` flag on
`TarneebState`/`START_GAME` that **defaults to `'pairs'`** (a legacy state with no `variant` reads
as pairs). Solo scoring is per-seat: **declarer makes it → +bid, defenders +0; declarer fails →
−bid, each defender +its own tricks; first to 41, ties are not a finish**. It is exercised only by
`src/games/tarneeb/solo.test.ts` — **not in the game picker, not online-enabled, records no stats,
and the lobby/team UI is unchanged.** Everything in §1–§16 above describes the released **pairs**
game and is byte-for-byte unaffected. A local-only setup + playable prototype is **Stage 28.2**.
