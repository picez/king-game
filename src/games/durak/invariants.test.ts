import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { durakReducer } from './engine';
import { durakBotAction } from './ai';
import { beats } from './rules';
import type { Card } from '../../models/types';
import type { DurakState, DurakVariant } from './types';

const key = (c: Card) => `${c.rank}${c.suit[0]}`;

/** Every card in play, across all zones. */
function allCards(s: DurakState): Card[] {
  const cs: Card[] = [...s.drawPile, ...s.discardPile];
  for (const p of s.players) cs.push(...p.hand);
  for (const pair of s.table) { cs.push(pair.attack); if (pair.defense) cs.push(pair.defense); }
  return cs;
}

/** Asserts every Durak invariant from DURAK_RULES.md on a single state. */
function assertInvariants(s: DurakState): void {
  // Card conservation + uniqueness: always exactly the 36-card deck, no dupes.
  const cards = allCards(s);
  expect(cards).toHaveLength(36);
  expect(new Set(cards.map(key)).size).toBe(36);

  // Attack-count limit: ≤ boutLimit ≤ 6 (min(6, defender hand at bout start)).
  expect(s.boutLimit).toBeLessThanOrEqual(6);
  expect(s.table.length).toBeLessThanOrEqual(s.boutLimit);

  // Every defended pair is a legal beat.
  for (const pair of s.table) {
    if (pair.defense) expect(beats(pair.defense, pair.attack, s.trumpSuit)).toBe(true);
  }

  // Roles are distinct while playing.
  if (s.status !== 'finished') expect(s.attackerIndex).not.toBe(s.defenderIndex);
}

function playOut(numPlayers: number, variant: DurakVariant, seed: number): DurakState {
  const names = Array.from({ length: numPlayers }, (_, i) => `P${i}`);
  let s = durakReducer(null, { type: 'START_DURAK', playerNames: names, variant }, { rng: makeRng(seed) })!;
  assertInvariants(s);
  for (let step = 0; step < 6000; step++) {
    if (s.status === 'finished') return s;
    const action = durakBotAction(s);
    if (!action) throw new Error('no action while not finished');
    const next = durakReducer(s, action);
    if (next === s || next === null) throw new Error(`illegal/no-op bot action: ${JSON.stringify(action)}`);
    s = next;
    assertInvariants(s);
  }
  throw new Error('did not finish within cap');
}

describe('Durak invariants hold through full simulated games', () => {
  const seeds = [1, 7, 42, 100, 2026, 31337];
  for (const n of [2, 3, 4]) {
    for (const variant of ['simple', 'transfer'] as DurakVariant[]) {
      it(`${n}p ${variant}: invariants hold every step and the game finishes`, () => {
        for (const seed of seeds) {
          const final = playOut(n, variant, seed);
          expect(final.status).toBe('finished');
          expect(final.drawPile).toHaveLength(0);
          expect(final.table).toEqual([]);
          // Exactly one fool, or a draw with none; the fool is never a winner.
          if (final.isDraw) {
            expect(final.foolId).toBeNull();
            expect(final.winnerIds.sort()).toEqual(final.players.map((p) => p.id).sort());
          } else {
            expect(final.foolId).not.toBeNull();
            expect(final.winnerIds).not.toContain(final.foolId);
            expect(final.winnerIds).toHaveLength(final.players.length - 1);
          }
        }
      });
    }
  }
});
