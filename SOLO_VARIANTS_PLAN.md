# Solo / individual game-mode design — Stage 27.5 (design-first, docs-only)

> **SUPERSEDED (v0.3.2).** This is the original Stage 27.5 design pass and its **"keep Tarneeb
> team-only (Variant C)"** recommendation. That decision was later **reversed**: Tarneeb Solo
> (Variant B, 4-player cutthroat) was actually built and **fully released** across Stages 28.1–28.6
> (local + online + stats + one achievement). For current status see `TARNEEB_SOLO_PLAN.md` and
> `TARNEEB_RULES.md` §17. Deberc's Solo/Pairs modes were also made explicit (Stages 28.0/28.2).
> Kept here for the design rationale (variant A/B/C analysis), not as current status.

Backlog item D (`RULES_UX_TODO.md`): *"Deberc isn't only a partnership game — it can be played
individually. Same for Tarneeb."* This is a **decision/design pass only** — no reducers, rules,
scoring, UI, server, protocol or DB were touched, and released Tarneeb behaviour is unchanged.

## 1. Deberc — audited, already covered ✅

Deberc **already ships an individual / every-player-for-self mode**: it is its 3-player game.

- Engine (`src/games/deberc/engine.ts`): `teamOf = n === 4 ? [0,1,0,1] : [0,1,2]`,
  `teamCount = n === 4 ? 2 : 3`. So **3p → three one-person "teams"** (each player for self),
  **4p → two fixed pairs** (0&2 vs 1&3).
- Scoring (`src/games/deberc/scoring.ts`) aggregates per *team*; with 3p each team is a single
  seat, so it is genuinely per-player.
- Stats (`src/net/debercStats.ts`, comment): *"Deberc is a TEAM game (3p = three solo teams, 4p
  = two pairs)"*; a seat wins when its team is `winnerTeam` → in 3p that is a per-player win/loss.
- Docs & UX already say so accurately: `DEBERC_RULES.md` §1 ("3 players — every player for
  themselves"), `help.deberc.players` ("3 players (each for self) …"), `deberc.rule.deck`
  ("3 players go solo, 4 play as two teams"), and the Stage 18.0 team-lobby note (Deberc starts
  at 3 = each-for-self).

**Conclusion:** nothing to change in the Deberc engine, and the wording is already correct — no
doc claims Deberc is "always partnership". Only a one-line cross-reference was added to
`DEBERC_RULES.md` §1 to name 3p explicitly as *the* individual mode. **Deberc satisfies the
owner's "play separately" desire in the product today.**

## 2. Tarneeb — released mode (do not break)

`src/games/tarneeb/` is hard-wired to **4 players in two fixed partnerships** (`NUM_SEATS = 4`,
`teamOfSeat`: A = 0&2, B = 1&3). The auction is 3–13 (bots floor at 7); the highest bidder's
**team** is the declarer side; make the bid as a team (exact = doubled) or the defending team
scores; first team to 41. Stats/leaderboard are **per-team** (`winnerTeam`, exactly two
`playerId`s on the winning pair). Redaction hides only `handsBySeat`.

A solo Tarneeb is therefore **not a UI toggle** — it changes the contract-scoring model, the
stats schema, the bot strategy, and the lobby team-UI, and needs a variant flag threaded through
setup → lobby → room → protocol, plus a stats migration. Three shapes were considered.

### Variant A — 3-player solo Tarneeb

| Aspect | Design |
|---|---|
| Players / seating | 3 seats, no partners, each for self (3p table layout already exists). |
| Deck / deal | ⚠️ **Problem**: 52 cards don't divide by 3. Needs an *invented* fix — a reduced deck (e.g. 51 cards, 17 each) or a widow/kitty. Tarneeb is fundamentally a 4-player, 13-trick game. |
| Bidding | Each bids for self; highest = sole declarer vs 2 opponents. |
| Declarer / opponents | 1 vs 2 — needs a rule for how the two independent defenders score. |
| Trump / trick rules | Unchanged (declarer names trump; follow-suit + trump obligation). |
| Contract scoring | **New individual model** (declarer makes/misses; per-opponent or pooled defender score) — differs from released team scoring. |
| Stats / leaderboard | New per-player win model; `tarneebStats` `winnerTeam` (2 ids) no longer fits → schema branch. |
| Achievements | Derived from stats; a schema change needs an achievements pass. |
| Lobby labels | Team grouping hidden; "solo" labelling. |
| Bots | AI assumes a partner (bids/signals for the pair) → new solo AI. |
| Online redaction | Unchanged (hide hands) — low risk. |
| Migration / protocol | Variant flag + stats-schema change. Medium-high. |
| **Risk / authenticity** | **High risk, low authenticity** — 3-player Tarneeb isn't a standard variant and needs an invented deck/deal. |

### Variant B — 4-player every-player-for-self (cutthroat) Tarneeb

| Aspect | Design |
|---|---|
| Players / seating | 4 seats, no partners. **Deck math stays clean: 52 / 13 each** — the released deal is reused as-is. |
| Bidding | Each bids for self; highest = declarer vs 3 opponents. |
| Declarer / opponents | 1 vs 3 — needs a rule for how the three defenders score (pooled or per-player). |
| Trump / trick rules | Unchanged. |
| Contract scoring | **New individual model** (declarer alone vs a defender pool) — differs from released team scoring. |
| Stats / leaderboard | New per-player win model; same `winnerTeam` schema issue as A. |
| Achievements | Same as A. |
| Lobby labels | Team grouping hidden. |
| Bots | Four independent solo bots (no partner assumption) → new AI. |
| Online redaction | Unchanged — low risk. |
| Migration / protocol | Variant flag + stats-schema change. Medium. |
| **Risk / authenticity** | **Medium-high risk, better authenticity** — 4-player cutthroat/solo Tarneeb variants exist regionally, and the deck math needs no invention. Preferred *if* solo is built. |

### Variant C — keep Tarneeb team-only in v0.3.x; solo as a separate future variant

- No change to released Tarneeb. Solo becomes its own future stage with a variant flag, its own
  scoring/stats/bots/lobby, and tests for **both** variants.
- Zero risk to the released 2×2 mode and its online stats/leaderboard continuity.

## 3. Recommendation — Variant C now (matches the owner's intuition)

**Ship nothing new this stage; keep Tarneeb strictly team-only for v0.3.x.** Reasons:

1. **The underlying want is already met.** Deberc's 3-player mode is a real every-player-for-self
   game that exists in the product today, so "card games you can play solo, not just in pairs" is
   already true. There is no product gap forcing a rushed solo Tarneeb.
2. **Solo Tarneeb is a rules + data change, not a toggle.** It rewrites contract scoring
   (team → individual), the stats schema (`winnerTeam` 2-ids → per-player), the bot strategy
   (drop the partner assumption), and the lobby team-UI — plus a variant flag through
   setup/lobby/room/protocol and a stats migration. That must be its own tested stage.
3. **Rewriting a released game in place is the risky path.** A separate variant leaves the 2×2
   mode — and everyone's existing online stats/leaderboard — untouched.

**When solo Tarneeb is eventually built, prefer Variant B** (4-player cutthroat): the 52/13 deck
math is clean (no invented reduced-deck or kitty), and 1-vs-3 cutthroat is a more recognized
Tarneeb shape than 3-player Tarneeb. Variant A is not recommended.

### If/when Variant B is picked — required work (future stage, not now)

1. `variant: 'team' | 'solo'` flag through `TarneebSetup` → lobby → `RoomSnapshot` → start action
   (default `'team'`, so existing rooms/stats are unaffected).
2. Pure scoring branch for 1-vs-3 (declarer contract vs defender scoring) — new tests alongside
   the released team tests; team scoring untouched.
3. Bot strategy that doesn't assume a partner.
4. Stats: extend `tarneebStats` to a per-player outcome for solo; keep the team record for team
   games; leaderboard/achievements aware of the mode. Migration if the persisted shape changes.
5. Lobby: hide/relabel the 2×2 team grid for solo; redaction is unchanged (still hides hands).
6. Protocol: carry the variant on room create/join; reject a solo action on a team game and vice
   versa. QA both variants online.

## 4. Status

- **Deberc solo:** done (3p mode). No engine/doc change beyond a cross-reference.
- **Tarneeb solo:** **decision made → Variant C** (team-only for v0.3.x; solo deferred to a future
  stage, Variant B preferred). Released Tarneeb behaviour unchanged.
