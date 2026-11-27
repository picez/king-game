// S5 — Hearts vs three deterministic bots, inside the solitaire Engine contract.
import { describe, expect, it } from 'vitest';
import { makeRng } from '../core/rng';
import { replay, type HeartsMove } from './engine';
import { hearts, legalCards, botPass, passDirOf, passTarget, points, HEARTS_TARGET, type HeartsState } from './hearts';
import type { SCard } from './cards';

const all = (s: HeartsState): SCard[] => [...s.hands.flat(), ...s.trick.map((p) => p.card)];

describe('Hearts deal and pass', () => {
  it('13 cards each, 52 unique, first hand passes left', () => {
    const s = hearts.deal(7);
    expect(s.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(new Set(all(s).map((c) => c.id)).size).toBe(52);
    expect(s.phase).toBe('pass');
    expect(passDirOf(0)).toBe('left');
    expect(passDirOf(3)).toBe('none');
    expect(hearts.legal(s)).toHaveLength(286); // C(13, 3)
    expect(hearts.deal(7)).toEqual(s);
  });

  it('passing swaps three cards each way and starts play from the 2♣', () => {
    const s = hearts.deal(11);
    const mine = s.hands[0].slice(0, 3);
    const after = hearts.apply(s, { t: 'pass', ids: mine.map((c) => c.id) })!;
    expect(after.phase).toBe('play');
    expect(after.hands[0].some((c) => mine.some((m) => m.id === c.id))).toBe(false);
    // Left pass: you receive from the seat on your right (seat 3).
    expect(passTarget(3, 'left')).toBe(0);
    const fromRight = botPass(s.hands[3]).map((c) => c.id).sort();
    expect([...after.received].sort()).toEqual(fromRight);
    // Bots played up to your turn; the trick holds the 2♣ unless you hold it.
    const iHave2C = after.hands[0].some((c) => c.suit === 'clubs' && c.rank === 2);
    if (iHave2C) expect(after.trick).toEqual([]);
    else expect(after.trick[0].card).toMatchObject({ suit: 'clubs', rank: 2 });
    expect(after.turn).toBe(0);
    expect(hearts.apply(s, { t: 'pass', ids: [mine[0].id, mine[0].id, mine[1].id] })).toBeNull();
    expect(hearts.apply(after, { t: 'pass', ids: mine.map((c) => c.id) })).toBeNull();
  });
});

describe('Hearts rules', () => {
  const base = (over: Partial<HeartsState>): HeartsState => ({
    hands: [[], [], [], []], phase: 'play', hand: 0, trick: [], lastTrick: null, turn: 0, heartsBroken: false,
    trickNo: 1, taken: [0, 0, 0, 0], scores: [0, 0, 0, 0], moons: [0, 0, 0, 0], received: [], seed: 1, ...over,
  });
  const c = (suit: SCard['suit'], rank: number, id: number): SCard => ({ id, suit, rank, up: true });

  it('follow suit; no points on the first trick when avoidable; hearts not led before broken', () => {
    const hand = [c('hearts', 5, 1), c('spades', 12, 2), c('diamonds', 9, 3)];
    expect(legalCards(base({ hands: [hand, [], [], []], trick: [{ seat: 3, card: c('diamonds', 2, 9) }] }), 0).map((x) => x.id)).toEqual([3]);
    const void0 = [c('hearts', 5, 1), c('spades', 12, 2), c('clubs', 9, 3)];
    expect(legalCards(base({ hands: [void0, [], [], []], trickNo: 0, trick: [{ seat: 3, card: c('diamonds', 2, 9) }] }), 0).map((x) => x.id)).toEqual([3]);
    expect(legalCards(base({ hands: [hand, [], [], []] }), 0).map((x) => x.id)).toEqual([2, 3]);
    expect(legalCards(base({ hands: [[c('hearts', 5, 1)], [], [], []] }), 0).map((x) => x.id)).toEqual([1]);
    expect(points(c('spades', 12, 1))).toBe(13);
    expect(points(c('hearts', 1, 1))).toBe(1);
  });
});

/** Plays a whole game with seeded random legal moves (or the hint). */
function playGame(seed: number, pick: 'random' | 'hint') {
  const rng = makeRng(seed * 31);
  let s = hearts.deal(seed);
  const moves: HeartsMove[] = [];
  let hands = 0;
  for (let i = 0; i < 2000 && s.phase !== 'over'; i++) {
    const legal = hearts.legal(s);
    expect(legal.length, `seed ${seed} stuck at ${i}`).toBeGreaterThan(0);
    const m = pick === 'hint' ? hearts.hint(s)! : legal[Math.floor(rng() * legal.length)];
    const next = hearts.apply(s, m);
    expect(next).not.toBeNull();
    if (next!.phase !== 'over') {
      // Every card is somewhere: in a hand or the current trick, 4 per finished trick gone.
      expect(all(next!).length).toBe(52 - 4 * next!.trickNo);
      expect(next!.hands[0].length).toBe(13 - next!.trickNo - (next!.trick.some((p) => p.seat === 0) ? 1 : 0));
    }
    if (next!.hand !== s.hand || next!.phase === 'over') {
      hands++;
      const added = next!.scores.reduce((a, b) => a + b, 0) - s.scores.reduce((a, b) => a + b, 0);
      expect([26, 78]).toContain(added);
    }
    s = next!;
    moves.push(m);
  }
  return { s, moves, hands };
}

describe('whole games', () => {
  it('random play always ends at 100 with consistent scores, and replays exactly', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { s, moves } = playGame(seed, 'random');
      expect(s.phase).toBe('over');
      expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(HEARTS_TARGET);
      expect(hearts.won(s) || hearts.lost!(s)).toBe(true);
      const r = replay(hearts, seed, moves);
      expect(r.ok && JSON.stringify(r.state)).toBe(JSON.stringify(s));
    }
  });

  it('following the hint wins a fair share against the bots (they are beatable)', () => {
    let wins = 0;
    for (let seed = 1; seed <= 30; seed++) if (hearts.won(playGame(seed, 'hint').s)) wins++;
    expect(wins).toBeGreaterThan(2);
    expect(wins).toBeLessThan(30);
  });

  it('shooting the moon gives 26 to everyone else', () => {
    // Find a hand where a seat took all 26 under random play, or build one directly.
    const s0 = hearts.deal(3);
    const done = { ...s0, phase: 'play' as const, trickNo: 12, taken: [26, 0, 0, 0] };
    // Finish the last trick quickly by checking the scoring rule through a crafted end state.
    const last: HeartsState = { ...done, hands: [[{ id: 1, suit: 'clubs', rank: 3, up: true }], [{ id: 2, suit: 'clubs', rank: 4, up: true }], [{ id: 3, suit: 'clubs', rank: 5, up: true }], [{ id: 4, suit: 'clubs', rank: 6, up: true }]], trick: [], turn: 0 };
    const after = hearts.apply(last, { t: 'play', id: 1 })!;
    expect(after.scores).toEqual([0, 26, 26, 26]);
    expect(after.moons[0]).toBe(1);
  });
});
