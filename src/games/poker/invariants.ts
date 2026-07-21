// ---------------------------------------------------------------------------
// Poker — structural invariants. Pure: `checkPokerInvariants(state)` returns the
// list of violated invariants (empty ⇒ well-formed). Used by the soak tests and
// available as a runtime guard. The headline invariant is CHIP CONSERVATION:
// no chip is ever created or destroyed. See POKER_RULES.md §15.
// ---------------------------------------------------------------------------

import { POKER_DECK_SIZE } from './deck';
import type { PokerCard, PokerState } from './types';

/** Every real card currently anywhere in the game (hole/board/deck/burns). */
export function allCards(state: PokerState): PokerCard[] {
  const cards: PokerCard[] = [];
  for (const h of state.holeCardsBySeat) cards.push(...h);
  cards.push(...state.board, ...state.deck, ...state.burned);
  return cards;
}

/** Total chips that must be conserved (starting stack × seats). */
export function totalChips(state: PokerState): number {
  return state.options.startingStack * state.playerCount;
}

/** Return the list of violated invariants; empty means the state is valid. */
export function checkPokerInvariants(state: PokerState): string[] {
  const errors: string[] = [];
  const n = state.playerCount;

  const perSeat: [string, number][] = [
    ['players', state.players.length],
    ['stacksBySeat', state.stacksBySeat.length],
    ['holeCardsBySeat', state.holeCardsBySeat.length],
    ['committedBySeat', state.committedBySeat.length],
    ['contributedBySeat', state.contributedBySeat.length],
    ['foldedBySeat', state.foldedBySeat.length],
    ['allInBySeat', state.allInBySeat.length],
    ['eliminatedBySeat', state.eliminatedBySeat.length],
  ];
  for (const [name, len] of perSeat) if (len !== n) errors.push(`${name} length ${len} != playerCount ${n}`);

  // Chip conservation. Chips in play sit in stacks plus (during a betting round)
  // the pot formed by this hand's contributions; between hands every contributed
  // chip has been redistributed back into stacks.
  const potInPlay = state.phase === 'betting' ? sum(state.contributedBySeat) : 0;
  const chips = sum(state.stacksBySeat) + potInPlay;
  if (chips !== totalChips(state)) {
    errors.push(`chip conservation: ${chips} != ${totalChips(state)}`);
  }
  for (let s = 0; s < n; s++) if (state.stacksBySeat[s] < 0) errors.push(`seat ${s} negative stack`);

  // Card conservation + uniqueness (skip placeholder-redacted views).
  const cards = allCards(state);
  const redacted = cards.some((c) => c.id === 'hidden');
  if (!redacted) {
    if (cards.length !== POKER_DECK_SIZE) errors.push(`card count ${cards.length} != ${POKER_DECK_SIZE}`);
    const ids = new Set(cards.map((c) => c.id));
    if (ids.size !== cards.length) errors.push('duplicate card id detected');
  }

  // Board length is one of the legal street sizes.
  if (![0, 3, 4, 5].includes(state.board.length)) errors.push(`illegal board length ${state.board.length}`);

  // During betting the acting seat must be able to act.
  if (state.phase === 'betting') {
    const t = state.toActSeat;
    if (t < 0 || t >= n) errors.push(`toActSeat ${t} out of range`);
    else if (state.foldedBySeat[t] || state.allInBySeat[t] || state.eliminatedBySeat[t]) {
      errors.push(`toActSeat ${t} cannot act (folded/all-in/eliminated)`);
    }
  }

  if (state.currentBet < 0) errors.push('negative currentBet');
  if (state.minRaise < 0) errors.push('negative minRaise');

  return errors;
}

function sum(a: number[]): number {
  return a.reduce((x, y) => x + y, 0);
}
