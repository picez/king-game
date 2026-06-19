# King Rules

Source of truth for the King game in this project. Code (engine, UI, AI,
server) must follow this file. When rules change, update this file first, then
the code and tests.

## Players and Deck

Support both 3 and 4 players.

For 3 players:
- 32-card deck: 7, 8, 9, 10, J, Q, K, A.
- 10 cards per player.
- 2-card kitty / прикуп.
- 10 tricks per round.

For 4 players:
- 52-card deck.
- 13 cards per player.
- No kitty.
- 13 tricks per round.

## Game Flow

Each round, in order:
1. Cards are dealt.
2. The dealer looks at **their own initial hand** (without the kitty).
3. The dealer picks the game mode from their remaining personal set.
4. The dealer takes the kitty into hand.
5. The dealer discards the same number of cards (legal discards only).
6. If the mode is Trump, the dealer chooses the trump suit.
7. Play begins — **the dealer leads (plays first) the first trick.** Turn order
   then proceeds clockwise (by seat). The winner of each trick leads the next.

- **Dealer's Choice is the primary mode.** Fixed order is a secondary option
  only.
- The dealer rotates in turn every round (round-robin).
- The dealer always picks the game mode for the round.
- **Each dealer has their own personal set of 9 games** (see Modes). A dealer
  picks only from their own still-unused modes.
- One dealer's choice never affects another dealer's set — mode availability is
  tracked per dealer (per `playerId`), not as a global shared pool.
- The game ends when every dealer has used all 9 of their games:
  - 3 players → 27 rounds (9 × 3);
  - 4 players → 36 rounds (9 × 4).

## Modes

Seven modes exist:
- No Tricks
- No Hearts
- No Queens
- No Jacks
- King of Hearts
- Last Two Tricks
- Trump

### Per-dealer mode set (9 games)

Every player, while dealer, must play exactly these 9 games (6 negative + 3
trump):

| Mode            | Count |
|-----------------|-------|
| No Tricks       | 1     |
| No Hearts       | 1     |
| No Queens       | 1     |
| No Jacks        | 1     |
| King of Hearts  | 1     |
| Last Two Tricks | 1     |
| Trump           | 3     |

- Trump is available three times per dealer: after the first Trump choice that
  dealer has 2 left, then 1, then 0.
- Counts are stored per dealer: `dealerModes[playerId] = { no_tricks: 1, …, trump: 3 }`.
- `ModeSelectionScreen` shows the current dealer's own remaining modes and the
  Trump remaining count (e.g. `Trump (3 left)`); used-up modes are disabled.
- The AI dealer chooses only from its own remaining modes.

## Kitty / Прикуп

Applies whenever a kitty exists (3 players → 2 cards). The dealer takes the
kitty **in every mode** of the round (after choosing the mode in Dealer's
Choice).

- The dealer takes the kitty into hand.
- After taking the kitty, the dealer discards the same number of cards.
- Discarded cards leave the game entirely.
- Discarded cards are NOT added to `collectedCards`.
- Discarded cards are scored to nobody (there is no kitty penalty).
- The dealer may NOT discard penalty cards of the current mode.

Forbidden discards by mode:
- No Hearts: cannot discard hearts.
- No Queens: cannot discard Q.
- No Jacks: cannot discard J.
- King of Hearts: cannot discard **any heart** (not just K♥) — so the King can
  never be removed from play via the discard.
- No Tricks: any card may be discarded.
- Last Two Tricks: any card may be discarded.
- Trump: any card may be discarded.

Privacy:
- The discard is **private to the dealer** during the round (the dealer can
  review it via "My discard"); other players never see it mid-round.
- Each player can review only their **own** collected (won) cards during the
  round; opponents' collected cards are revealed only at round scoring.

Implementation requirements:
- Core helper `canDiscardToKitty(card, modeId)` and `getValidKittyDiscards(hand, modeId)`.
- UI disables/dims illegal discard cards.
- The reducer rejects an illegal discard even if the UI failed (server-side
  authority online).
- The AI never chooses illegal discard cards.

## Trick Rules

- The **dealer leads the first trick** of each round; afterwards the winner of
  a trick leads the next. Order around the table is clockwise (by seat).
- The trick leader may play any card, **except**: in **No Hearts** and **King of
  Hearts** a player may not *lead* with a heart while they still hold a
  non-heart card (if hearts are all they have, they may lead a heart).
- Once a suit is led, a player must follow suit if they hold a card of that
  suit; otherwise they may play any card.
- Trick winner:
  - if a trump exists and the trick contains trumps, the highest trump wins;
  - otherwise the highest card of the led suit wins.

## Trump

- Trump is a positive mode.
- The dealer chooses the trump suit.
- No Trump is allowed: the dealer may choose "No Trump".
- In Trump, the dealer also takes the kitty and discards (when a kitty exists),
  before selecting trump.

## Scoring

For 3 players:
- No Tricks: -4 per trick.
- No Hearts: -5 per heart.
- No Queens: -10 per queen.
- No Jacks: -10 per jack.
- King of Hearts: -40.
- Last Two Tricks: -20 per each of the last two tricks.
- Trump: +8 per trick.

For 4 players:
- No Tricks: -4 per trick.
- No Hearts: -4 per heart.
- No Queens: -13 per queen.
- No Jacks: -13 per jack.
- King of Hearts: -52.
- Last Two Tricks: -26 per each of the last two tricks.
- Trump: +4 per trick.

## Early Round End

A round can end before all tricks are played when every penalty card of the
mode has already been collected (it cannot change the score to play on):

- No Hearts — all hearts collected.
- No Queens — all four queens collected.
- No Jacks — all four jacks collected.
- King of Hearts — the K♥ collected.
- No Tricks / Last Two Tricks / Trump — **no early end** (every trick matters).

On early end the round is scored from the tricks actually played and the game
proceeds to round scoring, then the next dealer/round.

## Tests Required For Rule Changes

- deck creation 32/52 without duplicates;
- dealing for 3/4 players;
- follow-suit rule;
- trick winner with and without trump;
- scoring of all modes (3p and 4p);
- kitty discard legality:
  - cannot discard hearts in No Hearts;
  - cannot discard Q in No Queens;
  - cannot discard J in No Jacks;
  - cannot discard K♥ in King of Hearts;
  - can discard anything in No Tricks, Last Two Tricks, Trump;
- reducer rejects illegal discard;
- discarded cards do not affect score (no kitty penalty);
- per-dealer mode sets:
  - each dealer owns 9 games (Trump count 3) in both 3p and 4p;
  - choosing Trump decrements only that dealer's Trump count (3 → 2);
  - one dealer's choice does not remove the mode for other dealers;
  - game finishes after 27 rounds (3p) and 36 rounds (4p);
  - mode selection uses per-dealer counts, not a global shared pool.
