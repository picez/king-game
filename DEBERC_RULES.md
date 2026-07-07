# Deberc Rules (Деберц) — v1.1

> **STATUS: Rules confirmed. v1.1 (owner correction 2026-07-07): the 3-card
> прикуп is taken only AFTER trump is chosen (bidding happens on 6-card hands),
> and sequence melds (терц/платіна/деберц) must be DECLARED at the start of the
> hand — see §3 and §4.**
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

## 3. Deal, trump bidding, and the "об'яз"  ✅ CONFIRMED (v1.1)

- **Deck:** 36 cards. Each player is dealt **6 cards to hand** (open) **plus a
  separate face-down 3-card прикуп (talon)** packet. **Bidding happens on the
  6-card hands** — the прикуп is NOT looked at or added to the hand until a trump
  has been chosen. A **face-up trump card** is shown on the table for round 1.
- **The face-up trump card and the прикуп:**
  - **4 players** (whole deck, 4×9 = 36): the face-up trump card belongs to the
    **dealer's (роздаючий) прикуп** — the dealer picks it up with their 3-card
    прикуп when trumps are taken. There is **no stock**.
  - **3 players** (3×9 = 27 dealt, **9 undealt**): the dealer has **his own
    separate 3-card прикуп**; the face-up trump card is the **top of the undealt
    stock** and is **NOT taken by anyone** — it only shows the table-trump suit.
- **Taking the прикуп:** once a trump is committed, **every player picks up their
  own 3-card прикуп** → each hand becomes **9 cards**. Only then are melds
  declared (§4) and the 9 tricks played (nothing is discarded).
- **Об'яз** (the obligated maker — judged for **ХВ** in §7): the player who **must
  play**.
  - **First hand:** the initial об'яз is a random seat.
  - **Later hands:** the initial об'яз = **winner of the previous hand**.
- **Trump bidding** — on the **6-card hands**. Going **clockwise starting from the
  player after the об'яз, with the об'яз speaking LAST**:
  - **Round 1:** each player says whether to play the **table trump** (the face-up
    suit). The first to accept takes it.
  - **Round 2** (only if all passed round 1): each player may declare **any other
    suit** as trump.
  - **Whoever commits to a trump becomes the об'яз** (they "intercept" the role) —
    so the **ХВ risk transfers to the player who actually chose trump**.
  - **All pass both rounds (§8.1):** the **table trump is forced onto the об'яз**
    (no redeal). *(resolved in code)*

---

## 4. Melds (комбінації)  ✅ CONFIRMED (v1.1 — must be declared)

**Declaration (v1.1):** sequence melds (**терц / платіна / деберц**) must be
**announced by the holder** — they do **NOT** score automatically.
- **Терц / платіна / деберц** are declared **at the start of the hand, after the
  прикуп is taken and BEFORE the first card is played** (a short window — the UI
  gives ~15 s). A sequence that is **not declared scores nothing**, and only
  **declared** melds take part in the hierarchy below (an undeclared higher терц
  does **not** cancel a declared lower one). A declared **деберц** ends the match
  immediately (jackpot).
- **Бела (bella)** — trump **K + Q** — is declared **during play**: it scores
  **20** when the holder **wins a trick with a bella card** (trump K or Q). It is
  independent of the sequence hierarchy and of the start-of-hand declaration.
- **4-player:** declarations (and their points) are pooled per team.

Sequences are runs of one suit in rank order (6-7-8-9-10-J-Q-K-A):

| Meld | Length | Points |
|------|--------|--------|
| **Терц** | 3 in a row | **20** |
| **Платіна / п'ятдесят** | **4–7** in a row | **50** |
| **Деберц** | **8–9** in a row | **INSTANT MATCH WIN** (jackpot) |

Ranking: **деберц > платіна > терц**. A **деберц** (8–9 same-suit run) ends the
whole **match** immediately — the holder wins outright, regardless of score. ✅

- Hierarchy is judged **among declared melds only.** A declared **терц** does
  **not** score if another side **declared** a платіна/деберц, or **declared** a
  **higher терц** (compared by top card; run-to-10 loses to run-to-Q). Two
  **equal non-trump** declared терці both score; an equal **trump** терц beats an
  equal non-trump one. The same "highest declared holder only" rule extends across
  платіна (equal платіни compare by top card, trump breaking ties, like терці).
- 4-player: declared melds are pooled per team.

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

## 8. Deferred edges

1. **§3 — RESOLVED:** all pass both rounds → the table trump is forced onto the
   об'яз (no redeal).
2. **§4 — RESOLVED:** "highest **declared** holder only" extends across платіна;
   equal платіни compare by top card with trump breaking ties (like терці).
3. **§7** — 4p бейт when a *team* takes zero tricks (rare) vs a single partner.
4. **§4 (v1.1)** — a seat may declare **multiple** sequences (e.g. two терці in
   different suits); each declared meld is judged independently in the hierarchy.
   Declaration is validated against the seat's actual 9-card hand (you cannot
   declare a meld you do not hold).
