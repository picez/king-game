// ---------------------------------------------------------------------------
// Local pass-and-play view logic (§14). Pure — decides, from the authoritative
// state and which human LAST confirmed the device, whether a handover screen must
// be shown and which seat the local table may be redacted for. The acting human is
// ALWAYS resolved by SEAT (never by name), so duplicate human names are safe.
//
// Stage 38.0.2 policy change (owner-confirmed): a handover is a PRIVACY step
// between two different humans, not a per-turn ritual.
//   • Exactly ONE human at the table (the rest bots) → there is nobody to hide
//     from, so no handover EVER; that human is the stable local viewer and keeps
//     seeing their own hole cards across every bot turn.
//   • Two or more humans → a handover is required only when the device actually
//     changes hands: the confirmation STICKS to its seat, so human A → bots → A
//     never re-prompts, while A → bots → B (and A → B) prompts for B. While a bot
//     acts, no human's hole cards are on screen.
// ---------------------------------------------------------------------------

import { getActingPokerSeat } from '../../games/poker/rules';
import type { PokerState } from '../../games/poker/types';

/** The seat that must act now during betting, or null on a public screen. */
export function actingSeat(state: PokerState): number | null {
  return getActingPokerSeat(state);
}

/** Every seat occupied by a human player (by SEAT, never by name). */
export function humanSeats(state: PokerState): number[] {
  return state.players.filter((p) => p.type === 'human').map((p) => p.seatIndex);
}

/**
 * The seat of the ONLY human at the table, or null when 0 or ≥2 humans play.
 * A single human plus bots is a private, single-device session: no handover, and
 * that seat stays the viewer through every bot turn and between hands.
 */
export function soloHumanSeat(state: PokerState): number | null {
  const humans = humanSeats(state);
  return humans.length === 1 ? humans[0] : null;
}

/**
 * Whether the device must be handed over before the acting human may look.
 * False for a solo-human table (nobody to hide from) and false when the human who
 * already holds the device is the one to act — including after any number of bot
 * turns in between (`confirmedSeat` is the LAST confirmed human seat, not a
 * per-turn flag).
 */
export function needsHandover(state: PokerState, confirmedSeat: number | null): boolean {
  if (soloHumanSeat(state) != null) return false;         // 1 human + bots → never
  const seat = actingSeat(state);
  if (seat == null) return false;                         // public / between-hands screen
  if (state.players[seat].type !== 'human') return false; // a bot acts automatically
  return confirmedSeat !== seat;                          // a DIFFERENT human held the device
}

/**
 * The seat the local table may be redacted for.
 *
 * Solo human → always that seat (their own hand is never a secret from themselves).
 * Multi-human → ONLY the confirmed CURRENT human actor: null on a public screen, on a
 * BOT's turn, and before the acting human confirms a handover, so one human's hole
 * cards can never be on screen while another human (or a bot) is acting. §14.
 */
export function viewerFor(state: PokerState, confirmedSeat: number | null): number | null {
  const solo = soloHumanSeat(state);
  if (solo != null) return solo;
  if (state.phase !== 'betting') return null;
  const seat = actingSeat(state);
  if (seat == null) return null;                          // public / between-hands screen
  if (state.players[seat].type !== 'human') return null;  // a bot is acting → reveal nothing
  return confirmedSeat === seat ? seat : null;            // only the confirmed acting human
}
