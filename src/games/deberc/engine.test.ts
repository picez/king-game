import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import type { Rank, Suit } from '../../models/types';
import { seqValue } from './deck';
import {
  applyMark, currentLegalPlays, debercReducer, getActingDebercPlayerId, isDebercFinished,
} from './engine';
import type { DebercAction, DebercState } from './types';

/** A card in the given suit/rank (for crafting known melds). */
const c = (suit: Suit, rank: Rank) => ({ suit, rank, value: seqValue(rank) });
/** The first non-trump suit for the state (for crafting a declarable run). */
const someNonTrump = (s: DebercState): Suit =>
  (['spades', 'hearts', 'diamonds', 'clubs'] as Suit[]).find((x) => x !== s.trumpSuit)!;

function start(numPlayers: number, matchSize: 'small' | 'big', seed: number): DebercState {
  const names = Array.from({ length: numPlayers }, (_, i) => `P${i}`);
  const types = names.map(() => 'ai' as const);
  const s = debercReducer(null, { type: 'START_DEBERC', playerNames: names, playerTypes: types, matchSize }, { rng: makeRng(seed) });
  if (!s) throw new Error('start failed');
  return s;
}

/** Drive bidding: the first bidder accepts the table trump (→ declaring phase). */
function acceptTableTrump(s: DebercState): DebercState {
  return debercReducer(s, { type: 'BID', suit: s.tableTrumpCard.suit }, {})!;
}

/** Pass every seat's meld declaration (declare nothing) until play opens. */
function declareAllPass(s: DebercState): DebercState {
  let cur = s;
  let guard = 0;
  while (cur.phase === 'declaring' && guard++ < 10) {
    cur = debercReducer(cur, { type: 'DECLARE_MELD', melds: [] }, {})!;
  }
  return cur;
}

/** Accept the table trump, then pass all declarations → a fresh 'playing' hand. */
function toPlaying(s: DebercState): DebercState {
  return declareAllPass(acceptTableTrump(s));
}

/** Auto-play a whole hand with a fixed policy (lowest legal card) until it ends. */
function playOutHand(state: DebercState, ctx = { rng: makeRng(1) }): DebercState {
  let s = state;
  let guard = 0;
  while (s.phase !== 'hand_scoring' && s.phase !== 'finished' && guard++ < 500) {
    if (s.phase === 'declaring') {
      s = debercReducer(s, { type: 'DECLARE_MELD', melds: [] }, ctx)!; // pass
      continue;
    }
    if (s.phase === 'trick_complete') {
      s = debercReducer(s, { type: 'NEXT_TRICK' }, ctx)!;
      continue;
    }
    if (s.phase === 'playing') {
      const legal = currentLegalPlays(s);
      s = debercReducer(s, { type: 'PLAY_CARD', card: legal[0] }, ctx)!;
      continue;
    }
    break;
  }
  return s;
}

describe('debercReducer — start', () => {
  it('rejects player counts other than 3 or 4', () => {
    expect(debercReducer(null, { type: 'START_DEBERC', playerNames: ['a', 'b'], matchSize: 'small' }, {})).toBeNull();
    expect(debercReducer(null, { type: 'START_DEBERC', playerNames: ['a', 'b', 'c', 'd', 'e'], matchSize: 'small' }, {})).toBeNull();
  });

  it('3 players: three solo teams, bidding open on 6-card hands + 3 прикуп', () => {
    const s = start(3, 'small', 5);
    expect(s.teamCount).toBe(3);
    expect(s.teamOf).toEqual([0, 1, 2]);
    expect(s.phase).toBe('bidding');
    expect(s.players.map((p) => p.hand.length)).toEqual([6, 6, 6]); // v1.1: bid on 6
    expect(s.prykup.map((p) => p.length)).toEqual([3, 3, 3]);
    expect(s.stock).toHaveLength(5); // 32-card deck (3p): 32 − 27 dealt
    expect(s.bidderSeat).toBe((s.dealerSeat + 1) % 3); // dealer speaks last
  });

  it('4 players: two teams of 2 (0&2 vs 1&3), whole deck dealt (6 + 3 each)', () => {
    const s = start(4, 'big', 3);
    expect(s.teamCount).toBe(2);
    expect(s.teamOf).toEqual([0, 1, 0, 1]);
    expect(s.stock).toHaveLength(0);
    expect(s.players.map((p) => p.hand.length)).toEqual([6, 6, 6, 6]);
    expect(s.prykup.map((p) => p.length)).toEqual([3, 3, 3, 3]);
  });

  it('a second START is illegal (returns the same state)', () => {
    const s = start(3, 'small', 1);
    const again = debercReducer(s, { type: 'START_DEBERC', playerNames: ['x', 'y', 'z'], matchSize: 'big' }, {});
    expect(again).toBe(s);
  });
});

describe('debercReducer — bidding (§3)', () => {
  it('accepting the table trump commits it, takes прикуп (→9), opens declaring', () => {
    const s0 = start(3, 'small', 5);
    const acceptor = s0.bidderSeat;
    const trump = s0.tableTrumpCard.suit;
    const s1 = acceptTableTrump(s0);
    expect(s1.phase).toBe('declaring');              // v1.1: melds declared before play
    expect(s1.trumpSuit).toBe(trump);
    expect(s1.objazSeat).toBe(acceptor);             // intercepts the об'яз role
    expect(s1.meldTurnSeat).toBe(acceptor);          // об'яз declares first
    expect(s1.players.map((p) => p.hand.length)).toEqual([9, 9, 9]); // прикуп taken
    expect(s1.prykup.every((p) => p.length === 0)).toBe(true);
    expect(s1.dealtHands).toHaveLength(3);
    const s2 = declareAllPass(s1);
    expect(s2.phase).toBe('playing');
    expect(s2.turnSeat).toBe(acceptor);              // об'яз leads the first trick
  });

  it('all pass round 1 → round 2, then a free suit can be declared', () => {
    let s = start(3, 'small', 5);
    const n = 3;
    for (let i = 0; i < n; i++) s = debercReducer(s, { type: 'BID', suit: null }, {})!;
    expect(s.phase).toBe('bidding');
    expect(s.bidRound).toBe(2);
    expect(s.bidderSeat).toBe((s.dealerSeat + 1) % n);
    const free: Suit = s.tableTrumpCard.suit === 'spades' ? 'hearts' : 'spades';
    const seat = s.bidderSeat;
    s = debercReducer(s, { type: 'BID', suit: free }, {})!;
    expect(s.phase).toBe('declaring');
    expect(s.trumpSuit).toBe(free);
    expect(s.objazSeat).toBe(seat);
  });

  it('all pass both rounds → table trump forced onto the об\'яз (§8.1)', () => {
    let s = start(3, 'small', 5);
    const dealer = s.dealerSeat;
    const tableTrump = s.tableTrumpCard.suit;
    for (let i = 0; i < 6; i++) s = debercReducer(s, { type: 'BID', suit: null }, {})!;
    expect(s.phase).toBe('declaring');
    expect(s.trumpSuit).toBe(tableTrump);
    expect(s.objazSeat).toBe(dealer);
  });

  it('BID is illegal outside the bidding phase', () => {
    const s = acceptTableTrump(start(3, 'small', 5));
    expect(debercReducer(s, { type: 'BID', suit: 'hearts' }, {})).toBe(s);
  });
});

describe('debercReducer — play (§5)', () => {
  it('rejects an illegal (off-suit) play', () => {
    const s = toPlaying(start(3, 'small', 5));
    const seat = s.turnSeat;
    const legal = currentLegalPlays(s);
    // find a card NOT among the legal leads — leading is always legal, so instead
    // start a trick then try to break suit from the next seat.
    const s1 = debercReducer(s, { type: 'PLAY_CARD', card: legal[0] }, {})!;
    const nextSeat = s1.turnSeat;
    const legalNext = currentLegalPlays(s1);
    const illegal = s1.players[nextSeat].hand.find((c) => !legalNext.some((l) => l.suit === c.suit && l.rank === c.rank));
    if (illegal) {
      expect(debercReducer(s1, { type: 'PLAY_CARD', card: illegal }, {})).toBe(s1);
    }
  });

  it('a full hand reaches hand_scoring after exactly 9 tricks', () => {
    const s = playOutHand(acceptTableTrump(start(3, 'small', 5)));
    expect(s.phase).toBe('hand_scoring');
    expect(s.tricksPlayed).toBe(9);
    expect(s.players.every((p) => p.hand.length === 0)).toBe(true);
    // every trick's cards are accounted for across seats (27 for 3 players)
    const totalWon = s.wonCards.reduce((a, cards) => a + cards.length, 0);
    expect(totalWon).toBe(27);
  });
});

describe('debercReducer — declaring (§4, v1.3 truthful + reveal)', () => {
  const ALL_SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
  /** A 9-card hand holding exactly a terz (`ranks` of `suit`) + non-run fillers. */
  const craftTerz = (suit: Suit, ranks: Rank[]) => {
    const run = ranks.map((r) => c(suit, r));
    const fill = ALL_SUITS.filter((x) => x !== suit).flatMap((su) => [c(su, '6'), c(su, '8')]); // 6/8 never extend a run
    return [...run, ...fill].slice(0, 9);
  };

  it('records a TRUTHFUL announcement (held terz) and advances the turn', () => {
    const s1 = acceptTableTrump(start(3, 'small', 5));
    const seat = s1.meldTurnSeat;
    const crafted: DebercState = { ...s1, dealtHands: s1.dealtHands.map((h, i) => (i === seat ? craftTerz(someNonTrump(s1), ['J', 'Q', 'K']) : h)) };
    const next = debercReducer(crafted, { type: 'DECLARE_MELD', melds: [{ kind: 'terz', topRank: 'K' }] }, {})!;
    expect(next.declaredMelds.some((m) => m.seatIndex === seat && m.kind === 'terz')).toBe(true);
    expect(next.meldsDone[seat]).toBe(true);
  });

  it('an UNHELD announcement is illegal (no bluff) → same state reference', () => {
    const s1 = acceptTableTrump(start(3, 'small', 5));
    const seat = s1.meldTurnSeat;
    const noRun = [c('spades', '7'), c('hearts', '9'), c('diamonds', 'J'), c('clubs', 'K'),
      c('spades', 'A'), c('hearts', '7'), c('diamonds', '9'), c('clubs', 'J'), c('spades', 'K')];
    const crafted: DebercState = { ...s1, dealtHands: s1.dealtHands.map((h, i) => (i === seat ? noRun : h)) };
    expect(debercReducer(crafted, { type: 'DECLARE_MELD', melds: [{ kind: 'deberc', topRank: 'A' }] }, {})).toBe(crafted);
  });

  it('a TRUTHFUL деберц (real 8-run) wins the match instantly (jackpot)', () => {
    const s1 = acceptTableTrump(start(3, 'small', 5));
    const seat = s1.meldTurnSeat;
    const suit = someNonTrump(s1);
    const run8 = (['7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as Rank[]).map((r) => c(suit, r)); // 32-deck run
    const crafted: DebercState = { ...s1, dealtHands: s1.dealtHands.map((h, i) => (i === seat ? run8 : h)) };
    const won = debercReducer(crafted, { type: 'DECLARE_MELD', melds: [{ kind: 'deberc', topRank: 'A' }] }, {})!;
    expect(won.phase).toBe('finished');
    expect(won.jackpot).toBe(true);
    expect(won.winnerTeam).toBe(won.teamOf[seat]);
  });

  it('among equal-kind terz, only the higher nominal reveals & scores (§4)', () => {
    const s0 = acceptTableTrump(start(3, 'small', 5));
    const plains = ALL_SUITS.filter((x) => x !== s0.trumpSuit);
    const order = [s0.meldTurnSeat, (s0.meldTurnSeat + 1) % 3, (s0.meldTurnSeat + 2) % 3];
    const lowSeat = order[0], highSeat = order[1];
    let s: DebercState = { ...s0, dealtHands: s0.dealtHands.map((h, i) =>
      i === lowSeat ? craftTerz(plains[0], ['9', '10', 'J'])
        : i === highSeat ? craftTerz(plains[1], ['J', 'Q', 'K']) : h) };
    for (const seat of order) {
      const melds = seat === lowSeat ? [{ kind: 'terz' as const, topRank: 'J' as Rank }]
        : seat === highSeat ? [{ kind: 'terz' as const, topRank: 'K' as Rank }] : [];
      s = debercReducer(s, { type: 'DECLARE_MELD', melds }, {})!;
    }
    expect(s.phase).toBe('playing');
    const terz = s.declaredMelds.filter((m) => m.kind === 'terz');
    expect(terz.find((m) => m.seatIndex === highSeat)!.revealed).toBe(true);
    expect(terz.find((m) => m.seatIndex === lowSeat)!.revealed).toBe(false);
  });

  it('an undeclared sequence scores nothing (all pass) — hand still plays out', () => {
    const scored = playOutHand(acceptTableTrump(start(3, 'small', 5))); // all pass declarations
    expect(scored.phase).toBe('hand_scoring');
    expect(scored.declaredMelds).toHaveLength(0);
    expect(scored.melds.every((m) => m.kind === 'bella')).toBe(true); // only bella can appear
  });
});

describe('debercReducer — hand scoring (§6, §7)', () => {
  it('NEXT_HAND banks points and either finishes or deals a fresh hand', () => {
    const scored = playOutHand(acceptTableTrump(start(3, 'small', 5)));
    const next = debercReducer(scored, { type: 'NEXT_HAND' }, { rng: makeRng(2) })!;
    expect(next.lastHand).not.toBeNull();
    // 3p deals only 27 of 36 cards (9 stay in stock), so the hand never reaches
    // the full 152; points are still positive and include the +10 last trick.
    const sumHand = next.lastHand!.teamPoints.reduce((a, b) => a + b, 0);
    expect(sumHand).toBeGreaterThan(0);
    if (next.phase !== 'finished') {
      expect(next.phase).toBe('bidding');
      expect(next.objazSeat).toBe(next.dealerSeat);
      // об'яз rotated to the winning team's representative seat
      expect(next.teamOf[next.dealerSeat]).toBe(next.lastHand!.topScorerTeam);
    }
  });

  it('4-player hand banks the full 152 + 10 last-trick bonus (whole deck)', () => {
    const scored = playOutHand(acceptTableTrump(start(4, 'big', 4)));
    const next = debercReducer(scored, { type: 'NEXT_HAND' }, { rng: makeRng(2) })!;
    const sumHand = next.lastHand!.teamPoints.reduce((a, b) => a + b, 0);
    // 152 card points + 10 last trick + any meld points
    expect(sumHand).toBeGreaterThanOrEqual(162);
  });

  it('plays a whole small match to completion (bot soak, 3p)', () => {
    let s = start(3, 'small', 11);
    let guard = 0;
    while (!isDebercFinished(s) && guard++ < 200) {
      if (s.phase === 'bidding') { s = acceptTableTrump(s); continue; }
      if (s.phase === 'hand_scoring') { s = debercReducer(s, { type: 'NEXT_HAND' }, { rng: makeRng(guard) })!; continue; }
      s = playOutHand(s, { rng: makeRng(guard) });
    }
    expect(isDebercFinished(s)).toBe(true);
    expect(s.winnerTeam).not.toBeNull();
    expect(s.matchScore[s.winnerTeam!]).toBeGreaterThanOrEqual(510);
  });

  it('plays a whole 4-player big match to completion', () => {
    let s = start(4, 'big', 7);
    let guard = 0;
    while (!isDebercFinished(s) && guard++ < 400) {
      if (s.phase === 'bidding') { s = acceptTableTrump(s); continue; }
      if (s.phase === 'hand_scoring') { s = debercReducer(s, { type: 'NEXT_HAND' }, { rng: makeRng(guard) })!; continue; }
      s = playOutHand(s, { rng: makeRng(guard) });
    }
    expect(isDebercFinished(s)).toBe(true);
    expect(s.winnerTeam === 0 || s.winnerTeam === 1).toBe(true);
  });
});

describe('applyMark — ХВ/бейт ledger (§7)', () => {
  it('first mark of a kind only records (no penalty)', () => {
    expect(applyMark('hv', 0, 0)).toEqual({ hv: 1, beit: 0, penalty: 0 });
    expect(applyMark('beit', 0, 0)).toEqual({ hv: 0, beit: 1, penalty: 0 });
  });

  it('a same-kind pair costs −100 and clears', () => {
    expect(applyMark('hv', 1, 0)).toEqual({ hv: 0, beit: 0, penalty: 100 });
    expect(applyMark('beit', 0, 1)).toEqual({ hv: 0, beit: 0, penalty: 100 });
  });

  it('a mixed ХВ+бейт pair cancels (no penalty)', () => {
    expect(applyMark('beit', 1, 0)).toEqual({ hv: 0, beit: 0, penalty: 0 }); // beit onto an outstanding hv
    expect(applyMark('hv', 0, 1)).toEqual({ hv: 0, beit: 0, penalty: 0 });   // hv onto an outstanding beit
  });
});

describe('getActingDebercPlayerId', () => {
  it('follows the active seat through the phases; null when finished', () => {
    const s0 = start(3, 'small', 5);
    expect(getActingDebercPlayerId(s0)).toBe(`player-${s0.bidderSeat}`);
    const s1 = acceptTableTrump(s0); // → declaring
    expect(getActingDebercPlayerId(s1)).toBe(`player-${s1.meldTurnSeat}`);
    const s2 = declareAllPass(s1);   // → playing
    expect(getActingDebercPlayerId(s2)).toBe(`player-${s2.turnSeat}`);
    const finished: DebercState = { ...s2, phase: 'finished' };
    expect(getActingDebercPlayerId(finished)).toBeNull();
  });
});

describe('reducer contract', () => {
  it('actions on a null/finished state are inert', () => {
    const play: DebercAction = { type: 'PLAY_CARD', card: { suit: 'hearts', rank: 'A', value: 14 } };
    expect(debercReducer(null, play, {})).toBeNull();
    const finished: DebercState = { ...start(3, 'small', 5), phase: 'finished' };
    expect(debercReducer(finished, play, {})).toBe(finished);
  });
});
