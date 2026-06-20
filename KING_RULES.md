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
4. **If the mode is Trump, the dealer chooses the trump suit *now* — BEFORE
   taking the kitty.** The dealer must not see the kitty before choosing trump.
5. The dealer takes the kitty into hand (when a kitty exists).
6. The dealer discards the same number of cards (legal discards only).
7. Play begins — **the dealer leads (plays first) the first trick.** Turn order
   then proceeds clockwise (by seat). The winner of each trick leads the next.

Exact step order per mode (the trump suit is chosen *before* the kitty):

- **Trump:** deal → dealer sees hand → choose Trump mode → **choose trump suit**
  → take kitty → discard → dealer leads.
- **Non-Trump:** deal → dealer sees hand → choose mode → take kitty → discard →
  dealer leads.

The authoritative status order is therefore:
- Trump (3p): `mode_selection` → `select_trump` → `kitty_exchange` → `playing`.
- Trump (4p, no kitty): `mode_selection` → `select_trump` → `playing`.
- Non-Trump (3p): `mode_selection` → `kitty_exchange` → `playing`.
- Non-Trump (4p): `mode_selection` → `playing`.

The server is authoritative for this order online; clients only render the
screen for the current status.

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
  suit.
- **Trump forced-ruff:** in **Trump** mode, if a player cannot follow the led
  suit but holds a card of the trump suit, they **must** play a trump. If they
  hold neither the led suit nor a trump, they may play any card. (When the led
  suit *is* the trump suit, ordinary follow-suit already covers this. With "No
  Trump", there is no trump suit, so any card may be played when off-suit.)
- In non-Trump modes there is no trump, so a player who cannot follow suit may
  play any card.
- Trick winner:
  - if a trump exists and the trick contains trumps, the highest trump wins;
  - otherwise the highest card of the led suit wins.

## Trump

- Trump is a positive mode.
- The dealer chooses the trump suit **before taking the kitty** (so the kitty
  cards cannot influence the trump choice and stay hidden until trump is set).
- No Trump is allowed: the dealer may choose "No Trump" (then no forced-ruff).
- After choosing trump, the dealer takes the kitty and discards (when a kitty
  exists), then leads the first trick.
- Forced-ruff applies during play: see Trick Rules.

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

## Surrender (concede a round) — MVP

A player may concede the current round instead of playing it out.

- **Who/when:** only the **current actor**, only while `status === 'playing'`, and
  only in a **negative** mode. **Surrender is disabled in Trump** (the remaining-
  trick reward is ambiguous; revisit later).
- **Scoring (Variant A — no exploit):** the round ends immediately and every
  outstanding penalty is charged to the **surrendering** player, then scored
  normally:
  - **No Hearts / No Queens / No Jacks / King of Hearts:** all penalty cards of
    the mode still in play (in any hand + the current trick) are added to the
    surrendering player's collected pile.
  - **No Tricks / Last Two Tricks:** every remaining trick of the round is
    awarded to the surrendering player.
  - Already-collected cards / completed tricks keep their real owners.
- The round then goes to `round_scoring`; `Round.surrenderedBy` records who
  conceded, and the round is written to the score-tracker history for **all**
  players like any other round.
- **Online:** a client sends `SURRENDER_ROUND { playerId }`; the server only
  accepts it for the sender's own seat and only when it is their turn (the
  reducer re-checks). Bots never surrender.

## Turn Timer (online, optional)

The host may set a per-turn timer in the lobby: **Off / 30s / 60s / 90s**
(stored on the room). When on, it applies to every action a player owns —
CHOOSE_MODE, SELECT_TRUMP, EXCHANGE_KITTY, PLAY_CARD. If a player does not act
in time the **server auto-plays a safe move** for them using the same AI
heuristics, applied through the normal authorised reducer (so it is always a
legal move). The timer resets on every state transition and is cleared when the
room ends/cleans up. Off by default; local pass-and-play has no timer.

## Score Tracker

**One compact table** is shown on round scoring, at game end, and on demand
during play (a "Score table" button opens a modal).

- **Rows = players.** **Columns (in order):** No Tricks, No Hearts, No Jacks,
  No Queens, King of Hearts, Last Two Tricks, Trump 1, Trump 2, Trump 3, Total.
- A cell `[player P][game g]` lists **P's own score in EACH dealer's round of
  that game** — so every dealer plays every game, a 3-/4-player cell holds up to
  3/4 values. Each value is tagged with the **dealer's marker** (①..④). A legend
  maps marker → avatar + name.
- A small **dot** marks a cell on row P's column g when **P is the dealer who
  played that game** — so you can see which of their 9 games each player still
  owes (Trump dot lands in Trump 1/2/3 by how many trumps they've dealt).
- Every player's score for a round is recorded (not only the dealer's — the
  earlier dealer-only bug is fixed). Trump is split into 1/2/3 by the dealer's
  play order. Unplayed games are blank (`—`); the latest round is highlighted.
- **Total** (right) = the player's overall standing (`scores[p].total`).
- Works for 3 and 4 players; the table scrolls horizontally on mobile; headers
  and the legend are translated (EN/UK/DE/AR).

To make this possible the game keeps a **round history** in state — one record
per completed round: `{ roundNumber, dealerId, modeId, trumpOccurrence (1..3 for
Trump, else 0), scoreByPlayer }`. It holds only scores (no hands/cards), is part
of the authoritative state, and survives server persistence/restore. The pure
helper `buildScoreTracker(state)` derives the table from it. Early-ended rounds
are recorded exactly like full rounds.

## Tests Required For Rule Changes

- deck creation 32/52 without duplicates;
- dealing for 3/4 players;
- follow-suit rule;
- trump forced-ruff:
  - Trump mode, no led suit in hand + holds a trump → only trumps are valid;
  - no led suit + no trump → any card valid;
  - holds the led suit + holds a trump → led suit still forced;
  - non-Trump modes are unaffected (off-suit → any card);
- trump-before-kitty order:
  - Trump 3p: `mode_selection` → `select_trump` → `kitty_exchange` → `playing`;
  - the dealer's hand stays 10 cards (kitty not taken) until trump is chosen;
  - the kitty is never visible (to anyone) before trump is selected;
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
  - mode selection uses per-dealer counts, not a global shared pool;
- score tracker:
  - **all players'** scores land in the dealer's chosen mode column (not only
    the dealer's) — e.g. a Trump round records every player's score in that
    dealer's Trump slot;
  - three Trump games fill Trump 1 / 2 / 3 in play order;
  - unplayed cells are empty;
  - the grand total per player equals `scores[playerId].total`;
  - early-ended rounds are still recorded in the history;
  - the round history survives serialize/restore (server persistence).
- surrender:
  - conceding charges all remaining penalties to the surrendering player
    (per-card modes: uncollected penalty cards; per-trick modes: remaining
    tricks);
  - cannot surrender as another player (online auth) or out of turn;
  - surrender is rejected in Trump (MVP);
  - the surrendered round is recorded for all players in the score tracker.
