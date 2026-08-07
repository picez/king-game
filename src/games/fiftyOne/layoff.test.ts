// ---------------------------------------------------------------------------
// Stage 38.0.9 — explicit lay-off placement (§9 owner clarification) + the pure side
// of the intermittent `6♠ Joker 8♠` report.
//
// RED measured on 87f00f3:
//   D — `[6♠,7♠,Joker=8♠] + 5♠` was REJECTED (the reducer always appended, producing
//       `[6,7,J,5]`), although `[5,6,7,J]` is obviously a run.
//   E — `Joker + [4♠,5♠,6♠]` is legal at BOTH ends (3♠ or 7♠) and the action carried no
//       side at all, so the player could not choose.
//   F — the pure engine already accepted every permutation of `6♠ Joker 8♠` (value 21),
//       so the rules were never the problem: the UI selection lifecycle was.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  resolveMeld, legalLayoffPlacements, layoffCandidate, isLayoffPlacement, LAYOFF_PLACEMENTS,
} from './melds';
import { fiftyOneReducer } from './engine';
import type { FiftyOneCard, FiftyOneMeld, FiftyOneState } from './types';
import type { Rank, Suit } from '../../models/types';

let n = 0;
const c = (rank: Rank, suit: Suit): FiftyOneCard => ({ id: `c${n++}`, joker: false, suit, rank });
const J = (): FiftyOneCard => ({ id: `j${n++}`, joker: true, suit: null, rank: null });
const show = (cards: readonly FiftyOneCard[]): string =>
  cards.map((x) => (x.joker ? 'J' : `${x.rank}`)).join('-');

function meldOf(id: string, cards: FiftyOneCard[]): FiftyOneMeld {
  const r = resolveMeld(cards)!;
  return { id, ownerSeat: 0, type: r.type, cards: r.cards, jokerRepresents: r.jokerRepresents, value: r.value };
}

/** A PLAYING state at seat 0's meld step, already opened. */
function state(hand: FiftyOneCard[], melds: FiftyOneMeld[], over: Partial<FiftyOneState> = {}): FiftyOneState {
  return {
    gameType: 'fifty-one', phase: 'playing', playerCount: 2, currentSeat: 0, turnStep: 'meld_discard',
    players: [
      { id: 'player-0', name: 'A', seatIndex: 0, type: 'human' },
      { id: 'player-1', name: 'B', seatIndex: 1, type: 'human' },
    ],
    dealerSeat: 0, starterSeat: 0,
    handsBySeat: [hand, [c('2', 'clubs')]],
    drawPile: [c('3', 'clubs')], discardPile: [c('9', 'clubs')],
    openedBySeat: [true, true], publicMelds: melds,
    scoresBySeat: [0, 0], eliminatedSeats: [false, false],
    roundNumber: 1, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
    options: { targetPenalty: 510 },
    ...over,
  } as unknown as FiftyOneState;
}

describe('the placement type itself', () => {
  it('is exactly two sides, and nothing else validates', () => {
    expect([...LAYOFF_PLACEMENTS]).toEqual(['start', 'end']);
    expect(isLayoffPlacement('start')).toBe(true);
    expect(isLayoffPlacement('end')).toBe(true);
    for (const bad of ['middle', '', 0, 1, null, undefined, {}, ['start']]) {
      expect(isLayoffPlacement(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('keeps the SELECTION order and can only ever prepend or append', () => {
    const meld = [c('6', 'spades'), c('7', 'spades'), c('8', 'spades')];
    const sel = [c('4', 'spades'), c('5', 'spades')];
    expect(show(layoffCandidate(meld, sel, 'start'))).toBe('4-5-6-7-8');
    expect(show(layoffCandidate(meld, sel, 'end'))).toBe('6-7-8-4-5');
    // There is no third shape — an insertion INSIDE the run is not expressible.
    expect(layoffCandidate(meld, sel, 'start')).toHaveLength(5);
  });
});

describe('FAIL D — a card that extends the START of a run', () => {
  it('the exact owner case: [6♠,7♠,Joker=8♠] + 5♠ at start → [5,6,7,Joker=8♠]', () => {
    const m = meldOf('m1', [c('6', 'spades'), c('7', 'spades'), J()]);
    expect(show(m.cards)).toBe('6-7-J');
    expect(m.jokerRepresents[2]).toEqual({ suit: 'spades', rank: '8' });

    const five = c('5', 'spades');
    const options = legalLayoffPlacements(m.cards, [five]);
    expect(options.map((o) => o.placement)).toEqual(['start']);      // ONLY the start is legal
    expect(show(options[0].resolved.cards)).toBe('5-6-7-J');
    expect(options[0].resolved.jokerRepresents[3]).toEqual({ suit: 'spades', rank: '8' });

    const s = state([five, c('K', 'hearts')], [m]);
    const next = fiftyOneReducer(s, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [five], placement: 'start' });
    expect(next).not.toBe(s);
    const out = (next as FiftyOneState).publicMelds[0];
    expect(show(out.cards)).toBe('5-6-7-J');
    expect(out.jokerRepresents[3]).toEqual({ suit: 'spades', rank: '8' }); // the joker did NOT move
    expect(out.value).toBe(5 + 6 + 7 + 8);
    expect((next as FiftyOneState).handsBySeat[0].map((x) => x.id)).not.toContain(five.id);
  });

  it('the WRONG side is refused without changing the state reference', () => {
    const m = meldOf('m1', [c('6', 'spades'), c('7', 'spades'), J()]);
    const five = c('5', 'spades');
    const s = state([five, c('K', 'hearts')], [m]);
    expect(fiftyOneReducer(s, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [five], placement: 'end' })).toBe(s);
  });

  it('an Ace joins a 2-3-4 run at the start (Ace-low, 30.10)', () => {
    const m = meldOf('m1', [c('2', 'spades'), c('3', 'spades'), c('4', 'spades')]);
    const ace = c('A', 'spades');
    // Both inputs resolve to the SAME canonical A-2-3-4, so it is reported once.
    expect(legalLayoffPlacements(m.cards, [ace]).map((o) => o.placement)).toEqual(['start']);
    const s = state([ace, c('K', 'hearts')], [m]);
    const out = (fiftyOneReducer(s, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [ace], placement: 'start' }) as FiftyOneState).publicMelds[0];
    expect(show(out.cards)).toBe('A-2-3-4');
    expect(out.value).toBe(1 + 2 + 3 + 4);
  });

  it('K-A-2 stays illegal from either side', () => {
    const m = meldOf('m1', [c('Q', 'spades'), c('K', 'spades'), c('A', 'spades')]);
    expect(legalLayoffPlacements(m.cards, [c('2', 'spades')])).toEqual([]);
  });

  it('several selected cards keep their order and extend one side together', () => {
    const m = meldOf('m1', [c('6', 'spades'), c('7', 'spades'), c('8', 'spades')]);
    const four = c('4', 'spades'); const five = c('5', 'spades');
    // Both sides produce the identical canonical 4-5-6-7-8, so ONE option is offered.
    expect(legalLayoffPlacements(m.cards, [four, five]).map((o) => o.placement)).toEqual(['start']);
    const s = state([four, five, c('K', 'hearts')], [m]);
    const out = (fiftyOneReducer(s, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [four, five], placement: 'start' }) as FiftyOneState).publicMelds[0];
    expect(show(out.cards)).toBe('4-5-6-7-8');
  });
});

describe('FAIL E — an AMBIGUOUS joker lay-off offers BOTH sides', () => {
  it('the exact owner case: Joker + [4♠,5♠,6♠] → 3♠ at the start OR 7♠ at the end', () => {
    const m = meldOf('m1', [c('4', 'spades'), c('5', 'spades'), c('6', 'spades')]);
    const joker = J();
    const options = legalLayoffPlacements(m.cards, [joker]);
    expect(options.map((o) => o.placement)).toEqual(['start', 'end']);
    expect(options[0].resolved.jokerRepresents[0]).toEqual({ suit: 'spades', rank: '3' });
    expect(options[1].resolved.jokerRepresents[3]).toEqual({ suit: 'spades', rank: '7' });

    // Each choice really produces its own meld, and the reducer honours it.
    for (const o of options) {
      const s = state([joker, c('K', 'hearts')], [meldOf('m1', [c('4', 'spades'), c('5', 'spades'), c('6', 'spades')])]);
      const out = (fiftyOneReducer(s, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [joker], placement: o.placement }) as FiftyOneState).publicMelds[0];
      if (o.placement === 'start') {
        expect(show(out.cards)).toBe('J-4-5-6');
        expect(out.jokerRepresents[0]).toEqual({ suit: 'spades', rank: '3' });
        expect(out.value).toBe(3 + 4 + 5 + 6);
      } else {
        expect(show(out.cards)).toBe('4-5-6-J');
        expect(out.jokerRepresents[3]).toEqual({ suit: 'spades', rank: '7' });
        expect(out.value).toBe(4 + 5 + 6 + 7);
      }
    }
  });

  it('an UNAMBIGUOUS card gets exactly one side — no pointless question', () => {
    const m = meldOf('m1', [c('4', 'spades'), c('5', 'spades'), c('6', 'spades')]);
    // A plain card has ONE outcome whichever way it is handed in, so exactly one option.
    expect(legalLayoffPlacements(m.cards, [c('3', 'spades')])).toHaveLength(1);
    expect(legalLayoffPlacements(m.cards, [c('7', 'spades')])).toHaveLength(1);
    expect(legalLayoffPlacements(m.cards, [c('9', 'hearts')])).toEqual([]);
  });

  it('a joker at the very bottom or top of the range has only one legal side', () => {
    const low = meldOf('m1', [c('2', 'spades'), c('3', 'spades'), c('4', 'spades')]);
    // Nothing sits below 2 in an Ace-HIGH reading, but Ace-low makes `J-2-3-4` = A-2-3-4.
    expect(legalLayoffPlacements(low.cards, [J()]).map((o) => o.placement)).toEqual(['start', 'end']);
    const high = meldOf('m2', [c('Q', 'spades'), c('K', 'spades'), c('A', 'spades')]);
    expect(legalLayoffPlacements(high.cards, [J()]).map((o) => o.placement)).toEqual(['start']);
  });

  it('a SET never asks a side — it is normalised to `end` exactly once', () => {
    const set = meldOf('m1', [c('Q', 'hearts'), c('Q', 'clubs'), c('Q', 'diamonds')]);
    const options = legalLayoffPlacements(set.cards, [c('Q', 'spades')]);
    expect(options).toHaveLength(1);
    expect(options[0].placement).toBe('end');
    expect(options[0].resolved.type).toBe('set');
    // A duplicate identical card is still refused (§6).
    expect(legalLayoffPlacements(set.cards, [c('Q', 'hearts')])).toEqual([]);
    // A joker completing the fourth suit works, still with one option.
    const three = meldOf('m2', [c('7', 'hearts'), c('7', 'clubs'), c('7', 'diamonds')]);
    expect(legalLayoffPlacements(three.cards, [J()])).toHaveLength(1);
  });

  it('either side of a SET action is accepted and normalised by the reducer', () => {
    const q = c('Q', 'spades');
    for (const placement of LAYOFF_PLACEMENTS) {
      const s = state([q, c('K', 'hearts')], [meldOf('m1', [c('Q', 'hearts'), c('Q', 'clubs'), c('Q', 'diamonds')])]);
      const next = fiftyOneReducer(s, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [q], placement });
      expect(next, placement).not.toBe(s);
      expect((next as FiftyOneState).publicMelds[0].cards, placement).toHaveLength(4);
      expect((next as FiftyOneState).publicMelds[0].value, placement).toBe(40);
    }
  });
});

describe('the reducer never trusts the caller', () => {
  const base = () => {
    const m = meldOf('m1', [c('6', 'spades'), c('7', 'spades'), c('8', 'spades')]);
    const five = c('5', 'spades');
    return { m, five, s: state([five, c('K', 'hearts')], [m]) };
  };

  it('a missing or unknown placement is refused, not guessed', () => {
    const { five, s } = base();
    for (const placement of [undefined, null, 'middle', 'START', 0, {}]) {
      const next = fiftyOneReducer(s, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [five], placement } as never);
      expect(next, String(placement)).toBe(s);
    }
  });

  it('a malformed payload never throws and never changes the state', () => {
    const { s } = base();
    for (const action of [
      { type: 'ADD_TO_MELD', meldId: 'nope', cards: [], placement: 'start' },
      { type: 'ADD_TO_MELD', meldId: 'm1', cards: [], placement: 'start' },
      { type: 'ADD_TO_MELD', meldId: 'm1', cards: null, placement: 'start' },
      { type: 'ADD_TO_MELD', meldId: 'm1', cards: [{ id: 'ghost', joker: false, suit: 'spades', rank: '5' }], placement: 'start' },
      { type: 'ADD_TO_MELD', cards: [], placement: 'end' },
    ]) {
      expect(() => fiftyOneReducer(s, action as never)).not.toThrow();
      expect(fiftyOneReducer(s, action as never)).toBe(s);
    }
  });

  it('an UNOPENED seat, the wrong step and the last card are all still refused', () => {
    const { five, m } = base();
    const unopened = state([five, c('K', 'hearts')], [m], { openedBySeat: [false, true] } as never);
    expect(fiftyOneReducer(unopened, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [five], placement: 'start' })).toBe(unopened);

    const drawStep = state([five, c('K', 'hearts')], [m], { turnStep: 'draw' } as never);
    expect(fiftyOneReducer(drawStep, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [five], placement: 'start' })).toBe(drawStep);

    const lastCard = state([five], [m]);   // must keep one card to discard (§5)
    expect(fiftyOneReducer(lastCard, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [five], placement: 'start' })).toBe(lastCard);
  });

  it('a client cannot forge a legal preview — the reducer re-derives it', () => {
    // The action claims `end` for a card that only fits at the START of a JOKER run —
    // exactly the owner case. No amount of client-side "it looked valid" changes it.
    const m = meldOf('m1', [c('6', 'spades'), c('7', 'spades'), J()]);
    const five = c('5', 'spades');
    const s = state([five, c('K', 'hearts')], [m]);
    expect(fiftyOneReducer(s, { type: 'ADD_TO_MELD', meldId: 'm1', cards: [five], placement: 'end' })).toBe(s);
  });
});

describe('FAIL F — the pure rules always accepted 6♠ + Joker + 8♠', () => {
  it('every selection permutation resolves to 6-J-8 worth 21', () => {
    const six = c('6', 'spades'); const eight = c('8', 'spades'); const joker = J();
    const perms: FiftyOneCard[][] = [
      [six, joker, eight], [six, eight, joker], [joker, six, eight],
      [joker, eight, six], [eight, six, joker], [eight, joker, six],
    ];
    for (const p of perms) {
      const r = resolveMeld(p);
      expect(r, show(p)).not.toBeNull();
      expect(show(r!.cards), show(p)).toBe('6-J-8');
      expect(r!.jokerRepresents[1], show(p)).toEqual({ suit: 'spades', rank: '7' });
      expect(r!.value, show(p)).toBe(21);
    }
  });

  it('the reducer lays it as a fresh meld from any picked order', () => {
    const six = c('6', 'spades'); const eight = c('8', 'spades'); const joker = J();
    for (const order of [[six, joker, eight], [eight, six, joker], [joker, eight, six]]) {
      const s = state([...order, c('K', 'hearts')], []);
      const next = fiftyOneReducer(s, { type: 'OPEN_MELDS', melds: [order] });
      expect(next, show(order)).not.toBe(s);
      const laid = (next as FiftyOneState).publicMelds[0];
      expect(show(laid.cards), show(order)).toBe('6-J-8');
      expect(laid.jokerRepresents[1], show(order)).toEqual({ suit: 'spades', rank: '7' });
      expect(laid.value, show(order)).toBe(21);
    }
  });

  it('duplicate physical cards from the second deck are distinct ids, not a duplicate rank', () => {
    const sixA = c('6', 'spades'); const sixB = c('6', 'spades');
    expect(sixA.id).not.toBe(sixB.id);
    expect(resolveMeld([sixA, sixB, c('7', 'spades')])).toBeNull();   // 6-6-7 is not a run
    // …but two 6♠ from two decks in a SET is still one duplicate suit → refused.
    expect(resolveMeld([sixA, sixB, c('6', 'hearts')])).toBeNull();
  });
});

describe('the bot uses the same helper and always sends a placement', () => {
  it('finds a START lay-off the old append-only probe could never see', async () => {
    const { fiftyOneBotAction } = await import('./ai');
    const m = meldOf('m1', [c('6', 'spades'), c('7', 'spades'), c('8', 'spades')]);
    const five = c('5', 'spades');
    const s = state([five, c('K', 'hearts')], [m]);
    const action = fiftyOneBotAction(s, 0) as { type: string; placement?: string; cards?: FiftyOneCard[] };
    expect(action.type).toBe('ADD_TO_MELD');
    expect(isLayoffPlacement(action.placement)).toBe(true);
    // …and the reducer accepts what the bot produced.
    expect(fiftyOneReducer(s, action as never)).not.toBe(s);
  });

  it('never emits an ADD_TO_MELD without a placement', async () => {
    const { fiftyOneBotAction } = await import('./ai');
    const m = meldOf('m1', [c('6', 'spades'), c('7', 'spades'), c('8', 'spades')]);
    for (const card of [c('5', 'spades'), c('9', 'spades'), J()]) {
      const s = state([card, c('K', 'hearts')], [m]);
      const a = fiftyOneBotAction(s, 0) as { type: string; placement?: unknown };
      if (a.type === 'ADD_TO_MELD') expect(isLayoffPlacement(a.placement), String(card.rank)).toBe(true);
    }
  });
});
