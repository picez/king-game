# Tarneeb Solo — implementation-ready plan (Variant B: 4-player cutthroat)

**Status: FULLY RELEASED (Stage 28.4) — local + online + stats.** Tarneeb ships two released modes
behind a `variant: 'pairs' | 'solo'` flag that **defaults to `'pairs'`**: **Pairs** (the classic
4-player 2×2 partnership game) and **Solo** (4-player cutthroat, every player for self). Both are
selectable in the **local setup** and the **online Host** sheet; the lobby shows the mode (Solo =
individual seats, no Team A/B grid); the table / hand-complete / finished screens adapt (per-seat
standings, individual winner); rematch preserves the variant; and **stats + leaderboard** record
solo under a **separate `game_type='tarneeb-solo'`** (no DB migration — the pairs `'tarneeb'`
aggregates are byte-for-byte untouched). Backward compatible: a legacy room/state/client with no
variant reads as Pairs. **Stage 28.6** added one solo achievement — **"Tarneeb Soloist"** (win a
Tarneeb Solo) — reading the separate `tarneeb-solo` stats so it never mixes with the Pairs badges
and is not required for All-Rounder.

> **28.0** spec → **28.1** pure core → **28.3** local UI → **28.4** full online + stats release.
> The scoring model in §2 is the one that shipped.

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
   no `variant` field resolves to `'pairs'`. **28.4:** threaded end-to-end online — a dedicated
   `tarneebVariant?` on `CREATE_ROOM` / `RoomSnapshot` / `RoomSummary` / `ServerRoom` (mirrors
   Durak's `variant`), read by `buildTarneebStartAction`, persisted + restored (missing → pairs).
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
6. ✅ **Stats (28.4).** Solo records under a **separate `game_type='tarneeb-solo'`** — the pairs
   cache (`game_type='tarneeb'`, `winnerTeam`) is byte-for-byte untouched, and **no migration** was
   needed (`game_type` is free text; `user_stats` PK is `(user_id, game_type)`; per-player fields in
   the existing JSONB blob). `summarizeFinishedTarneebGame` branches to per-seat for solo;
   `getTarneebStats`/`getTarneebLeaderboard` take a `variant`; the API exposes `?variant=solo`; the
   profile has a Pairs/Solo toggle. Solo leaderboard orders by wins then games (same index).
7. ✅ **Lobby (28.4).** Solo shows flat individual seats + an every-player-for-self hint (no team
   grid); Pairs keeps the 2×2 grid. Redaction is variant-agnostic (still hides `handsBySeat`).
8. ✅ **Protocol (28.4).** `tarneebVariant` carried on `CREATE_ROOM` + snapshots; the server is
   authoritative (same reducer + redaction). No new action types; the variant lives in room metadata
   + `state.variant`, so no cross-variant action confusion.
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
