import { describe, it, expect, vi } from 'vitest';
import type { ServerRoom, PokerEscrow } from './serverCore';
import type { PokerState } from '../games/poker/types';
import { classifyBootstrapRecovery, applyBootstrapRecovery } from '../../server/pokerBootstrap';

// Stage 37.7.10 FAIL 1 (pure): a restored bankroll room that carried a game state across a restart is
// classified correctly — a SETTLED (paid) escrow + finished game is a PAID FINISH (finalize stats,
// never cancel), NOT a refund. Distinguishes live / payout_pending / paid_finish / cancelled / frozen.

const isFin = (s: PokerState) => s.phase === 'game_finished';
const FINISHED = { phase: 'game_finished' } as unknown as PokerState;
const LIVE = { phase: 'betting' } as unknown as PokerState;

function room(escrow: PokerEscrow | undefined, gameState: PokerState | null, over: Partial<ServerRoom> = {}): ServerRoom {
  return { code: 'B1', gameType: 'poker', pokerBuyIn: 5000, pokerEscrow: escrow, gameState, ...over } as unknown as ServerRoom;
}
const esc = (status: PokerEscrow['status']): PokerEscrow => ({ matchId: 'm1', buyIn: 5000, status, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] });

describe('FAIL 1 — classifyBootstrapRecovery', () => {
  it('settled escrow + FINISHED game → paid_finish (never cancelled)', () => {
    expect(classifyBootstrapRecovery(room(esc('settled'), FINISHED), isFin)).toBe('paid_finish');
  });
  it('funded escrow + UNFINISHED game → live', () => {
    expect(classifyBootstrapRecovery(room(esc('funded'), LIVE), isFin)).toBe('live');
  });
  it('funded/settling escrow + FINISHED game → payout_pending', () => {
    expect(classifyBootstrapRecovery(room(esc('funded'), FINISHED), isFin)).toBe('payout_pending');
    expect(classifyBootstrapRecovery(room(esc('settling'), FINISHED), isFin)).toBe('payout_pending');
  });
  it('cancelled/absent escrow → cancelled', () => {
    expect(classifyBootstrapRecovery(room(esc('cancelled'), FINISHED), isFin)).toBe('cancelled');
    expect(classifyBootstrapRecovery(room(undefined, FINISHED), isFin)).toBe('cancelled');
  });
  it('frozen room → frozen; non-bankroll / no game → not_bankroll', () => {
    expect(classifyBootstrapRecovery(room(esc('settled'), FINISHED, { pokerFrozen: true }), isFin)).toBe('frozen');
    expect(classifyBootstrapRecovery(room(esc('settled'), null), isFin)).toBe('not_bankroll');
    expect(classifyBootstrapRecovery(room(esc('settled'), FINISHED, { pokerBuyIn: undefined }), isFin)).toBe('not_bankroll');
  });
});

describe('FAIL 1 — applyBootstrapRecovery preserves a paid finish, cancels a refund', () => {
  it('paid_finish is NOT cancelled (finished state kept; caller finalizes stats)', () => {
    const r = room(esc('settled'), FINISHED, { started: true });
    const persist = vi.fn();
    applyBootstrapRecovery(r, 'paid_finish', { rescheduleAdvance: vi.fn(), persist, clearTimers: vi.fn() });
    expect(r.gameState).not.toBeNull();     // finished state preserved
    expect(r.pokerMatchCancelled).toBeUndefined();
  });
  it('cancelled wipes the game to a clean lobby', () => {
    const r = room(esc('cancelled'), FINISHED, { started: true });
    applyBootstrapRecovery(r, 'cancelled', { rescheduleAdvance: vi.fn(), persist: vi.fn(), clearTimers: vi.fn() });
    expect(r.gameState).toBeNull();
    expect(r.pokerMatchCancelled).toBe(true);
    expect(r.started).toBe(false);
  });
  it('live reschedules the advance', () => {
    const r = room(esc('funded'), LIVE);
    const rescheduleAdvance = vi.fn();
    applyBootstrapRecovery(r, 'live', { rescheduleAdvance, persist: vi.fn(), clearTimers: vi.fn() });
    expect(rescheduleAdvance).toHaveBeenCalledOnce();
  });
});
