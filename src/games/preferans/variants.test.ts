import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { preferansReducer, MISERE_VALUE } from './engine';
import { preferansBotAction } from './ai';
import { checkPreferansInvariants } from './invariants';
import { canBidMisere, MISERE_BID, bidRank } from './rules';
import { nextSeat } from './deck';
import { normalizePreferansRules } from './variants';
import { preferansGameDefinition } from './definition';
import { summarizeFinishedPreferansGame } from '../../net/preferansStats';
import { buildCreateIntent, firstConnectMessage } from '../../net/online';
import type { RoomSnapshot } from '../../net/messages';
import type { PreferansAction, PreferansOptions, PreferansState } from './types';

// Stage 41.4 — misère and распасы, both host-optional (PREFERANS_RULES §5a/§7a).

const ctxOf = (seed: number) => ({ rng: makeRng(seed) });

function start(options: Partial<PreferansOptions> = {}, seed = 1, dealerSeat = 0): PreferansState {
  return preferansReducer(null, {
    type: 'START_GAME', playerNames: ['A', 'B', 'C'], playerTypes: ['ai', 'ai', 'ai'], dealerSeat, options,
  }, ctxOf(seed)) as PreferansState;
}
const act = (s: PreferansState, a: PreferansAction, seed = 1) => preferansReducer(s, a, ctxOf(seed)) as PreferansState;
const MISERE: PreferansAction = { type: 'BID', level: 0, suit: 'NT', misere: true };

/** Let the bots finish the current hand (to hand_complete / game_finished). */
function playOutHand(s: PreferansState): PreferansState {
  const ctx = ctxOf(9);
  let guard = 0;
  while (s.phase === 'playing' || s.phase === 'talon') {
    const next = preferansReducer(s, preferansBotAction(s, s.currentSeat), ctx) as PreferansState;
    if (next === s) throw new Error(`illegal bot action in ${s.phase}`);
    s = next;
    expect(checkPreferansInvariants(s)).toEqual([]);
    if (++guard > 200) throw new Error('hand did not end');
  }
  return s;
}

describe('misère bidding', () => {
  it('is refused unless the host enabled it', () => {
    const s = start();
    expect(canBidMisere(s, s.currentSeat)).toBe(false);
    expect(act(s, MISERE)).toBe(s);
  });

  it('ranks between 8NT and 9♠', () => {
    expect(bidRank(MISERE_BID)).toBeGreaterThan(bidRank({ level: 8, suit: 'NT' }));
    expect(bidRank(MISERE_BID)).toBeLessThan(bidRank({ level: 9, suit: 'spades' }));
  });

  it('must be a first bid, only 9+ outbids it, and its bidder may then only pass', () => {
    let s = start({ misere: true });
    const first = s.currentSeat;
    s = act(s, MISERE);
    expect(s.highBid).toMatchObject({ misere: true, seat: first });
    const second = s.currentSeat;
    expect(act(s, { type: 'BID', level: 8, suit: 'NT' })).toBe(s);
    s = act(s, { type: 'BID', level: 9, suit: 'spades' });
    expect(s.highBid).toMatchObject({ level: 9, suit: 'spades', seat: second });
    // Back to the misère bidder after the third seat passes: no further bid is legal.
    s = act(s, { type: 'PASS_BID' });
    expect(s.currentSeat).toBe(first);
    expect(act(s, { type: 'BID', level: 9, suit: 'hearts' })).toBe(s);
    expect(act(s, MISERE)).toBe(s);
  });

  it('cannot follow the seat\'s own contract bid', () => {
    let s = start({ misere: true });
    const first = s.currentSeat;
    s = act(s, { type: 'BID', level: 6, suit: 'spades' });
    s = act(s, { type: 'BID', level: 6, suit: 'clubs' });
    s = act(s, { type: 'PASS_BID' });
    expect(s.currentSeat).toBe(first);
    expect(canBidMisere(s, first)).toBe(false);
  });
});

describe('misère play and scoring', () => {
  function misereHand(seed: number): PreferansState {
    let s = start({ misere: true }, seed);
    const declarer = s.currentSeat;
    s = act(s, MISERE);
    s = act(s, { type: 'PASS_BID' });
    s = act(s, { type: 'PASS_BID' });
    expect(s.phase).toBe('talon');
    expect(s.declarerSeat).toBe(declarer);
    s = act(s, { type: 'TAKE_TALON' });
    const hand = s.handsBySeat[declarer];
    s = act(s, { type: 'DISCARD', cards: [hand[0], hand[1]] });
    return s;
  }

  it('the discard plays the misère straight away — No-Trump, the declarer\'s left leads', () => {
    const s = misereHand(3);
    expect(s.phase).toBe('playing');
    expect(s.contract).toEqual(MISERE_BID);
    expect(s.currentSeat).toBe(nextSeat(s.declarerSeat!));
    expect(act(s, { type: 'DECLARE_CONTRACT', level: 6, suit: 'spades' })).toBe(s);
  });

  it('is made with ZERO tricks only, for ±5 (defenders +5 each when it fails)', () => {
    let made = 0; let failed = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const s = playOutHand(misereHand(seed));
      const h = s.lastHand!;
      expect(h.kind).toBe('misere');
      expect(h.made).toBe(h.declarerTricks === 0);
      const d = h.declarerSeat;
      for (let seat = 0; seat < 3; seat++) {
        const want = seat === d ? (h.made ? MISERE_VALUE : -MISERE_VALUE) : (h.made ? 0 : MISERE_VALUE);
        expect(h.deltaBySeat[seat]).toBe(want);
      }
      if (h.made) made++; else failed++;
    }
    expect(made + failed).toBe(12);
  });
});

describe('распасы (all-pass)', () => {
  const allPass = (s: PreferansState) => act(act(act(s, { type: 'PASS_BID' }), { type: 'PASS_BID' }), { type: 'PASS_BID' });

  it('without the option an all-pass is still a redeal', () => {
    const s = allPass(start({}, 5, 0));
    expect(s.phase).toBe('bidding');
    expect(s.allPass).toBeUndefined();
    expect(s.dealerSeat).toBe(1);
  });

  it('with the option: No-Trump play, no declarer, the talon set aside, left of dealer leads', () => {
    const s = allPass(start({ allPass: true }, 5, 0));
    expect(s.phase).toBe('playing');
    expect(s.allPass).toBe(true);
    expect(s.declarerSeat).toBeNull();
    expect(s.contract).toBeNull();
    expect(s.talon).toHaveLength(2);
    expect(s.currentSeat).toBe(1);
    expect(checkPreferansInvariants(s)).toEqual([]);
  });

  it('the fewest tricks score +1, nobody loses, and the next hand is a normal one', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = playOutHand(allPass(start({ allPass: true }, seed, 0)));
      const h = s.lastHand!;
      expect(h.kind).toBe('allpass');
      expect(h.declarerSeat).toBe(-1);
      const fewest = Math.min(...h.tricksBySeat!);
      expect(h.deltaBySeat).toEqual(h.tricksBySeat!.map((t) => (t === fewest ? 1 : 0)));
      expect(h.tricksBySeat!.reduce((a, b) => a + b, 0)).toBe(10);
      const next = act(s, { type: 'START_NEXT_HAND' });
      expect(next.phase).toBe('bidding');
      expect(next.allPass).toBeUndefined();
      expect(next.handNumber).toBe(2);
    }
  });
});

describe('bot-only matches with both variants on', () => {
  it('always terminate with invariants intact, and the stats skip распасы', () => {
    let sawMisere = false; let sawAllPass = false;
    for (const seed of [1, 2, 3, 7, 42, 100, 2024, 31337]) {
      const ctx = ctxOf(seed);
      let s = start({ misere: true, allPass: true }, seed);
      let steps = 0;
      while (s.phase !== 'game_finished' && steps < 40000) {
        expect(checkPreferansInvariants(s)).toEqual([]);
        const next = preferansReducer(s, preferansBotAction(s, s.currentSeat), ctx) as PreferansState;
        if (next === s) throw new Error(`illegal bot action in ${s.phase} (seed ${seed})`);
        s = next; steps++;
      }
      expect(s.phase, `seed ${seed}`).toBe('game_finished');
      sawMisere ||= s.handHistory.some((h) => h.kind === 'misere');
      sawAllPass ||= s.handHistory.some((h) => h.kind === 'allpass');
      const summary = summarizeFinishedPreferansGame(s);
      const declared = s.handHistory.filter((h) => h.kind !== 'allpass').length;
      expect(summary.players.reduce((n, p) => n + p.declarerCount, 0)).toBe(declared);
      for (const [i, h] of s.handHistory.entries()) {
        expect(summary.rounds[i].modeId).toBe(h.kind === 'allpass' ? 'PASS' : h.kind === 'misere' ? 'MIS' : summary.rounds[i].modeId);
      }
    }
    expect(sawMisere || sawAllPass).toBe(true);
  });
});

describe('online plumbing', () => {
  it('normalises the host\'s choice to strict booleans', () => {
    expect(normalizePreferansRules(undefined)).toEqual({ misere: false, allPass: false });
    expect(normalizePreferansRules({ misere: 'yes', allPass: true })).toEqual({ misere: false, allPass: true });
  });

  it('the create intent carries the rules for Preferans only, and the room starts with them', () => {
    const rules = { misere: true, allPass: true };
    const intent = buildCreateIntent({ gameType: 'preferans', name: 'H', modeSelectionType: 'fixed', preferansRules: rules });
    expect(firstConnectMessage(intent)).toMatchObject({ t: 'CREATE_ROOM', preferansRules: rules });
    const king = buildCreateIntent({ gameType: 'king', name: 'H', modeSelectionType: 'fixed', preferansRules: rules });
    expect(firstConnectMessage(king)).not.toHaveProperty('preferansRules');

    const room = {
      members: [0, 1, 2].map((i) => ({ role: 'player', seatIndex: i, name: `P${i}`, type: 'human' })),
      preferansRules: rules,
    } as unknown as RoomSnapshot;
    const startAction = preferansGameDefinition.buildStartAction(room);
    expect(startAction).toMatchObject({ options: { targetScore: 10, misere: true, allPass: true } });
    const legacy = preferansGameDefinition.buildStartAction({ ...room, preferansRules: undefined } as RoomSnapshot);
    expect(legacy).toMatchObject({ options: { misere: false, allPass: false } });
  });
});
