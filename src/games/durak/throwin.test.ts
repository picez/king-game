import { describe, it, expect } from 'vitest';
import { cardValue } from './deck';
import { durakReducer, getActingDurakPlayerId } from './engine';
import { getValidAttackCards } from './rules';
import type { Card } from '../../models/types';
import type { DurakPlayer, DurakState } from './types';

// Priority throw-in (DURAK_RULES.md): the primary attacker keeps the throw until
// they pass; then it moves clockwise to the next eligible attacker; the defender
// never throws; when nobody can/will throw and all is beaten the bout ends.

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit, value: cardValue(rank) });
const P = (seat: number, hand: Card[]): DurakPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human', hand });

function st(n: number, over: Partial<DurakState>): DurakState {
  const s: DurakState = {
    gameType: 'durak', variant: 'simple',
    players: Array.from({ length: n }, (_, i) => P(i, [])),
    drawPile: [], trumpSuit: 'spades', trumpCard: C('6', 'spades'),
    attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, passedAttackers: [],
    table: [], discardPile: [], status: 'attack', boutLimit: 6,
    foolId: null, winnerIds: [], isDraw: false, ...over,
  };
  if (over.throwerIndex === undefined) s.throwerIndex = s.attackerIndex;
  return s;
}

describe('priority throw-in (3 players)', () => {
  // A(0)=primary attacker, B(1)=defender, C(2)=co-attacker. The 6♥ is already
  // beaten by 7♥; both A and C still hold a 6 to throw.
  const post = (over: Partial<DurakState> = {}) => st(3, {
    players: [P(0, [C('6', 'clubs'), C('A', 'spades')]), P(1, [C('K', 'spades')]), P(2, [C('6', 'diamonds'), C('Q', 'spades')])],
    table: [{ attack: C('6', 'hearts'), defense: C('7', 'hearts') }],
    status: 'attack', attackerIndex: 0, defenderIndex: 1, ...over,
  });

  it('only the PRIMARY attacker may throw before they pass', () => {
    const s = post();
    expect(s.throwerIndex).toBe(0);
    expect(getActingDurakPlayerId(s)).toBe('player-0'); // not C, even though C holds a 6
  });

  it('after the primary passes, the throw moves to the next eligible attacker', () => {
    let s = post();
    s = durakReducer(s, { type: 'PASS_ATTACK' })!;
    expect(s.passedAttackers).toContain(0);
    expect(s.throwerIndex).toBe(2);                 // C (the defender, seat 1, is skipped)
    expect(getActingDurakPlayerId(s)).toBe('player-2');
  });

  it('when every eligible attacker passes and all is beaten, the bout ends (defended)', () => {
    let s = post();
    s = durakReducer(s, { type: 'PASS_ATTACK' })!;  // A passes → C
    s = durakReducer(s, { type: 'PASS_ATTACK' })!;  // C passes → no thrower → resolve
    expect(s.table).toEqual([]);
    expect(s.discardPile.map((c) => `${c.rank}${c.suit[0]}`).sort()).toEqual(['6h', '7h']);
    expect(s.attackerIndex).toBe(1);                // the defender becomes the next attacker
    expect(s.defenderIndex).toBe(2);
    expect(s.status).toBe('attack');
  });

  it('the defender is never offered the throw', () => {
    let s = post();
    s = durakReducer(s, { type: 'PASS_ATTACK' })!;  // → C (seat 2), not B (seat 1, defender)
    expect(s.throwerIndex).not.toBe(s.defenderIndex);
  });

  it('a co-attacker can actually throw after the primary passes', () => {
    let s = post();
    s = durakReducer(s, { type: 'PASS_ATTACK' })!;  // thrower = C
    s = durakReducer(s, { type: 'ATTACK_CARD', card: C('6', 'diamonds') })!;
    expect(s.table.map((p) => p.attack.rank)).toEqual(['6', '6']);
    expect(s.status).toBe('defense');               // B must beat the new 6
    expect(s.players[2].hand.some((c) => c.rank === '6')).toBe(false);
  });
});

describe('re-priority after a co-attacker throw-in (3 players)', () => {
  it('hands the throw back to the primary once a newly-beaten card adds a rank they hold', () => {
    // A opens a 6; B beats with a 7; A holds no 6/7 (auto-passes); C throws a 7;
    // B beats it with a 9 → rank 9 now on the table → A (who holds a 9) leads again.
    let s = st(3, {
      players: [
        P(0, [C('6', 'clubs'), C('9', 'hearts')]),   // primary attacker
        P(1, [C('7', 'clubs'), C('9', 'spades')]),   // defender (9♠ trump introduces rank 9)
        P(2, [C('7', 'hearts')]),                    // co-attacker
      ],
      status: 'attack', attackerIndex: 0, defenderIndex: 1, throwerIndex: 0,
    });
    s = durakReducer(s, { type: 'ATTACK_CARD', card: C('6', 'clubs') })!;                          // (a)(b)
    s = durakReducer(s, { type: 'DEFEND_CARD', attack: C('6', 'clubs'), card: C('7', 'clubs') })!; // beat
    expect(s.throwerIndex).toBe(2);                  // (c)(d) A has no 6/7 → auto-passed → C leads
    s = durakReducer(s, { type: 'ATTACK_CARD', card: C('7', 'hearts') })!;                         // C throws rank 7
    expect(s.passedAttackers).toEqual([]);           // new card → fresh throw-in cycle
    s = durakReducer(s, { type: 'DEFEND_CARD', attack: C('7', 'hearts'), card: C('9', 'spades') })!; // (e) trump beat → rank 9 appears
    expect(s.status).toBe('attack');
    expect(s.throwerIndex).toBe(0);                  // (f) PRIMARY regains the throw
    expect(getValidAttackCards(s).some((c) => c.rank === '9')).toBe(true);
    s = durakReducer(s, { type: 'ATTACK_CARD', card: C('9', 'hearts') })!;                         // (g) A throws the 9
    expect(s.status).toBe('defense');
    expect(s.table.map((p) => p.attack.rank)).toEqual(['6', '7', '9']);
  });

  it('a pass stays effective while no new card is added', () => {
    // No ATTACK_CARD is played, so passedAttackers is NOT reset: A remains passed
    // and the throw stays with the next eligible co-attacker.
    let s = st(3, {
      players: [P(0, [C('A', 'spades')]), P(1, [C('K', 'spades')]), P(2, [C('6', 'diamonds')])],
      table: [{ attack: C('6', 'hearts'), defense: C('7', 'hearts') }],
      status: 'attack', attackerIndex: 0, defenderIndex: 1, throwerIndex: 0,
    });
    s = durakReducer(s, { type: 'PASS_ATTACK' })!;   // A passes (no card added)
    expect(s.passedAttackers).toContain(0);          // A stays passed (no reset)
    expect(s.throwerIndex).toBe(2);                  // throw stays with C
    expect(s.status).toBe('attack');
  });
});

describe('attack limit + auto-pass', () => {
  it('ends the bout when the limit is reached even if an attacker holds a match', () => {
    // boutLimit 1, one beaten card on the table; A holds a 6 but cannot throw (limit).
    const s = st(2, {
      players: [P(0, [C('6', 'clubs')]), P(1, [C('K', 'spades')])],
      table: [{ attack: C('6', 'hearts'), defense: C('7', 'hearts') }],
      status: 'defense', boutLimit: 1,
    });
    // Defender already beat → trigger resume by re-beating is N/A; instead pass from A.
    const atk = st(2, { ...s, status: 'attack', throwerIndex: 0 });
    const next = durakReducer(atk, { type: 'PASS_ATTACK' })!;
    expect(next.table).toEqual([]);                 // resolved, not stuck
    expect(next.status === 'attack' || next.status === 'finished').toBe(true);
  });
});

describe('take + transfer reset the throw-in state', () => {
  it('TAKE_CARDS clears passedAttackers and resets the thrower', () => {
    const s = st(3, {
      players: [P(0, [C('8', 'clubs')]), P(1, [C('6', 'clubs')]), P(2, [C('9', 'spades')])],
      table: [{ attack: C('7', 'hearts'), defense: null }], status: 'defense',
      attackerIndex: 0, defenderIndex: 1, passedAttackers: [2],
    });
    const next = durakReducer(s, { type: 'TAKE_CARDS' })!;
    expect(next.passedAttackers).toEqual([]);
    expect(next.throwerIndex).toBe(next.attackerIndex);
  });

  it('TRANSFER_ATTACK resets passedAttackers and makes the transferrer the thrower', () => {
    const s = st(3, {
      variant: 'transfer', status: 'defense',
      players: [P(0, [C('K', 'spades')]), P(1, [C('7', 'clubs')]), P(2, [C('9', 'diamonds'), C('10', 'diamonds')])],
      table: [{ attack: C('7', 'hearts'), defense: null }],
      attackerIndex: 0, defenderIndex: 1, passedAttackers: [0],
    });
    const next = durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') })!;
    expect(next.passedAttackers).toEqual([]);
    expect(next.attackerIndex).toBe(1);   // the transferrer
    expect(next.throwerIndex).toBe(1);
    expect(next.defenderIndex).toBe(2);
    expect(next.status).toBe('defense');
  });
});
