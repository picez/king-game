// ---------------------------------------------------------------------------
// Poker redaction. Pure: returns the state a viewer at `viewerSeat` may see (§13).
//   • the viewer's own hole cards are real; every other seat's hole cards become
//     face-down placeholders — UNLESS that seat was revealed at showdown;
//   • the undealt deck and the burn cards are SERVER-PRIVATE — stripped to empty;
//   • the community board, pots, stacks, bets, action state, button/blinds and
//     the public showdown result are all PUBLIC.
// A folded seat is NEVER revealed. `viewerSeat` null = a spectator (own = none).
// Never leaks a private hole card, the deck order or a burn card.
// ---------------------------------------------------------------------------

import type { PokerCard, PokerState } from './types';

/** A face-down placeholder — no suit/rank leaks. */
const hidden = (): PokerCard => ({ id: 'hidden', suit: null, rank: null });

const hide = (cards: PokerCard[]): PokerCard[] => cards.map(() => hidden());

/**
 * The state a viewer at `viewerSeat` may see. Own hole cards are shown; every
 * other seat's are hidden until that seat is revealed at showdown. The deck and
 * burns are removed entirely (server-only). Everything else in poker is public.
 */
export function pokerRedactStateFor(state: PokerState, viewerSeat: number | null): PokerState {
  return {
    ...state,
    holeCardsBySeat: state.holeCardsBySeat.map((hole, seat) =>
      seat === viewerSeat || state.revealedBySeat[seat] ? hole : hide(hole),
    ),
    // The undealt deck order and the burn cards never reach any client.
    deck: [],
    burned: [],
  };
}
