# Deberc Rules (Деберц) — v1.6

> **v1.6 (Stage 30.16, owner corrections):** three rule fixes.
> 1. **Trump exchange is restricted (§3a).** The low trump (7 for 3p, 6 for 4p) may be swapped for the
>    face-up table card **only** when (a) the exposed table card is itself of the **trump suit** (i.e.
>    the trump was TAKEN from the table in round 1, not declared as a free suit in round 2), and (b)
>    the low trump was in the player's **originally dealt 6-card hand** — **never** a low trump that
>    arrived in the 3-card прикуп (talon). A low trump from the прикуп can NOT be exchanged.
> 2. **Палтіна ranks by LENGTH first (§4, §8.2).** A **longer** run beats a shorter one regardless of
>    top card — a **5-card палтіна beats any 4-card палтіна**. Only when the lengths are **equal** is
>    the higher top card (then trump) used. (This reverses the old "compare by top card" for палтіни.)
> 3. **Бела is declared at PLAY time, not at the start (§4).** Бела is no longer announced in the
>    declaring phase. Instead the holder of trump **K+Q** declares it **as they play a trump K or Q**,
>    and it scores **20 only if that same trick is won** by the declarer (their team in 4p). Playing a
>    trump K/Q with no declaration, or declaring but losing the trick, scores **0**.
>
> **v1.5b (Stage 27.2, owner):** **trump exchange (§3a)** — before the first card, the holder of the
> lowest trump (7 for 3p, 6 for 4p) may swap it for the face-up table trump. Hand counts preserved;
> once per hand; optional; public swap (no hidden-hand leak). Scoring unchanged.
>
> **v1.5 (Stage 27.0, owner):** the 50-point run is spelled **"Палтіна" (Paltina)** in the UI,
> not "Платіна" — a display-only slang correction across en/uk/de/ar. The internal meld id stays
> `platina` (no data migration). Rules/scoring unchanged.
>
> **STATUS: Rules confirmed. v1.4 (owner corrections 2026-07-08): (a) a player's
> OWN melds never cancel each other — two терці, or платіна+терц, both score; the
> §4 contest is only between opposing sides. (b) ХВ/бейт LABELS swapped (об'яз
> under-scores → «Бейт»; zero tricks → «ХВ»). (c) ХВ/бейт penalty is now first-free
> then −100 for EACH subsequent mark of that kind (no pairs / mixed cancel). See §4, §7.**
>
> v1.3 (owner correction 2026-07-07): meld declaration
> is TRUTHFUL, not a bluff — you announce a kind + its nominal (e.g. "терц до K");
> among equal kinds only the highest nominal REVEALS its cards and scores, the
> lower holders do not reveal and score 0 (§4). No −50 penalty. v1.2 stands: deck
> is 32 cards for 3 players (no 6s), 36 for 4 (§1). v1.1 stands: the прикуп is
> taken only AFTER trump is chosen (bidding on 6-card hands), melds declared
> before the first card (§3, §4).**
> Source of truth for the **Deberc** game (the third game after King and Durak).
> Code (engine, UI, AI, server) must follow this file. When rules change, update
> this file first, then the code and tests.

Deberc (деберц / кларабор, a Klaberjass/Belote-family trick game) uses a
**32- or 36-card deck** — ranks **7, 8, 9, 10, J, Q, K, A** (3 players, 32) or
**6, 7, 8, 9, 10, J, Q, K, A** (4 players, 36) in ♠♥♦♣. A **match** accumulates
the scores of successive hands (здачі) up to a target:

- **Small match (`small`)** — target **510**.
- **Big match (`big`)** — target **1020**.

Each hand is exactly **9 tricks** (every player plays 9 cards).

---

## 1. Players, teams, and deck  ✅ (v1.2)

**Deberc ships two released modes, chosen by seat count (Stage 28.0 names them explicitly in the
setup and lobby UI):**

- **Solo · 3 players** — every player for themselves (three one-person "teams", `teamCount = 3`).
- **Pairs · 4 players** — two fixed teams of 2 (partners opposite, `teamCount = 2`).

Both are the same engine and scoring — the seat count *is* the mode; nothing else toggles.

- **3 players** — every player for themselves, played with a **32-card deck** (drop
  the four 6s). 3 × 9 = 27 cards used; **5 stay undealt** (the stock). The 6 is a
  0-point card, so card totals are unchanged. *(This 3-player mode is Deberc's
  individual / solo game — see `SOLO_VARIANTS_PLAN.md`; 4-player is the partnership mode.)*
- **4 players** — two fixed **teams of 2** (partners opposite; 2×2), played with the
  full **36-card deck**. 4 × 9 = 36 — the whole deck is dealt. Partners pool trick
  points and melds.
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

## 3. Deal, trump bidding, and the "об'яз"  ✅ CONFIRMED (v1.2)

- **Deck:** 32 cards (3p) / 36 cards (4p, see §1). Each player is dealt **6 cards
  to hand** (open) **plus a separate face-down 3-card прикуп (talon)** packet.
  **Bidding happens on the 6-card hands** — the прикуп is NOT looked at or added to
  the hand until a trump has been chosen. A **face-up trump card** is shown on the
  table for round 1.
- **The face-up trump card and the прикуп:**
  - **4 players** (whole 36-card deck, 4×9 = 36): the face-up trump card belongs to
    the **dealer's (роздаючий) прикуп** — the dealer picks it up with their 3-card
    прикуп when trumps are taken. There is **no stock**.
  - **3 players** (32-card deck, 3×9 = 27 dealt, **5 undealt**): the dealer has
    **his own separate 3-card прикуп**; the face-up trump card is the **top of the
    undealt stock** and is **NOT taken by anyone** — it only shows the trump suit.
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

### 3a. Trump exchange (козирний обмін)  ✅ (v1.6, Stage 30.16 restriction; v1.5 base)

Once trump is set and **before the first card of the hand is played**, the player holding the
**lowest trump** may **swap it for the face-up table trump** — but only under the v1.6 restrictions:

- **3 players:** the low trump is the **7** of trump. **4 players:** the **6** of trump.
- Example: trump ♣, the table shows **10♣**; the holder of **7♣** (3p) may take 10♣ and leave 7♦… no —
  the exchange is **only allowed because the table card 10♣ is itself of the trump suit ♣**. If the
  trump had been chosen as a **free suit** in round 2 (so the exposed table card is NOT of the trump
  suit), the exchange is **forbidden**.
- **Origin restriction (v1.6):** the low trump must come from the player's **originally dealt 6-card
  hand**. If the **7/6 arrived in the 3-card прикуп (talon)**, the exchange is **forbidden** — you may
  only exchange a low trump you were actually dealt to hand, not one you drew from the prykup.
- The low trump goes to where the exposed trump was (**3p:** the top of the stock; **4p:** the
  dealer's hand, into which the table trump was taken with the прикуп) and the exposed card enters
  the exchanger's hand. **Hand counts are unchanged** (a straight swap; the 36-card total holds).
- **Once per hand** — after the swap the face-up trump IS the low trump, so no further exchange is
  possible. It is **optional**: a player may simply declare / play without exchanging.
- **Timing / implementation:** offered on that player's **declaring turn**, before they declare
  (so it never invalidates a meld). Only the lone holder of the low trump is ever eligible, so
  gating it to the acting declarer matches "any player with the low trump" while staying turn-based
  for online play. Bots exchange automatically when eligible. Action: `EXCHANGE_TRUMP`. The swap is
  **public** (the new table trump + a "X swapped the low trump" note); no hidden hand is revealed —
  and the origin check reads a per-seat boolean computed at trump commit, so it leaks no card either.

---

## 4. Melds (комбінації)  ✅ CONFIRMED (v1.3 — truthful declaration + reveal)

**Declaration is truthful (v1.3), no bluff.** At the start of the hand (after the
прикуп is taken, before the first card) each player, об'яз first, **announces the
melds it actually holds** — for a sequence, its **kind + nominal** (the top card,
e.g. "**терц до K**") — or passes. The engine validates every announcement against
the real hand; you **cannot** announce a meld you do not hold.
- **The announcement is public** (everyone hears "seat X: терц до K"), but the
  **cards stay hidden**. When everyone has declared, the melds are compared: among
  the same kind, the **highest nominal** (trump breaks ties) wins. **Only the
  winner(s) REVEAL their cards and score**; the lower holders **do not reveal** and
  score **0**. This is the classic belote "highest shows" rule.
- There is **no penalty** (no −50) — bluffing is impossible.
- A **Деберц** (run ≥ 8) ends the match immediately (jackpot) when announced.
- **Бела (bella)** — trump **K + Q** — is **NOT announced in the declaring phase** (v1.6). It is
  declared **at play time**: the holder of trump K+Q declares бела **as it plays a trump K or Q**
  (the `PLAY_CARD` action carries a `declareBela` flag), and scores **20 only if the same trick is
  won** by the declarer (their team in 4p). No declaration when playing the honor, or declaring but
  **losing** that trick → **0**. Бела is independent of the sequence hierarchy (no contest — each
  bella is its own). A player may declare бела **once per hand**.
- **4-player:** sequence announcements and scores are pooled per team; a бела is earned by the seat
  that both holds the trump K+Q and wins the declared trick, and its 20 points go to that team.

Sequences are runs of one suit in rank order (7-8-9-10-J-Q-K-A, plus 6 at 4p):

| Meld | Length | Points |
|------|--------|--------|
| **Терц** | 3 in a row | **20** |
| **Платіна / п'ятдесят** | **4–7** in a row | **50** |
| **Деберц** | **8–9** in a row | **INSTANT MATCH WIN** (jackpot) |

Ranking: **деберц > платіна > терц**. A **деберц** (8–9 same-suit run) ends the
whole **match** immediately — the holder wins outright, regardless of score. ✅

**Within the same band, LENGTH wins first (v1.6, Stage 30.16).** A **longer** run beats a shorter one
regardless of top card — a **5-card палтіна beats any 4-card палтіна**. Only when two runs are the
**same length** is the higher **top card** compared, and only then does **trump** break a remaining
tie. (Терці are always length 3, so терц-vs-терц is decided by top card exactly as before.)

- Hierarchy is judged **among declared melds only**, and **only between DIFFERENT
  SIDES** (owner clarification 2026-07-08). A declared **терц** does **not** score
  if **another side declared** a платіна/деберц, or a **higher терц** (same length 3,
  so compared by top card; run-to-10 loses to run-to-Q). Two **equal** declared melds
  (same band, same length, same top, both non-trump) from different sides both score;
  an equal **trump** meld beats an equal non-trump one. The **length-first** rule
  above governs платіна-vs-платіна.
- **A player's OWN melds never cancel each other** — one seat holding **two терці**,
  or a **платіна and a терц**, scores **BOTH**. (A seat may truthfully announce a
  sequence in each suit it holds one in.)
- 4-player: declared melds are pooled per team (a team's melds don't cancel each
  other; the contest is against the opposing team).

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

## 7. ХВ and бейт  ✅ CONFIRMED (v1.4 — owner corrections 2026-07-08)

> **NAMING (v1.4):** the two marks were previously LABELLED the wrong way round.
> The **displayed** names are now swapped: the mark for the **об'яз under-scoring**
> is shown as **«Бейт»**, and the mark for **taking zero tricks** is shown as
> **«ХВ»**. (Internally the code still stores them in `hvMarks` / `beitMarks`
> respectively; only the labels swap — see the swapped `deberc.hv` / `deberc.beit`
> i18n values. Mechanics below are attached to the CONDITION, not the label.)

Tallies kept in the score table (**per player** in 3p; **per team** in 4p):

- **Об'яз under-scores** (displayed **«Бейт»**) — recorded when the **об'яз** scores
  **fewer points than at least one other player/team** in a hand. Consequences:
  1. Penalty accounting (below).
  2. **All of the об'яз's points for that hand go to the top scorer.**
  3. The **об'яз role passes to that top scorer** next hand.
- **Zero tricks** (displayed **«ХВ»**) — recorded for **any player/team that takes
  zero tricks** in a hand.

**Penalty accounting (v1.4)** — per tally holder, per kind, counted independently:
- The **first** mark of a kind costs **nothing** (recorded only).
- **Every subsequent** mark of the **same kind** costs **−100** (2nd, 3rd, … each
  −100). No pairs, no mixed cancellation.
- The об'яз can collect **both** marks from one hand (0 tricks ⇒ necessarily fewer
  points) — **both land** independently.

---

## 8. Deferred edges

1. **§3 — RESOLVED:** all pass both rounds → the table trump is forced onto the
   об'яз (no redeal).
2. **§4 — RESOLVED (v1.6, Stage 30.16):** "highest **declared** holder only" extends across платіна.
   Within a band, comparison is **LENGTH first** (a longer run wins), then top card, then trump —
   so a 5-card палтіна beats a 4-card палтіна regardless of top card; equal-length runs compare by
   top card with trump breaking ties (like терці). *(Supersedes the old "equal платіни compare by
   top card" wording.)*
3. **§7 — RESOLVED (owner rule 2026-07-08):** in 4p the zero-tricks mark
   (displayed «ХВ») is **per team** — recorded only when the **whole team** takes
   zero tricks in a hand. A single partner taking zero tricks while the other
   partner takes any does **not** earn the mark (the team is the accounting unit,
   consistent with §7 tallies being per team in 4p).
4. **§4 (v1.3) — RESOLVED:** declaration is **truthful** — a seat announces a
   sequence's kind + nominal (top card) it really holds; the engine validates it
   against the hand (an unheld announcement is illegal). Among equal kinds only the
   highest nominal reveals its cards and scores; lower holders score 0 and do not
   reveal. No bluff, no penalty. (One announcement per kind per seat.)
