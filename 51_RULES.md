# 51 (Syrian 51 / واحد وخمسين) — MVP Rules Spec

> **STATUS: RELEASED (Stage 30.7); meld/opening rules corrected (Stages 30.9–30.10).** 51 is the
> fully `available` 6th game — local + online + stats + favorite + achievement — built from
> `src/games/fiftyOne/`. Owner corrections: a joker may sit at **any position** in a meld (§8),
> the **51 minimum is a once-per-round opening gate** — after opening, any valid meld may be laid
> (§7, 30.9), and **Ace-low runs extend** (`A-2-3-4`, …) so an Ace lays off onto a `2-3-4` (§6,
> 30.10). This document remains the single source of truth; when code disagrees with this spec,
> the code is wrong — or this spec is updated first, deliberately.
>
> **Sources.** Reconciled from the owner-supplied *Syrian 51 Card Game Rules* text and
> the **owner's authoritative house-rule corrections**. Where the two disagree, the
> **owner corrections win** (each override is called out inline as *[owner override]*).
> Anything still genuinely ambiguous is a numbered item in [§16 Open questions](#16-open-questions--confirmations-needed) with a **recommended MVP** default — the MVP will build the recommended default unless the owner confirms otherwise.
>
> Internal identifiers (for the eventual code): game id `fiftyOne`, `game_type='fifty-one'`,
> core folder `src/games/fiftyOne/` — the doc keeps the human name **51**.

---

## 1. Objective

Be the first player to **get rid of all the cards in your hand** by forming valid
**melds** (runs and sets) and discarding. The game is named "51" after its **opening
rule** (§7): your first melds must total **51+ points**. *[owner override: the round is
won by emptying your hand — **NOT** by "reaching 51". 51 is only the opening threshold.]*

A **match** is played over multiple rounds; a player is **eliminated when their running
penalty reaches 510** (§12). Lower is better.

---

## 2. Players

- **MVP: 2–4 players.** *[owner override: source says 2–5; MVP caps at 4.]*
- Every player is on their **own side** (no partnerships) — this is a cutthroat game.

---

## 3. Deck

The deck size depends on the player count. Two **Jokers** are always in play.

| Players | Cards | Jokers | Total |
|--------:|-------|:------:|:-----:|
| **2**   | 1 standard 52-card deck | 2 | **54** |
| **3–4** | 2 standard 52-card decks (104) | 2 | **106** |

- *[owner decision / recommended MVP]* This 1-deck-for-2 / 2-decks-for-3–4 split is the
  **owner's recommended interpretation** of an ambiguous source ("1 deck for 2–3, 2 decks
  for 4–5; usually 2 jokers"). **Confirm before 30.1** — see [§16 Q1](#16-open-questions--confirmations-needed).
- Jokers are **wild** (§8). No other wild cards.
- With two decks, the same physical card (e.g. two 9♥) can appear twice across the game;
  meld-duplication rules are in §6.

---

## 4. Deal & round start

- **Each player is dealt 13 cards.** The **starting player is dealt 14.** *[owner
  override: source says 14 / starter 15.]*
- The rest form the **face-down draw pile.**
- **No initial face-up discard.** The discard pile starts **empty**. *[owner override:
  source allows an optional starting face-up card; the MVP does **not** — "the first card
  does not show".]*
- **The starter opens the round by discarding (playing) first, WITHOUT drawing** — they
  already hold 14, so their first action is a discard down to 13, then play passes on.
  Every subsequent turn (including the starter's later turns) follows the normal
  draw-then-discard structure (§5).
- Dealer/starter rotation between rounds: the start seat rotates by one each new round
  (platform convention; exact rotation finalised in 30.1, non-behavioural for the spec).

---

## 5. Turn structure

A **normal** turn is, in order:

1. **Draw one card** — from the **draw pile**, OR (only if you have already *opened*, §7)
   the **top card of the discard pile**. *[owner override: you may take from the discard
   pile **only after you have opened**; before opening it is **draw pile only**.]*
2. **Optionally meld** — lay down new melds (subject to the §7 opening rule), add to your
   own melds, and/or add to *other players'* melds (only after opening, §9).
3. **Discard exactly one card** to the top of the discard pile. **A turn always ends with
   a discard** and then passes to the next player.

Exceptions & clarifications:
- **Starter's first turn:** no draw (they start with 14); they just discard (and may meld
  if they can already open — unusual but legal).
- **Taking the discard top does not force immediate use** *[owner recommended MVP]*: the
  taken card goes into your hand; you then meld/discard as normal. See [§16 Q6](#16-open-questions--confirmations-needed).
- **Only the single top discard card** may be taken, never the whole pile *[owner
  recommended MVP]*. See [§16 Q5](#16-open-questions--confirmations-needed).
- **Finish is by discard** *[owner recommended MVP]*: to go out you meld your cards and
  **discard your final card**. Whether a player may finish by melding *all* remaining cards
  with **no** final discard is [§16 Q3](#16-open-questions--confirmations-needed) (MVP: must end on a discard).

---

## 6. Melds (runs & sets)

Every meld has **at least 3 cards**. Two kinds:

### A. Run
Three or more **consecutive cards of the same suit**, e.g. `7♥ 8♥ 9♥` or `10♣ J♣ Q♣ K♣`.

- **Ace is high** by default (…Q K A). *[owner override / house rule]*
  - **Ace-low runs** anchor the Ace at the **bottom** and may extend upward: `A-2-3`,
    `A-2-3-4`, `A-2-3-4-5`, … *[owner rule 30.10 — the low Ace is no longer limited to
    `A-2-3` alone]*. The low Ace counts **1**, so `A-2-3` = **6**, `A-2-3-4` = **10**,
    `A-2-3-4-5` = **15**, … (§10). This matters for **lay-off** too: a public `2-3-4` run
    accepts an `A` to become `A-2-3-4`, and a public `A-2-3` accepts a `4` to become `A-2-3-4`.
  - **`Q-K-A` is allowed**, meld value **30** (Q=10, K=10, A=10) — the Ace is high here.
  - **`K-A-2` is NOT allowed** — a run may not "wrap" around the Ace. *[owner override.]*
    (So adding a `K` to an `A-2-3` run is also rejected — `A-2-3-K` is not a run.)
- A run may not exceed one full suit sequence (no `…K A 2…` continuation). An Ace is
  **either** low (position 1) **or** high (above the King) in a given run, never both.

### B. Set (group)
Three or more cards of the **same rank**, e.g. `9♠ 9♥ 9♦` or `K♣ K♦ K♥`.

- **No duplicate identical card in one set** — with two decks you may **not** put two of
  the exact same suit+rank (e.g. two `9♥`) in the same set. *[owner recommended MVP; source
  calls this house-rule dependent.]* A set of 4 must therefore use all four distinct suits.

Both meld types may contain **Jokers** (§8), subject to the joker limit and
"clear card" rule.

---

## 7. The "51" opening

Before a player may place **any** card on the table, their **first lay-down** must be one
or more valid melds whose **combined point value is ≥ 51**.

- The opening 51 **must come entirely from the player's own melds** — you may **not** reach
  51 by adding cards to other players' melds. *[owner override, matches source §19.]*
- Point values for the 51 calculation use the **card values in §10** (e.g. `10♥ J♥ Q♥` = 30,
  `7♣ 7♦ 7♠` = 21 → 51, so both may be laid together to open).
- A Joker inside an opening meld contributes **the value of the card it represents** (§8),
  not 25.
- Opening happens **during the meld step** of a normal turn; a player is either "opened" or
  "not opened" for the rest of the round. **The 51 minimum applies only to this first
  lay-down — it is a once-per-player-per-round gate, never re-checked afterwards.**

**Before opening:** you may only draw from the **draw pile**, you may **not** lay any meld,
and you may **not** take from the discard pile or add to anyone's melds.

**After opening (§7 clarified, Stage 30.9):** on this same turn or any later turn you may
**lay new valid melds of ANY point value** (no further 51 minimum), add to your own melds,
add to other players' melds (§9), and take the discard top (§5). You never have to reach 51
again — reaching it once, to open, is the only threshold.

---

## 8. Jokers (wild cards)

- A Joker is **wild** and may stand in for **one specific missing card** in a run or set.
  It **must represent a clear, unambiguous card** — e.g. in `7♠ [Joker] 9♠` the Joker is
  `8♠`; in `Q♥ Q♦ [Joker]` it is a third queen.
- **A Joker may sit at ANY position in a meld** *[owner rule, Stage 30.9]* — the beginning,
  the middle, or the end of a run, and any slot of a set. In a **run**, the card the Joker
  represents is fixed by **its slot in the run sequence** (left = low, right = high), so the
  arrangement removes the old ambiguity: `7♠ 8♠ [Joker]` = `7-8-9` (Joker = `9♠`),
  `[Joker] 8♠ 9♠` = `7-8-9` (Joker = `7♠`), `Q♠ K♠ [Joker]` = `Q-K-A` (Joker = `A♠`, worth 30),
  `[Joker] 2♠ 3♠` = `A-2-3` (Joker = `A♠`, worth 6). An arrangement that has **no** legal
  reading — e.g. `K-A-[Joker]` (would wrap past the Ace) — is still rejected.
- **In an opened meld, the Joker's value = the value of the card it represents** (§10).
  *[owner override: not a flat 15.]*
- **A Joker left in a player's hand at round end = 25 penalty points** (§11). *[owner
  override: source says ~15.]*
- **Joker cap (unchanged, MVP):** at most **ONE joker per meld** — two-plus jokers in one
  meld are rejected (keeps the represented card unambiguous). In a **set**, the joker takes a
  clear missing suit. (The old "internal gap only" run restriction from 30.1 is **superseded**
  by the any-position rule above.)

---

## 9. Adding to melds ("laying off")

After you have opened:

- You may add valid cards to **your own** melds.
- You may add valid cards to **other players'** melds — e.g. add `4♠` or `8♠` to an existing
  `5♠ 6♠ 7♠`. *[source §12–13; owner to confirm — [§16 Q4](#16-open-questions--confirmations-needed).]*
- Added cards must keep the target meld valid (still a legal run/set, joker still clear).

Before opening you may **never** add to any meld (yours or others').

---

## 10. Card values

Used both for the **51 opening total** and for **end-of-round hand penalties** (§11).

| Card | Value |
|------|:-----:|
| 2–9 | Face value (2…9) |
| 10, J, Q, K | **10** |
| **Ace** | **10** — *except* it counts **1** at the **low end** of an Ace-low run (`A-2-3`, `A-2-3-4`, …) *[owner override: Ace = 10, not 11]* |
| Joker **in a meld** | Value of the **card it represents** |
| Joker **in hand** (penalty) | **25** |

Worked notes:
- `A-2-3` run = **6** (1+2+3); `A-2-3-4` = **10**; `A-2-3-4-5` = **15**. `Q-K-A` run = **30**
  (10+10+10). Set `A A A` = **30**.
- An Ace **left in hand** at round end scores **10** penalty.

---

## 11. Round end & scoring

- **The round ends the instant a player empties their hand** (goes out) by melding and
  making their final discard (§5).
- **Winner scores 0** for the round.
- **Every other player counts the card values (§10) still in their hand** and adds that to
  their running match penalty. **Lower total is better.**
- **Joker in hand = 25** each.
- **"Never opened" loser = 100** *[owner override]*: a losing player who **still holds all
  their cards** (i.e. **never opened** this round) scores a flat **100** for the round
  instead of their card-value sum. See [§16 Q8](#16-open-questions--confirmations-needed) for the exact trigger
  (recommended MVP: "never laid any meld this round").
- The source's "**Hand** win" bonus (going out all-at-once for extra penalties against
  others) is **NOT in MVP** — flagged as [§16 Q9](#16-open-questions--confirmations-needed).

---

## 12. Elimination & match end

- A player whose **running penalty reaches 510 (at or above)** is **eliminated**,
  immediately **after the round** in which they crossed it. *[owner override / decision.]*
- **Recommended MVP:** the match **continues until one player remains** — that player wins.
  *(Alternative "stop at first 510, lowest score wins" is explicitly NOT preferred, because
  the owner said "eliminated".)* See [§16 Q7](#16-open-questions--confirmations-needed).
- With 2 players, one crossing 510 ends the match (the other wins).

---

## 13. Direction of play

- **Clockwise** — platform convention across Card Majlis. *[owner override: source says
  counterclockwise; the platform reads clockwise on screen. See [§16 Q2](#16-open-questions--confirmations-needed) if the owner wants
  authentic counterclockwise for 51 specifically.]*

---

## 14. Online redaction / privacy (for the future server-authoritative build)

The pure reducer is the single source of truth for local **and** server play; the server
redacts per viewer before sending state.

**Each player sees only:**
- **Their own hand** (cards + count).

**Public to everyone:**
- All **opened melds** on the table (owner seat + cards, including which card a Joker
  represents).
- The **discard pile** as the rules expose it — at minimum the **top card**; the MVP may
  keep the **full discard pile visible** (it is public information) — confirm in 30.4.
- Each player's **hand count**, **opened/not-opened** flag, running **penalty scores**,
  **eliminated** flags, whose **turn** it is, draw-pile **count**.

**Hidden from everyone (never serialised to a non-owner):**
- The **order/contents of the draw pile**.
- **Other players' hand cards** (only the count is public).

No card identity that a viewer should not see may ever leave the server. (Same discipline
as Tarneeb/Deberc redaction.)

---

## 15. MVP scope boundaries

**In MVP:** 2–4 players, the deck split (§3), 13/14 deal, draw-then-discard turns, the 51
opening from own melds, runs (incl. `A-2-3`=6 and `Q-K-A`=30, no `K-A-2`), sets (no
duplicate identical card), jokers (wild, meld-value / 25-in-hand), open-gated discard-pile
take + lay-off to others, empty-hand win, hand-value penalties, 100 for never-opened,
Joker-in-hand 25, elimination at 510, continue-until-one-remains, clockwise.

**Deferred / NOT in MVP:** the "Hand" all-at-once win bonus (§16 Q9); configurable target
(fixed 510 for MVP; a lobby option can come later like Tarneeb's target score); Kaboot-style
variants; any partnership mode; taking more than the top discard card; forced-immediate-use
of a taken discard card.

---

## 16. Open questions / confirmations needed

Each has a **recommended MVP default** the build will use unless the owner says otherwise.

1. **Deck exact count.** Confirm **2p = 1 deck + 2 jokers (54)**, **3–4p = 2 decks + 2
   jokers (106)**. *(Recommended MVP as in §3.)*
2. **Direction.** Clockwise for platform consistency (recommended), or authentic
   **counterclockwise** for 51 specifically?
3. **Finish without discard.** Must the final action always be a **discard** (recommended
   MVP), or may a player go out by **melding all remaining cards with no final discard**?
4. **Adding to other players' melds.** Allowed **after opening** (source says yes) — confirm
   it's in MVP (recommended: yes).
5. **Taking the discard.** **Top card only** (recommended MVP) vs multiple/the whole pile.
6. **Immediate use of a taken discard.** **No** — take into hand, then meld/discard
   (recommended MVP) vs must-use-immediately.
7. **Elimination & match end.** Eliminate at **≥ 510 immediately after the round**, then
   **continue until one player remains** (recommended MVP). Confirm the "one remains" finish
   vs "first-to-510 ends it".
8. **The 100 penalty trigger.** "All cards still in hand" = the loser **never opened** (laid
   no meld) this round (recommended MVP). Confirm it is *never opened* rather than *literally
   0 cards played*.
9. **"Hand" win bonus.** Source §16 describes an all-at-once win with extra penalties to
   others. **NOT in MVP** (recommended) — confirm it can stay deferred.
10. **Jokers per meld.** Cap so the represented card is unambiguous (recommended: **≤ 1 joker
    per 3-card meld**; a longer meld may allow more if still unambiguous). Minor, non-blocking.

---

## 17. Change log (this spec)

- **Stage 30.0 (2026-07-14):** initial SPEC-ONLY draft — reconciled the owner's Syrian 51
  source text with the owner's authoritative corrections; recorded 10 open confirmations.
  No runtime code. Rollout staged in [`51_PLAN.md`](51_PLAN.md).
- **Stage 30.1 (2026-07-14):** **pure core built** under `src/games/fiftyOne/` (types, deck,
  meld validator, reducer, greedy AI, redaction, invariants) with 70 unit tests. Implemented
  **every §16 open question on its recommended MVP default** (deck 54/106; clockwise; finish
  by discard — a meld/lay-off may not empty the hand, you go out on the final discard; lay-off
  to others after opening; take top discard only, no forced immediate use; eliminate at ≥510
  after the round, continue until one remains; the 100 penalty triggers when a loser **never
  opened**; the "Hand" all-at-once bonus stays deferred; **≤ 1 joker per meld**, run jokers
  fill internal gaps only). Draw-pile exhaustion **reshuffles the discard except its top**
  (§5 MVP). No catalog/UI/server/stats yet.
- **Stage 30.9 (2026-07-14):** **two owner meld/opening corrections** (§7, §8). (1) A joker
  may now sit at **any position** in a run/set — the represented card is fixed by its **slot**
  in the sequence, so end jokers resolve (`7-8-[J]`=`7-8-9`, `[J]-8-9`=`7-8-9`, `Q-K-[J]`=`Q-K-A`,
  `[J]-2-3`=`A-2-3`); the "internal gap only" 30.1 restriction is **superseded** (the ≤1-joker
  cap and `K-A-2`/`K-A-[J]` rejection stay). (2) The **51 minimum is a once-per-round OPENING
  gate**: after a player has opened, they may lay **new valid melds of any value**, lay off, and
  take the discard top on this or later turns — the code now does this (the reducer's lay-melds
  action no longer re-checks 51 once opened). Core two-pass run resolver + reducer branch + UI
  ("Open 51" → "Lay meld") + bot (lays fresh melds after opening) + online/unit tests. No deck,
  scoring, elimination, joker-hand-penalty, discard-restriction or win-by-final-discard change.
- **Stage 30.10 (2026-07-14):** **Ace-low run extension + meld display fix** (§6, §10). (1)
  Ace-low runs are no longer limited to `A-2-3`: the low Ace anchors position 1 and the run may
  extend up (`A-2-3-4`=10, `A-2-3-4-5`=15, …). This makes the natural **lay-off** work — a public
  `2-3-4` accepts an `A` (→ `A-2-3-4`), a public `A-2-3` accepts a `4`; adding a `K` to `A-2-3`
  and `K-A-2` stay invalid. The order-independent resolver pass now normalises the displayed run
  to Ace-first (`A-2-3-4`, not `2-3-4-A`). (2) **Public-meld card layout** fixed — meld card rows
  use positive gaps + `object-fit:contain` + in-block horizontal scroll, so cards no longer
  overlap/clip and never overflow at 360/390. No deck/scoring/elimination/penalty/discard/win change.
