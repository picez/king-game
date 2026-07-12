# Rules / UX backlog — Stage 27.0 (deferred with design notes)

Stage 27.0 shipped a focused, fully-tested slice of the rules/table-clarity request (see
CHANGELOG). To avoid half-breaking released games in one pass, the larger items below are
**deferred** with a concrete design so a follow-up stage can pick them up safely. **Nothing here
is half-implemented** — current team modes / navigation / turn order are untouched.

## Done in 27.0
- **Tarneeb minimum bid → 3** (auction 3–13; bots stay conservative at 7+). Engine + tests.
- **Tarneeb trump obligation:** void in the led suit + holding trump ⇒ must trump. Pure reducer
  (`legalPlays`), so online validates identically. Tests.
- **Deberc "Платіна" → "Палтіна" (Paltina)** display rename (en/uk/de/ar); internal id unchanged.
- **Deberc UI:** skip-meld button is red/destructive; larger table cards.
- **Lead-card badge** (`card--lead`) on the first card of the current trick — Tarneeb/Preferans/Deberc.
- **2-second reveal delay everywhere** (normalized): server `TRICK_ADVANCE` + King/Deberc local +
  Durak table review + Tarneeb/Preferans review (local AND now online, previously missing) = 2000 ms.

---

## Deferred — design notes

### A. Profile / menu navigation separation (Req 1, Part A)
Today `ProfileMenu` packs 5 tabs (Profile / Friends / Stats / Achievements / Leaderboard) into one
segmented row — crowded on 360 px. **Plan:** split into top-level menu tiles from the main menu
(Profile, **Friends** — carrying the incoming-request badge, Statistics, Achievements), each opening
its own screen; keep Leaderboard as a sub-toggle under Statistics. Preserve the 25.7 request badge
on the Friends entry. Risk: low (UI only) but touches menu routing + several tests → its own stage.

### B.2 Deberc trump exchange (Req 3, Part B.2)
**Rule:** before the first trick, once trump is revealed on the table, any player holding the
**lowest trump** may swap it for the face-up table trump: **7 of trump (3-player), 6 of trump
(4-player)**. Example: trump ♦, table shows **J♦**, a player holding **7♦** swaps 7♦ ⇄ J♦.
**Design:** a new pre-play window + action `EXCHANGE_TRUMP` in the Deberc reducer (pure), a
`canExchangeTrump(state, seat)` check (eligible card by player count, before any trick, trump on
table), hand counts preserved, a public event that leaks no other hidden cards, bot performs it if
available, and online redaction unchanged. UI: an "Exchange" button only when eligible + the table
trump shown clearly. **Deferred** because it adds a new phase/action to a released engine — needs
its own stage with the full test matrix (eligible 3p/4p, ineligible reject, only-before-play,
counts preserved, bot, no-leak).

### C.3 Tarneeb "view my tricks" (Req 9, Part C.3)
Add a "My tricks" drawer/modal (like Deberc's existing `deberc-mytricks`) showing the tricks
your team/you have taken this hand, from `completedTricks` (winner + cards). No hidden-hand leak
(only completed, public tricks). Available during/after the hand, mobile-safe. **Deferred** — a
bounded UI add; grouped with Part A (both are UI-navigation) for a follow-up.

### C.4 Tarneeb stats (Req 13) — audit result
**No change needed.** Tarneeb already records per-`(user, game_type='tarneeb')` stats on finished
human-vs-human online games (idempotent, privacy-safe) with its own stats + leaderboard panels
(released). Verified against `maybeRecordFinished` + `TarneebStatsPanel`.

### D. Solo / individual modes for Deberc & Tarneeb (Req 2, Part D)
**Large variant change — deferred (team mode stays intact).** Deberc already supports **3-player
each-for-self** (its 3p mode is individual); Tarneeb is strictly 4-player 2×2. A full "individual"
Tarneeb variant would need: a variant flag through setup/lobby, per-player (not per-team) scoring
and stats aggregation, seat-parity assumptions removed, lobby team-UI made conditional, and bot
logic that doesn't assume a partner. This is a multi-file rules change touching scoring — it must
be its own stage with tests for **both** variants, and must not regress the released team mode.
**This stage does not touch team scoring.**

### E. Turn direction / clockwise audit (Req 7, Part E)
Current engine turn order: Durak lays opponents **clockwise in play order** (UI comment); Tarneeb
plays **counter-clockwise** (seat 0→3→2→1) per TARNEEB_RULES §2; King/Deberc/Preferans follow their
own dealing order. The owner wants play to read **clockwise by UI seating**. **Action for a
follow-up:** verify per game whether the *engine* next-seat order and the *screen* seat layout
agree with a clockwise read; where they disagree, prefer fixing the **UI layout/labels** (not the
engine, to avoid changing dealing/scoring). Add a per-game "next seat order" guard test. Deferred —
needs a careful visual audit on device, not a blind engine flip.

### F.4 Reactions/emoji over the sender (Req 8, Part F.4)
Reactions currently float **top-centre** (`reactions-float`). To float them **over the sender's
seat**, map `ReactionEvent.seatIndex` to that seat's on-screen position — but seat positions are
**per-game** (each game screen lays seats out differently). **Design:** expose a seat→screen-anchor
map from each game screen (or a shared seat-layout helper) and position the floating chip there,
falling back to centre when the seat is unknown / in the lobby. Deferred — per-game positioning
work best done alongside the table-layout pass.
