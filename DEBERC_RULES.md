# Deberc Rules (Деберц) — v1.0

> **STATUS: Rules confirmed. Implementation in progress. One minor edge (§3
> all-pass bidding) is deferred to when the bidding module is built.**
> Source of truth for the **Deberc** game (the third game after King and Durak).
> Code (engine, UI, AI, server) must follow this file. When rules change, update
> this file first, then the code and tests.

Deberc (деберц / кларабор, a Klaberjass/Belote-family trick game) uses a
**36-card deck** — ranks **6, 7, 8, 9, 10, J, Q, K, A** in ♠♥♦♣ (9 ranks × 4).
A **match** accumulates the scores of successive hands (здачі) up to a target:

- **Small match (`small`)** — target **510**.
- **Big match (`big`)** — target **1020**.

Each hand is exactly **9 tricks** (every player plays 9 cards).

---

## 1. Players and teams  ✅

- **3 players** — every player for themselves. 3 × 9 = 27 cards used; the other
  9 stay undealt.
- **4 players** — two fixed **teams of 2** (partners opposite; 2×2). 4 × 9 = 36 —
  the whole deck is dealt. Partners pool trick points and melds.
- Turn order clockwise; the deal rotates clockwise each hand.

---

## 2. Card point values  ✅ CONFIRMED

| Card | Trump | Non-trump |
|------|-------|-----------|
| J (йось) | **20** | 2 |
| 9 (маніла) | **14** | 0 |
| A | 11 | 11 |
| 10 | 10 | 10 |
| K | 4 | 4 |
| Q | 3 | 3 |
| 8 | 0 | 0 |
| 7 | 0 | 0 |
| 6 | 0 | 0 |

- Total card points: **152**. **Last trick** (останній хабар) = **+10**.
  Max trick-point total per hand = **162** (before melds).
- **[CONFIRM]** Trick strength order — trump: J > 9 > A > 10 > K > Q > 8 > 7 > 6;
  non-trump: A > 10 > K > Q > J > 9 > 8 > 7 > 6 (standard Belote order).

---

## 3. Deal, trump bidding, and the "об'яз"  ✅ CONFIRMED

- **Deck:** 36 cards. **Deal 3 at a time**; **every** player gets **6 cards to
  hand + a 3-card прикуп (talon)** = **9 cards**, all taken into hand and played
  (nothing discarded). The hand is 9 tricks long. A **face-up trump card** plus
  the **remaining stock** are placed on the table.
- **Об'яз** (the obligated maker — judged for **ХВ** in §7): the player who **must
  play**.
  - **First hand:** each player picks a suit; a random card is drawn — whoever
    picked that suit becomes the initial об'яз.
  - **Later hands:** the initial об'яз = **winner of the previous hand**.
- **Trump bidding** — everyone has their 9 cards (the talon lets each player judge
  whether to take trump *before* the об'яз). Going **clockwise starting from the
  player after the об'яз, with the об'яз speaking LAST**:
  - **Round 1:** each player says whether to play the **table trump** (the face-up
    suit). The first to accept takes it.
  - **Round 2** (only if all passed round 1): each player may declare **any other
    suit** as trump.
  - **Whoever commits to a trump becomes the об'яз** (they "intercept" the role) —
    so the **ХВ risk transfers to the player who actually chose trump**, not
    necessarily the original об'яз.
  - **[TBD]** What happens if everyone passes both rounds (redeal? original об'яз
    forced onto the table trump?). To be resolved when the bidding module is built.

---

## 4. Melds (комбінації)  ⚠️ ONE CONFIRM LEFT

Sequences are runs of one suit in rank order (6-7-8-9-10-J-Q-K-A):

| Meld | Length | Points |
|------|--------|--------|
| **Терц** | 3 in a row | **20** |
| **Платіна / п'ятдесят** | **4–7** in a row | **50** |
| **Деберц** | **8–9** in a row | **INSTANT MATCH WIN** (jackpot) |

Ranking: **деберц > платіна > терц**. A **деберц** (8–9 same-suit run) ends the
whole **match** immediately — the holder wins outright, regardless of score. ✅

- **Терц** does **not** score if anyone holds a платіна or деберц, or if an
  opponent holds a **higher терц** (compared by top card; run-to-10 loses to
  run-to-Q). Two **equal non-trump** терці both score; an equal **trump** терц
  beats an equal non-trump one. ✅
- **[CONFIRM]** Does the same "highest holder only" rule extend across платіна /
  деберц too (i.e. only the single best sequence-holding side scores its runs)?
- **Бела (bella)** — trump **K + Q**. Scores **20** whenever you win at least one
  trick with a bella card (trump K or Q) **and** you declared it. Independent of
  the sequence hierarchy. ✅
- 4-player: melds are pooled per team.

---

## 5. Play  ✅ CONFIRMED

- Clockwise. Must **follow the led suit** if able.
- If you **cannot follow suit**, you **must play a trump** (ruff) — but you are
  **not** obliged to over-trump a trump already in the trick (you may play a lower
  trump, e.g. to save a card for the last trick). ✅
- If you can neither follow suit nor trump, play any card.
- Highest trump wins; else the highest card of the led suit. Winner leads next.

---

## 6. Hand scoring  ✅ (values depend on §4)

Each side's hand score = trick card-points (+10 last trick) + scoring melds (§4)
+ bella if applicable.

---

## 7. ХВ and бейт  ✅ CONFIRMED

Tallies kept in the score table (**per player** in 3p; **per team** in 4p):

- **ХВ** — recorded when the **об'яз** scores **fewer points than at least one
  other player/team** in a hand. Consequences:
  1. Penalty accounting (below).
  2. **All of the об'яз's points for that hand go to the top scorer.**
  3. The **об'яз role passes to that top scorer** next hand.
- **Бейт** — recorded for **any player/team that takes zero tricks** in a hand.

**Penalty accounting** (per tally holder):
- The **first** mark of either kind costs **nothing** (recorded only).
- Each completed **pair of the same kind** = **−100** (two ХВ = −100; two
  бейти = −100).
- A **mixed pair (1 ХВ + 1 бейт) cancels** — nothing deducted.

**[CONFIRM]** Can the об'яз collect **both** an ХВ and a бейт from one hand
(0 tricks ⇒ necessarily fewer points)? Assuming **yes, both marks land**.

---

## 8. Deferred edges (resolve during implementation)

1. **§3** — all-players-pass bidding outcome (redeal vs forced об'яз).
2. **§4** — whether "highest holder only" extends across платіна (and how equal
   платіни compare, by analogy to терц).
3. **§7** — 4p бейт when a *team* takes zero tricks (rare) vs a single partner.
