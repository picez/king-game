// ---------------------------------------------------------------------------
// Preferans redaction (Stage 19.1, pure). Returns the state a viewer may see:
//   • the viewer's own hand is real; every other seat's hand is replaced with
//     face-down placeholders (the count is kept);
//   • the talon (before it is taken) and the declarer's discards are hidden from
//     EVERYONE (face-down placeholders, count kept) — PREFERANS_RULES.md §14;
//   • bids/contract, trump/level, the current + completed tricks, tricksBySeat,
//     and scores are PUBLIC.
// Never leaks a private hand. Mirrors Durak/Deberc/Tarneeb's redact helpers; will be
// wired online in Stage 19.4 via the GameDefinition's redactStateFor.
// ---------------------------------------------------------------------------

import type { Card } from '../../models/types';
import type { PreferansState } from './types';

/** The same face-down placeholder King/Durak/Deberc/Tarneeb use (client shows a back). */
const HIDDEN = { suit: 'spades', rank: '?', value: 0 } as unknown as Card;
const hide = (cards: Card[]): Card[] => cards.map(() => ({ ...HIDDEN }));

/**
 * The state a viewer at `viewerSeat` may see. Own hand stays real; every other seat's
 * hand, the talon, and the discards become face-down placeholders. `viewerSeat` null =
 * a spectator, so all three hands are hidden too. Everything else is already public.
 */
export function preferansRedactStateFor(state: PreferansState, viewerSeat: number | null): PreferansState {
  return {
    ...state,
    handsBySeat: state.handsBySeat.map((hand, seat) => (seat === viewerSeat ? hand : hide(hand))),
    talon: hide(state.talon),         // hidden from everyone (§14)
    discards: hide(state.discards),   // hidden from everyone (§14, MVP)
  };
}
