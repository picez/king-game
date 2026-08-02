// ---------------------------------------------------------------------------
// Poker oval-table seat geometry (Stage 37.7 §16 F, reworked in Stage 38.0.3).
// Pure + unit-tested. Maps a seat INDEX (relative to the viewer, who always sits at
// the bottom) to an absolute %-position on the oval felt, for 2–6 players. Positions
// are PHYSICAL (left/top), NOT logical, so the geometry is identical under LTR and
// Arabic RTL — seat identity never mirrors (only the text inside a pod follows the
// language direction).
//
// Stage 38.0.3 — owner FAIL: at 4 players the side pods sat ON the community board
// and the pot. The old side seats (top 47%) shared the table's vertical middle with
// the centre block, so on a 360/390 felt (~334–362px wide) a 72px pod at left 22%
// and a ~220px board simply could not both fit on that line — they overlapped by
// design, not by a rounding accident.
//
// The fix is a reserved CENTRE SAFE ZONE: the board + pot own a horizontal band of
// the felt, and NO seat may place its pod band inside it. Separating vertically (not
// horizontally) is what makes this robust — a pod's height is bounded (~80px, ~17% of
// the felt) whereas the board's WIDTH grows with the card count and the viewport is
// what runs out. The same percentages therefore work at every width, so this stays a
// pure, viewport-independent function; the mobile stylesheet only shrinks the pods
// and cards, which can never re-create the overlap.
// ---------------------------------------------------------------------------

export interface SeatPos {
  /** Horizontal centre, % of the table width. */
  left: number;
  /** Vertical centre, % of the table height. */
  top: number;
}

/**
 * The vertical band (in % of the felt height) reserved for the community board, the
 * pot and the street label — `.poker-center` plus its worst-case content. Measured
 * from the real DOM at 360/390 (board ≈ 47px + pot pill ≈ 26px + gaps on a ~464px
 * felt ≈ 17%), then rounded outward for safety.
 */
export const CENTER_BAND = { top: 32, bottom: 52 } as const;

/**
 * Half the vertical extent of a seat pod, in % of the felt height. A pod carries
 * badges + two hole cards + name + stack. The WORST case is what matters: with all four
 * badges (D / SB / BB / ALL-IN) the badge row wraps to two lines and a folded/out tag is
 * added, taking the pod to ~102px on a ~464px felt ≈ 22%, so half of it is ~11%. (An
 * earlier 9% was calibrated on the plain pod and still let a 4-player Arabic table with
 * every badge clip the board by 6px — measured, then fixed here.) Every seat must clear
 * {@link CENTER_BAND} by at least this much.
 */
export const POD_HALF_HEIGHT = 11;

/**
 * Seat positions per player count, indexed by DISTANCE FROM THE VIEWER (0 = viewer,
 * bottom-centre; the rest run clockwise around the oval). Curated so that no two pods
 * overlap, the viewer is always front-and-centre at the bottom, and every pod band
 * clears the centre safe zone (asserted by `pokerSeatLayout.test.ts`).
 */
const LAYOUTS: Record<number, SeatPos[]> = {
  2: [
    { left: 50, top: 86 },                    // viewer
    { left: 50, top: 12 },                    // opponent (across)
  ],
  3: [
    { left: 50, top: 86 },
    { left: 22, top: 20 },
    { left: 78, top: 20 },
  ],
  4: [
    { left: 50, top: 86 },
    { left: 20, top: 19 },
    { left: 50, top: 10 },
    { left: 80, top: 19 },
  ],
  5: [
    { left: 50, top: 87 },
    { left: 20, top: 64 },
    { left: 28, top: 16 },
    { left: 72, top: 16 },
    { left: 80, top: 64 },
  ],
  6: [
    { left: 50, top: 87 },
    { left: 20, top: 64 },
    { left: 23, top: 20 },
    { left: 50, top: 10 },
    { left: 77, top: 20 },
    { left: 80, top: 64 },
  ],
};

/** The position index (0=viewer, clockwise) for engine `seat`, given the viewer seat. */
export function positionIndexFor(seat: number, viewerSeat: number, playerCount: number): number {
  return ((seat - viewerSeat) % playerCount + playerCount) % playerCount;
}

/** The oval %-position for engine `seat` given the viewer (spectator → viewer = seat 0). */
export function seatPosition(seat: number, viewerSeat: number | null, playerCount: number): SeatPos {
  const layout = LAYOUTS[playerCount] ?? LAYOUTS[6];
  const viewer = viewerSeat == null ? 0 : viewerSeat;
  const idx = positionIndexFor(seat, viewer, playerCount);
  return layout[idx] ?? layout[layout.length - 1];
}

/** Every curated position for a player count (test/QA helper). */
export function seatLayoutFor(playerCount: number): SeatPos[] {
  return LAYOUTS[playerCount] ?? LAYOUTS[6];
}

/** Whether a seat at `top` keeps its whole pod out of the reserved centre band. */
export function clearsCenterBand(top: number): boolean {
  return top + POD_HALF_HEIGHT <= CENTER_BAND.top || top - POD_HALF_HEIGHT >= CENTER_BAND.bottom;
}
