# Preferans (Преферанс) — Rules (Card Majlis) v0.1 (MVP)

> **Status: RELEASED (Stage 19.7).** Preferans is a fully `available` game — local
> + server-authoritative online, with per-`game_type` stats/leaderboard, a favorite
> option, and a "Preferans Declarer" achievement (see [`PREFERANS_PLAN.md`](PREFERANS_PLAN.md)
> for the 19.1→19.7 rollout). This document remains the source of truth for the shipped
> **MVP variant**; if the code disagrees with this doc, the code is wrong (until this doc
> is revised).
>
> Preferans has *many* regional variants (Сочинка / Ленинградка / Ростов, and endless
> house rules). **The MVP deliberately fixes ONE clean, internally-consistent variant**
> and marks everything else **post-MVP**. Items needing an owner sign-off are tagged
> **[CONFIRM]** and collected in [`PREFERANS_PLAN.md`](PREFERANS_PLAN.md) → "Owner
> confirmations needed".

## 1. Scope / MVP / variants

**MVP (this spec):**
- **3 players only**, no partners — one **declarer** vs two **defenders** each hand.
- **32-card deck** (7…A), one **trump suit or No-Trump** per contract.
- Deal **10 each + a 2-card talon (прикуп)**.
- **Classic ascending contract auction** (level 6–10 × suit order + No-Trump).
- The auction winner takes the talon, discards 2, then declares a final contract.
- **Compulsory whist:** both defenders always play to defeat the contract (there is
  **no** whist/pass decision in MVP).
- **All-pass → redeal** (no распасы in MVP).
- **Misère excluded from MVP** (positive suit/NT contracts only).
- **Simplified single-score "contract points" scoring** (§10) with a target to end —
  NOT the classic pool/mountain/whist (пуля/гора/висты) ledger.

**Explicitly post-MVP** (documented, not built): misère & open misère; распасы
(all-pass play-for-fewest); whist/pass + half-whist + open/closed whist; the classic
**Sochi (Сочинка)** pool/mountain/whist scoring; 4-player Preferans (with a sitting-out
dealer); overtrick/undertrick fine-tuning; "гусарик"/"чиновничий" and other house rules.

## 2. Players / seating

- Exactly **3 seats**, `seatIndex` 0–2, ids `player-0..player-2` (same convention as
  the other games). No teams.
- Each hand has one **declarer** (auction winner) and two **defenders**.
- **Dealer rotation:** the dealer rotates one seat per hand (to the left / next seat).
  The player to the dealer's left bids first.

## 3. Deck / ranks / suits

- **32 cards:** ranks **7, 8, 9, 10, J, Q, K, A** in four suits ♠ ♣ ♦ ♥.
- **Rank order (high→low):** A, K, Q, J, 10, 9, 8, 7.
- **Suit order for the auction & trump strength (low→high):**
  **♠ spades < ♣ clubs < ♦ diamonds < ♥ hearts < NT (No-Trump)**.
  (This is the standard Preferans ordering: пики < трефы < бубны < черви < бескозырка.)

## 4. Deal

- Shuffle; deal **10 cards to each of the 3 players** (30 cards) and **2 cards
  face-down to the talon (прикуп)** (32 total).
- The **talon is face-down and hidden from everyone** until the declarer takes it (§6).
- Dealer rotates left each real (played) hand. A redeal (§5 all-pass) does **not**
  advance the hand counter but does pass the deal to the next dealer. **[CONFIRM]**

## 5. Bidding (auction)

- Starting with the player left of the dealer, each seat in turn either **bids** a
  contract strictly higher than the current high bid, or **passes** (a pass is final —
  that seat is out of this auction).
- **Contract ladder** — a bid is a `(level, suit)` pair. Levels run **6 → 10** (the
  number of tricks contracted). Within a level, suits ascend **♠ < ♣ < ♦ < ♥ < NT**.
  So the full ascending ladder is:
  `6♠ < 6♣ < 6♦ < 6♥ < 6NT < 7♠ < … < 7NT < 8♠ < … < 10♥ < 10NT`.
- The **auction winner** is the last seat to make a bid after the other two pass. That
  seat becomes the **declarer**; its winning bid is the **minimum contract**.
- **All-pass (no bids at all):** the hand is a **redeal** — cards are collected, the
  deal passes to the next dealer, and a fresh hand is dealt (**no распасы in MVP**).
  **[CONFIRM]**

## 6. Talon (прикуп)

Order of operations for the auction winner:

1. **TAKE_TALON** — the declarer takes the 2 talon cards into hand (now **12 cards**).
   The talon becomes part of the declarer's **private** hand (hidden from defenders).
2. **DISCARD** — the declarer discards **exactly 2 cards** face-down (back to **10**).
   The discards are **hidden from everyone** (including at hand end, MVP) and are set
   aside; they do **not** count as tricks. **[CONFIRM: reveal discards at hand end?]**
3. **DECLARE_CONTRACT** — the declarer names the **final** contract `(level, suit)`,
   which must be **≥ the winning bid** on the ladder (they may raise after seeing the
   talon, never lower it). This fixes the trump suit (or No-Trump) and the trick target.

**Privacy/redaction:** before it is taken the talon is hidden; after TAKE_TALON its
cards are indistinguishable from the rest of the declarer's private hand; discards are
hidden. Bids and the final contract are **public**.

## 7. Contracts

- A contract is `(level L, suit S)` where **L ∈ {6,7,8,9,10}** and **S ∈ {♠,♣,♦,♥,NT}**.
- **Suit contract:** `S` is trump. **No-Trump (NT):** no trump suit.
- **Required tricks:** the declarer must take **at least `L`** of the 10 tricks to make
  the contract.
- **Misère:** *post-MVP.* (A misère is a No-Trump contract to take **zero** tricks; it
  changes scoring and play/defence enough that it is excluded from the MVP for a clean,
  cleanly-statable rule set.) **[CONFIRM]**

## 8. Trick play

- **10 tricks** per hand (each player plays their 10 cards).
- The declarer's **left-hand defender leads the first trick** (standard Preferans).
  **[CONFIRM: some variants lead from the declarer's left; MVP uses left-of-declarer.]**
- Players must **follow the led suit** if able. If void, in a suit contract a player may
  play a trump or discard any card; in No-Trump they discard any card.
- A trick is won by the **highest trump** played, or if none, the **highest card of the
  led suit**. The **winner of a trick leads the next**.

## 9. Defenders

- **Compulsory whist (MVP):** both defenders **always play to defeat** the contract —
  there is **no** whist/pass/half-whist decision, and **no** open/closed whist. This is
  the deliberate MVP simplification. **[CONFIRM]**
- *Post-MVP:* a WHIST/PASS_WHIST phase (a defender chooses to whist or pass), open vs
  closed whist, and the associated whist scoring.

## 10. Scoring

**MVP = "contract points" single-score model** (chosen for a clean, integer,
internally-consistent match with a definite end — see [`PREFERANS_PLAN.md`](PREFERANS_PLAN.md)
"Owner confirmations needed" for why this is preferred over the classic ledger).

- Each player keeps one integer **score**, starting at 0. Scores may go **negative**.
- **Game value by level** — `G(L)` (MVP uses **level only**, suit does not change the
  value; suit still matters for the auction order + trump): **[CONFIRM: classic Sochi
  weights the value by suit/NT; MVP uses level-only for simplicity]**

  | Contract level L | 6 | 7 | 8 | 9 | 10 |
  |---|---|---|---|---|---|
  | Game value G(L) | 1 | 2 | 3 | 4 | 5 |

- Let `t` = the declarer's trick count this hand (0–10), `L` = the contracted level.
  - **Made (`t ≥ L`):** **declarer += G(L)**; defenders unchanged. (No overtrick bonus
    in MVP.)
  - **Set / failed (`t < L`):** **declarer −= G(L)**, and **each defender += G(L)**.
    (No per-undertrick multiplier in MVP — a single flat swing keeps it clean; undertrick
    scaling is a post-MVP refinement.) **[CONFIRM]**

**Worked examples** (contract by the declarer at seat 0; D1/D2 = defenders):

| Contract | Declarer tricks `t` | Result | Δ declarer | Δ each defender |
|---|---|---|---|---|
| 6♠ (G=1) | 6 | made | **+1** | 0 |
| 6♠ (G=1) | 5 | set | **−1** | **+1** |
| 8♦ (G=3) | 9 | made (overtrick, no bonus) | **+3** | 0 |
| 9♥ (G=4) | 7 | set | **−4** | **+4** |
| 10NT (G=5) | 10 | made | **+5** | 0 |

*Classic Sochi (Сочинка) pool/mountain/whist scoring is documented as the recommended
**post-MVP** faithful variant (пуля filled by made contracts, гора by failed ones,
висты between defenders).* **[CONFIRM which classic variant to add later]**

## 11. End game

- The match ends when any player's score reaches the **target** (`targetScore`, default
  **[CONFIRM] 10**), OR after a fixed number of deals — **the MVP uses a target score**
  (mirrors how Tarneeb ends). The player with the highest score wins; ties are possible
  and reported as a draw. **[CONFIRM: target value and/or fixed-deal alternative]**
- **Negative scores** are allowed mid-match (a repeatedly-set declarer can go below 0);
  the game only ends when someone reaches the positive target.

## 12. Action vocabulary (MVP)

- `START_GAME` — deal the first hand (names/types, options, optional first dealer/seed).
- `BID { level, suit }` — a legal bid strictly above the current high bid.
- `PASS_BID` — drop out of the auction (final).
- `TAKE_TALON` — declarer takes the 2 talon cards (12 in hand).
- `DISCARD { cards: [c1, c2] }` — declarer discards exactly 2 (back to 10).
- `DECLARE_CONTRACT { level, suit }` — final contract ≥ the winning bid.
- `PLAY_CARD { card }` — play one legal card into the current trick.
- `START_NEXT_HAND` — advance from `hand_complete` to the next hand (rotates dealer).

*Post-MVP actions:* `WHIST` / `PASS_WHIST` (defender choice), misère declaration.

## 13. Core state shape (proposal)

Mirrors `TarneebState` (contract auction + trump + trick play + score-only history),
adapted to 3 players + a talon. Illustrative TypeScript:

```ts
type PreferansPhase = 'bidding' | 'talon' | 'playing' | 'hand_complete' | 'game_finished';
//   'talon' covers TAKE_TALON → DISCARD → DECLARE_CONTRACT for the declarer.

interface PreferansState {
  gameType: 'preferans';
  phase: PreferansPhase;
  players: { id: string; name: string; seatIndex: number; type: PlayerType }[]; // exactly 3
  dealerSeat: number;
  currentSeat: number;               // whose turn to act

  handsBySeat: Card[][];             // each seat's private 10-card hand (redacted)
  talon: Card[];                     // 2 cards; hidden until taken, then [] (folded into declarer)
  discards: Card[];                  // declarer's 2 face-down discards (hidden)

  // auction
  bids: { seat: number; bid: { level: number; suit: Suit | 'NT' } | null }[]; // null = pass
  passed: boolean[];
  highBid: { seat: number; level: number; suit: Suit | 'NT' } | null;

  // contract
  declarerSeat: number | null;
  contract: { level: number; suit: Suit | 'NT' } | null; // final contract (trump = suit, or NT)

  // play
  currentTrick: { leadSeat: number; ledSuit: Suit | null; plays: { seat: number; card: Card }[]; winnerSeat: number | null } | null;
  completedTricks: /* … */[];
  tricksBySeat: number[];            // tricks won per seat this hand (sums to 10)

  scores: number[];                  // cumulative per-seat score (may be negative)
  handNumber: number;
  targetScore: number;
  lastHand: PreferansHandResult | null;
  handHistory: PreferansHandResult[]; // public, score-only (no cards) → feeds stats
  winnerSeat: number | null;         // once finished (or null on a draw)
}
```

`PreferansHandResult` (public, score-only, like `TarneebHandResult`): hand number,
declarer seat, contract `(level, suit)`, declarer tricks, made/set, per-seat score delta.

## 14. Redaction / privacy

- A viewer at `viewerSeat` sees **only their own hand**; every other seat's cards are
  replaced with hidden placeholders. A spectator (`null`) sees no hands.
- **Talon:** hidden from everyone **before** TAKE_TALON. **After** TAKE_TALON the talon
  cards are part of the declarer's private hand (still hidden from defenders) and `talon`
  is emptied in the shared state.
- **Discards:** hidden from everyone for the whole hand (MVP). **[CONFIRM reveal-at-end]**
- **Public** (in the redacted state): phase, seats/dealer/currentSeat, bids + final
  contract, trump/level, the current trick + completed tricks + `tricksBySeat`, scores,
  and `handHistory`. **Never** another player's hand, the un-taken talon, or the discards.

## 15. AI requirements (MVP)

- **Deterministic, legal-first bot** (like Tarneeb's): never produces an illegal action.
  - **Bidding:** pass unless a conservative minimal bid is clearly safe; the bot should
    mostly pass so bot-only hands resolve (a redeal on all-pass still terminates the
    match via the dealer rotation + target).
  - **Talon:** take, discard its two weakest off-suit cards, declare the minimum contract.
  - **Play:** follow suit with the lowest winning/losing card by a simple heuristic; when
    void, trump low (suit contract) or discard low; defenders play to win tricks.
- **Termination:** a bot-only match must always reach `game_finished` in bounded hands
  (guaranteed by the target score + monotonic dealer rotation + all-pass redeal).

## 16. Required tests (for the eventual core)

1. **Deck / deal** — 32 unique cards; 10 + 10 + 10 + a 2-card talon; deterministic with a
   seeded rng.
2. **Bidding ladder** — the `(level, suit)` ordering is correct; a bid must strictly
   exceed the high bid; passing is final; all-pass triggers a redeal; the last bidder wins.
3. **Talon / discard** — TAKE_TALON → 12 cards; DISCARD exactly 2 → 10; DECLARE ≥ winning
   bid; illegal discards/contracts rejected.
4. **Legal play / follow-suit** — must follow the led suit if able; trump/void rules;
   correct trick winner (highest trump, else highest of led suit); winner leads next.
5. **Scoring examples** — the §10 table reproduces exactly (made/set, declarer & defender
   deltas); target-score end condition; negative scores allowed.
6. **Redaction** — a viewer never sees another hand, the un-taken talon, or the discards;
   bids/contract/tricks/scores are public; a full round-trip (redact → serialize) leaks
   nothing private.
7. **Invariants** — 32 cards conserved across the hand (hands + talon + discards + played);
   trick counts sum to 10; scores integer.
8. **Bot-only termination** — a 3-bot match always reaches `game_finished` (bounded hands),
   with all invariants holding throughout (a soak like `durak-soak` / `deberc-soak`).
