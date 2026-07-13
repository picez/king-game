# Tarneeb Solo — implementation-ready plan (Variant B: 4-player cutthroat)

**Status: foundation / design only (Stage 28.0).** No solo gameplay ships yet. Released Tarneeb
stays **4-player, fixed 2×2 pairs, default and only playable mode**. This document is the
implementation-ready spec for the future stage that builds solo; it fixes the one decision the
earlier design pass left open — **the scoring model** — so the build stage has no "invented quietly"
gaps. The released behaviour guarded by `src/games/tarneeb/soloGuard.test.ts` must keep holding for
the `team` variant after solo lands.

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

## 3. Required work (future build stage — NOT this stage)

1. **Variant flag.** `variant: 'team' | 'solo'` (default `'team'`) threaded
   `TarneebSetup → lobby → RoomSnapshot → START_GAME action`. Existing rooms/snapshots without the
   field resolve to `'team'` — zero migration for team play.
2. **Types/state.** Add `variant` to `TarneebState`. For solo, `teamOfSeat`/`declarerTeam`/
   `tricksByTeam` are replaced by per-seat equivalents; keep the team fields for team games. Do not
   remove the released team path — branch, don't rewrite.
3. **Scoring branch.** Pure `scoreSoloHand(state) → number[4]` implementing §2, with its own tests.
   Team scoring (`scoreHand`) untouched; the two never share a code path beyond trick counting.
4. **Bots.** New solo bot: no partner assumption in bidding or card choice (the released AI bids and
   signals for the pair). Team AI unchanged.
5. **`legalPlays` / server auth.** Reused verbatim — trick legality is variant-independent, so the
   UI == reducer == server single-source guarantee is preserved for free.
6. **Stats.** `tarneebStats`: for solo, record a per-player outcome (declarer made/failed + final
   placement) instead of `winnerTeam` (2 ids). Team record shape unchanged; leaderboard and
   achievements branch on `variant`. **Migration only if the persisted column shape changes** —
   prefer an additive `variant` column over rewriting `winnerTeam`.
7. **Lobby.** Hide the 2×2 team grid for solo; show a flat "each for self" seating (the Deberc-solo
   pattern). Redaction unchanged (still hides `handsBySeat`).
8. **Protocol.** Carry `variant` on room create/join; reject a solo action on a team game and vice
   versa (server-authoritative, same reducer).
9. **Setup UX.** Segmented Pairs / Solo control (mirrors the Deberc Solo/Pairs mode cards). Local +
   online both wired. Solo stays hidden from the picker until the core + stats land — no disabled
   half-feature in the UI.

## 4. Tests the build stage must add

- Solo scoring: made (`+C`, opponents 0), failed (`−C`, opponents get their own trick counts),
  self-balancing defensive credit, match-to-41.
- Variant isolation: a `team` game after the change is byte-for-byte the released behaviour
  (extend `soloGuard.test.ts` to assert team scoring/stats unchanged).
- Legality parity: `legalPlays` identical across variants for the same hand.
- Bots: solo bot never assumes a partner; team bot unchanged.
- Online: both variants create/join/redact correctly; cross-variant actions rejected.

## 5. Explicit non-goals for the build stage

- No 3-player Tarneeb (Variant A — needs an invented deck; rejected).
- No overtrick/kaboot/doubled-solo scoring — MVP is §2 only.
- No change to released team scoring, stats schema semantics, or leaderboard for team games.
