import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { cardValue } from './deck';
import { durakReducer } from './engine';
import { durakBotAction } from './ai';
import { canTransfer, canTrumpShowTransfer, getValidTrumpShowCards } from './rules';
import { durakRedactStateFor } from './redact';
import type { Card } from '../../models/types';
import type { DurakPlayer, DurakState, DurakVariant } from './types';

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit, value: cardValue(rank) });
const P = (seat: number, hand: Card[]): DurakPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human', hand });

function st(over: Partial<DurakState>): DurakState {
  const s: DurakState = {
    gameType: 'durak', variant: 'transfer', players: [P(0, []), P(1, [])],
    drawPile: [], trumpSuit: 'spades', trumpCard: C('6', 'spades'),
    attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, lastThrowerIndex: 0, passedAttackers: [],
    table: [], discardPile: [],
    status: 'attack', boutLimit: 6, trumpShowUsed: false, lastTrumpShow: null,
    foolId: null, winnerIds: [], isDraw: false, ...over,
  };
  if (over.throwerIndex === undefined) s.throwerIndex = s.attackerIndex;
  if (over.lastThrowerIndex === undefined) s.lastThrowerIndex = s.throwerIndex;
  return s;
}

describe('transfer chaining around the table (engine)', () => {
  it('a same-rank transfer hops the bout forward twice (P1→P2→P3)', () => {
    // Trump is spades; all sevens below are non-trump so each may be transferred.
    let s = st({
      players: [
        P(0, [C('7', 'hearts'), C('9', 'clubs')]),
        P(1, [C('7', 'clubs'), C('8', 'hearts')]),
        P(2, [C('7', 'diamonds'), C('8', 'clubs'), C('9', 'diamonds')]),
        P(3, [C('8', 'diamonds'), C('9', 'hearts'), C('10', 'diamonds'), C('J', 'clubs')]),
      ],
      attackerIndex: 0, defenderIndex: 1, status: 'attack',
    });

    s = durakReducer(s, { type: 'ATTACK_CARD', card: C('7', 'hearts') })!;
    expect(s.status).toBe('defense');
    expect(s.defenderIndex).toBe(1);

    // P1 transfers with 7♣ → P1 becomes attacker, P2 the new defender.
    s = durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') })!;
    expect(s.status).toBe('defense');
    expect(s.attackerIndex).toBe(1);
    expect(s.defenderIndex).toBe(2);
    expect(s.table).toHaveLength(2);

    // P2 transfers again with 7♦ → P2 attacker, P3 defender, three cards on the table.
    s = durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'diamonds') })!;
    expect(s.status).toBe('defense');
    expect(s.attackerIndex).toBe(2);
    expect(s.defenderIndex).toBe(3);
    expect(s.table).toHaveLength(3);
    // Every card on the table is still an unbeaten same-rank seven.
    expect(s.table.every((p) => p.defense === null && p.attack.rank === '7')).toBe(true);
  });

  it('rejects a transfer once a card has been beaten (no-op)', () => {
    let s = st({
      players: [P(0, [C('7', 'hearts')]), P(1, [C('9', 'hearts'), C('7', 'clubs')]), P(2, [C('8', 'clubs'), C('9', 'clubs')])],
      attackerIndex: 0, defenderIndex: 1, status: 'attack',
    });
    s = durakReducer(s, { type: 'ATTACK_CARD', card: C('7', 'hearts') })!;
    s = durakReducer(s, { type: 'DEFEND_CARD', attack: C('7', 'hearts'), card: C('9', 'hearts') })!;
    // A card is beaten now → transfer is illegal even though P1 holds another 7.
    const before = s;
    const after = durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') });
    expect(after).toBe(before); // reducer no-op
  });
});

describe('the bot actually uses TRANSFER_ATTACK', () => {
  function countBotTransfers(numPlayers: number, variant: DurakVariant, seed: number): number {
    const names = Array.from({ length: numPlayers }, (_, i) => `Bot${i}`);
    let s = durakReducer(null, { type: 'START_DURAK', playerNames: names, variant }, { rng: makeRng(seed) })!;
    let transfers = 0;
    for (let step = 0; step < 5000 && s.status !== 'finished'; step++) {
      const action = durakBotAction(s);
      if (!action) break;
      if (action.type === 'TRANSFER_ATTACK') transfers++;
      const next = durakReducer(s, action);
      if (next === null || next === s) throw new Error(`illegal bot action: ${JSON.stringify(action)}`);
      s = next;
    }
    return transfers;
  }

  it('emits at least one transfer across a spread of transfer-variant games', () => {
    let total = 0;
    for (const seed of [1, 7, 42, 100, 2026, 31337]) {
      for (const n of [3, 4]) total += countBotTransfers(n, 'transfer', seed);
    }
    expect(total).toBeGreaterThan(0);
  });

  it('never transfers in the simple variant', () => {
    let total = 0;
    for (const seed of [1, 7, 42]) total += countBotTransfers(3, 'simple', seed);
    expect(total).toBe(0);
  });
});

// --- §3a One-time trump-show transfer (Stage 13.4) -------------------------
describe('trump-show transfer (one-time, card stays in hand)', () => {
  // A defending state: P0 opened with 7♥ (trump = spades). P1 (defender) holds the
  // trump seven (7♠) → may SHOW-transfer; P2 holds a non-trump seven (7♣) for a
  // subsequent regular transfer. All hands large enough to receive the count.
  const opened = (over: Partial<DurakState> = {}): DurakState => st({
    variant: 'transfer',
    trumpSuit: 'spades', trumpCard: C('6', 'spades'),
    players: [
      P(0, [C('9', 'clubs')]),
      P(1, [C('7', 'spades'), C('8', 'hearts')]),        // defender holds trump-7
      P(2, [C('7', 'clubs'), C('8', 'diamonds'), C('9', 'diamonds')]),
      P(3, [C('8', 'spades'), C('9', 'hearts'), C('10', 'diamonds'), C('J', 'clubs')]),
    ],
    attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, lastThrowerIndex: 0,
    table: [{ attack: C('7', 'hearts'), defense: null }],
    status: 'defense',
    ...over,
  });

  it('is legal once; shows the trump WITHOUT placing it (hand + table unchanged)', () => {
    const s0 = opened();
    expect(canTrumpShowTransfer(s0)).toBe(true);
    expect(getValidTrumpShowCards(s0)).toEqual([C('7', 'spades')]);

    const s1 = durakReducer(s0, { type: 'TRUMP_SHOW_TRANSFER', card: C('7', 'spades') })!;
    // Table length unchanged (card NOT placed); the shown trump stays in hand.
    expect(s1.table).toHaveLength(1);
    expect(s1.table[0].attack).toEqual(C('7', 'hearts'));
    expect(s1.players[1].hand).toContainEqual(C('7', 'spades')); // still held
    expect(s1.players[1].hand).toHaveLength(2);                  // no card left the hand
    // Defender changed correctly; the shower became the new primary attacker.
    expect(s1.defenderIndex).toBe(2);
    expect(s1.attackerIndex).toBe(1);
    expect(s1.status).toBe('defense');
    // Public announcement + one-time flag.
    expect(s1.trumpShowUsed).toBe(true);
    expect(s1.lastTrumpShow).toEqual({ seat: 1, card: C('7', 'spades') });
  });

  it('rejects a SECOND trump-show in the same bout (once per bout)', () => {
    // Conditions otherwise hold (defender P2 also happens to hold a trump-7 here),
    // but the one-time option is already spent this bout.
    const spent = opened({
      trumpShowUsed: true,
      defenderIndex: 2,
      players: [
        P(0, [C('9', 'clubs')]),
        P(1, [C('8', 'hearts')]),
        P(2, [C('7', 'spades'), C('8', 'diamonds'), C('9', 'diamonds')]), // holds trump-7
        P(3, [C('8', 'spades'), C('9', 'hearts'), C('10', 'diamonds'), C('J', 'clubs')]),
      ],
    });
    expect(canTrumpShowTransfer(spent)).toBe(false);
    const after = durakReducer(spent, { type: 'TRUMP_SHOW_TRANSFER', card: C('7', 'spades') });
    expect(after).toBe(spent); // no-op (same reference)
  });

  it('still allows a REGULAR (card-placed) transfer after a trump-show', () => {
    const s1 = durakReducer(opened(), { type: 'TRUMP_SHOW_TRANSFER', card: C('7', 'spades') })!;
    // P2 is now the defender and holds a non-trump 7 → a normal transfer is legal.
    expect(canTransfer(s1)).toBe(true);
    const s2 = durakReducer(s1, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') })!;
    expect(s2.table).toHaveLength(2);                 // the card WAS placed this time
    expect(s2.table[1].attack).toEqual(C('7', 'clubs'));
    expect(s2.defenderIndex).toBe(3);
    expect(s2.trumpShowUsed).toBe(true);              // flag persists across the bout
  });

  it('rejects a trump-show in the SIMPLE variant', () => {
    const simple = opened({ variant: 'simple' });
    expect(canTrumpShowTransfer(simple)).toBe(false);
    const after = durakReducer(simple, { type: 'TRUMP_SHOW_TRANSFER', card: C('7', 'spades') });
    expect(after).toBe(simple); // no-op
  });

  it('re-arms the option at the next bout (flag reset by rotateRoles)', () => {
    // A beaten table; the attacker passes and no attacker can throw in → the bout
    // resolves (defended) and roles rotate to a NEW bout (all seats keep cards +
    // a draw pile, so the game continues), which must reset trumpShowUsed.
    const nearEnd = st({
      variant: 'transfer', trumpSuit: 'spades', trumpCard: C('6', 'spades'),
      drawPile: [C('5', 'clubs'), C('4', 'clubs')], // draws keep everyone non-empty
      players: [P(0, [C('K', 'diamonds')]), P(1, [C('9', 'diamonds')]), P(2, [C('Q', 'clubs')])],
      attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, lastThrowerIndex: 0,
      table: [{ attack: C('7', 'hearts'), defense: C('8', 'hearts') }], // already beaten
      status: 'attack', trumpShowUsed: true, lastTrumpShow: { seat: 1, card: C('7', 'spades') },
    });
    const next = durakReducer(nearEnd, { type: 'PASS_ATTACK' })!;
    expect(next.status).not.toBe('finished');  // the game continues (new bout)
    expect(next.table).toHaveLength(0);        // bout resolved
    expect(next.trumpShowUsed).toBe(false);    // re-armed for the next bout
    expect(next.lastTrumpShow).toBeNull();
  });

  it('never leaks the shower’s other cards in redaction (only the shown trump)', () => {
    const s1 = durakReducer(opened(), { type: 'TRUMP_SHOW_TRANSFER', card: C('7', 'spades') })!;
    // An opponent (seat 3) views the state: the shower's (seat 1) hand is hidden…
    const view = durakRedactStateFor(s1, 3);
    expect(view.players[1].hand.every((c) => c.rank === '?')).toBe(true); // all hidden
    expect(JSON.stringify(view.players[1].hand)).not.toContain('8');      // 8♥ not leaked
    // …but the PUBLIC show announcement carries the (rule-mandated, deducible) card.
    expect(view.lastTrumpShow).toEqual({ seat: 1, card: C('7', 'spades') });
    expect(view.trumpShowUsed).toBe(true);
  });

  it('bot games with the new action type still terminate (transfer variant)', () => {
    // The AI never emits a trump-show, but the enlarged action union must not break
    // deterministic bot playouts. Reuse the existing bot-driven termination path.
    for (const seed of [3, 11, 23]) {
      let s = durakReducer(null, {
        type: 'START_DURAK', variant: 'transfer',
        playerNames: ['A', 'B', 'C'], playerTypes: ['ai', 'ai', 'ai'],
      }, { rng: makeRng(seed) })!;
      let guard = 0;
      while (s.status !== 'finished' && guard++ < 5000) {
        const a = durakBotAction(s);
        if (!a) break;
        s = durakReducer(s, a)!;
      }
      expect(s.status).toBe('finished');
    }
  });
});
