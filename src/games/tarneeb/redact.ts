// ---------------------------------------------------------------------------
// Tarneeb redaction (Stage 10.2). Pure: returns the state a viewer may see.
//   • the viewer's own hand is real; every other seat's hand is replaced with
//     face-down placeholders (the count is kept);
//   • Tarneeb has NO hidden kitty / widow / discard / stock, so redaction is
//     simple — only `handsBySeat` is private (TARNEEB_RULES.md §13);
//   • bids/passes, the chosen trump, the current trick on the table,
//     completed-trick counts, and both teams' scores are PUBLIC.
// Never leaks a private hand. Mirrors Durak/Deberc's redact helpers.
//
// NOTE: Tarneeb is `coming_soon` (Stage 10.2) and is not wired to the server yet,
// so this runs only in tests today. It exists so the GameDefinition is complete.
// ---------------------------------------------------------------------------

import type { Card } from '../../models/types';
import type { TarneebState } from './types';

/** The same face-down placeholder King/Durak/Deberc use, so the client shows a back. */
const HIDDEN = { suit: 'spades', rank: '?', value: 0 } as unknown as Card;

const hide = (cards: Card[]): Card[] => cards.map(() => ({ ...HIDDEN }));

/**
 * The state a viewer at `viewerSeat` may see. Own hand stays real; every other
 * seat's hand becomes face-down placeholders. `viewerSeat` null = a spectator, so
 * all four hands are hidden. Everything else in Tarneeb is already public.
 */
export function tarneebRedactStateFor(state: TarneebState, viewerSeat: number | null): TarneebState {
  return {
    ...state,
    handsBySeat: state.handsBySeat.map((hand, seat) =>
      seat === viewerSeat ? hand : hide(hand)),
    // bids / highestBid / trumpSuit / currentTrick / completedTricks /
    // tricksByTeam / scoresByTeam: all public — left untouched.
  };
}
