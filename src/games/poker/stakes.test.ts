import { describe, it, expect } from 'vitest';
import {
  STAKES_PRESETS, BUY_IN_BIG_BLINDS, buyInForBigBlind, findStakesPreset, isApprovedStakes,
  validateBlindGrowth, BLIND_GROWTH_PRESETS, MAX_BLIND_GROWTH,
} from './stakes';

// Online stakes whitelist (§16 B). Buy-in is always 100 BB and server-derived; the 8
// approved levels are the ONLY accepted stakes.

describe('STAKES_PRESETS', () => {
  it('has the 8 approved levels with buy-in = 100 big blinds', () => {
    expect(STAKES_PRESETS.map((p) => [p.smallBlind, p.bigBlind, p.buyIn])).toEqual([
      [25, 50, 5_000], [50, 100, 10_000], [100, 200, 20_000], [200, 400, 40_000],
      [400, 800, 80_000], [800, 1_600, 160_000], [1_600, 3_200, 320_000], [3_200, 6_400, 640_000],
    ]);
  });
  it('every preset buy-in equals bigBlind × 100', () => {
    expect(BUY_IN_BIG_BLINDS).toBe(100);
    for (const p of STAKES_PRESETS) expect(p.buyIn).toBe(buyInForBigBlind(p.bigBlind));
  });
});

describe('isApprovedStakes / findStakesPreset', () => {
  it('accepts each whitelisted pair', () => {
    for (const p of STAKES_PRESETS) expect(isApprovedStakes(p.smallBlind, p.bigBlind)).toBe(true);
  });
  it('rejects non-whitelisted or forged pairs', () => {
    for (const [sb, bb] of [[10, 20], [25, 100], [30, 60], [3200, 6401], [0, 0], [-25, -50]]) {
      expect(isApprovedStakes(sb, bb), `${sb}/${bb}`).toBe(false);
    }
    expect(findStakesPreset('25', '50')).toBe(null); // string blinds not accepted
    expect(findStakesPreset(undefined, undefined)).toBe(null);
  });
});

describe('validateBlindGrowth', () => {
  it('accepts 0 (off) and safe integers 1..100', () => {
    expect(validateBlindGrowth(0)).toBe(0);
    expect(validateBlindGrowth(3)).toBe(3);
    expect(validateBlindGrowth(MAX_BLIND_GROWTH)).toBe(100);
    for (const g of BLIND_GROWTH_PRESETS) expect(validateBlindGrowth(g)).toBe(g);
  });
  it('rejects fraction / negative / >100 / NaN / Infinity / string / object', () => {
    for (const bad of [-1, 0.5, 101, 1000, NaN, Infinity, -Infinity, '3', {}, [], null, undefined]) {
      expect(validateBlindGrowth(bad), String(bad)).toBe(null);
    }
  });
});
