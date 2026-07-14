// ---------------------------------------------------------------------------
// Sender-anchored reactions (Stage 27.1) — PURE, unit-testable.
//
// A floating reaction/sticker should appear near the SENDER's seat, not always at the centre of
// the table. Most game screens seat the local viewer at the BOTTOM and the others CLOCKWISE from
// the seat after them, so the sender's seat maps with `rel = fromSeat − mySeat` (King / Durak /
// Deberc / Preferans — see each *GameScreen).
//
// Tarneeb is the exception (Stage 29.5 fix): its engine order is counter-clockwise BY INDEX, so the
// screen MIRRORS the seats (`rel = mySeat − fromSeat`, see `seatPosition` in TarneebGameScreen and
// CLOCKWISE_AUDIT.md) to keep play reading clockwise. Feeding Tarneeb through the forward mapping put
// the chip on the OPPOSITE side of the table for every OTHER viewer (the sender is always `rel 0` →
// bottom, so only remote viewers saw the bug). `mirrored` selects the matching convention.
//
// Falls back to 'center' when the seat can't be resolved (spectator, lobby without seats, unknown
// count).
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
 *
 * `mirrored` = true for games whose screen mirrors seats left↔right (Tarneeb); the sender still
 * anchors to 'bottom' either way, so this only changes the left/right sides for remote viewers.
 */
export function reactionAnchorForSender(
  fromSeat: number | null | undefined,
  mySeat: number | null | undefined,
  seatCount: number,
  mirrored = false,
): ReactionAnchor {
  if (fromSeat == null || mySeat == null) return 'center';
  if (!Number.isInteger(seatCount)) return 'center';
  const layout = LAYOUTS[seatCount];
  if (!layout) return 'center';
  const delta = mirrored ? mySeat - fromSeat : fromSeat - mySeat;
  const rel = ((delta % seatCount) + seatCount) % seatCount; // 0 = me (bottom)
  return layout[rel] ?? 'center';
}
