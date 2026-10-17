import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../../models/types';
import { makeRng } from '../../core/rng';
import { tarneebReducer } from './engine';
import { tarneebBotAction } from './ai';
import { canChooseTrump, isTarneebFinished, kabootOutcome, teamOfSeat } from './rules';
import { normalizeTarneebRules, tarneebRuleEngineOptions } from './variants';
import { tarneebGameDefinition } from './definition';
import { buildCreateIntent, firstConnectMessage } from '../../net/online';
import type { RoomSnapshot } from '../../net/messages';
import type { TarneebAction, TarneebContext, TarneebOptions, TarneebState } from './types';

// Stage 41.5 — the Kaboot table and No-Trump, both host-optional (TARNEEB_RULES §6a/§9).

const VALUE: Record<Rank, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
const C = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: VALUE[rank] });

function start(options: Partial<TarneebOptions> = {}, seed = 1, variant?: 'solo'): { s: TarneebState; ctx: TarneebContext } {
  const ctx: TarneebContext = { rng: makeRng(seed) };
  const s = tarneebReducer(null, {
    type: 'START_GAME', playerNames: ['P0', 'P1', 'P2', 'P3'], playerTypes: ['ai', 'ai', 'ai', 'ai'],
    dealerSeat: 0, options: { targetScore: 41, ...options }, ...(variant ? { variant } : {}),
  }, ctx) as TarneebState;
  return { s, ctx };
}
const R = (s: TarneebState, a: TarneebAction, ctx: TarneebContext) => tarneebReducer(s, a, ctx) as TarneebState;

/** First bidder bids `bid`, the other three pass → that seat chooses trump. */
function toTrumpChoice(s: TarneebState, ctx: TarneebContext, bid = 7): TarneebState {
  s = R(s, { type: 'BID', amount: bid }, ctx);
  for (let i = 0; i < 3; i++) s = R(s, { type: 'PASS_BID' }, ctx);
  expect(s.phase).toBe('choosing_trump');
  return s;
}

/**
 * Jump to the LAST trick with the declarer's side already holding `declPrior` of the
 * first 12 tricks, and one card each such that the declarer's ♠A wins the 13th.
 */
function lastTrick(s: TarneebState, declPrior: number): TarneebState {
  const d = s.declarerSeat!;
  const x = structuredClone(s);
  const hands = [C('hearts', '2'), C('hearts', '3'), C('hearts', '4'), C('hearts', '5')].map((c) => [c]);
  hands[d] = [C('spades', 'A')];
  x.handsBySeat = hands;
  const dummy = { leadSeat: d, ledSuit: 'hearts' as Suit, plays: [], winnerSeat: d };
  x.completedTricks = Array.from({ length: 12 }, () => dummy);
  const declTeam = teamOfSeat(d);
  if (x.variant === 'solo') {
    const t = [0, 0, 0, 0];
    t[d] = declPrior;
    const others = [0, 1, 2, 3].filter((seat) => seat !== d);
    let left = 12 - declPrior;
    for (const seat of others) { const take = Math.min(left, 4); t[seat] = take; left -= take; }
    x.tricksBySeat = t;
  }
  x.tricksByTeam = declTeam === 'A' ? { A: declPrior, B: 12 - declPrior } : { A: 12 - declPrior, B: declPrior };
  x.currentSeat = d;
  x.currentTrick = { leadSeat: d, ledSuit: null, plays: [], winnerSeat: null };
  return x;
}

function finishTrick(s: TarneebState, ctx: TarneebContext): TarneebState {
  for (let i = 0; i < 4; i++) s = R(s, { type: 'PLAY_CARD', card: s.handsBySeat[s.currentSeat][0] }, ctx);
  return s;
}

describe('No-Trump (§6a)', () => {
  it('is refused unless the host enabled it', () => {
    const { s, ctx } = start();
    const c = toTrumpChoice(s, ctx);
    expect(canChooseTrump(c, c.currentSeat, 'NT')).toBe(false);
    expect(R(c, { type: 'CHOOSE_TRUMP', suit: 'NT' }, ctx)).toBe(c);
  });

  it('plays with no trump, records "NT", and the next hand starts clean', () => {
    const { s, ctx } = start({ allowNoTrump: true });
    let c = toTrumpChoice(s, ctx);
    c = R(c, { type: 'CHOOSE_TRUMP', suit: 'NT' }, ctx);
    expect(c.phase).toBe('playing');
    expect(c.trumpSuit).toBeNull();
    expect(c.noTrump).toBe(true);
    c = finishTrick(lastTrick(c, 6), ctx);
    expect(c.lastHand?.trumpSuit).toBe('NT');
    const next = R(c, { type: 'START_NEXT_HAND' }, ctx);
    expect(next.noTrump).toBeUndefined();
  });
});

describe('Kaboot table (§9)', () => {
  it('kabootOutcome follows the recommended table, and nothing when off', () => {
    expect(kabootOutcome('off', 7, 13)).toBeNull();
    expect(kabootOutcome('recommended', 7, 13)).toEqual({ declarer: 16, defenderMultiplier: 0 });
    expect(kabootOutcome('recommended', 13, 12)).toEqual({ declarer: -16, defenderMultiplier: 2 });
    expect(kabootOutcome('recommended', 13, 13)).toBeNull(); // the §8 exact double (+26) applies
    expect(kabootOutcome('recommended', 7, 12)).toBeNull();
  });

  it('pairs: all 13 on bid 7 scores +16 (off: +13)', () => {
    for (const [mode, want] of [['recommended', 16], ['off', 13]] as const) {
      const { s, ctx } = start({ kabootMode: mode });
      let c = R(toTrumpChoice(s, ctx, 7), { type: 'CHOOSE_TRUMP', suit: 'spades' }, ctx);
      c = finishTrick(lastTrick(c, 12), ctx);
      const team = c.lastHand!.declarerTeam;
      expect(c.lastHand!.deltaByTeam[team]).toBe(want);
      expect(c.lastHand!.kaboot === true).toBe(mode === 'recommended');
    }
  });

  it('pairs: a failed 13 costs −16 and the defenders score twice their tricks', () => {
    const { s, ctx } = start({ kabootMode: 'recommended' });
    let c = R(toTrumpChoice(s, ctx, 13), { type: 'CHOOSE_TRUMP', suit: 'spades' }, ctx);
    c = finishTrick(lastTrick(c, 10), ctx); // 11 of 13
    const h = c.lastHand!;
    const def = h.declarerTeam === 'A' ? 'B' : 'A';
    expect(h.deltaByTeam[h.declarerTeam]).toBe(-16);
    expect(h.deltaByTeam[def]).toBe(2 * 2);
  });

  it('solo: all 13 on bid 7 scores +16 for the declarer alone', () => {
    const { s, ctx } = start({ kabootMode: 'recommended' }, 1, 'solo');
    let c = R(toTrumpChoice(s, ctx, 7), { type: 'CHOOSE_TRUMP', suit: 'spades' }, ctx);
    c = finishTrick(lastTrick(c, 12), ctx);
    const h = c.lastSoloHand!;
    expect(h.deltaBySeat[h.declarerSeat]).toBe(16);
    expect(h.deltaBySeat.filter((_, i) => i !== h.declarerSeat)).toEqual([0, 0, 0]);
    expect(h.kaboot).toBe(true);
  });
});

describe('bot-only matches with both options on', () => {
  it('terminate in pairs and solo, every bot choice legal', () => {
    for (const variant of [undefined, 'solo'] as const) {
      for (const seed of [1, 2, 3, 5, 8, 13]) {
        let { s, ctx } = start({ kabootMode: 'recommended', allowNoTrump: true }, seed, variant);
        let steps = 0;
        while (!isTarneebFinished(s) && steps++ < 4000) {
          if (s.phase === 'hand_complete') { s = R(s, { type: 'START_NEXT_HAND' }, ctx); continue; }
          const next = R(s, tarneebBotAction(s, s.currentSeat), ctx);
          if (next === s) throw new Error(`illegal bot action in ${s.phase} (seed ${seed})`);
          s = next;
        }
        expect(isTarneebFinished(s), `${variant ?? 'pairs'} seed ${seed}`).toBe(true);
      }
    }
  }, 20_000);
});

describe('online plumbing', () => {
  it('normalises the host\'s choice and maps it onto the engine options', () => {
    expect(normalizeTarneebRules(undefined)).toEqual({ kaboot: false, noTrump: false });
    expect(normalizeTarneebRules({ kaboot: 1, noTrump: true })).toEqual({ kaboot: false, noTrump: true });
    expect(tarneebRuleEngineOptions({ kaboot: true, noTrump: false })).toEqual({ kabootMode: 'recommended', allowNoTrump: false });
  });

  it('the create intent carries the rules for Tarneeb only, and the room starts with them', () => {
    const rules = { kaboot: true, noTrump: true };
    const intent = buildCreateIntent({ gameType: 'tarneeb', name: 'H', modeSelectionType: 'fixed', tarneebRules: rules });
    expect(firstConnectMessage(intent)).toMatchObject({ t: 'CREATE_ROOM', tarneebRules: rules });
    const durak = buildCreateIntent({ gameType: 'durak', name: 'H', modeSelectionType: 'fixed', tarneebRules: rules });
    expect(firstConnectMessage(durak)).not.toHaveProperty('tarneebRules');

    const room = {
      members: [0, 1, 2, 3].map((i) => ({ role: 'player', seatIndex: i, name: `P${i}`, type: 'human' })),
      tarneebRules: rules,
    } as unknown as RoomSnapshot;
    expect(tarneebGameDefinition.buildStartAction(room)).toMatchObject({ options: { kabootMode: 'recommended', allowNoTrump: true } });
    const legacy = tarneebGameDefinition.buildStartAction({ ...room, tarneebRules: undefined } as RoomSnapshot);
    expect(legacy).toMatchObject({ options: { kabootMode: 'off', allowNoTrump: false } });
  });
});
