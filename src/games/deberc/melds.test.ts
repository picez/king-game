import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../../models/types';
import { seqValue } from './deck';
import {
  detectBestSequence, compareSequences, scoringSequenceSeats, hasBella,
  announcedMeld,
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

describe('announcedMeld (§4, v1.3 truthful)', () => {
  const trump: Suit = 'hearts';

  it('validates and reconstructs a held terz by its nominal', () => {
    const m = announcedMeld(run('spades', ['9', '10', 'J']), 0, 'terz', 'J', trump);
    expect(m?.kind).toBe('terz');
    expect(m?.topValue).toBe(seqValue('J'));
    expect(m?.cards).toHaveLength(3);
    expect(m?.revealed).toBe(false);
  });

  it('rejects a meld/nominal the hand does not hold (no bluff)', () => {
    const hand = run('spades', ['9', '10', 'J']); // only a terz-to-J
    expect(announcedMeld(hand, 0, 'platina', 'A', trump)).toBeNull(); // no platina
    expect(announcedMeld(hand, 0, 'terz', 'K', trump)).toBeNull();    // wrong nominal
    expect(announcedMeld(hand, 0, 'bella', 'K', trump)).toBeNull();   // bella isn't a sequence
  });

  it('the run’s natural band must match the claimed kind (no under-claim)', () => {
    const hand = run('spades', ['9', '10', 'J', 'Q']); // a platina (4-run), top Q
    expect(announcedMeld(hand, 0, 'terz', 'Q', trump)).toBeNull();
    expect(announcedMeld(hand, 0, 'platina', 'Q', trump)?.kind).toBe('platina');
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
