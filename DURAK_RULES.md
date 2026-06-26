# Durak Rules (Дурак)

Source of truth for the **Durak** game in this project (the second game after
King). Code (engine, UI, AI, server) must follow this file. When rules change,
update this file first, then the code and tests.

Two variants are supported:

- **Simple Durak** (`simple`) — Простий дурак. The defender either beats every
  attacking card or takes all cards on the table. No transferring.
- **Transfer Durak** (`transfer`) — Переводний дурак. Before beating any card,
  the defender may **transfer** (перевести) the attack to the next player by
  playing a card of the same rank as the attack.

Everything in **Common rules** applies to both variants; the variant-specific
sections add to or override it.

---

## 1. Common rules

### Players and order

- **Players:** 2–4 (MVP). No teams — every player is for themselves.
- **Seating / turn order:** clockwise. The **defender** is always the player
  immediately clockwise (to the left) of the current **attacker**. After the
  defender comes the next player, and so on.

### Deck and deal

- **Deck:** 36 cards — ranks **6, 7, 8, 9, 10, J, Q, K, A** in four suits
  (♠ ♥ ♦ ♣). Ace is high, 6 is low. (This is King's 32-card deck **plus the
  sixes** — the card art already exists.)
- **Deal:** **6 cards** to each player, dealt before the trump is revealed.
- **Trump:** after the deal, the **next card** off the top of the deck is turned
  **face-up** and placed at the **bottom of the deck**, sticking out so everyone
  sees it. Its **suit is the trump** for the whole game. It is the **last card
  drawn** from the deck.
- **Rank order for comparisons:** 6 < 7 < 8 < 9 < 10 < J < Q < K < A.
- **Card strength:** any **trump** beats any **non-trump**. Between two cards of
  the same suit, the higher rank wins.

### First attacker

- The first attacker is the player holding the **lowest trump card** in hand.
- **Fallback** (no player holds a trump — possible because the trump card itself
  sits in the deck): the first attacker is chosen **deterministically** — the
  player at **seat 0** (room/host order). The deal seed is recorded server-side
  so this is reproducible. (A random pick is acceptable only if seeded.)

### A bout (one attack → defense cycle)

1. **Attack.** The attacker places one card face-up in front of the defender.
   The attacker may then **add more cards**, but **only of a rank already on the
   table** (this is the "throw-in"/подкидывание). Example: attack with a 7, then
   add another 7 or — after the defender beats with a 9 — add a 9.
2. **Defense.** For **each** unbeaten attacking card, the defender must place a
   beating card on top of it:
   - a **higher card of the same suit**, or
   - **any trump**, if the attacking card is **not** a trump;
   - a **trump** attacking card can only be beaten by a **higher trump**.
3. **Limits:**
   - The number of attacking cards in a single bout may **not exceed the
     defender's hand size** (you cannot ask a player to beat more cards than they
     hold) **and never exceeds 6**. So `maxAttack = min(6, defenderHandSize)`,
     evaluated against the defender's hand **at the start of the bout**.
4. **Throw-in priority (multi-player).** Who may add cards is decided by priority,
   not free-for-all:
   - The **primary attacker** (the opener) has **first priority**. While they have
     **not passed**, only they may throw in (after the defender beats, the throw
     returns to them).
   - When the primary **passes**, the right to throw moves **clockwise to the next
     eligible attacker** (every active player **except the defender**), in turn.
     Each such attacker may throw in or **pass**.
   - **Co-attackers may only throw cards of a rank already on the table** (the
     opener's first card is unrestricted).
   - A passed attacker is out **for the current throw-in cycle** only. An attacker
     who simply **cannot** throw (no matching rank, or the limit is reached) is
     treated as having passed, so the turn moves on (engine convenience — same
     outcome).
   - **Re-priority on a new card.** Every time a card is **added** to the table, a
     **fresh throw-in cycle** begins: `passedAttackers` is cleared. So after a
     co-attacker throws and the defender beats it, the **primary attacker gets the
     first chance again** — a rank that just appeared (from the thrown or the
     beating card) may now give an earlier attacker a legal throw. The cycle then
     proceeds clockwise as before. Passes therefore apply only to the *current*
     table-rank state, never permanently — yet the bout still terminates (each
     added card is finite, and the table is capped at `min(6, …)`).
   - The **defender never throws.**
5. **Ending the bout.**
   - **Successful defense:** every attack is beaten **and** all eligible attackers
     have passed (or can no longer throw). All cards on the table go to the
     **discard pile** (out of the game). The **defender becomes the next
     attacker**; the new defender is the player after them. In a **2-player** game
     this means: after the primary passes, nobody else can throw, so the bout ends
     immediately.
   - **Defender takes:** at any point the defender may **take** all cards on the
     table — both the attacking cards and any cards they already used to defend —
     into their **hand**. The bout ends. The **next attacker is the player after
     the defender** (the defender is **skipped** as attacker this time).

### Drawing back up to six

After a bout ends, players **refill** their hands to **6 cards** from the deck,
in this order:

1. the **attacker(s)** first, in turn order starting from the primary attacker,
2. then the **defender** last.

Draw stops when a hand reaches 6 or the **deck is empty**. The face-up trump
card is the **last** card taken from the deck.

### Running out of deck and ending the game

- Once the deck (including the bottom trump card) is **empty**, there is **no
  more drawing**; players keep playing from their hands only.
- A player who has **no cards** and cannot draw (deck empty) is **out** (safe —
  they finished).
- The game continues until **only one player has cards left**. That last player
  is the **durak** (the "fool" / loser).
- **Draw (no loser):** if the final bout empties the last two players
  simultaneously (e.g., the defender beats the attack using their last cards and
  the deck is empty), the game is a **draw** — no fool.

---

## 2. Simple Durak (`simple`)

No transferring. On their turn the defender may only:

- **beat** the current unbeaten attacking card(s) (and keep beating as the
  attacker throws in matching ranks), or
- **take** all cards on the table.

Everything else is the Common rules.

---

## 3. Transfer Durak (`transfer`)

Adds one option for the defender, taken **before they have beaten any card**:

- **Transfer (перевести).** If the table holds **only attacking cards of a
  single rank** and **none have been beaten yet**, the defender may play a card
  of that **same rank** from their hand onto the table. The defense then
  **passes to the next player clockwise**: the former defender becomes an
  attacker, and the player after them becomes the new defender.
- **Conditions:**
  - Transfer is **only** legal while **no defending card has been played** in
    this bout. Once the defender beats even one card, they can no longer transfer
    (they must beat the rest or take).
  - **Capacity:** after the transfer the total number of attacking cards must not
    exceed the **new defender's hand size** (and never exceed 6). If it would,
    the transfer is **illegal**.
  - **Multi-card attacks:** if the attack already has several cards of the rank
    (e.g., two 7s), the defender transfers by adding **one more** card of that
    same rank (→ three 7s); the new defender then faces all of them, subject to
    the capacity check.
  - **Chaining:** the new defender may **transfer again** to the next player if
    they too hold a same-rank card and capacity allows, and so on around the
    table (never back onto a player who is already out).
- **Trump-show transfer** (showing a trump of the same rank without playing it)
  is a known variant but is **NOT** in MVP — only play-a-same-rank-card transfer.

After a transfer, the **transferrer becomes the new primary attacker** (the
throw-in priority and `passedAttackers` reset), and play proceeds normally from
the new defender (who may beat, take, or — if still legal — transfer again).

---

## 4. Explicit MVP decisions

These pin down the ambiguous points so the implementation is unambiguous:

- **Players:** 2–4. **No teams.**
- **Throw-in:** **priority** — the primary attacker leads until they pass, then it
  moves clockwise to the next eligible attacker; co-attackers throw matching ranks
  only; the **defender never throws**. A player who cannot throw auto-passes.
- **After a transfer:** the **transferrer becomes the new primary attacker** and
  the throw-in state resets.
- **Max attacking cards** in a bout = `min(6, defenderHandSizeAtBoutStart)`.
- **No throw-in beyond the defender's hand size.**
- **After a successful defense:** the **defender becomes the next attacker**.
- **After the defender takes:** the **next attacker is the player after the
  defender** (defender skipped).
- **Draw order after a bout:** **attacker(s) first, then the defender.** Refill
  to 6; the face-up trump is drawn last; no draws once the deck is empty.
- **Last bout (deck empty):** no drawing; play out the hands.
- **Game end:** deck empty **and** players run out of cards; the **last player
  holding cards is the durak**. Simultaneous empty of the last two = **draw**.
- **First attacker:** lowest trump in hand; deterministic seat-0 fallback if no
  trump is held.
- **Transfer (transfer variant only):** allowed before any card is beaten, by
  playing a same-rank card, subject to the next defender's capacity.

---

## 5. Action vocabulary (for the engine/protocol)

These are the player actions the Durak reducer must accept (names are
indicative; finalized in Stage 9.1). All are validated server-side; illegal
actions are rejected, never silently applied.

- **ATTACK** — place one or more same-rank attacking cards (first card or a
  legal throw-in of a rank already on the table).
- **DEFEND** — place a beating card on a specific unbeaten attacking card.
- **TAKE** — the defender picks up all table cards.
- **PASS_ATTACK** ("бито") — the **current thrower** gives up their throw-in; the
  throw moves to the next eligible attacker, or — if nobody else can throw and all
  attacks are beaten — the bout ends as a successful defense.
- **TRANSFER** — (transfer variant) play a same-rank card to pass the defense to
  the next player.

The reducer also performs the non-player transitions: dealing, revealing trump,
resolving the bout, discarding/taking, drawing back to six, rotating roles, and
detecting the end of the game.

---

## 6. Out of scope (post-MVP)

Documented so they are not silently assumed present:

- Co-attacker throw-ins from players other than the primary attacker.
- 5–6 players, teams, "passport"/перевод by showing a trump, "погоны" (epaulettes).
- "Перебивной"/"дорожный" and other regional variants.
- Speed Durak, открытый/closed-hand variants.

See **DURAK_PLAN.md** for the architecture and the staged implementation plan
(9.1 → 9.5).
