# Clockwise & table-clarity audit — Stage 27.4

The owner requirement: **play must read clockwise on screen**, and in every game it must be
clear *who played which card*, *which card led*, *which card covers which* (Durak), and *who
took the trick*. This audit records the current state per game, what was fixed, and why no
rules/scoring/stats/DB change was needed.

## How "clockwise" is decided

Every game screen lays its seats out in the fixed **clockwise** slot order
`['bottom', 'left', 'top', 'right']` (a 3-seat table drops `'top'`), with the viewer at
`'bottom'`. So the whole question reduces to one invariant:

> **the seat that plays right after the viewer must land in the `'left'` slot** — the first
> clockwise step up from the bottom.

That depends on *both* the engine's next-seat direction *and* the screen's seat→slot mapping.
`src/ui/clockwiseAudit.test.ts` runs each game's **real** engine successor through its slot
mapping and asserts it lands on `'left'` (and the partner, where paired, stays opposite at
`'top'`).

## Findings

| Game | Engine next-seat | UI seat→slot mapping | Reads clockwise? |
|------|------------------|----------------------|------------------|
| **King** | `(currentLeaderIdx + plays) % n` → **+1** | `(seatIndex − viewer + n) % n` | ✅ yes |
| **Durak** | attacker/next → **+1** | opponents `(meSeat + 1 + k) % n` → left/top/right | ✅ yes |
| **Deberc** | `turnSeat = (seat + 1) % n` → **+1** | opponents `(meSeat + 1 + k) % n` | ✅ yes |
| **Preferans** | `nextSeat = (seat + 1) % n` → **+1** | `(seat − viewer + 3) % 3` | ✅ yes (comment was wrong) |
| **Tarneeb** | `nextSeatCounterClockwise = (seat + 3) % 4` → **−1 by index** | `(seat − viewer + 4) % 4` | ❌ **was counter-clockwise** |

### Fixed

- **Tarneeb — UI only.** The engine seat order is counter-clockwise *by index* (0→3→2→1,
  `TARNEEB_RULES.md` §2). With the old `(seat − viewer)` mapping the successor fell into the
  **right** slot, so the turn swept bottom→right→top→left — counter-clockwise on screen. The
  mapping now **mirrors** to `(viewer − seat + 4) % 4`, putting the engine successor at the
  **left** slot → bottom→left→top→right (**clockwise**). The **partner still sits opposite at
  the top**, and the **play order, dealing, partnerships and scoring are all unchanged** — only
  the left/right screen placement mirrors. This is the sanctioned "fix the UI, not the engine"
  path; `TARNEEB_RULES.md` §2's "counter-clockwise" still describes the internal index order.

- **Preferans — comment only.** The layout was already clockwise; a stale doc-comment claimed
  "play flows counter-clockwise". Corrected to match reality (no behaviour change).

### Not changed (already correct)

King, Durak, Deberc all advance `+1` and map the successor to the left slot — clockwise as-is.
No engine touched.

## Table clarity

Shared conventions, reused rather than re-abstracted:

- **Lead card** — the first card of the current trick carries a `card--lead` badge + ring
  (`CardView lead` prop, Stage 27.0). Present in Tarneeb / Preferans / Deberc (27.0) and now
  **King** too (Stage 27.4, `lead={i === 0}` on the led play). Durak has no "lead" — its unit is
  the attack/defense **pair**.
- **Who played what** — every trick renderer positions each played card **in front of the
  player's named seat** (spatial played-by). This is deliberately *not* duplicated as a text
  chip on each card, to avoid crowding at 360/390 (see Part E). Durak instead labels seat roles
  (thrower/defender) and groups cards by pair.
- **Winner / taker** — after a trick resolves the winning seat and its card pulse
  (`trick-slot--winning` / `tseat--winner` in King; `highlight` on the winning card elsewhere;
  the review modals name the winner per trick).
- **Durak pairs** — each attack card is grouped with its covering defense (`durak-pair`,
  `durak-pair__def`); `durak-pair--beaten` vs `durak-pair--unbeaten`, and the still-open attack
  is highlighted (`highlight={pair.defense === null}`) so it's clear which attacks remain.

## Reveal delay

Normalised to a readable **~2000 ms** in Stage 27.0 and re-verified here across every path:
server `DEFAULT_TRICK_ADVANCE_MS`, King `TRICK_VIEW_MS`, Durak `TABLE_REVIEW_MS`, Deberc
`ADVANCE_MS`, Tarneeb/Preferans `TRICK_REVIEW_MS`, and the shared `useTrickReview`
`TRICK_REVIEW_MS`. Guarded in `clockwiseAudit.test.ts`.

## Manual limitations (honest)

The node test env has no DOM, so these are **source/logic guards**, not pixel checks. Not
automated here (needs a device / screenshot pass): that the mirrored Tarneeb layout looks
natural with real avatars, that no seat label overflows at 360/390 in every language incl. RTL
Arabic, and that the lead badge is legible on the smallest `size="table"` card. Seating itself
stays game-stable (not RTL-mirrored) by design.
