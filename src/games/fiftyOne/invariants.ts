// ---------------------------------------------------------------------------
// 51 — structural invariants. Pure: `checkFiftyOneInvariants(state)` returns the
// list of violated invariants (empty ⇒ the state is well-formed). Used by the
// soak tests and available as a runtime guard. See 51_RULES.md.
// ---------------------------------------------------------------------------

import { totalDeckSize } from './deck';
import type { FiftyOneCard, FiftyOneState } from './types';

/** Every physical card currently anywhere in the game (hands/draw/discard/melds). */
export function allCards(state: FiftyOneState): FiftyOneCard[] {
  const cards: FiftyOneCard[] = [];
  for (const h of state.handsBySeat) cards.push(...h);
  cards.push(...state.drawPile);
  cards.push(...state.discardPile);
  for (const m of state.publicMelds) cards.push(...m.cards);
  return cards;
}

/** Return the list of violated invariants; empty means the state is valid. */
export function checkFiftyOneInvariants(state: FiftyOneState): string[] {
  const errors: string[] = [];
  const n = state.playerCount;

  // Seat-count consistency across every per-seat array.
  const perSeat: [string, number][] = [
    ['handsBySeat', state.handsBySeat.length],
    ['openedBySeat', state.openedBySeat.length],
    ['scoresBySeat', state.scoresBySeat.length],
    ['eliminatedSeats', state.eliminatedSeats.length],
    ['players', state.players.length],
  ];
  for (const [name, len] of perSeat) {
    if (len !== n) errors.push(`${name} length ${len} != playerCount ${n}`);
  }

  // Card conservation + no duplicate ids (skip placeholder-redacted states,
  // where hidden cards all share the sentinel id 'hidden').
  const cards = allCards(state);
  const redacted = cards.some((c) => c.id === 'hidden');
  if (!redacted) {
    const expected = totalDeckSize(n);
    if (cards.length !== expected) {
      errors.push(`card count ${cards.length} != deck size ${expected}`);
    }
    const ids = new Set(cards.map((c) => c.id));
    if (ids.size !== cards.length) errors.push('duplicate card id detected');
  }

  // Draw/discard tops must be real cards where present (structural sanity).
  if (state.currentSeat < 0 || state.currentSeat >= n) {
    errors.push(`currentSeat ${state.currentSeat} out of range`);
  }
  if (state.turnStep !== 'draw' && state.turnStep !== 'meld_discard') {
    errors.push(`invalid turnStep ${String(state.turnStep)}`);
  }

  // During play the acting seat may not be eliminated.
  if (state.phase === 'playing' && state.eliminatedSeats[state.currentSeat]) {
    errors.push(`currentSeat ${state.currentSeat} is eliminated but acting`);
  }

  // opened ⇔ owns at least one public meld.
  for (let seat = 0; seat < n; seat++) {
    const owns = state.publicMelds.some((m) => m.ownerSeat === seat);
    if (owns && !state.openedBySeat[seat]) {
      errors.push(`seat ${seat} owns a meld but is not marked opened`);
    }
    if (state.openedBySeat[seat] && !owns && state.phase === 'playing') {
      errors.push(`seat ${seat} marked opened but owns no meld`);
    }
  }

  // Every public meld owner must be a valid seat.
  for (const m of state.publicMelds) {
    if (m.ownerSeat < 0 || m.ownerSeat >= n) errors.push(`meld ${m.id} has invalid ownerSeat ${m.ownerSeat}`);
  }

  // During play, eliminated seats hold no cards (their hand was cleared at the
  // next deal). At round_complete / game_finished a just-eliminated seat still
  // holds its final losing hand until the next round is dealt, so we only assert
  // this once play has resumed.
  if (state.phase === 'playing') {
    for (let seat = 0; seat < n; seat++) {
      if (state.eliminatedSeats[seat] && state.handsBySeat[seat].length > 0) {
        errors.push(`eliminated seat ${seat} still holds cards`);
      }
    }
  }

  return errors;
}
