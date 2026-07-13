# Rules / UX backlog — Stage 27.0 (deferred with design notes)

Stage 27.0 shipped a focused, fully-tested slice of the rules/table-clarity request (see
CHANGELOG). To avoid half-breaking released games in one pass, the larger items below are
**deferred** with a concrete design so a follow-up stage can pick them up safely. **Nothing here
is half-implemented** — current team modes / navigation / turn order are untouched.

**Update (Stage 27.1):** Part A (profile section split) and Part F.4 (sender-anchored reactions)
are **DONE**.
**Update (Stage 27.2):** Part B.2 (Deberc trump exchange) is **DONE**.
**Update (Stage 27.3):** Part C.3 (Tarneeb view team tricks) is **DONE**.
**Update (Stage 27.4):** Part E (clockwise + table-clarity audit) is **DONE** — see
`CLOCKWISE_AUDIT.md`.
**Update (Stage 27.5):** Part D (solo/individual modes) is **DESIGNED / decided** (docs-only) —
see `SOLO_VARIANTS_PLAN.md`: Deberc already covers it (3p), Tarneeb stays team-only (Variant C).
**All original Stage 27.0 backlog items are now resolved** (implemented or decided).
**Update (Stages 28.0–28.6, SUPERSEDES the 27.5 decision):** solo modes were actually **built and
released** — Deberc Solo/Pairs made explicit + playable online, and **Tarneeb Solo (Variant B)
fully released** (local + online + stats + "Tarneeb Soloist" achievement). See `TARNEEB_SOLO_PLAN.md`
/ `TARNEEB_RULES.md` §17; the "Tarneeb stays team-only" note above is historical only.

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

### A. Profile / menu navigation separation (Req 1, Part A) — ✅ DONE (Stage 27.1)
The `ProfileMenu` horizontal tab row was replaced with a **section grid**: Account / Friends /
Statistics / Achievements / Leaderboards are each a tappable tile (icon + label + subtitle) that
drills into its own screen with a "← Sections" back button. No more truncated tab strip; wraps
cleanly at 360/390, RTL-safe. The incoming friend-request **badge** shows on the Friends tile (and
the Friends section header). The per-game Stats/Leaderboard selectors and the Achievements toast
are preserved inside their sections.

### B.2 Deberc trump exchange (Req 3, Part B.2) — ✅ DONE (Stage 27.2)
Implemented for **3p (7) and 4p (6)**: action `EXCHANGE_TRUMP` + pure `canExchangeTrump(state, seat)`
in the Deberc reducer/rules; offered on the declarer's turn before they declare (the lone low-trump
holder reaches their own turn, so it works over the turn-based online auth). The low trump swaps for
the face-up table trump (from the stock for 3p / the dealer's hand for 4p) — **counts preserved,
36-card total holds**; once per hand; optional. Bots exchange automatically. Redaction is public-safe
(new table trump + a "X swapped" note; no hidden hand leaked). See DEBERC_RULES §3a. Full test matrix
in `trumpExchange.test.ts` (eligible 3p/4p, ineligible/second/after-play rejected, counts preserved,
bot, redaction, UI/i18n).

### C.3 Tarneeb "view my tricks" (Req 9, Part C.3) — ✅ DONE (Stage 27.3)
A "🃏 Team tricks (N)" button in the Tarneeb top bar opens `TarneebTricksReview` — a modal listing
every trick YOUR SIDE (2×2 partnership) has taken this hand, each with its hand trick number, the
winner, the 4 cards in play order and the **lead card flagged**; the opponents show as a **count**
only, with a "No tricks yet." empty state. UI-ONLY: the played cards already live in the PUBLIC
`completedTricks` (redaction hides only `handsBySeat`), so no engine/redaction/protocol/DB change —
stats stay score-only. Works local + online from the same server-authoritative state.

### C.4 Tarneeb stats (Req 13) — audit result
**No change needed.** Tarneeb already records per-`(user, game_type='tarneeb')` stats on finished
human-vs-human online games (idempotent, privacy-safe) with its own stats + leaderboard panels
(released). Verified against `maybeRecordFinished` + `TarneebStatsPanel`.

### D. Solo / individual modes for Deberc & Tarneeb (Req 2, Part D) — ✅ DESIGNED / DECISION MADE (Stage 27.5)
Design-first audit done (docs-only) — see `SOLO_VARIANTS_PLAN.md`. Findings:
- **Deberc — already covered.** Its **3-player mode is genuinely every-player-for-self**
  (`teamOf = [0,1,2]`, `teamCount = 3`); 4p is the 2×2 pair mode. Engine + stats + docs + UX
  already say so — no change needed (only a one-line `DEBERC_RULES.md` §1 cross-reference added).
  So the owner's "play separately" desire is met in the product today.
- **Tarneeb — decision: keep team-only (Variant C).** Three shapes were analysed (A: 3-player
  solo — needs an invented deck/deal, not recommended; B: 4-player cutthroat 1-vs-3 — clean 52/13
  deck, preferred *if* built; C: keep team-only in v0.3.x and treat solo as a separate future
  variant). **Chosen: C.** Solo Tarneeb changes contract scoring, the per-team stats schema, the
  partner-assuming bot AI and the lobby team-UI — a multi-file rules+data change that must be its
  own tested stage with a `variant` flag defaulting to `'team'`, never a rewrite of the released
  2×2 game. Released Tarneeb behaviour is unchanged; team scoring is not touched.

### E. Turn direction / clockwise audit (Req 7, Part E) — ✅ DONE (Stage 27.4)
Audited all five games (see `CLOCKWISE_AUDIT.md`). King, Durak, Deberc and Preferans already read
**clockwise** (engine advances +1 and the screen maps the successor to the left slot). **Tarneeb**
was the only miss: its engine order is counter-clockwise *by index* (0→3→2→1, §2) and the old UI
mapping put the successor on the **right**, so it read counter-clockwise. Fixed **UI-only** by
mirroring the seat mapping to `(viewerSeat − seat + 4) % 4` — the successor now lands on the left
(bottom→left→top→right = clockwise), the partner stays opposite at the top, and dealing /
partnerships / play order / scoring are untouched. Preferans's stale "counter-clockwise" comment
was corrected. Guard test `clockwiseAudit.test.ts` runs each engine's real successor through its
slot mapping and asserts the clockwise invariant, plus lead/winner/pair markup and the ~2000 ms
reveal delay.

### F.4 Reactions/emoji over the sender (Req 8, Part F.4) — ✅ DONE (Stage 27.1)
Reactions + stickers now float **over the sender's seat** instead of top-centre. A pure helper
`reactionAnchorForSender(fromSeat, mySeat, seatCount)` maps the sender to a relative anchor
(bottom = the viewer, others clockwise — mirroring the game seat layouts), and RoomSocial positions
each chip at that edge (`reaction-anchor--bottom/left/top/right`), never over the hand/trick. It
reuses the existing **public `seatIndex`** already in the REACTION / CHAT payloads (no protocol
change, no new identity). Unknown seat (spectator / lobby / unsupported count) → centred, as before.
