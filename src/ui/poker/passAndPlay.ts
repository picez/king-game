// ---------------------------------------------------------------------------
// Local pass-and-play view logic (§14). Pure — decides, from the authoritative
// state and which human currently holds the device, whether a handover screen must
// be shown and which seat the local table may be redacted for. The acting human is
// ALWAYS resolved by SEAT (never by name), so duplicate human names are safe.
// ---------------------------------------------------------------------------

import { getActingPokerSeat } from '../../games/poker/rules';
import type { PokerState } from '../../games/poker/types';

/** The seat that must act now during betting, or null on a public screen. */
export function actingSeat(state: PokerState): number | null {
  return getActingPokerSeat(state);
}

/** Whether the acting seat is a HUMAN who still needs to confirm a handover. */
export function needsHandover(state: PokerState, viewerSeat: number | null): boolean {
  const seat = actingSeat(state);
  if (seat == null) return false;                       // public / between-hands screen
  if (state.players[seat].type !== 'human') return false; // a bot acts automatically
  return viewerSeat !== seat;                           // a different (or no) human held the device
}

/**
 * The seat the local table may be redacted for: ONLY the confirmed CURRENT human
 * actor. Returns null on a public screen, on a BOT's turn, or before the acting human
 * confirms a handover — so no player's hole cards are ever on screen while a bot acts
 * (there is no 750ms leak window: the result never depends on a stale viewerSeat, only
 * on who is acting NOW). §14.
 */
export function viewerFor(state: PokerState, viewerSeat: number | null): number | null {
  if (state.phase !== 'betting') return null;
  const seat = actingSeat(state);
  if (seat == null) return null;                          // public / between-hands screen
  if (state.players[seat].type !== 'human') return null;  // a bot is acting → reveal nothing
  return viewerSeat === seat ? seat : null;               // only the confirmed acting human
}
