import { describe, it, expect, vi } from 'vitest';
import { createRoom, addMember, serializeRoom, deserializeRoom, snapshot, roomSummary, type ServerRoom, type PokerEscrow } from './serverCore';
import type { PokerState } from '../games/poker/types';
import { escrowGameBinding, gameBoundToEscrow, bindGameToEscrow, clearGameBinding, resolveUnboundEscrowGame } from '../../server/pokerBinding';

// Stage 37.7.12 FAIL 1 (pure): the durable gameState ↔ escrow GENERATION binding. A paid rematch
// mints escrow M1 BEFORE the new hand exists, so a crash in that window persists "M1 + the previous
// match's state". The binding is what tells those apart after a restart — a room lock cannot, because
// the damage happens across the crash/restore boundary, not inside one process.

const LIVE = { phase: 'betting' } as unknown as PokerState;
const FINISHED = { phase: 'game_finished' } as unknown as PokerState;
const esc = (matchId: string, status: PokerEscrow['status'] = 'funded'): PokerEscrow =>
  ({ matchId, buyIn: 5000, status, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] });

function room(over: Partial<ServerRoom> = {}): ServerRoom {
  return { code: 'BND', gameType: 'poker', pokerBuyIn: 5000, gameState: LIVE, ...over } as unknown as ServerRoom;
}

describe('escrowGameBinding classification', () => {
  it('bound only when the CURRENT escrow matchId produced the CURRENT state', () => {
    expect(escrowGameBinding(room({ pokerEscrow: esc('m1'), pokerGameMatchId: 'm1' }))).toBe('bound');
    expect(gameBoundToEscrow(room({ pokerEscrow: esc('m1'), pokerGameMatchId: 'm1' }))).toBe(true);
  });
  it('unbound when the state came from a DIFFERENT generation (the crashed-rematch shape)', () => {
    const r = room({ pokerEscrow: esc('m2'), pokerGameMatchId: 'm1', gameState: FINISHED });
    expect(escrowGameBinding(r)).toBe('unbound');
    expect(gameBoundToEscrow(r)).toBe(false);
  });
  it('unknown for a legacy save (a state + escrow but no marker) — never guessed as bound', () => {
    const r = room({ pokerEscrow: esc('m1') });
    expect(escrowGameBinding(r)).toBe('unknown');
    expect(gameBoundToEscrow(r)).toBe(false);
  });
  it('no_game / no_escrow / not_bankroll shapes', () => {
    expect(escrowGameBinding(room({ pokerEscrow: esc('m1'), gameState: null }))).toBe('no_game');
    expect(escrowGameBinding(room({ pokerGameMatchId: 'm1' }))).toBe('no_escrow');
    expect(escrowGameBinding(room({ pokerBuyIn: undefined }))).toBe('not_bankroll');
    expect(escrowGameBinding(room({ gameType: 'king' }))).toBe('not_bankroll');
  });
});

describe('bindGameToEscrow only binds a REAL funded generation', () => {
  it('binds after a funded debit + a live state', () => {
    const r = room({ pokerEscrow: esc('m1') });
    bindGameToEscrow(r);
    expect(r.pokerGameMatchId).toBe('m1');
    expect(gameBoundToEscrow(r)).toBe(true);
  });
  it('never binds a pending/settling/settled/cancelled escrow, a stateless room, or a free table', () => {
    for (const status of ['pending', 'settling', 'settled', 'cancelled'] as const) {
      const r = room({ pokerEscrow: esc('m1', status) });
      bindGameToEscrow(r);
      expect(r.pokerGameMatchId, status).toBeUndefined();
    }
    const noState = room({ pokerEscrow: esc('m1'), gameState: null });
    bindGameToEscrow(noState);
    expect(noState.pokerGameMatchId).toBeUndefined();
    const free = room({ pokerEscrow: esc('m1'), pokerBuyIn: undefined });
    bindGameToEscrow(free);
    expect(free.pokerGameMatchId).toBeUndefined();
  });
  it('clearGameBinding drops it', () => {
    const r = room({ pokerEscrow: esc('m1'), pokerGameMatchId: 'm1' });
    clearGameBinding(r);
    expect(r.pokerGameMatchId).toBeUndefined();
    expect(gameBoundToEscrow(r)).toBe(false);
  });
});

describe('resolveUnboundEscrowGame — the unplayed fresh debit lifecycle', () => {
  const deps = (refund: boolean) => ({ refundBuyIns: vi.fn(async () => (refund ? 'confirmed_refund' as const : 'retry_pending' as const)), persist: vi.fn(), clearTimers: vi.fn() });

  it('a CONFIRMED refund drops the stale state + binding and yields an honest cancelled lobby', async () => {
    const r = room({ pokerEscrow: esc('m2'), pokerGameMatchId: 'm1', gameState: FINISHED, started: true });
    const d = deps(true);
    expect(await resolveUnboundEscrowGame(r, d)).toBe('refunded');
    expect(r.gameState).toBeNull();
    expect(r.pokerGameMatchId).toBeUndefined();
    expect(r.started).toBe(false);
    expect(r.pokerMatchCancelled).toBe(true);
    expect(d.refundBuyIns).toHaveBeenCalledOnce();
    expect(d.clearTimers).toHaveBeenCalledOnce();
    expect(d.persist).toHaveBeenCalledOnce();
  });

  it('a FAILED refund leaves settlement-pending (funded, no state) — never a false cancel', async () => {
    const r = room({ pokerEscrow: esc('m2'), pokerGameMatchId: 'm1', gameState: FINISHED, started: true });
    const d = deps(false);
    expect(await resolveUnboundEscrowGame(r, d)).toBe('settlement_pending');
    expect(r.gameState).toBeNull();
    expect(r.pokerMatchCancelled).toBeUndefined();
    expect(r.pokerEscrow!.status).toBe('funded'); // still owed → the sweep retries
    expect(d.persist).toHaveBeenCalledOnce();
  });
});

describe('the binding is PERSISTED but never PUBLIC', () => {
  function realRoom(): ServerRoom {
    const r = createRoom({ code: 'BND1', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: 'user-1' }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMember(r, { clientId: 'b', reconnectToken: 't', name: 'B', userId: 'user-2' });
    r.started = true;
    r.gameState = LIVE as unknown as typeof r.gameState;
    r.pokerEscrow = esc('match-secret-1');
    bindGameToEscrow(r);
    return r;
  }

  it('survives serialize → deserialize (a restart keeps the generation)', () => {
    const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(realRoom()))))!;
    expect(restored.pokerGameMatchId).toBe('match-secret-1');
    expect(gameBoundToEscrow(restored)).toBe(true);
  });

  it('a malformed/empty persisted binding restores as undefined (fails closed, never a bogus match id)', () => {
    for (const bad of ['', 42, {}, null]) {
      const json = JSON.parse(JSON.stringify(serializeRoom(realRoom()))) as Record<string, unknown>;
      json.pokerGameMatchId = bad;
      const restored = deserializeRoom(json)!;
      expect(restored.pokerGameMatchId).toBeUndefined();
      expect(escrowGameBinding(restored)).toBe('unknown');
    }
  });

  it('never reaches the public snapshot or the room summary (no match id, no escrow, no user ids)', () => {
    const r = realRoom();
    for (const payload of [JSON.stringify(snapshot(r, 'a')), JSON.stringify(roomSummary(r))]) {
      expect(payload).not.toContain('pokerGameMatchId');
      expect(payload).not.toContain('match-secret-1');
      expect(payload).not.toContain('pokerEscrow');
      expect(payload).not.toContain('user-1');
      expect(payload).not.toContain('user-2');
    }
  });
});
