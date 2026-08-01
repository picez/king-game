import { describe, it, expect, vi } from 'vitest';
import type { ServerRoom, PokerEscrow } from './serverCore';
import type { PokerState } from '../games/poker/types';
import {
  classifyBootstrapRecovery, applyBootstrapRecovery, recoverRestoredBankrollRoom,
  shouldDeferBootstrapAdvance,
} from '../../server/pokerBootstrap';

// Stage 37.7.10 FAIL 1 (pure): a restored bankroll room that carried a game state across a restart is
// classified correctly — a SETTLED (paid) escrow + finished game is a PAID FINISH (finalize stats,
// never cancel), NOT a refund. Distinguishes live / payout_pending / paid_finish / cancelled / frozen.
// Stage 37.7.11 FAIL 1: a SETTLED escrow + UNFINISHED game is INCOHERENT (money out, final state
// lost) → permanently frozen, never `live`; and NO bankroll room may advance before classification.

const isFin = (s: PokerState) => s.phase === 'game_finished';
const FINISHED = { phase: 'game_finished' } as unknown as PokerState;
const LIVE = { phase: 'betting' } as unknown as PokerState;

/** A restored bankroll room. By default its state is BOUND to escrow `m1` (37.7.12) — i.e. that
 *  escrow generation really produced this state, which every economy path now requires. */
function room(escrow: PokerEscrow | undefined, gameState: PokerState | null, over: Partial<ServerRoom> = {}): ServerRoom {
  return { code: 'B1', gameType: 'poker', pokerBuyIn: 5000, pokerEscrow: escrow, gameState, pokerGameMatchId: 'm1', ...over } as unknown as ServerRoom;
}
const esc = (status: PokerEscrow['status'], matchId = 'm1'): PokerEscrow => ({ matchId, buyIn: 5000, status, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] });
const applyDeps = () => ({ rescheduleAdvance: vi.fn(), persist: vi.fn(), clearTimers: vi.fn(), freeze: vi.fn((r: ServerRoom) => { r.pokerFrozen = true; }) });

describe('FAIL 1 — classifyBootstrapRecovery', () => {
  it('settled escrow + FINISHED game → paid_finish (never cancelled)', () => {
    expect(classifyBootstrapRecovery(room(esc('settled'), FINISHED), isFin)).toBe('paid_finish');
  });
  it('settled escrow + UNFINISHED game → incoherent_paid (37.7.11: NEVER live)', () => {
    const r = room(esc('settled'), LIVE);
    expect(classifyBootstrapRecovery(r, isFin)).toBe('incoherent_paid');
  });
  it('funded escrow + UNFINISHED game → live', () => {
    expect(classifyBootstrapRecovery(room(esc('funded'), LIVE), isFin)).toBe('live');
  });
  it('funded/settling escrow + FINISHED game → payout_pending', () => {
    expect(classifyBootstrapRecovery(room(esc('funded'), FINISHED), isFin)).toBe('payout_pending');
    expect(classifyBootstrapRecovery(room(esc('settling'), FINISHED), isFin)).toBe('payout_pending');
  });
  it('(37.7.12) an UNBOUND live escrow → unbound_debit; a MISSING binding → unknown_binding', () => {
    expect(classifyBootstrapRecovery(room(esc('funded', 'm2'), FINISHED), isFin)).toBe('unbound_debit');
    expect(classifyBootstrapRecovery(room(esc('funded', 'm2'), LIVE), isFin)).toBe('unbound_debit');
    expect(classifyBootstrapRecovery(room(esc('settling', 'm2'), FINISHED), isFin)).toBe('unbound_debit');
    // A PAID escrow whose state is from another generation can't be paid OR refunded → frozen.
    expect(classifyBootstrapRecovery(room(esc('settled', 'm2'), FINISHED), isFin)).toBe('incoherent_paid');
    // No binding at all (a legacy save) → never guessed.
    expect(classifyBootstrapRecovery(room(esc('funded'), LIVE, { pokerGameMatchId: undefined }), isFin)).toBe('unknown_binding');
    // A legacy PAID room is `unknown_binding` too (both freeze; this one is the more precise reason).
    expect(classifyBootstrapRecovery(room(esc('settled'), FINISHED, { pokerGameMatchId: undefined }), isFin)).toBe('unknown_binding');
  });
  it('cancelled/absent/pending escrow → cancelled', () => {
    expect(classifyBootstrapRecovery(room(esc('pending'), FINISHED), isFin)).toBe('cancelled');
    expect(classifyBootstrapRecovery(room(esc('cancelled'), FINISHED), isFin)).toBe('cancelled');
    expect(classifyBootstrapRecovery(room(undefined, FINISHED), isFin)).toBe('cancelled');
  });
  it('frozen room → frozen; non-bankroll / no game → not_bankroll', () => {
    expect(classifyBootstrapRecovery(room(esc('settled'), FINISHED, { pokerFrozen: true }), isFin)).toBe('frozen');
    expect(classifyBootstrapRecovery(room(esc('settled'), null), isFin)).toBe('not_bankroll');
    expect(classifyBootstrapRecovery(room(esc('settled'), FINISHED, { pokerBuyIn: undefined }), isFin)).toBe('not_bankroll');
  });
});

describe('FAIL 1 — applyBootstrapRecovery preserves a paid finish, cancels a refund, freezes an incoherent paid state', () => {
  it('paid_finish is NOT cancelled (finished state kept; stats marked owed)', () => {
    const r = room(esc('settled'), FINISHED, { started: true });
    const deps = applyDeps();
    applyBootstrapRecovery(r, 'paid_finish', deps);
    expect(r.gameState).not.toBeNull();     // finished state preserved
    expect(r.pokerMatchCancelled).toBeUndefined();
    expect(r.pokerStatsPending).toBe(true); // the sweep finalizes stats idempotently
    expect(r.pokerFrozen).toBeUndefined();
    expect(deps.rescheduleAdvance).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalled();
  });
  it('incoherent_paid freezes: no advance, timers cleared, state kept, NOT cancelled', () => {
    const r = room(esc('settled'), LIVE, { started: true });
    const deps = applyDeps();
    applyBootstrapRecovery(r, 'incoherent_paid', deps);
    expect(r.pokerFrozen).toBe(true);
    expect(r.gameState).not.toBeNull();          // evidence kept for the operator
    expect(r.pokerMatchCancelled).toBeUndefined(); // nothing was refunded → never a cancelled lobby
    expect(deps.rescheduleAdvance).not.toHaveBeenCalled();
    expect(deps.clearTimers).toHaveBeenCalledOnce();
    expect(deps.freeze).toHaveBeenCalledOnce();   // logged exactly once
    expect(deps.persist).toHaveBeenCalled();      // the freeze survives a restart
  });
  it('cancelled wipes the game to a clean lobby', () => {
    const r = room(esc('cancelled'), FINISHED, { started: true });
    applyBootstrapRecovery(r, 'cancelled', applyDeps());
    expect(r.gameState).toBeNull();
    expect(r.pokerMatchCancelled).toBe(true);
    expect(r.started).toBe(false);
  });
  it('live reschedules the advance', () => {
    const r = room(esc('funded'), LIVE);
    const deps = applyDeps();
    applyBootstrapRecovery(r, 'live', deps);
    expect(deps.rescheduleAdvance).toHaveBeenCalledOnce();
  });
});

describe('FAIL 1 (37.7.11) — shouldDeferBootstrapAdvance: no bankroll room advances before classification', () => {
  it('defers EVERY bankroll room, whatever its escrow status', () => {
    for (const status of ['pending', 'funded', 'settling', 'settled', 'cancelled'] as const) {
      expect(shouldDeferBootstrapAdvance(room(esc(status), LIVE))).toBe(true);
    }
    expect(shouldDeferBootstrapAdvance(room(undefined, LIVE))).toBe(true);
    expect(shouldDeferBootstrapAdvance(room(esc('settled'), FINISHED, { pokerStatsPending: true }))).toBe(true);
    expect(shouldDeferBootstrapAdvance(room(esc('settled'), LIVE, { pokerFrozen: true }))).toBe(true);
  });
  it('does not defer non-bankroll rooms (the other 6 games / local free poker are unchanged)', () => {
    expect(shouldDeferBootstrapAdvance(room(undefined, LIVE, { gameType: 'king', pokerBuyIn: undefined }))).toBe(false);
    expect(shouldDeferBootstrapAdvance(room(undefined, LIVE, { pokerBuyIn: undefined }))).toBe(false);
  });
});

describe('FAIL 1 (37.7.11) — recoverRestoredBankrollRoom orchestration (the function index.ts runs)', () => {
  const deps = (over: Partial<{ reconcile: (r: ServerRoom) => Promise<void>; refund: (r: ServerRoom) => Promise<boolean> }> = {}) => ({
    ...applyDeps(),
    reconcileEscrow: over.reconcile ?? (async () => {}),
    isFinished: isFin,
    refundBuyIns: vi.fn(over.refund ?? (async (r: ServerRoom) => { if (r.pokerEscrow) r.pokerEscrow.status = 'cancelled'; return true; })),
  });

  it('reconciles BEFORE classifying — a settling escrow promoted to settled becomes paid_finish', async () => {
    const r = room(esc('settling'), FINISHED);
    const d = deps({ reconcile: async (rm) => { rm.pokerEscrow!.status = 'settled'; } });
    expect(await recoverRestoredBankrollRoom(r, d)).toBe('paid_finish');
    expect(r.pokerStatsPending).toBe(true);
    expect(d.rescheduleAdvance).not.toHaveBeenCalled();
  });

  it('a settling escrow promoted to settled with an UNFINISHED state freezes (never live)', async () => {
    const r = room(esc('settling'), LIVE);
    const d = deps({ reconcile: async (rm) => { rm.pokerEscrow!.status = 'settled'; } });
    expect(await recoverRestoredBankrollRoom(r, d)).toBe('incoherent_paid');
    expect(r.pokerFrozen).toBe(true);
    expect(d.rescheduleAdvance).not.toHaveBeenCalled();
  });

  it('only a live funded match re-arms the advance', async () => {
    const live = room(esc('funded'), LIVE);
    const dLive = deps();
    expect(await recoverRestoredBankrollRoom(live, dLive)).toBe('live');
    expect(dLive.rescheduleAdvance).toHaveBeenCalledOnce();

    for (const [status, state, expected] of [
      [esc('funded'), FINISHED, 'payout_pending'],
      [esc('settled'), FINISHED, 'paid_finish'],
      [esc('settled'), LIVE, 'incoherent_paid'],
      [esc('cancelled'), FINISHED, 'cancelled'],
    ] as Array<[PokerEscrow, PokerState, string]>) {
      const d = deps();
      expect(await recoverRestoredBankrollRoom(room(status, state), d)).toBe(expected);
      expect(d.rescheduleAdvance).not.toHaveBeenCalled();
    }
  });

  it('(37.7.12 FAIL 1) an UNBOUND live escrow (a crashed rematch debit) is refunded, never paid', async () => {
    // escrow M1 (funded) next to the PREVIOUS match's finished state (bound to m1 ≠ m2).
    const r = room(esc('funded', 'm2'), FINISHED, { started: true });
    const d = deps();
    expect(await recoverRestoredBankrollRoom(r, d)).toBe('unbound_debit');
    expect(d.refundBuyIns).toHaveBeenCalledOnce();     // the fresh, unplayed buy-in is refunded
    expect(d.rescheduleAdvance).not.toHaveBeenCalled();
    expect(r.gameState).toBeNull();                    // the previous generation's state is dropped
    expect(r.pokerGameMatchId).toBeUndefined();
    expect(r.started).toBe(false);
    expect(r.pokerMatchCancelled).toBe(true);          // refund CONFIRMED → honest cancelled lobby
    expect(r.pokerFrozen).toBeUndefined();
    expect(d.clearTimers).toHaveBeenCalledOnce();
  });

  it('(37.7.12) an UNBOUND escrow whose refund FAILS stays settlement-pending (funded, no game), never cancelled', async () => {
    const r = room(esc('funded', 'm2'), FINISHED, { started: true });
    const d = deps({ refund: async () => false });
    expect(await recoverRestoredBankrollRoom(r, d)).toBe('unbound_debit');
    expect(r.gameState).toBeNull();
    expect(r.pokerEscrow!.status).toBe('funded');      // still owed → the sweep retries
    expect(r.pokerMatchCancelled).toBeUndefined();     // NEVER a false "refunded"
    expect(r.pokerFrozen).toBeUndefined();
  });

  it('(37.7.12) a legacy room with NO binding freezes — the generation is never guessed', async () => {
    for (const [status, state] of [[esc('funded'), LIVE], [esc('funded'), FINISHED], [esc('settled'), FINISHED]] as Array<[PokerEscrow, PokerState]>) {
      const r = room(status, state, { pokerGameMatchId: undefined, started: true });
      const d = deps();
      const rec = await recoverRestoredBankrollRoom(r, d);
      expect(rec === 'unknown_binding' || rec === 'incoherent_paid').toBe(true);
      expect(r.pokerFrozen).toBe(true);                // frozen for review
      expect(r.gameState).not.toBeNull();              // nothing destroyed
      expect(d.refundBuyIns).not.toHaveBeenCalled();   // and nothing settled either way
      expect(d.rescheduleAdvance).not.toHaveBeenCalled();
    }
  });

  it('skips a non-bankroll room / a room with no game state without touching it', async () => {
    const d = deps();
    expect(await recoverRestoredBankrollRoom(room(esc('settled'), null), d)).toBe('not_bankroll');
    expect(await recoverRestoredBankrollRoom(room(undefined, LIVE, { gameType: 'king', pokerBuyIn: undefined }), d)).toBe('not_bankroll');
    expect(d.persist).not.toHaveBeenCalled();
    expect(d.rescheduleAdvance).not.toHaveBeenCalled();
  });
});
