import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../../models/types';
import { seqValue } from './deck';
import {
  detectBestSequence, compareSequences, scoringSequenceSeats, hasBella,
  resolveDeclarations, detectHeldKinds,
} from './melds';

const card = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: seqValue(rank) });
const run = (suit: Suit, ranks: Rank[]): Card[] => ranks.map((r) => card(suit, r));

describe('detectBestSequence (DEBERC_RULES §4)', () => {
  it('classifies a 3-run as терц (20)', () => {
    const m = detectBestSequence(run('spades', ['7', '8', '9']), 0, 'hearts');
    expect(m?.kind).toBe('terz');
    expect(m?.points).toBe(20);
    expect(m?.cards).toHaveLength(3);
  });

  it('classifies a 4–7 run as платіна (50)', () => {
    const m = detectBestSequence(run('spades', ['7', '8', '9', '10', 'J']), 0, 'hearts');
    expect(m?.kind).toBe('platina');
    expect(m?.points).toBe(50);
  });

  it('classifies an 8–9 run as деберц (jackpot, 0 points)', () => {
    const m = detectBestSequence(run('spades', ['6', '7', '8', '9', '10', 'J', 'Q', 'K']), 0, 'hearts');
    expect(m?.kind).toBe('deberc');
    expect(m?.points).toBe(0);
  });

  it('returns null when there is no run of 3', () => {
    const hand = [card('spades', '7'), card('spades', '9'), card('hearts', 'J')];
    expect(detectBestSequence(hand, 0, 'hearts')).toBeNull();
  });

  it('picks the stronger of two runs (higher top card)', () => {
    const hand = [...run('spades', ['7', '8', '9']), ...run('clubs', ['Q', 'K', 'A'])];
    const m = detectBestSequence(hand, 0, 'hearts');
    expect(m?.topValue).toBe(seqValue('A'));
  });
});

describe('compareSequences', () => {
  const terzTo10 = detectBestSequence(run('spades', ['8', '9', '10']), 0, 'hearts')!;
  const terzToQ = detectBestSequence(run('clubs', ['10', 'J', 'Q']), 1, 'hearts')!;
  const terzToQtrump = detectBestSequence(run('hearts', ['10', 'J', 'Q']), 2, 'hearts')!;

  it('higher top card wins at equal length', () => {
    expect(compareSequences(terzToQ, terzTo10)).toBeGreaterThan(0);
  });

  it('trump breaks a tie on length + top', () => {
    expect(compareSequences(terzToQtrump, terzToQ)).toBeGreaterThan(0);
  });

  it('equal non-trump runs tie (both score)', () => {
    const other = detectBestSequence(run('diamonds', ['10', 'J', 'Q']), 3, 'hearts')!;
    expect(compareSequences(terzToQ, other)).toBe(0);
  });
});

describe('resolveDeclarations (§4, v1.2 bluff + penalty)', () => {
  const trump: Suit = 'hearts';

  it('a truthful under-claim scores; a bluff is counted as a false claim', () => {
    const hands = [
      run('spades', ['7', '8', '9', '10']), // seat0 holds a platina (4-run)…
      run('clubs', ['J', 'Q']),             // seat1 holds no sequence
      [],                                    // seat2 passes
    ];
    // seat0 under-claims a terz (valid — it holds ≥3), seat1 bluffs a platina.
    const r = resolveDeclarations(hands, [['terz'], ['platina'], []], trump);
    expect(r.seqMelds.some((m) => m.seatIndex === 0 && m.kind === 'terz')).toBe(true);
    expect(r.falseBySeat).toEqual([0, 1, 0]);
  });

  it('bella: held (trump K+Q) is valid; not held is a false claim', () => {
    const withBella = [card('hearts', 'K'), card('hearts', 'Q'), card('spades', 'A')];
    const noBella = [card('spades', '7'), card('clubs', '8')];
    const r = resolveDeclarations([withBella, noBella], [['bella'], ['bella']], trump);
    expect(r.bellaSeats).toEqual([0]);
    expect(r.falseBySeat).toEqual([0, 1]);
  });

  it('detectHeldKinds reports the best band a hand holds + bella', () => {
    const hand = [...run('spades', ['9', '10', 'J', 'Q']), card('hearts', 'K'), card('hearts', 'Q')];
    expect(detectHeldKinds(hand, trump).sort()).toEqual(['bella', 'platina']);
  });
});

describe('scoringSequenceSeats (hierarchy)', () => {
  it('a платіна cancels everyone else’s терці', () => {
    const seat0 = detectBestSequence(run('spades', ['7', '8', '9']), 0, 'hearts'); // terz
    const seat1 = detectBestSequence(run('clubs', ['9', '10', 'J', 'Q']), 1, 'hearts'); // platina
    expect(scoringSequenceSeats([seat0, seat1])).toEqual([1]);
  });

  it('an opponent’s higher терц shuts out the lower one', () => {
    const lo = detectBestSequence(run('spades', ['7', '8', '9']), 0, 'hearts');
    const hi = detectBestSequence(run('clubs', ['Q', 'K', 'A']), 1, 'hearts');
    expect(scoringSequenceSeats([lo, hi])).toEqual([1]);
  });

  it('equal non-trump терці both score', () => {
    const a = detectBestSequence(run('spades', ['10', 'J', 'Q']), 0, 'hearts');
    const b = detectBestSequence(run('clubs', ['10', 'J', 'Q']), 1, 'hearts');
    expect(scoringSequenceSeats([a, b]).sort()).toEqual([0, 1]);
  });

  it('trump терц beats an equal non-trump терц', () => {
    const plain = detectBestSequence(run('spades', ['10', 'J', 'Q']), 0, 'hearts');
    const trump = detectBestSequence(run('hearts', ['10', 'J', 'Q']), 1, 'hearts');
    expect(scoringSequenceSeats([plain, trump])).toEqual([1]);
  });
});

describe('hasBella', () => {
  it('true only with trump K + Q', () => {
    expect(hasBella([card('hearts', 'K'), card('hearts', 'Q')], 'hearts')).toBe(true);
    expect(hasBella([card('hearts', 'K'), card('spades', 'Q')], 'hearts')).toBe(false);
    expect(hasBella([card('hearts', 'K'), card('hearts', 'Q')], null)).toBe(false);
  });
});
