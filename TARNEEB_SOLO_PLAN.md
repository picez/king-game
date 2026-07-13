# Tarneeb Solo — implementation-ready plan (Variant B: 4-player cutthroat)

**Status: PURE CORE (28.1) + LOCAL PLAYABLE UI (28.3) DONE; ONLINE / stats PENDING.** The solo
reducer, per-seat scoring (§2 below), bots, and redaction ship in `src/games/tarneeb/` behind a
`variant: 'pairs' | 'solo'` flag that **defaults to `'pairs'`**. As of **Stage 28.3** it is
**playable locally**: the Tarneeb local setup has a **Pairs / Solo** picker (default Pairs), and the
table / hand-complete / finished screens adapt to per-seat cutthroat (no A/B teams, 4-player
standings, individual winner). It is still **NOT online-enabled** (the online host + lobby stay
Pairs) and records **no stats/leaderboard/achievements**. Released Tarneeb Pairs is unchanged.

> **Stage 28.0** produced this spec (design only). **Stage 28.1** built the pure core. **Stage 28.3**
> added the local-only playable UI. The scoring model in §2 is the one that was built.
> Next: **28.4** — online Tarneeb Solo readiness OR solo stats design.

See `SOLO_VARIANTS_PLAN.md` for why **Variant B (4-player cutthroat)** was chosen over 3-player
(Variant A, needs an invented reduced deck) and over deferring indefinitely (Variant C). Variant B
reuses the released 52-card / 13-each deal unchanged — only teams and scoring differ.

## 1. Shape

| Aspect | Solo (Variant B) | Released team (unchanged) |
|---|---|---|
| Seats | 4, no partners — every player for themselves | 4, pairs A = 0&2, B = 1&3 |
| Deck / deal | 52 cards, 13 each — **reused as-is** | same |
| Bidding | 3–13, each bids for self; highest = sole declarer | same range; declarer's *team* |
| Declarer vs field | 1 declarer vs **3 independent opponents** | declarer team vs defender team |
| Trump | declarer names trump | same |
| Trick play | follow-suit + trump obligation — **`legalPlays` reused verbatim** | same |
| Scoring | individual (§2 below) | team, first to 41 |
| Stats | per-player outcome | per-team (`winnerTeam`, 2 ids) |

## 2. Scoring model (the decision this doc fixes)

Chosen model — **"declarer vs the field, tricks-based defensive credit"**. It is unambiguous,
reuses the released contract math, and needs no new tunables:

Let `C` = the winning bid (3–13), `D` = tricks the declarer actually won (0–13).

- **Declarer makes it (`D ≥ C`):**
  - Declarer scores **`+C`** (exactly the released "made" value — bid, not overtricks).
  - Each of the 3 opponents scores **`0`**.
- **Declarer fails (`D < C`):**
  - Declarer scores **`−C`**.
  - The 3 opponents **share defensive credit by the tricks they took**: each opponent scores
    **`+ (tricks that opponent won)`**. (The 3 opponents' tricks sum to `13 − D`, so defensive
    credit is self-balancing and needs no pool constant.)

**Match end:** first player to **41** (same target as the team game). On a tie at ≥41 in the same
hand, highest total wins; if still tied, play one more hand.

Rationale: mirrors the released set/made contract feel (declarer risks exactly the bid), makes the
three defenders genuinely independent (you are rewarded for *your own* tricks when the declarer is
set), and avoids inventing a "defenders collectively get +C" pool whose split would be arbitrary.
This is the MVP model — a richer overtrick/kaboot variant is explicitly out of scope.

## 3. Work status (✅ = done in Stage 28.1 pure core, ⏳ = future stage)

1. ✅ **Variant flag.** `variant: 'pairs' | 'solo'` on `TarneebState` + `START_GAME`, **default
   `'pairs'`**. Backward-compatible read via `tarneebVariant(state)` — a legacy/restored state with
   no `variant` field resolves to `'pairs'`. (Note: the code uses `'pairs'`, not `'team'`.) The
   ⏳ setup → lobby → RoomSnapshot threading is deferred (solo is core-only, not online).
2. ✅ **Types/state.** `variant` added; solo per-seat fields (`tricksBySeat`, `scoresBySeat`,
   `lastSoloHand`, `soloHandHistory`, `soloWinnerSeat`) are OPTIONAL — **undefined in pairs**, so a
   pairs state's shape is unchanged apart from `variant`. Team fields kept; branch, not rewrite.
3. ✅ **Scoring branch.** `scoreSoloHand` implements §2 with its own tests; team `scoreHand` is
   byte-for-byte unchanged (early `if (isSoloTarneeb) return scoreSoloHand`). Shared only trick
   counting (solo also tallies `tricksBySeat[winner]`).
4. ✅ **Bots.** Solo bidding estimates the OWN hand only (no partner), with a `mustOpen` guarantee
   so a bot-only auction always resolves (no infinite redeal); solo card play skips the
   partner-winning branch. Team AI untouched.
5. ✅ **`legalPlays` / server auth.** Reused verbatim — trick legality is variant-independent, so the
   UI == reducer == server single-source guarantee is preserved for free.
6. ⏳ **Stats.** `tarneebStats`: for solo, record a per-player outcome (declarer made/failed + final
   placement) instead of `winnerTeam` (2 ids). Team record shape unchanged; leaderboard and
   achievements branch on `variant`. **Migration only if the persisted column shape changes** —
   prefer an additive `variant` column over rewriting `winnerTeam`. **Not started (28.1 records no
   solo stats).**
7. ⏳ **Lobby.** Hide the 2×2 team grid for solo; show a flat "each for self" seating (the
   Deberc-solo pattern). Redaction is already variant-agnostic (still hides `handsBySeat`) ✅.
8. ⏳ **Protocol.** Carry `variant` on room create/join; reject a solo action on a team game and vice
   versa (server-authoritative, same reducer).
9. ✅ **Setup UX (LOCAL, Stage 28.3).** Segmented Pairs / Solo control in the Tarneeb **local** setup
   (default Pairs). Table/hand-complete/finished screens adapt to per-seat cutthroat. Online host
   still shows no Solo. Remaining ⏳: the online segmented control lands with online enablement.

## 4. Tests — done in 28.1 (✅) / deferred (⏳)

- ✅ Solo scoring: made (`+C`, opponents 0), failed (`−C`, opponents get their own trick counts),
  self-balancing defensive credit, match-to-41, tie-safe (no null winner).
- ✅ Variant isolation: a `pairs` game is byte-for-byte the released behaviour; `soloGuard.test.ts`
  asserts pairs unchanged + solo not exposed.
- ✅ Legality: trump obligation enforced in a solo state; illegal play returns the same ref.
- ✅ Bots: solo bot never assumes a partner; team bot unchanged; deterministic soak terminates.
- ✅ Redaction: each viewer sees only its own hand; solo public fields survive; core-purity guard.
- ⏳ Online: both variants create/join/redact; cross-variant actions rejected (when online lands).

## 5. Explicit non-goals for the build stage

- No 3-player Tarneeb (Variant A — needs an invented deck; rejected).
- No overtrick/kaboot/doubled-solo scoring — MVP is §2 only.
- No change to released team scoring, stats schema semantics, or leaderboard for team games.
