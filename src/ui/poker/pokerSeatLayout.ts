// ---------------------------------------------------------------------------
// Poker oval-table seat geometry (Stage 37.7 §16 F). Pure + unit-tested. Maps a
// seat INDEX (relative to the viewer, who always sits at the bottom) to an absolute
// %-position on the oval felt, for 2–6 players. Positions are PHYSICAL (left/top),
// NOT logical, so the geometry is identical under LTR and Arabic RTL — seat identity
// never mirrors (only the text inside a pod follows the language direction).
// ---------------------------------------------------------------------------

export interface SeatPos {
  /** Horizontal centre, % of the table width. */
  left: number;
  /** Vertical centre, % of the table height. */
  top: number;
}

/**
 * Seat positions per player count, indexed by DISTANCE FROM THE VIEWER (0 = viewer,
 * bottom-centre; the rest run clockwise around the oval). Curated so no two pods
 * overlap and the viewer is always front-and-centre at the bottom.
 */
const LAYOUTS: Record<number, SeatPos[]> = {
  2: [
    { left: 50, top: 86 },                    // viewer
    { left: 50, top: 12 },                    // opponent (across)
  ],
  3: [
    { left: 50, top: 86 },
    { left: 23, top: 34 },
    { left: 77, top: 34 },
  ],
  4: [
    { left: 50, top: 86 },
    { left: 22, top: 47 },
    { left: 50, top: 13 },
    { left: 78, top: 47 },
  ],
  5: [
    { left: 50, top: 87 },
    { left: 22, top: 55 },
    { left: 31, top: 18 },
    { left: 69, top: 18 },
    { left: 78, top: 55 },
  ],
  6: [
    { left: 50, top: 87 },
    { left: 22, top: 58 },
    { left: 27, top: 22 },
    { left: 50, top: 13 },
    { left: 73, top: 22 },
    { left: 78, top: 58 },
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
