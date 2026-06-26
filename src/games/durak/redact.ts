// ---------------------------------------------------------------------------
// Durak redaction (Stage 9.5). Pure: returns the state a viewer may see.
//   • the viewer's own hand is real;
//   • every opponent hand is replaced with hidden placeholder cards (count kept);
//   • the face-down draw pile and the discard pile are hidden (counts kept);
//   • the trump suit/card, the table (attack/defense pairs), roles, status and
//     the end-of-game fields are PUBLIC.
// Never leaks a private hand. Mirrors King's `redactStateFor` placeholder.
// ---------------------------------------------------------------------------

import type { Card } from '../../models/types';
import type { DurakState } from './types';

/** The same face-down placeholder King uses, so the client renders a card back. */
const HIDDEN = { suit: 'spades', rank: '?', value: 0 } as unknown as Card;

const hide = (cards: Card[]): Card[] => cards.map(() => ({ ...HIDDEN }));

export function durakRedactStateFor(state: DurakState, viewerSeat: number | null): DurakState {
  return {
    ...state,
    players: state.players.map((p) =>
      p.seatIndex === viewerSeat ? { ...p } : { ...p, hand: hide(p.hand) }),
    // The deck (incl. the bottom trump card) is face-down; trumpCard stays public.
    drawPile: hide(state.drawPile),
    // Beaten cards are out of the game and not reviewable.
    discardPile: hide(state.discardPile),
    // table / trumpSuit / trumpCard / roles / status / boutLimit / fool fields: public.
  };
}
