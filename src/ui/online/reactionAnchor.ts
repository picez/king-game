// ---------------------------------------------------------------------------
// Sender-anchored reactions (Stage 27.1) — PURE, unit-testable.
//
// A floating reaction/sticker should appear near the SENDER's seat, not always at the centre of
// the table. Every game screen seats the local viewer at the BOTTOM and the others CLOCKWISE from
// the seat after them (see each *GameScreen SEAT_LAYOUT). This maps the sender's seat to the same
// relative anchor so the overlay can position the chip at that edge. Falls back to 'center' when
// the seat can't be resolved (spectator, lobby without seats, unknown count).
// ---------------------------------------------------------------------------

export type ReactionAnchor = 'bottom' | 'left' | 'top' | 'right' | 'center';

/** Relative anchor per player count, viewer at index 0 (bottom), others clockwise. Mirrors the
 *  game screens' seat layouts so a reaction lands where that player visibly sits. */
const LAYOUTS: Record<number, ReactionAnchor[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'left', 'right'],
  4: ['bottom', 'left', 'top', 'right'],
  5: ['bottom', 'left', 'top', 'top', 'right'],
};

/**
 * The screen anchor for a reaction from `fromSeat`, as seen by the viewer at `mySeat`, in a table
 * of `seatCount` players. Returns 'center' when it can't be resolved (kept identical to the old
 * behaviour for spectators / the lobby / an unknown layout).
 */
export function reactionAnchorForSender(
  fromSeat: number | null | undefined,
  mySeat: number | null | undefined,
  seatCount: number,
): ReactionAnchor {
  if (fromSeat == null || mySeat == null) return 'center';
  if (!Number.isInteger(seatCount)) return 'center';
  const layout = LAYOUTS[seatCount];
  if (!layout) return 'center';
  const rel = (((fromSeat - mySeat) % seatCount) + seatCount) % seatCount; // 0 = me (bottom)
  return layout[rel] ?? 'center';
}
