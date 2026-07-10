import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import type { Rng } from '../../core/rng';
import { preferansReducer } from '../../games/preferans/engine';
import { bidRank } from '../../games/preferans/rules';
import type { Card, PreferansAction, PreferansState } from '../../games/preferans/types';
import { allBidShapes, validBids, validDeclareContracts } from './bids';

// The screen renders only LEGAL options; these tests exercise the pure builders it
// derives them from (no DOM needed — mirrors the tarneeb local-wiring approach).

function start(dealerSeat: number, rng: Rng): PreferansState {
  return preferansReducer(null, {
    type: 'START_GAME',
    playerNames: ['You', 'Mira AI', 'Niko AI'],
    playerTypes: ['human', 'ai', 'ai'],
    options: { targetScore: 10 },
    dealerSeat,
  }, { rng }) as PreferansState;
}

/** Bid `bid` as the human (seat 0), then pass seats 1 & 2 → human wins → talon. */
function reachTalonAsDeclarer(bid: { level: number; suit: Card['suit'] | 'NT' }, rng: Rng): PreferansState {
  let s = start(2, rng); // dealer 2 → seat 0 (human) opens
  s = preferansReducer(s, { type: 'BID', level: bid.level, suit: bid.suit }, { rng })!;
  s = preferansReducer(s, { type: 'PASS_BID' }, { rng })!; // seat 1
  s = preferansReducer(s, { type: 'PASS_BID' }, { rng })!; // seat 2 → enterTalon(0)
  return s;
}

describe('allBidShapes / validBids', () => {
  it('there are 25 total contract shapes (levels 6–10 × ♠♣♦♥NT)', () => {
    expect(allBidShapes()).toHaveLength(25);
  });

  it('every shape is legal to open, but only strictly-higher shapes stay legal after a bid', () => {
    const s = start(2, makeRng(4)); // seat 0 opens
    expect(validBids(s, 0)).toHaveLength(25);
    // Non-acting seats have no legal bids.
    expect(validBids(s, 1)).toHaveLength(0);

    const afterMid = preferansReducer(s, { type: 'BID', level: 8, suit: 'clubs' }, { rng: makeRng(4) })!;
    const nextSeat = afterMid.currentSeat;
    const legal = validBids(afterMid, nextSeat);
    // Only shapes strictly above 8♣ remain.
    const floor = bidRank({ level: 8, suit: 'clubs' });
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((b) => bidRank(b) > floor)).toBe(true);
  });
});

describe('discard requires exactly 2 distinct cards from the 12-card hand', () => {
  it('after taking the talon, only a 2-distinct-card discard is legal', () => {
    let s = reachTalonAsDeclarer({ level: 6, suit: 'spades' }, makeRng(9));
    expect(s.phase).toBe('talon');
    expect(s.declarerSeat).toBe(0);
    s = preferansReducer(s, { type: 'TAKE_TALON' }, { rng: makeRng(9) })!;
    expect(s.handsBySeat[0]).toHaveLength(12);

    const hand = s.handsBySeat[0];
    // Exactly 2 distinct cards → legal; DISCARD advances to the declare step (10 left).
    const good = preferansReducer(s, { type: 'DISCARD', cards: [hand[0], hand[1]] }, { rng: makeRng(9) })!;
    expect(good.handsBySeat[0]).toHaveLength(10);
    expect(good.discards).toHaveLength(2);

    // One card, three cards, or a duplicate are all rejected (state unchanged).
    const one = preferansReducer(s, { type: 'DISCARD', cards: [hand[0]] as unknown as [Card, Card] }, { rng: makeRng(9) });
    expect(one).toBe(s);
    const three = preferansReducer(s, { type: 'DISCARD', cards: [hand[0], hand[1], hand[2]] as unknown as [Card, Card] }, { rng: makeRng(9) });
    expect(three).toBe(s);
    const dup = preferansReducer(s, { type: 'DISCARD', cards: [hand[0], hand[0]] }, { rng: makeRng(9) });
    expect(dup).toBe(s);
  });
});

describe('declare options are all >= the winning bid', () => {
  it('validDeclareContracts includes the winning bid and nothing below it', () => {
    const winning = { level: 8, suit: 'hearts' as const };
    let s = reachTalonAsDeclarer(winning, makeRng(13));
    s = preferansReducer(s, { type: 'TAKE_TALON' }, { rng: makeRng(13) })!;
    const hand = s.handsBySeat[0];
    s = preferansReducer(s, { type: 'DISCARD', cards: [hand[0], hand[1]] }, { rng: makeRng(13) })!;
    expect(s.discards).toHaveLength(2);
    expect(s.contract).toBeNull();

    const options = validDeclareContracts(s, 0);
    const floor = bidRank(winning);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((b) => bidRank(b) >= floor)).toBe(true);
    expect(options.some((b) => b.level === winning.level && b.suit === winning.suit)).toBe(true);
    // A shape strictly below the winning bid (8♣ < 8♥) is not offered.
    expect(options.some((b) => b.level === 8 && b.suit === 'clubs')).toBe(false);

    // Declaring the minimum enters play (left-of-declarer leads).
    const played = preferansReducer(s, { type: 'DECLARE_CONTRACT', level: winning.level, suit: winning.suit }, { rng: makeRng(13) })!;
    expect(played.phase).toBe('playing');
    expect(played.contract).toMatchObject(winning);
  });
});
