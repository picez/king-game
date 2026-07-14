// ---------------------------------------------------------------------------
// 51 redaction. Pure: returns the state a viewer at `viewerSeat` may see (§14).
//   • the viewer's own hand is real; every other seat's hand becomes
//     face-down placeholders (the count is kept);
//   • the draw pile is face-down (its order/contents are hidden; count kept);
//   • the discard pile is PUBLIC (top + full list per §14 MVP);
//   • opened melds (incl. which card a joker represents), opened flags,
//     scores, eliminations, whose turn/step, round number: all PUBLIC.
// Never leaks a private hand or the draw-pile order. Mirrors Durak/Tarneeb.
// ---------------------------------------------------------------------------

import type { FiftyOneCard, FiftyOneState } from './types';

/** A face-down placeholder — no suit/rank leaks. */
const hidden = (): FiftyOneCard => ({ id: 'hidden', joker: false, suit: null, rank: null });

const hide = (cards: FiftyOneCard[]): FiftyOneCard[] => cards.map(() => hidden());

/**
 * The state a viewer at `viewerSeat` may see. `viewerSeat` null = a spectator
 * (all hands hidden). Everything else in 51 is already public.
 */
export function fiftyOneRedactStateFor(state: FiftyOneState, viewerSeat: number | null): FiftyOneState {
  return {
    ...state,
    handsBySeat: state.handsBySeat.map((hand, seat) => (seat === viewerSeat ? hand : hide(hand))),
    // The draw pile is face-down: order and contents are hidden, count kept.
    drawPile: hide(state.drawPile),
    // discardPile / publicMelds / openedBySeat / scoresBySeat / eliminatedSeats /
    // currentSeat / turnStep / roundNumber / lastRound: all public — untouched.
  };
}
