import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { pokerReducer } from './engine';
import { pokerBotAction } from './ai';
import { checkPokerInvariants, totalChips } from './invariants';
import { getActingPokerSeat, legalActions } from './rules';
import type { PokerAction, PokerState } from './types';

function start(playerCount: number, seed: number): PokerState {
  const names = Array.from({ length: playerCount }, (_, i) => `P${i}`);
  return pokerReducer(null, {
    type: 'START_GAME', playerNames: names, playerTypes: names.map(() => 'ai' as const), playerCount, buttonSeat: 0,
  }, { rng: makeRng(seed) }) as PokerState;
}

/** Whether the bot's action is one the reducer will accept (a legal move). */
function isLegal(state: PokerState, seat: number, action: PokerAction): boolean {
  const la = legalActions(state, seat);
  switch (action.type) {
    case 'FOLD': return la.canFold;
    case 'CHECK': return la.canCheck;
    case 'CALL': return la.canCall;
    case 'BET': return la.canBet && action.amount >= la.minBet && action.amount <= la.maxTo;
    case 'RAISE': return la.canRaise && action.amount > state.currentBet && action.amount <= la.maxTo;
    case 'ALL_IN': return la.canAllIn;
    default: return false;
  }
}

describe('poker bot — always legal & deterministic (§12)', () => {
  it('every bot move for the acting seat is legal', () => {
    let s = start(4, 55);
    for (let i = 0; i < 12 && s.phase === 'betting'; i++) {
      const seat = getActingPokerSeat(s)!;
      const action = pokerBotAction(s, seat);
      expect(isLegal(s, seat, action), `illegal bot move ${JSON.stringify(action)}`).toBe(true);
      const next = pokerReducer(s, action) as PokerState;
      expect(next).not.toBe(s); // accepted (progressed)
      s = next;
    }
  });

  it('is deterministic — same state yields the same action', () => {
    const s = start(3, 88);
    const seat = getActingPokerSeat(s)!;
    expect(pokerBotAction(s, seat)).toEqual(pokerBotAction(s, seat));
  });
});

describe('poker bot — full-match soak (engine terminates, chips conserved)', () => {
  for (const [count, seed] of [[2, 1], [3, 2], [4, 3], [6, 4]] as const) {
    it(`drives a ${count}-player match to a single winner`, () => {
      let s = start(count, seed);
      const total = totalChips(s);
      let steps = 0;
      while (s.phase !== 'game_finished' && steps < 20000) {
        steps++;
        if (s.phase === 'betting') {
          const seat = getActingPokerSeat(s)!;
          const action = pokerBotAction(s, seat);
          const next = pokerReducer(s, action) as PokerState;
          expect(next, `bot deadlock at step ${steps}: ${JSON.stringify(action)}`).not.toBe(s);
          s = next;
        } else if (s.phase === 'hand_complete') {
          s = pokerReducer(s, { type: 'START_NEXT_HAND' }, { rng: makeRng(seed * 1000 + steps) }) as PokerState;
        }
        // Chips are conserved and the state is well-formed at every step.
        const chips = s.stacksBySeat.reduce((a, b) => a + b, 0) + (s.phase === 'betting' ? s.contributedBySeat.reduce((a, b) => a + b, 0) : 0);
        expect(chips).toBe(total);
        expect(checkPokerInvariants(s)).toEqual([]);
      }
      expect(s.phase).toBe('game_finished');
      expect(s.winnerSeat).not.toBeNull();
      // The winner holds every chip.
      expect(s.stacksBySeat[s.winnerSeat!]).toBe(total);
    });
  }
});
