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
  **all** the chips. A player whose stack reaches 0 may **buy back in between hands** —
  see §17.
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

The handover screen is a **privacy step between two different humans**, not a per-turn
ritual (owner-confirmed, Stage 38.0.2). It is driven purely by SEAT — duplicate human
names are irrelevant.

**One human + bots (any of 1–5 bots).** There is nobody to hide from, so:

- **No handover screen is ever shown.**
- That human is the **stable local viewer**: their hole cards stay visible across every
  bot turn and between hands, with no re-confirmation.
- Bots' hole cards remain hidden as always.

**Two or more humans.** The confirmation **sticks to the seat that gave it** (the last
confirmed human seat is tracked separately from the currently redacted viewer):

- human A → bots → **A** — **no** repeat handover; A's view returns automatically after
  the bot interval.
- human A → bots → **B** — handover **required for B**; A's hand is already hidden.
- human A → **B** directly — handover required for B.
- While a **bot** acts, **no** human's hole cards are on screen.
- Between hands / on any public screen, no private hand is shown.
- The confirmed seat is cleared on **game start, restart/play-again and exit**, so a
  stale viewer never carries into a new match.

Common to both:

- After reveal, the acting player sees their own hole cards, stack, the call amount,
  the pot, the board and their legal actions.
- The bet/raise control is **mobile-safe** with **presets** (minimum, half-pot, pot,
  all-in), a **slider** and a **manual numeric field** — all three drive one amount.
  The field may be blank while editing, but every commit (blur, Enter, or the Bet/Raise
  button) is validated as a finite safe integer and clamped to `[raiseMin, maxTo]`;
  an unusable draft falls back to the last valid amount, so no illegal action is sent.
  Enter in the field performs the same action as the button; reaching `maxTo` is ALL-IN.
  Illegal actions are disabled.
- The table layout stays **stable** across street changes and community-card count
  changes (no reflow jump).
- The board, the pot and the street label own a reserved **centre safe zone** of the
  felt (Stage 38.0.3). No seat may place its pod inside that band, so a side seat can
  never sit on the community cards or the pot — at 4 players on a 360/390 phone it
  previously did, because the side seats shared the felt's vertical middle with a board
  that is wider than the space left beside them.
- The public **action history** is a compact control in the bottom-end cluster (see
  §16 I), never a block under the table.

## §17 Between-hands rebuy (Stage 38.0.3B)

Owner-confirmed: **once a stack hits 0 the seat may buy back in — between hands only.**

**When.** The moment a hand ends with at least one busted seat the match enters the
explicit phase **`rebuy_window`**. Nobody is eliminated and the match cannot finish while
it is open; the showdown / fold-win review stays on screen underneath the panel.

**Amount.** Exactly **one starting stack** — locally the stack chosen in the setup, online
the table's buy-in. The amount is derived by the pure reducer from
`options.startingStack`; no action, caller or client ever supplies it.

**Local play.** Free. The device owner decides for **every** busted seat — human *or*
bot — and an explicit **Continue** closes the window. No wallet, network or DB is touched.

**Online bankroll play.** A real debit of `room.pokerBuyIn` from the player's own chip
wallet, allowed only for their **own** authenticated zero-stack seat and only when the
balance covers it. The window is **server-authoritative and lasts 20 seconds**: an
absolute deadline is minted once per (match, hand), so a reload, reconnect or restart can
never extend it; it closes early once every eligible seat has answered; an unanswered seat
counts as a decline; and an in-flight debit always blocks the close. The client sends an
EMPTY intent — the server derives the room, account, seat, match, hand and amount itself.
Each debit is one immutable `table_rebuy` ledger row keyed
`rebuy:<matchId>:<handNumber>:<userId>`, so a double tap, a replay or a reconnect can only
ever charge once. A crash between the debit and the state update is reconciled exactly
once from that row; anything that cannot be reconciled freezes the table for an operator
rather than minting or dropping chips.

**Never allowed:** a top-up while the stack is above 0; a rebuy during betting; a second
rebuy for the same seat in the same window; after a decline or the deadline; for another
player's seat; in a frozen / settlement- / payout- / stats-pending room; or after the
match's terminal payout or refund.

**Closing.** Seats that bought back in continue; every seat that declined *or* never
answered is eliminated then. Only after the close does the button move, the next hand
deal (≥2 active seats) or the match finish (1 active seat).

**Chip conservation** becomes `initial chips + every confirmed rebuy = stacks + committed
+ pots`. A rebuy is the only way chips enter a match after the deal. Online this extends to
the money: a match's **funded total** is its initial buy-ins plus every validated rebuy, so
a payout credits exactly that total and a cancellation refunds each account its buy-in plus
its own rebuys. A rebuy never mints a new match id — a rematch still does.

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
  `POST /api/me/poker-wallet/daily-claim` (grant), both non-guest-only.
- **Where it lives (Stage 38.0.2)** — the balance and the **Get 1,000,000** button are
  in the **Poker host flow of the start menu**, directly above the stakes picker (they
  were on the Profile screen until Stage 37.7, where players could not find them). The
  menu owns ONE wallet store shared by the wallet card and the stakes picker, so a
  successful claim updates the balance **and** the buy-in affordability immediately —
  no reload, and never two copies of the balance that can disagree. States shown:
  balance, claim button when the SERVER reports `canClaimToday`, “claimed today /
  available tomorrow”, loading, error + retry, a sign-in hint for a signed-out or guest
  visitor, and “economy unavailable” **only** for a real `503` from the wallet API.

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
- **Paid state is recovered fail-closed** (Stage 37.7.11). After a restart the server
  classifies every restored bankroll table BEFORE arming any timer, bot step or advance —
  no bankroll table resumes ahead of that decision. A table whose payout is durably
  **settled** but whose saved state is **not finished** is an **incoherent paid state**
  (the money is out; the authoritative final state was lost): it is **frozen for operator
  review** — never resumed, never re-paid, never refunded, never deleted, and publicly
  visible only as the opaque `frozen` recovery status. It is NOT a cancelled match (nothing
  was refunded).
- **One strict participant check guards both payout and stats** (Stage 37.7.11). The paid
  match's escrow (match id, seat → account, buy-in per seat) must correspond EXACTLY to the
  finished state: 2–6 seats, safe in-range seat indices, no duplicate seat, no duplicate
  account, every amount == the buy-in, the escrow seat set == the state's player seat set,
  **no bot seat**, and any declared winner among the participants. This runs before any
  wallet mutation AND before any stats row — including for an already-`settled` escrow, so a
  malformed restored match can never write a partial attribution. A structural failure is
  **permanent** (`invalid` → frozen, no stats, no retry), distinct from a **transient** DB
  failure (retried) and from a **duplicate** durable row (resolved).
- **The chips follow the hand that was actually dealt** (Stage 37.7.12). A paid rematch
  debits its buy-ins BEFORE the new hand exists, so a crash can persist the **new** escrow
  next to the **previous** match's finished state. Every table therefore records durably
  **which match produced its current game state** (a server-only `pokerGameMatchId`, set
  only after a successful debit AND a successful start/restart, cleared with the state,
  persisted in the room JSON, never in any public snapshot/summary/message and never
  logged). **Every economy path — payout, stats, payout-pending, bootstrap classification,
  teardown and the orphan-scan's "active match" set — requires
  `pokerGameMatchId === pokerEscrow.matchId`.** A per-room lock does not replace this: the
  lock serializes work inside one process, the binding survives the crash boundary.
  - **Unbound live escrow** (a fresh buy-in whose hand never started, restored beside an
    older state) → the stale state is dropped and the buy-in is **refunded idempotently**;
    payout = 0 and stats/game rows = 0 for that match. A confirmed refund leaves an honest
    **cancelled** lobby (a new match can be started there); a transient refund failure
    leaves **settlement-pending**, which keeps being retried and blocks deletion. No timer,
    action or rematch runs meanwhile.
  - **Unbound settled escrow** (paid, but the state belongs to another generation) →
    **frozen**, exactly like an incoherent paid state.
  - **No binding at all** (a legacy save) → **frozen for operator review**; the generation
    is never guessed, and no payout/refund/stats is written against an unproven state.
    **Correction (Stage 37.7.13):** as originally shipped this guarantee did NOT hold in
    production — the startup orphan-debit sweep ran BEFORE classification, so such a room's
    buy-ins were refunded before it was frozen. Fixed by the startup ordering below.
- **Startup settles only what classification has proven** (Stage 37.7.13). The boot sequence
  is **reconcile → classify → derive settlement protection from those classifications →
  orphan-debit scan → corrupt-room pass → apply recovery**. The protected set is no longer a
  room *shape* test computed before any classification: every match that is live, frozen, or
  whose durable outcome is UNPROVEN is protected from the global scan — including a room with
  no game state whose reconciliation failed. Only an explicitly stale generation (a fresh debit
  whose hand never started) is treated as an orphan and refunded exactly once.
- **A transient escrow is never assumed to be uncharged** (Stage 37.7.13). Reconciliation
  reports an EXPLICIT outcome — `funded`, `settled`, `cancelled`, `proven_uncommitted`,
  `retry_pending`, `corrupt_partial`, `noop` — instead of leaving callers to infer it from the
  escrow status. `cancelled` now requires durable proof: a committed refund row, or a
  reconciliation that PROVED zero committed buy-ins. A `pending`/`settling` escrow that
  SURVIVES reconciliation is **`recovery_pending`**: the room keeps its state, binding and
  escrow, does not advance, arms no timer, accepts no action, cannot rematch, is never purged,
  and is publicly the opaque `settlement_pending` status. It is retried on the next
  sweep/restart — then zero debit → cancelled, a full bound debit → live/finish, a full but
  unbound debit → refunded once. A **partial** durable debit (only some seats charged) can be
  settled neither way and is **frozen** for operator review.
  **Correction (Stage 37.7.14):** as shipped, that retry never happened — the periodic sweep
  did not reconcile an unresolved escrow at all, so such a table stayed blocked until the
  process restarted. Fixed by the runtime sweep below.
- **The runtime sweep reconciles, and reconciliation has PRECEDENCE** (Stage 37.7.14). The
  periodic settlement sweep now handles an unresolved (`pending`/`settling`) escrow FIRST,
  under the room lock, through the SAME classify/apply policy as bootstrap: reconcile →
  classify → apply. Only after a proven outcome may anything else run — `live` re-arms the
  advance exactly once, a paid finish finalizes stats, a proven-uncommitted debit becomes a
  clean cancelled lobby, a proven funded **unbound** debit is refunded once, an unproven one
  stays inert, and a partial/corrupt one freezes. Nothing is refunded, paid, recorded, purged
  — and NO game state or generation binding is dropped — while the outcome is unknown. In
  particular `unboundEscrowGame` and `payoutPending` now require a **funded** escrow, so an
  unresolved table can never be routed into the refund/payout paths first.
- **A committed settlement outranks the room's transient status** (Stage 37.7.14). When
  reconciling ANY transient escrow, a durable `payout` settlement row → `settled` and a
  durable `cancel_refund` row → `cancelled`, whatever the saved room JSON says. Only with no
  settlement row does the buy-in ledger decide (full → `funded`, zero → `proven_uncommitted`,
  partial → `corrupt_partial`; a `settling` escrow with no row → retryable `funded`). This
  closes a crash window where a `pending` escrow with a committed payout was promoted to
  `funded`, letting an already-PAID match resume as `live` and bypass the §16 `settled` +
  unfinished → frozen invariant.
- **A corrupt DURABLE match freezes its room** (Stage 37.7.14). The startup scan now reports
  which rooms own a malformed `poker_matches` record, and those rooms are **frozen before the
  recovery apply pass** — even when the persisted room escrow itself is structurally valid
  (so the older `pokerEscrowCorrupt` flag does not catch them). Such a table is never
  classified or applied as `live`: no advance, no timer, no actions, no rematch, no refund, no
  payout, no stats and no purge; state, binding, escrow and the durable evidence are all kept.
  Players see only the opaque `frozen` status; the operator log carries the room code and a
  safe reason and is written exactly once.
  **Corrections (Stage 37.7.15):** as shipped, that association was by ROOM CODE, so a stale
  corrupt record could freeze a healthy table that reused a dead room's 4-char code; and the
  "never a matchId" logging claim did not match the actual `console` output.
- **EXACT durable ownership before a table may resume** (Stage 37.7.15). A restored bankroll
  room becomes `live` / `payout_pending` / `paid_finish` only once the durable evidence PROVES
  it owns its escrow: the `poker_matches` row exists for `escrow.matchId`, passes the strict
  parse, and its `roomCode` / `buyIn` / canonical `seat→user→amount` set equal the escrow's;
  and the buy-in ledger holds **exactly one** `table_buy_in` row per participant with the right
  `delta`, `matchId`, `roomCode` and idempotency key, and no extra rows. A row COUNT is never
  proof — swapping one seat's debit for another account's kept the count intact. Outcomes are
  explicit: `exact_funded`, `proven_uncommitted`, `settled_payout`, `settled_refund`,
  `missing_durable`, `corrupt_durable`, `metadata_mismatch`, `ledger_partial`,
  `ledger_mismatch`, `retry_pending`. Every permanent structural failure shares ONE fail-closed
  classification (frozen: no advance/timer/action/rematch, no refund/payout/stats/purge, state +
  binding + escrow + durable evidence all kept, idempotent across boots, public status `frozen`).
  A transient DB failure is `retry_pending` — never corruption.
- **Corruption is associated by matchId** (Stage 37.7.15). A corrupt durable record freezes a
  restored room only when its `matchId` equals `room.pokerEscrow.matchId`; the record's
  `roomCode` is audit context only. (`pokerEscrowCorrupt` — a malformed persisted room JSON,
  where the current matchId cannot be proven at all — keeps its separate roomCode-based
  fail-closed refund/freeze path.)
- **Secret-free economy logs** (Stage 37.7.15). No poker economy/recovery log line may contain a
  raw matchId, a userId, escrow seats, balances, cards or private state. Room codes, bounded
  reason text and counts are allowed; internal reports keep the ids for orchestration only.
- **The financial and structural axes are INDEPENDENT** (Stage 37.7.16). A committed settlement
  row proves ONLY what happened to the chips (`payout` / `cancel_refund`); it proves nothing
  about WHOSE match it was. Ownership validation therefore reports both:
  `financial ∈ {unresolved, payout, cancel_refund}` and `structure ∈ {exact, proven_uncommitted,
  missing, corrupt, metadata_mismatch, ledger_partial, ledger_mismatch}`. **Both must hold.**
  `exact` + payout → `paid_finish` (or `incoherent_paid` by state/binding); `exact` + refund →
  `cancelled`; ANY non-exact structure → permanent frozen, whatever the settlement says: the
  payout is never repeated, no refund is issued, **no stats are written** and no state, binding
  or escrow is cleared. **Correction:** Stage 37.7.15 checked the settlement row FIRST and
  returned, so a settled match with missing/mismatched evidence became a healthy `paid_finish`
  whose stats were attributed from the room escrow alone.
- **A terminal status in room JSON is a CLAIM, not proof** (Stage 37.7.16). Bootstrap validates
  EVERY restored bankroll room that claims an economy match — an escrow of ANY status (terminal
  included), a carried game state, a generation binding, or owed stats — not only "unsettled"
  ones. A `settled`/`cancelled` escrow the DB does not confirm is `terminal_unconfirmed`; one
  the DB contradicts is `terminal_conflict`; both freeze. Such a room is also settlement-PROTECTED
  from the orphan scan, so it can never be refunded moments before it is frozen.
- **Settlement-time atomic ownership guard** (Stage 37.7.16). A FRESH payout or refund proves
  exact durable ownership **inside the same transaction** that claims the settlement row and
  moves the wallets: the `poker_matches` row is locked `FOR UPDATE`, the buy-in ledger is read
  from that same snapshot, and the settlement gate is claimed only after the evidence is exact.
  A preflight `SELECT` would be TOCTOU. A structural failure rolls the whole transaction back —
  no settlement row, no chip movement — and is a PERMANENT operator condition (payout `invalid`,
  refund `invalid` → the table is frozen, never retried, never purged). A replayed
  `already_paid` must satisfy the same proof before stats may be recorded. A transient DB
  failure remains `retry_pending`.
- **One consistent evidence snapshot** (Stage 37.7.16). The durable row, the buy-in ledger and
  the settlement row are read in ONE `REPEATABLE READ` transaction, so an atomic debit
  committing mid-read can never be observed half-written (which previously produced a false
  `missing_durable` freeze for a perfectly healthy match).
- **ONE guarded settlement contract for every fresh payout/refund** (Stage 37.7.17). Room
  payout, room refund, the GLOBAL orphan refund and corrupt-room recovery all go through
  `settleMatchWithOwnershipTx`; the unguarded gate no longer exists. A `poker_matches` row that
  merely PARSES is only the EXPECTED metadata — the guard re-locks it and requires the
  `table_buy_in` ledger to back it exactly. The orphan scan reports three outcomes separately:
  `refunded`, `corrupt` (+ internal `corruptRefs`, operator-owned, never settled) and
  `retryable` (transient — nothing was proven, the next boot retries). **Correction:** as
  shipped, Stage 37.7.16 left the orphan/corrupt-room paths on the old unguarded gate, so a
  parse-valid record with a missing/partial/wrong-account ledger was refunded to every listed
  seat — minting chips for a user who was never debited.
- **A missing escrow is NOT proof of a refund** (Stage 37.7.17). A bankroll room that still
  claims a match — a carried game state, a generation binding (`pokerGameMatchId`), or owed
  stats — while holding NO escrow is resolved from the durable record for that binding (the
  match id is server-only: never logged, never public). Outcomes: durable `cancel_refund` or a
  provably uncommitted debit → **cancelled**; durable `payout` → **frozen** (the money is out
  but the seat→account mapping cannot be rebuilt, so no stats may be attributed and no evidence
  cleared); a corrupt/missing/mismatched/partial record → **frozen**; an exact but UNSETTLED
  record → **inert and retryable**, and it becomes a clean lobby ONLY once a refund for that
  exact match id is CONFIRMED in the same boot; no binding at all → **frozen**. Such a room
  blocks START/ACTION/timer/advance/rematch/purge and is publicly the opaque
  `settlement_pending`. **Correction:** Stage 37.7.16 classified every escrowless room
  `cancelled` unconditionally, wiping its state and binding regardless of what the scan did.
- **A terminal escrow status is never self-proof** (Stage 37.7.17). The refund path's
  `settled`/`cancelled` fast path now re-checks the claim through the shared evidence resolver,
  so a teardown cannot purge a table whose settlement the DB never recorded (or recorded the
  other way). Unproven → frozen; transient → keep and retry.
- **Every settlement names its DURABLE FINANCIAL OUTCOME** (Stage 37.7.18). `RefundResult` is
  `confirmed_refund | already_paid | nothing_to_refund | retry_pending | invalid`; the orphan
  scan reports `refunded`, `alreadyPaid`, `corrupt`(+`corruptRefs`) and `retryable` separately.
  ONLY `confirmed_refund` may set `pokerMatchCancelled`, clear a game state/binding as refunded,
  purge a table as cancelled, or free it for a new paid match. A `SettlementConflictError` whose
  resolved outcome is `payout` is **`already_paid`** — the caller freezes (an incoherent paid
  table with no game) instead of cancelling. **Correction:** Stage 37.7.17 collapsed both into
  one `resolved`, so a payout that won the race entered the scan's `refunded` list.
- **A corrupt persisted escrow is never recovered by room code** (Stage 37.7.18). A malformed
  room JSON carries no trustworthy matchId, and a 4-char code is reused, so `reconcileCorruptRoom`
  no longer refunds matches that merely share the code: if ANY unsettled durable match names it,
  the room is frozen for operator review and every record/settlement/wallet is left untouched
  (the flag clears only when nothing durable references the code). Those codes are additionally
  fail-closed **protected** from the global scan, which now accepts `protectedRoomCodes` as well
  as `protectedMatchIds`.
- **Runtime orphan recovery — no restart required** (Stage 37.7.18). `runRuntimeEconomyRecovery`
  runs the guarded global scan and the escrowless-claim resolution on the normal cleanup
  interval, SINGLE-FLIGHT (never two passes, never concurrent with bootstrap). It classifies
  every bankroll room for PROTECTION only and applies nothing to a healthy live/payout/stats
  table, so no timer or advance is re-armed on a tick. A roomless orphan left by a transient
  failure is refunded on the next pass; an `escrowless_unresolved` claim becomes a clean lobby
  only when a refund for that exact matchId is confirmed in the same pass.
- **ONE refund-outcome policy for every lifecycle caller** (Stage 37.7.19). `applyRefundOutcome`
  maps a `RefundResult` to a `RefundDisposition`: `confirmed_refund` (and `nothing_to_refund`
  where no escrow was expected) → **cancelled**; `retry_pending` → **settlement_pending**;
  `already_paid` / `invalid` → **frozen** (timers cleared, evidence kept, never cancelled, never
  purged, never a new debit or rematch — `debitRematch` now refuses a frozen table too).
  `runBankrollRematch` gained a **`paid_conflict`** outcome and keeps its state + binding in that
  case. **Correction:** Stage 37.7.18 claimed every production caller distinguished the outcomes;
  the failed-start, seat-divergence, rematch and runtime-unbound paths still collapsed them into a
  boolean, so `already_paid` was answered as a transient pending while the escrow had already moved
  to `settled` — the table unblocked and a later START could debit again.
- **A terminal escrow is re-proved before its generation is replaced** (Stage 37.7.19). Both
  `debitFreshStart` and `debitRematch` call `resolveEscrowEvidence` before clearing a
  `settled`/`cancelled` escrow: the durable outcome must MATCH the claim (`cancelled` ⇒
  `cancel_refund`, `settled` ⇒ `payout`), the evidence must be structurally exact, and for a paid
  escrow the previous lifecycle must be complete (no owed stats; any carried state still BOUND).
  Otherwise: transient → retryable, everything else → `paidConflict` (frozen, no `poker_matches`
  row, no new buy-in). A terminal status in room JSON was already a claim (§16, 37.7.16) — the
  runtime START/rematch transitions are now held to it as well.
- **Durable debits and global settlement scans are serialized** (Stage 37.7.19). Every
  `performDebit` transaction and every global orphan scan runs through one FIFO
  **`withEconomyBarrier`**, and the scan REBUILDS its protection set inside that barrier (any
  escrow already marked `pending`/`settling` is fail-closed protected). Without it the scan could
  build protection, a START could commit a brand-new durable match, and the scan would refund a
  LIVE table's buy-ins while the room stayed funded and playing.
  **LOCK ORDER (never inverted): `withRoomLock(code)` → `withEconomyBarrier`.** A debit already
  holds its room lock and then takes the barrier; a scan takes ONLY the barrier and never acquires
  a room lock while holding it, so no cycle exists. Failed-start refunds stay in the per-room
  settlement sweep, never the global scan.
  **DEPLOYMENT INVARIANT:** this is an IN-PROCESS mutex and is correct only for the deployed
  topology — a SINGLE authoritative Node instance (see the single-instance limit in
  `ONLINE_ARCHITECTURE.md`). It is NOT cluster-wide; horizontal multi-instance would require a
  DB-authoritative lease or an equivalent durable active-match proof.
- **The fresh-debit transition is REVERSIBLE** (Stage 37.7.20). `performDebit` snapshots the
  previous escrow (a deep copy) before replacing it and restores it VERBATIM whenever the
  transaction does not commit — insufficient chips, a transient DB error, or no economy. A
  refused rematch therefore leaves the finished paid table untouched (escrow, finished state and
  generation binding all intact), never an escrowless claim that recovery would freeze, and a
  retry after a top-up mints exactly one new match. An initial START rolls back to a clean lobby;
  a START after a confirmed refund restores that exact cancelled escrow.
  **Correction:** Stage 37.7.19 cleared the terminal escrow up-front, so a rolled-back debit
  destroyed it.
- **The global scan owns ONLY roomless orphans** (Stage 37.7.20). Inside the economy barrier the
  scan re-reads the LIVE room registry (`currentRooms()`, not the array captured before the
  barrier) and protects EVERY match any room still claims — whatever its escrow status
  (`pending`, `funded`, `settling`, terminal, unbound, failed-start) — plus every corrupt room's
  code. Funded / unbound / failed-start matches are settled by their own per-room lifecycle
  (`settlementPending` sweep, `resolveUnboundEscrowGame`, teardown/bootstrap apply).
  **Correction:** Stage 37.7.19 only fail-closed protected `pending`/`settling` escrows from a
  stale snapshot, so a match whose debit had committed but whose `startGame`/`bindGameToEscrow`
  had not run — and any room created after the snapshot — could be refunded while going live.
- **A PAID escrow with NO finished bound state is INCOHERENT, never reusable** (Stage 37.7.20).
  `debitFreshStart` refuses a `settled` escrow outright (a clean lobby may only follow an exact
  durable `cancel_refund`); `debitRematch` requires a FINISHED state still BOUND to it, no owed
  stats and an exact durable payout. Bootstrap classifies `settled` + no state as
  `incoherent_paid` (frozen) instead of `not_bankroll`, and teardown routes EVERY economy claim
  (escrow of any status, binding, owed stats, corrupt escrow, carried state) through the
  all-status `resolveEscrowEvidence`: a terminal claim the DB does not confirm — or a paid one
  with no finished state — is frozen and KEPT, never purged; only an exact durable
  `cancel_refund` with no state may be purged.
  **Correction:** Stage 37.7.19's terminal proof only inspected a state that was present, and the
  synchronous teardown fast path purged terminal rooms with no proof at all.
- **A payable finished state must be provably final** (Stage 37.7.12). On top of the
  participant check, every economy finish path requires: `phase === 'game_finished'`,
  `stacksBySeat.length` **exactly** equal to `playerCount`, every seat explicitly `human`
  with a unique non-empty player id, exactly one `winnerSeat` that is a participant, the
  winner holding the **whole conserved escrow** (Σ buy-ins), and every other seat holding
  exactly `0`. A failure is `invalid` → nothing paid, nothing recorded, room frozen.
  Live-gameplay validation is unaffected: the participant/binding check and the
  finished-paid-state check are separate layers.
- **No rake, no ante, no rebuy** (a busted seat is out; the match ends when one player
  holds all the chips).

### Showdown review (§16 G)

A CONTESTED showdown is reviewed for a **server-driven ~7 s** (a fold-win uses a shorter
~2.5 s pause), then the next hand is auto-dealt exactly once (online). The evaluator
exposes the **exact five winning cards** per pot; the review highlights them, names the
localized combination, dims non-winners, keeps folded hands hidden, shows side pots as
separate rows (tap to highlight that pot's five), and shows all tied winners on a split.
A fold-win reveals nothing and shows no combination.

### Action history (§16 I)

The public action history is a **compact control**, never a block under the table
(Stage 38.0.2). There is **exactly one** control and **one** panel per table:

- **Online** — the button sits inside the RoomSocial control cluster next to
  chat/emoji/voice/timer, supplied through RoomSocial's game-agnostic `utilitySlot`
  (no poker dependency lives inside RoomSocial).
- **Local** — the same component in the same in-flow cluster.
- **The cluster is DOCKED, never floating** (Stage 38.0.3). Poker's action controls sit
  at the bottom of the screen, so a fixed corner cluster lands on top of them on a
  phone — measured at 208×74 px over the action row, covering Call/Check, the amount
  field, the presets and the slider. Poker therefore renders the whole social cluster
  as a compact horizontal toolbar in NORMAL FLOW between the table and the action row,
  and an open panel (history / chat / reactions) is a normal-flow sibling under it, so
  it pushes the controls down instead of covering them. Exactly ONE panel is open at a
  time. The toolbar row itself may scroll horizontally; the page never does.
- **Default closed.** A new action while closed shows an **unread dot**; opening the
  panel clears it. At most the **last 30** entries are listed.
- The panel is anchored to its button, scrolls internally, and never covers the cards
  or the action controls or overflows a 360/390 viewport; it is RTL-safe.
- **Public only**: seat name, action and amount. A log entry structurally cannot carry
  hole cards, the deck, burn cards, user ids, tokens or any escrow/economy data.

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

**Settlement-pending + rematch (§16, Stage 37.7.6).** A third, *transient* recovery state sits
between funded and cancelled: if a failed start/rematch tries to refund the buy-ins but the refund
**cannot be confirmed** (a transient DB failure), the escrow stays **funded** and the table is
**settlement-pending** — publicly shown as *“the previous match is still settling; this table is
temporarily unavailable”* (derived as *bankroll room + funded escrow + no game state*; no economy
data leaked). Gameplay, START, actions and rematch are all refused while pending; a background sweep
retries the refund and, only once it is **confirmed**, flips the table to a clean cancelled lobby
that a fresh paid match can start from. A funded escrow that reaches START from a clean lobby is an
**orphan** and is refunded first (or the start fails closed) — it is never reused as a “fresh” match.
The recovery table UI is **read-only** in the frozen and settlement-pending states (no betting or
next-hand controls). **Rematch** on the finish screen starts a brand-new **paid** match (a fresh
matchId, one new debit) via the shared ready-up control — and only after the previous match has
settled; it is suppressed entirely while the table is in any recovery state.

**Payout-pending (§16, Stage 37.7.7).** Symmetric to settlement-pending, but for the *finished*
table: if the end-of-match **payout** cannot be confirmed (a transient DB failure), the escrow stays
**funded** and the finished table is **payout-pending** — publicly shown as *“the finished match is
still paying out; a rematch will be available once the payout is confirmed”* (derived as *bankroll
room + funded/settling escrow + a FINISHED game*; no economy data leaked). A background sweep retries
the payout with the authoritative final hand and pays out **exactly once**; the table is read-only and
**rematch is blocked** until the payout settles. Three states are kept distinct so cleanup never
mis-settles: a **live** match (funded + UNFINISHED game, never touched), a **refund/failed-start
pending** table (funded + NO game → retry the refund), and a **payout-pending** table (funded/settling
+ FINISHED game → retry the payout). If the settlement gate reports a finished match was already
**refunded**, it is turned into an honest cancelled table and never paid or continued as a paid game.
A **rematch** is a brand-new paid match only after the previous payout is confirmed; while any recovery
is pending the rematch is refused with an honest banner, never a silent readiness reset.

**Settlement-before-stats + permanent invalid freeze (§16, Stage 37.7.8).** A bankroll match's
**stats / rating / achievements are recorded ONLY after a confirmed payout** (`paid`/`already_paid`) —
payout and stats run as one serialized flow (never in parallel, never before). A **transient** payout
failure (`retry_pending`) defers the stats: the settlement sweep records them after it finally pays
out, so stats can never precede a payout that later proves refunded. An **already-refunded** finished
match records no stats and becomes a cancelled table. An **invalid** payout — an *impossible*
conservation / structurally-broken escrow, a **permanent fail-closed operator condition** rather than a
transient DB error — no longer loops the sweep forever: the table is **permanently frozen** for operator
review. A frozen table blocks start / action / rematch, exposes only the public *frozen* recovery status
(never stacks / matchId / userId / escrow / corruption detail), logs the room code + a safe reason once,
and stays frozen across serialize/restore. It is never auto-paid, auto-refunded, or purged.

**Stable stats identity + stats-pending + queued-rematch consent (§16, Stage 37.7.9).** A bankroll
match's durable stats identity is its **stable unique escrow match id** (stored only as a
`poker|<matchId>` hash — the raw id never reaches a snapshot/log), so two consecutive paid matches in
the SAME room that finish with an identical result are still recorded as two distinct games (a
content-only key would have collided and dropped the second). If a payout **confirms** but its stats
write then fails transiently, the finish becomes **stats-pending**: the money is already out (so it is
never re-paid, and it is *not* payout-pending), the finished state + match id are kept, a new paid
rematch is blocked, the public recovery status is a safe *stats_pending*, the state survives a restart,
and the background sweep retries the stats write until it records **exactly once** — then the flag
clears and rematch is re-enabled. Finally, a rematch that all humans readied for but which had to wait
behind a busy room lock is **re-validated under the lock** before it starts: the game must still be
finished, the room must not have become recovery-blocked, and every required human must still be ready —
so a **decline / disconnect / recovery change** that lands while the rematch is queued cancels it (an
honest readiness/recovery broadcast is sent) instead of starting a match and debiting new buy-ins.

**Paid-finish recovery + teardown (§16, Stage 37.7.10).** On a restart, a restored bankroll table that
still carries a game state is classified against the durable settlement (after reconciliation): a LIVE
match, a payout still owed (**payout-pending**), a **PAID finish** (a settled escrow + a finished game →
keep the result and finalize its stats), a **refund** (cancelled escrow → clean lobby, no stats), or a
**frozen** table. A settled/paid finish is never mistaken for a refund, and the payout is never re-run —
only the (idempotent) stats write is completed, exactly once. Room **teardown** (all players left / TTL
expiry) uses the *same* settle→stats lifecycle: a finished paid table records its owed stats before the
room is deleted, a transient stats failure keeps the table for a later retry, and the payout is never
repeated. A finished paid match's stats are attributed from the **immutable participant snapshot**
captured at buy-in (the persisted escrow seats: seat → authenticated userId), never the current
connected membership — so a valid match is still recorded after its players have left, and a
malformed/absent participant snapshot is retried, never silently skipped. The finished screen never
briefly shows "rematch available" between a confirmed payout and its results being finalized.

## Poker is OUT of scope for the permanent "Quit for good" exit (Stage 38.0.5)

The six other online games gained an irreversible active-game forfeit (a durable technical
loss + an AI takeover of the same seat). **Poker deliberately does not have it**, online or
local: a Poker seat holds real chips under escrow, so abandoning one mid-hand is an economy
question (payout / refund / conservation / recovery), not a seat question. The server
refuses `LEAVE_GAME_PERMANENTLY` for any Poker room and the client renders no control for
it. Poker's existing exits are unchanged: the lobby leave, the reconnectable Back to menu,
and the escrow settlement/teardown paths of §16.

## 18. Anti-dumping economy policy (Stage 38.0.8)

**This section changes NO card rule.** Dealing, betting, hand ranking, showdown, blinds,
the button and the between-hands rebuy mechanic (§17) are exactly as specified above. This
is ONLINE BANKROLL ECONOMY POLICY only.

**It is a mitigation, not a guarantee.** Because a cash game pays the FINAL STACKS into
permanent wallets, a deliberate loss cannot be reliably distinguished from weak play. The
policy makes deliberate transfer slow and stops repeated arranged matches from feeding the
leaderboard. It does not make collusion impossible, and it never claims to.

### 18.1 Scope

| | |
| --- | --- |
| Applies to | ONLINE **bankroll** Poker only |
| Never applies to | **LOCAL free Poker** (no wallet, no escrow, **unlimited rebuys**) |
| Never applies to | the other six games |
| Never writes to | `online_matches` (that model is for the six non-Poker games) |

### 18.2 The three rules

1. **Rebuy cap — `MAX_BANKROLL_REBUYS_PER_SEAT = 2`.** Each seat may buy back in at most
   twice per `matchId`. The third attempt is refused BEFORE any wallet debit. The
   authoritative count is the committed `table_rebuy` ledger rows, read inside the same
   transaction that would add one — so an insufficient/transient/rolled-back attempt costs
   no allowance, a duplicate replay adds nothing, and two concurrent requests for the last
   allowance produce exactly one debit. The cap lives in the ONLINE-bankroll config and the
   server, **never** in the shared pure engine.
2. **Pair cooldown — `BANKROLL_PAIR_COOLDOWN_MS = 15 minutes`.** No new PAID match may start
   while any two of its players settled a `payout` together less than 15 minutes ago.
   Identity is the pair of account ids from `poker_matches.seats` — never a room code — so a
   brand-new room does not bypass it, and seat/user order is irrelevant. A multiway table is
   blocked if ONE of its pairs is cooling down. A `cancel_refund` (a match that was never
   played) creates no cooldown.
3. **Ranked gate — `MAX_RANKED_BANKROLL_MATCHES_PER_PAIR_UTC_DAY = 3`.** Only the first three
   settled `payout` matches of a pair per UTC day may feed stats. A candidate match is
   UNRANKED if ANY of its pairs is at or over the threshold. Active and refunded matches are
   never counted.

### 18.3 What UNRANKED means

An unranked match is a **completely normal paid match**: buy-ins are debited, rebuys work,
the payout of the final stacks happens in full, conservation and the settlement gate are
unchanged. The ONLY difference is that it writes **no** legacy stats row — no `games`,
`game_players`, `rounds` or `user_stats` — so `gamesPlayed`/`gamesWon`, the rating, the
leaderboard and every Poker achievement are untouched by it.

### 18.4 The pre-debit handshake

The decision is made SERVER-side from durable evidence, inside the same transaction as the
buy-in debit. A first START of an unranked line-up is refused with
`POKER_UNRANKED_CONFIRM_REQUIRED` and **nothing is debited and no match id is minted**. The
host may then re-send START with `pokerUnrankedConfirmed: true` — a pure acknowledgement;
the server recomputes the decision under its own lock immediately before the debit. A client
can never ask to be ranked.

### 18.5 Grandfathering

The policy applies only to an escrow carrying the private marker `antiDumpPolicy.version = 1`,
stamped by every debit made after deploy. A match already in flight has no marker and keeps
the OLD behaviour: uncapped rebuys and ranked stats. A malformed marker degrades to legacy —
it never makes an escrow look corrupt and never demotes a table.

### 18.6 What it never does

- never confiscates a balance;
- never blocks a **refund** or a **payout** (a refusal happens before any debit exists);
- never freezes a room;
- never trusts client-side telemetry;
- never reveals an opponent, a pair, a count, a threshold or a risk flag — the only public
  fact is the boolean `RoomSnapshot.pokerStatsEligible` (the Ranked/Unranked badge), and a
  cooldown refusal carries only an approximate `retryAfterSeconds`.
