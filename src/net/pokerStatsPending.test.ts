import { describe, it, expect, vi } from 'vitest';
import { createRoom, addMember, snapshot, serializeRoom, deserializeRoom } from './serverCore';
import { statsPending, payoutPending, pokerRecoveryBlocked } from '../../server/pokerEscrow';
import { handleRematchRequest } from '../../server/pokerRematch';
import type { PokerState } from '../games/poker/types';

// Stage 37.7.9 FAIL 2 (pure): a PAID-but-stats-owed bankroll room. `stats_pending` is DERIVED public
// state (money already out → NOT payout_pending, NOT frozen); it blocks a new paid rematch, exposes
// only a safe recovery status (no escrow/economy leak), and survives serialize → restore.

const FINISHED = { phase: 'game_finished', stacksBySeat: [10000, 0], playerCount: 2 } as unknown as PokerState;

function statsPendingRoom(code = 'SP1') {
  const room = createRoom({ code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'host', reconnectToken: 't', name: 'A', userId: 'u1' }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
  addMember(room, { clientId: 'p2', reconnectToken: 't', name: 'B', userId: 'u2' });
  room.started = true;
  room.gameState = FINISHED as unknown as typeof room.gameState;
  room.pokerEscrow = { matchId: 'm-paid', buyIn: 5000, status: 'settled', seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] };
  room.pokerStatsPending = true; // paid, but the stats write is still owed
  return room;
}

describe('FAIL 2 — stats_pending predicates (money out, stats owed)', () => {
  it('statsPending true; NOT payout_pending (escrow settled); blocks rematch', () => {
    const room = statsPendingRoom();
    expect(statsPending(room)).toBe(true);
    expect(payoutPending(room)).toBe(false);       // money already paid → never re-paid
    expect(pokerRecoveryBlocked(room)).toBe(true); // blocks a new paid rematch
  });
  it('a frozen room is NOT stats_pending (frozen is the permanent operator condition)', () => {
    const room = statsPendingRoom(); room.pokerFrozen = true;
    expect(statsPending(room)).toBe(false);
  });
});

describe('FAIL 2 — public snapshot shows ONLY stats_pending (no economy leak)', () => {
  it('snapshot recovery is stats_pending and carries no escrow/matchId/seats', () => {
    const snap = snapshot(statsPendingRoom()) as unknown as Record<string, unknown>;
    expect(snap.pokerRecovery).toBe('stats_pending');
    expect(snap.pokerEscrow).toBeUndefined();
    expect(JSON.stringify(snap)).not.toMatch(/m-paid|"seats"|userId|buyIn/);
  });
});

describe('FAIL 2 — the stats-pending flag survives serialize → restore', () => {
  it('a persisted+restored room stays stats_pending', () => {
    const persisted = serializeRoom(statsPendingRoom());
    expect((persisted as unknown as { pokerStatsPending?: boolean }).pokerStatsPending).toBe(true);
    const restored = deserializeRoom(persisted)!;
    expect(restored.pokerStatsPending).toBe(true);
    expect((snapshot(restored) as unknown as { pokerRecovery?: string }).pokerRecovery).toBe('stats_pending');
  });
});

describe('FAIL 2 — a stats-pending room refuses a rematch (no new paid match)', () => {
  it('handleRematchRequest → recovery_broadcast, no lifecycle', () => {
    const room = statsPendingRoom();
    const runRematch = vi.fn(async () => {});
    const broadcastRoom = vi.fn();
    const out = handleRematchRequest({ value: { room, clientId: 'host' } }, false, {
      isRoomFinished: () => true, pokerRecoveryBlocked, isBankrollRoom: () => true,
      broadcastRoom, broadcastRematch: () => {}, markReady: () => {}, removeReady: () => {},
      allHumansReady: () => true, withRoomLock: async (_c, fn) => fn(), runRematch, restartNonBankroll: () => {},
    });
    expect(out).toBe('recovery_broadcast');
    expect(runRematch).not.toHaveBeenCalled();
    expect(broadcastRoom).toHaveBeenCalledOnce();
  });
});
