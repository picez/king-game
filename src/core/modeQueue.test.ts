import { describe, it, expect } from 'vitest';
import { generateModeQueue } from './modeQueue';
import { DEALER_MODE_ORDER, GAMES_PER_DEALER } from '../config/gameModes';

describe('generateModeQueue', () => {
  it('produces GAMES_PER_DEALER × playerCount rounds (27 for 3p, 36 for 4p)', () => {
    expect(generateModeQueue(3)).toHaveLength(GAMES_PER_DEALER * 3);
    expect(generateModeQueue(3)).toHaveLength(27);
    expect(generateModeQueue(4)).toHaveLength(GAMES_PER_DEALER * 4);
    expect(generateModeQueue(4)).toHaveLength(36);
  });

  it('rotates the dealer round-robin starting at firstDealerIdx', () => {
    const q = generateModeQueue(3, 1);
    expect(q.slice(0, 6).map((e) => e.dealerIdx)).toEqual([1, 2, 0, 1, 2, 0]);
  });

  it('defaults the first dealer to seat 0', () => {
    expect(generateModeQueue(4)[0].dealerIdx).toBe(0);
  });

  it('gives every dealer exactly GAMES_PER_DEALER turns', () => {
    const q = generateModeQueue(3);
    const perDealer: Record<number, number> = {};
    for (const e of q) perDealer[e.dealerIdx] = (perDealer[e.dealerIdx] ?? 0) + 1;
    expect(perDealer).toEqual({ 0: GAMES_PER_DEALER, 1: GAMES_PER_DEALER, 2: GAMES_PER_DEALER });
  });

  it('assigns each dealer the DEALER_MODE_ORDER sequence across their turns', () => {
    const q = generateModeQueue(3);
    // Dealer 0 deals rounds 0, 3, 6, … — one per turnIndex, in canonical order.
    const dealer0Modes = q.filter((e) => e.dealerIdx === 0).map((e) => e.modeId);
    expect(dealer0Modes).toEqual(DEALER_MODE_ORDER);
  });

  it('advances the fixed mode only after a full dealer rotation', () => {
    const q = generateModeQueue(3);
    // Rounds 0-2 (one per dealer) all share turnIndex 0 → the first mode.
    expect(q.slice(0, 3).map((e) => e.modeId)).toEqual([
      DEALER_MODE_ORDER[0], DEALER_MODE_ORDER[0], DEALER_MODE_ORDER[0],
    ]);
    // Round 3 begins turnIndex 1 → the second mode.
    expect(q[3].modeId).toBe(DEALER_MODE_ORDER[1]);
  });
});
