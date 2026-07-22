# Poker Rules — No-Limit Texas Hold'em (Card Majlis)

Source of truth for the 7th Card Majlis game: **Poker — No-Limit Texas Hold'em**
(game id `poker`, internal module `poker`). This document is authoritative; the pure
core (`src/games/poker/`) encodes exactly these rules. When a rule and the code
disagree, fix the code — not this file — unless the owner amends the rule here.

Stage: **37.4 (Unreleased)** — full platform feature-stage, no version bump/tag.

---

## §1 Format

- Cash-style **free-play match** (a.k.a. "last player standing tournament"): every
  player starts with an equal chip stack; the match ends when a single player holds
  **all** the chips. There is no re-buy.
- **Deck:** a standard **52-card** French deck, no jokers. Ranks `2…10, J, Q, K, A`;
  suits `spades, hearts, diamonds, clubs`. Suits are **never** used to rank hands or
  break ties (poker suits are equal); they only matter for flush/straight-flush
  composition.
- **Players:** **2–6** seats. Bots may fill any seat.
- **Starting stack:** **1000** chips per player.
- **Blinds (fixed for MVP):** small blind **10**, big blind **20**. **No ante.**
  Blinds do not escalate in the MVP.

## §2 Seating, button and blinds

- Seats are a fixed clockwise ring `0,1,…,n-1`. The **button** (dealer marker) starts
  at a chosen seat and moves **one occupied seat clockwise after every completed hand**.
- **3+ players:** small blind = first occupied seat clockwise of the button; big blind
  = next occupied seat clockwise; first to act **pre-flop** = seat clockwise of the big
  blind ("under the gun"); first to act on **every post-flop street** = first occupied
  seat clockwise of the button (i.e. the small blind, if still in the hand).
- **Heads-up (2 players):** the **button posts the small blind** and acts **first
  pre-flop**; the other player posts the big blind and acts **first post-flop**. (This
  is the standard heads-up reversal.)
- A blind is posted for the full amount, or for the player's entire stack if it is
  smaller (a short blind is an all-in for less).

## §3 The deal

- Each player is dealt **2 private hole cards**, face down (a "hole" per player).
- **Community cards** are dealt to the board across the streets: **flop = 3**, **turn
  = 1**, **river = 1** (5 total).
- Before the flop, the turn and the river, one **burn card** is dealt off the top and
  discarded face down. **Burn cards are server-private** — they never appear in any
  client payload, redacted view, spectator view or reconnect snapshot, and never
  become community cards.
- The remaining un-dealt deck order is **server-private** at all times.

## §4 Streets

Order of play in one hand:

1. **pre-flop** — hole cards dealt, blinds posted, a betting round.
2. **flop** — burn, 3 community cards, a betting round.
3. **turn** — burn, 1 community card, a betting round.
4. **river** — burn, 1 community card, a betting round.
5. **showdown** — remaining players reveal; best hand(s) win the pot(s).

A street's board cards are dealt only when the previous betting round has closed and
**two or more players remain live** (not folded) — see §6/§7.

## §5 Actions & betting (No-Limit)

Legal actions for the player to act, given the current bet to match:

- **fold** — surrender the hand; the player forfeits all chips already in the pot and
  can no longer win it.
- **check** — pass action with no wager; legal only when there is **no outstanding
  bet** to the player (their committed amount already equals the current bet).
- **call** — match the current bet. The call amount = `currentBet − player.committed`,
  capped at the player's remaining stack (a call for the whole stack is an all-in).
- **bet** — with no outstanding bet, wager a fresh amount. Minimum bet = the **big
  blind** (20); maximum = the player's whole stack (no-limit).
- **raise** — with an outstanding bet, increase it. The **minimum raise increment** =
  the size of the **last full bet or raise** on this street (initially the big blind).
  So the minimum total-to = `currentBet + lastRaiseSize`. Maximum = the whole stack.
  A raise for the entire stack that is **less than a full minimum raise** is allowed
  as an **all-in** but does **not** reopen the betting to players who have already
  acted (see §6).
- **all-in** — commit the entire remaining stack. Depending on amount it functions as
  a call (≤ current bet), a bet, or a raise; a below-min all-in raise is an
  "incomplete raise" and does not reopen action.

The **server validates** every action: turn ownership (only the acting seat may act),
the action's legality for the current bet, the exact call amount, the minimum raise,
and that no wager exceeds the player's stack. Client-supplied chip counts, bet sizes,
seat/player ids and cards are **never trusted** — the client sends only an action
request; the server decides the actor and the outcome.

## §6 Closing a betting round

- A betting round has a `currentBet` (highest committed amount) and a `lastRaiseSize`
  (min legal raise increment).
- Each live, non-all-in player must either match `currentBet` or fold. The round
  **closes** only when **every** live non-all-in player has acted **and** all their
  committed amounts are equal to `currentBet` (or they are all-in for less).
- A **raise (or full bet) re-opens** the action: every other live non-all-in player
  gets another turn. A below-minimum **all-in** does **not** re-open action for players
  who have already matched the previous bet (they may only call the extra or fold — in
  MVP a player facing only an incomplete raise they've already covered simply has the
  option to call the difference; the round still requires equal contribution).
- A player with a **zero stack after going all-in** takes no further actions but
  **remains eligible** for every pot to which they contributed, through showdown.
- When the round closes, committed chips are collected into the pot(s) (§8) and play
  moves to the next street — unless only one live player remains (§7).

## §7 Winning without showdown

- The instant all opponents fold and **only one non-folded player remains**, that
  player **immediately wins the entire pot** with **no showdown** and **no card
  reveal** — their hole cards stay private. Any remaining streets are **not** dealt.
- The match then proceeds to the next hand (button moves), unless the win leaves a
  single player holding all chips (match over, §11).

## §8 Pots and side pots

- All chips wagered on a hand form the **pot**. When players are all-in for different
  amounts, the pot splits into a **main pot** and one or more **side pots**:
  - Sort each contributor's total contribution. Each distinct all-in level defines a
    pot layer; every player who contributed **at least** that layer's amount is
    **eligible** for it.
  - The **main pot** is contested by all contributors up to the smallest all-in; each
    successive side pot is contested only by players who put in more.
- **Uncalled chips** (a bet or raise no one matched) are **returned** to the bettor and
  never form a pot.
- Side pots are **mandatory** whenever multiple all-ins at different amounts occur.

## §9 Showdown & hand ranking

At showdown, each eligible (non-folded) player forms the **best 5-card poker hand**
from their **2 hole cards + 5 community cards** (best 5 of 7). Categories, strongest
first:

1. **Royal flush** — `A K Q J 10` all one suit (the highest straight flush).
2. **Straight flush** — five consecutive ranks, one suit.
3. **Four of a kind** — four cards of one rank + a kicker.
4. **Full house** — three of one rank + a pair of another.
5. **Flush** — five cards of one suit (not consecutive).
6. **Straight** — five consecutive ranks, mixed suits.
7. **Three of a kind** — three of one rank + two kickers.
8. **Two pair** — two pairs + a kicker.
9. **One pair** — one pair + three kickers.
10. **High card** — none of the above; the five highest cards.

Ranking details:

- **Ace is both high and low for straights:** `A-2-3-4-5` (the "wheel") is the lowest
  straight (the 5 plays as the high card of that straight); `10-J-Q-K-A` is the
  highest. `Q-K-A-2-3` is **not** a straight (no wrap-around).
- **Tie comparison is complete and deterministic:** compare category first, then the
  ordered tie-break ranks (e.g. for two pair: higher pair, lower pair, kicker; for a
  flush: all five ranks in descending order). Two hands compare **equal** only when
  every tie-break rank matches — **suits never break ties**.
- A **board-only** best hand (both players "play the board") ties and **splits**.

## §10 Awarding pots

- Each pot is awarded to the eligible player(s) with the **best** 5-card hand among
  that pot's contestants.
- **Split pots:** when 2+ eligible players tie for a pot, its chips are divided **evenly**.
- **Odd chips:** if a split does not divide evenly, the leftover chip(s) go to the
  eligible tied winner(s) **first in clockwise order starting from the seat left of the
  button** (the standard "first eligible seat after the button" rule), one chip each.
- **Card reveal at showdown:** only the hole cards of **showdown-eligible** (non-folded)
  players are revealed to everyone. Players who folded during the hand keep their hole
  cards private forever. (An MVP simplification: all showdown-eligible players' hands
  are revealed; there is no muck.)

## §11 Match end

- After each hand, players with a **zero stack are eliminated** (they cannot post a
  blind next hand). The button advances over occupied seats only.
- The **match ends** when a single player holds **all** the chips in play. That player
  is the **match winner**; everyone else placed by elimination order.

## §12 Bots (fair, deterministic MVP)

- A bot decides **only** from information a human at that seat would legally have: its
  **own hole cards**, the **public board**, the **pot size**, the **stacks/bets**, and
  its own **legal actions**. A bot must **never** read the authoritative deck order,
  burn cards, or any opponent's hole cards.
- Strategy (heuristic, not a solver/GTO):
  - **Pre-flop:** hole-card **strength tiers** (premium pairs/broadway → raise; medium
    → call/limp; trash → check/fold to a bet).
  - **Post-flop:** evaluate the bot's current best hand and simple **draw awareness**
    (flush/straight draws) vs. the pot; choose fold / check / call / bet / raise / all-in.
  - Every bot wager is **always a legal amount** (respects min-bet, min-raise, stack).
- Bots are **seed-deterministic** in tests (same RNG seed + same state → same action).

## §13 Privacy (server-authoritative redaction)

Private, never leaked to any client: **hole cards** of other players, the **deck order**,
and **burn cards**. Per viewer:

- The viewer sees **their own** hole cards in full.
- Every **other** player's hole cards are face-down **placeholders** (count kept =
  always 2 until folded) until that player is revealed at showdown.
- **Folded** players' hole cards are **never** revealed.
- **Public** to everyone: community cards, pot/side-pot sizes, every stack, every
  player's committed bet, the action history, the button/blind positions, whose turn
  it is, and the revealed showdown hands of eligible players.
- A **spectator** (no seat) sees **no** private hand at all.
- **Server-only** state (deck order, burns, bot internals) is stripped from every
  payload; **room summaries** never carry private hand state; a **reconnect snapshot**
  is re-redacted for the reconnecting viewer's seat.

## §14 Local pass-and-play

- Before each private decision the UI shows a **handover screen**; the next player's
  hole cards are hidden until they confirm.
- After reveal, the acting player sees their own hole cards, stack, the call amount,
  the pot, the board and their legal actions.
- The bet/raise control is **mobile-safe** with **presets**: minimum, half-pot, pot,
  all-in. Illegal actions are disabled.
- The table layout stays **stable** across street changes and community-card count
  changes (no reflow jump).

## §15 Determinism & engine contract

- The pure core is **deterministic**: all randomness (shuffle/deal) comes from an
  **injected seeded RNG**; there is no `Date`, `Math.random`, I/O, DB, WebSocket, or
  React in the core.
- The **same reducer** drives local and server play.
- **Illegal actions** return the **same state reference** (the repo's rejection pattern),
  never a mutated or thrown state.
- Single-source helpers expose: the **acting player/seat**, the **call amount**, the
  **minimum raise**, and the **legal action set** — the UI and bots consume these and
  never re-derive the rules.
- **Chip conservation** is invariant: total chips across all stacks + the live pot(s)
  equals `starting_stack × player_count` at every point in a hand.

---

## §16 Chip wallet & economy (Stage 37.7)

Poker has a **server-authoritative chip economy** for online tables. It is DB-gated
(Postgres): with no `DATABASE_URL` there is no economy and **local free-play Poker is
unaffected** (local chips are a sandbox — the player picks a starting stack, nothing is
debited or credited).

**Wallet (implemented).** Every non-guest account has a chip wallet:

- **Balance** — a server-authoritative `BIGINT`, **never negative** (enforced in code
  and by a DB `CHECK`). Stored in `poker_wallets` (migration 0010).
- **Daily claim** — a signed-in player may claim **exactly 1,000,000 chips once per UTC
  calendar day**. Eligibility uses the **server** clock, so a client clock/timezone
  change cannot unlock an extra claim. The grant is **atomic and idempotent**: a
  concurrent double request yields exactly one grant; a repeat the same day returns the
  balance and next-eligibility without crediting again.
- **Ledger** — every balance change appends one immutable row to `poker_ledger`
  (`reason` ∈ `daily_claim | table_buy_in | table_payout | table_cancel_refund`, signed
  `delta`, `balance_after`, a `UNIQUE idempotency_key`, optional match/room refs). The
  unique key is what makes each logical operation idempotent (a replay no-ops).
- **API** — `GET /api/me/poker-wallet` (balance + eligibility) and
  `POST /api/me/poker-wallet/daily-claim` (grant), both non-guest-only. The Profile →
  account screen shows the balance and a **Get 1,000,000** button (or “claimed today /
  available tomorrow”).

### Local free-play (§16 C)

Local pass-and-play Poker is a **free sandbox** — it NEVER touches the wallet. The host
picks a **starting stack** (presets 1,000 / 5,000 / 10,000 / 50,000 / 100,000 / 1,000,000,
or a custom safe integer 1,000–10,000,000; default 1,000); every seat (human + bots)
starts with it; the blinds stay 10/20. Bots are allowed locally.

### Online bankroll tables (§16 B/D/E/F/G)

Online Poker is a **bankroll-only** game backed by the wallet — there is **no free online
table**. Hosting requires the chip economy (Postgres), a whitelisted stakes preset, and a
**signed-in non-guest** creator (all re-validated server-side; local pass-and-play stays free):

- **Stakes** — the host picks one of **8 approved presets** (blinds 25/50 … 3200/6400).
  The **buy-in is always 100 big blinds** (5,000 … 640,000) and is **derived
  server-side** from the whitelisted preset — a client never supplies a buy-in.
- **Blind growth** — the host may grow blinds every **N** completed hands (Off, or a safe
  integer 1–100; UI presets Off/3/5/10). Exact off-by-one: hands 1…N post the base
  blinds, hand **N+1** posts **×2**, hand **2N+1** posts **×4** (level = ⌊(hand−1)/N⌋,
  multiplier = 2^level, overflow-capped). The CURRENT blinds are authoritative on the
  state; reconnect/restore/rematch never advance the level; an aborted hand never counts.
- **Human-only** — a bankroll room is **authenticated-humans-only**: every seat needs a
  userId, no bots (ADD_BOT is refused), no duplicate account seat, ≥2 players to start.
- **Buy-in escrow** — at START_GAME the server mints an **economy match id** and debits
  the buy-in from **every** seat in **one atomic transaction** (all-or-nothing; if anyone
  is short, nobody is debited and the room does not start). Idempotent via
  `buyin:<matchId>:<userId>` — a duplicate START / reconnect / restart never double-debits.
  A **durable match record** (migration 0012) is written in the SAME transaction, so a crash
  between the debit commit and room persistence is recoverable: startup reconciliation refunds
  any committed match with no active table exactly once (chips are never lost).
- **Signed-in seats** — every bankroll PLAYER seat requires a resolved non-guest account,
  stamped atomically at join; one account may hold only one player seat; guests may spectate
  (they never receive private cards).
- **Payout** — at `game_finished` each seat's **final stack** is credited back
  (`payout:<matchId>:<userId>`). Total paid == escrow (chip conservation). Idempotent;
  a rebroadcast / reconnect / restart never double-pays.
- **Cancellation refund** — if a **funded** table is orphaned/torn down **before**
  finishing, each buy-in is refunded once (`refund:<matchId>:<userId>`). Payout and
  refund are **DB-authoritatively mutually exclusive** — a per-match settlement row
  (migration 0011) is claimed inside the same transaction as the wallet mutations, so a
  crash/restart can never make both mint chips. A room is deleted only after
  settlement/refund is confirmed (a DB failure keeps it for a retry). A restored transient
  escrow is **reconciled** against the durable ledger on restart, and every lifecycle op is
  **serialized per room** (a debit never races a leave/kick/settings/second-start).
- **Rematch** = a **new** economy match id + a fresh buy-in + fresh balance check.
- **No rake, no ante, no rebuy** (a busted seat is out; the match ends when one player
  holds all the chips).

### Showdown review (§16 G)

A CONTESTED showdown is reviewed for a **server-driven ~7 s** (a fold-win uses a shorter
~2.5 s pause), then the next hand is auto-dealt exactly once (online). The evaluator
exposes the **exact five winning cards** per pot; the review highlights them, names the
localized combination, dims non-winners, keeps folded hands hidden, shows side pots as
separate rows (tap to highlight that pot's five), and shows all tied winners on a split.
A fold-win reveals nothing and shows no combination.

## Appendix A — MVP simplifications (explicit)

These are intentional MVP scope cuts, safe to revisit later:

- No ante, no straddle. (Blinds ARE configurable + can escalate for online bankroll —
  see §16; local free-play uses fixed 10/20.)
- No muck at showdown — every showdown-eligible hand is revealed.
- Incomplete (below-min) all-in raises do not reopen action.
- No rake. No time-bank beyond the shared optional turn timer.
- Single table only (no multi-table tournament).

**Recovery states (§16, Stage 37.7.3).** On restart a bankroll match whose buy-ins were
refunded is terminally **cancelled** (the room returns to a clean lobby); a room whose durable
match record is itself corrupt is **frozen** (no gameplay, kept for operator review) — a
refunded match never continues as a free game, and a corrupt record is never partially settled.
