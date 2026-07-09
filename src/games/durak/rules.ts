// ---------------------------------------------------------------------------
// Durak — pure legality helpers (Stage 9.1). No state mutation; the reducer
// (engine.ts) uses these to validate actions. See DURAK_RULES.md.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import type { DurakState } from './types';

export function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/**
 * Does `defense` beat `attack`? Higher card of the same suit, OR any trump when
 * the attack is not a trump. A trump attack is only beaten by a higher trump.
 */
export function beats(defense: Card, attack: Card, trumpSuit: Suit): boolean {
  if (defense.suit === attack.suit) return defense.value > attack.value;
  return defense.suit === trumpSuit; // trump beats non-trump (else different non-trump → no)
}

/** Ranks currently on the table (attack and defense cards) — valid throw-in ranks. */
export function tableRanks(state: DurakState): Set<string> {
  const ranks = new Set<string>();
  for (const p of state.table) {
    ranks.add(p.attack.rank);
    if (p.defense) ranks.add(p.defense.rank);
  }
  return ranks;
}

/** Unbeaten attack cards the defender still has to answer. */
export function unbeatenAttacks(state: DurakState): Card[] {
  return state.table.filter((p) => p.defense === null).map((p) => p.attack);
}

/** A bout is "complete" (ready to discard) when every attack card is beaten. */
export function isAttackComplete(state: DurakState): boolean {
  return state.table.length > 0 && state.table.every((p) => p.defense !== null);
}

/** Cards the current THROWER may legally play right now (open or throw-in). Also
 *  covers the 'taking' phase, where attackers pile matching ranks onto the table. */
export function getValidAttackCards(state: DurakState): Card[] {
  if (state.status !== 'attack' && state.status !== 'taking') return [];
  const thrower = state.players[state.throwerIndex];
  if (state.table.length === 0) return thrower.hand.slice();   // primary opens: any card
  if (state.table.length >= state.boutLimit) return [];        // attack limit reached
  const ranks = tableRanks(state);
  return thrower.hand.filter((c) => ranks.has(c.rank));        // throw-in: matching rank
}

/** Whether `seat` has a legal throw-in right now (a matching rank, under the limit). */
export function hasLegalThrowIn(state: DurakState, seat: number): boolean {
  if (state.table.length === 0 || state.table.length >= state.boutLimit) return false;
  const ranks = tableRanks(state);
  return state.players[seat].hand.some((c) => ranks.has(c.rank));
}

/** Defender's cards that beat a specific unbeaten attack card. */
export function getValidDefenseCards(state: DurakState, attack: Card): Card[] {
  if (state.status !== 'defense') return [];
  const defender = state.players[state.defenderIndex];
  return defender.hand.filter((c) => beats(c, attack, state.trumpSuit));
}

/**
 * First player (clockwise from `from`, wrapping) who still holds cards, skipping
 * `exclude`. Returns null if none (≤1 active player). Used for role rotation.
 */
export function findNextActivePlayer(state: DurakState, from: number, exclude?: number): number | null {
  const n = state.players.length;
  for (let k = 0; k < n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (i === exclude) continue;
    if (state.players[i].hand.length > 0) return i;
  }
  return null;
}

/**
 * Transfer Durak: may the defender pass the attack to the next player? Only when
 * the variant allows it, nothing has been beaten yet, every attack card shares
 * one rank, the defender holds that rank, and the next defender can hold the
 * resulting count (≤ their hand size and ≤ 6). DURAK_RULES.md §3.
 */
export function canTransfer(state: DurakState): boolean {
  if (state.variant !== 'transfer' || state.status !== 'defense') return false;
  if (state.table.length === 0) return false;
  if (state.table.some((p) => p.defense !== null)) return false; // a card was beaten
  const rank = state.table[0].attack.rank;
  if (state.table.some((p) => p.attack.rank !== rank)) return false; // mixed ranks
  const defender = state.players[state.defenderIndex];
  if (!defender.hand.some((c) => c.rank === rank)) return false;
  const next = findNextActivePlayer(state, state.defenderIndex + 1, state.defenderIndex);
  if (next === null) return false;
  const total = state.table.length + 1;
  return total <= state.players[next].hand.length && total <= 6;
}

/** The defender's cards that can legally transfer (same rank as the attack). */
export function getValidTransferCards(state: DurakState): Card[] {
  if (!canTransfer(state)) return [];
  const rank = state.table[0].attack.rank;
  return state.players[state.defenderIndex].hand.filter((c) => c.rank === rank);
}

/**
 * Transfer Durak §3a — one-time "trump-show" transfer: may the defender pass the
 * bout by merely SHOWING a matching-rank TRUMP (not placing it)? Same base
 * conditions as canTransfer, but:
 *  - available at most ONCE per bout (`trumpShowUsed` guards it);
 *  - the shown card is NOT added, so the next defender must be able to hold the
 *    CURRENT count (table.length ≤ their hand size and ≤ 6);
 *  - the defender must hold a TRUMP of the attack rank.
 * A regular transfer (placing a card) is always still available afterwards.
 */
export function canTrumpShowTransfer(state: DurakState): boolean {
  if (state.variant !== 'transfer' || state.status !== 'defense') return false;
  if (state.trumpShowUsed) return false;                 // already used this bout
  if (state.table.length === 0) return false;
  if (state.table.some((p) => p.defense !== null)) return false; // a card was beaten
  const rank = state.table[0].attack.rank;
  if (state.table.some((p) => p.attack.rank !== rank)) return false; // mixed ranks
  const defender = state.players[state.defenderIndex];
  // Must hold the TRUMP of that rank (the card that would be shown).
  if (!defender.hand.some((c) => c.rank === rank && c.suit === state.trumpSuit)) return false;
  const next = findNextActivePlayer(state, state.defenderIndex + 1, state.defenderIndex);
  if (next === null) return false;
  // No card is placed → the new defender faces the CURRENT count, not count + 1.
  return state.table.length <= state.players[next].hand.length && state.table.length <= 6;
}

/** The single trump card the defender may SHOW to transfer (empty if illegal). */
export function getValidTrumpShowCards(state: DurakState): Card[] {
  if (!canTrumpShowTransfer(state)) return [];
  const rank = state.table[0].attack.rank;
  return state.players[state.defenderIndex].hand.filter((c) => c.rank === rank && c.suit === state.trumpSuit);
}
