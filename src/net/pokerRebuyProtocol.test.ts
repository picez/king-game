import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ensureRebuyDeadline, clearRebuyDeadline, shouldCloseRebuyWindow, closeRebuyWindow,
  inOnlineRebuyWindow, resolveRebuySeat, rebuyRequestAllowed, hasRebuyInFlight, REBUY_WINDOW_MS,
} from '../../server/pokerRebuy';
import { rebuyIdempotencyKey, parseRebuyKey } from '../../server/db/pokerWallet';
import { createRoom, addMember } from './serverCore';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer } from '../games/poker/types';

// Stage 38.0.3C §17 — the ONLINE rebuy protocol + authorization, with NO database.
// The client sends an EMPTY intent; every value (room, account, seat, match, hand, amount)
// is derived server-side. These pin that contract and the window's deadline semantics.

// These are PURE predicate tests (no query is ever issued), but `pokerRecoveryBlocked`
// treats a funded bankroll room with NO economy configured as blocked — which is correct
// in production. Declaring a URL makes `isDbEnabled()` true so the authorization rules
// themselves are what is under test.
process.env.DATABASE_URL ||= 'postgres://unit-test/not-connected';

const BUY_IN = 5000;
const P = (seat: number): PokerPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' });

function windowState(over: Partial<PokerState> = {}): PokerState {
  const f = () => [false, false];
  return {
    gameType: 'poker', phase: 'rebuy_window', playerCount: 2, players: [P(0), P(1)],
    options: { startingStack: BUY_IN, smallBlind: 25, bigBlind: 50, blindGrowthEveryHands: 0 },
    buttonSeat: 0, handNumber: 4, street: 'river', smallBlindCurrent: 25, bigBlindCurrent: 50,
    stacksBySeat: [2 * BUY_IN, 0], holeCardsBySeat: [[], []], board: [], deck: [], burned: [],
    committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(), allInBySeat: f(),
    wasAllInBySeat: f(), actedBySeat: f(), raiseOpenBySeat: f(), eliminatedBySeat: f(),
    currentBet: 0, minRaise: 50, toActSeat: 0, revealedBySeat: f(), lastHand: null, winnerSeat: null,
    actionLog: [], telemetry: {
      handsPlayedBySeat: [4, 4], handsWonBySeat: [3, 1], showdownsWonBySeat: [1, 0],
      potsWonBySeat: [3, 1], biggestPotBySeat: [900, 400], allInsWonBySeat: [0, 0], royalFlushBySeat: [0, 0],
    },
    rebuyWindow: { handNumber: 4, eligibleSeats: [1], decisionBySeat: ['pending', 'pending'] },
    appliedRebuys: [], ...over,
  } as unknown as PokerState;
}

/** A funded, bound bankroll room paused on a rebuy window (no DB needed). */
function bankrollRoom(state: PokerState = windowState()): ServerRoom {
  const room = createRoom({
    code: 'RB00', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker',
    host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: 'user-A' },
    pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: BUY_IN,
  });
  addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: 'user-B' });
  room.started = true;
  room.gameState = state as unknown as typeof room.gameState;
  room.pokerEscrow = {
    matchId: 'match-1', buyIn: BUY_IN, status: 'funded',
    seats: [{ seat: 0, userId: 'user-A', amount: BUY_IN }, { seat: 1, userId: 'user-B', amount: BUY_IN }],
  };
  room.pokerGameMatchId = 'match-1';
  return room;
}

describe('the client intents carry NOTHING', () => {
  const messages = readFileSync(join(process.cwd(), 'src/net/messages.ts'), 'utf8');
  const index = readFileSync(join(process.cwd(), 'server/index.ts'), 'utf8');

  it('both messages are declared with an EMPTY payload', () => {
    expect(messages).toMatch(/\{ t: 'POKER_REBUY_REQUEST' \}/);
    expect(messages).toMatch(/\{ t: 'POKER_REBUY_DECLINE' \}/);
  });

  it('no financial or identity field can be sent by the client', () => {
    const decl = messages.slice(messages.indexOf("POKER_REBUY_REQUEST") - 200, messages.indexOf("POKER_REBUY_DECLINE") + 60);
    for (const banned of ['amount', 'seat', 'userId', 'matchId', 'roomCode', 'balance', 'handNumber']) {
      expect(decl.includes(`${banned}:`), `payload must not accept ${banned}`).toBe(false);
    }
  });

  it('the server derives every value itself and never routes a rebuy through ACTION_REQUEST', () => {
    expect(index).toContain('resolveRebuySeat(live, userId)');
    expect(index).toContain('rebuyRequestAllowed(live, seat)');
    expect(index).toMatch(/POKER_REBUY_REQUEST' \|\| msg\.t === 'POKER_REBUY_DECLINE'/);
    // The pure actions stay lifecycle-only, so a seated ACTION_REQUEST cannot drive them.
    const rules = readFileSync(join(process.cwd(), 'src/games/poker/rules.ts'), 'utf8');
    expect(rules).toContain("action.type === 'REBUY'");
  });

  it('an extra field on the wire changes nothing — the server reads only the type', () => {
    // The handler never dereferences the message beyond `msg.t`.
    const slice = index.slice(index.indexOf('handlePokerRebuy(sessionRef'), index.indexOf('handlePokerRebuy(sessionRef') + 200);
    expect(slice).not.toMatch(/msg\.(amount|seat|userId|matchId|balance)/);
  });
});

describe('seat + eligibility authorization', () => {
  it('resolves the seat from authoritative membership, never from the client', () => {
    const room = bankrollRoom();
    expect(resolveRebuySeat(room, 'user-B')).toBe(1);
    expect(resolveRebuySeat(room, 'user-A')).toBe(0);
    expect(resolveRebuySeat(room, 'someone-else')).toBe(null);   // not seated → no seat
    expect(resolveRebuySeat(room, null)).toBe(null);             // guest / unauthenticated
  });

  it('allows ONLY the busted seat inside an open window', () => {
    const room = bankrollRoom();
    expect(rebuyRequestAllowed(room, 1)).toBe(true);
    expect(rebuyRequestAllowed(room, 0)).toBe(false);            // still has chips — never a top-up
    expect(rebuyRequestAllowed(room, null)).toBe(false);
    expect(rebuyRequestAllowed(room, 5)).toBe(false);            // out of range
  });

  it('refuses once the seat has decided', () => {
    const room = bankrollRoom(windowState({
      rebuyWindow: { handNumber: 4, eligibleSeats: [1], decisionBySeat: ['pending', 'declined'] },
    } as Partial<PokerState>));
    expect(rebuyRequestAllowed(room, 1)).toBe(false);
  });

  it('refuses outside a rebuy window (mid-hand and after the close)', () => {
    expect(rebuyRequestAllowed(bankrollRoom(windowState({ phase: 'betting' } as Partial<PokerState>)), 1)).toBe(false);
    expect(rebuyRequestAllowed(bankrollRoom(windowState({ phase: 'hand_complete', rebuyWindow: null } as Partial<PokerState>)), 1)).toBe(false);
  });

  it('refuses a non-bankroll room, an unfunded escrow and an UNBOUND state', () => {
    const free = bankrollRoom(); free.pokerBuyIn = undefined;
    expect(rebuyRequestAllowed(free, 1)).toBe(false);
    const unfunded = bankrollRoom(); unfunded.pokerEscrow!.status = 'settling';
    expect(rebuyRequestAllowed(unfunded, 1)).toBe(false);
    const unbound = bankrollRoom(); unbound.pokerGameMatchId = 'another-match';
    expect(rebuyRequestAllowed(unbound, 1)).toBe(false);
  });

  it('refuses a frozen / recovery-blocked room', () => {
    const frozen = bankrollRoom(); frozen.pokerFrozen = true;
    expect(rebuyRequestAllowed(frozen, 1)).toBe(false);
    const statsPending = bankrollRoom(); statsPending.pokerStatsPending = true;
    expect(rebuyRequestAllowed(statsPending, 1)).toBe(false);
  });

  it('fails CLOSED when the pure amount and the table buy-in disagree', () => {
    const drift = bankrollRoom(windowState());
    (drift.gameState as unknown as PokerState).options.startingStack = BUY_IN + 1;
    expect(rebuyRequestAllowed(drift, 1)).toBe(false);
  });
});

describe('the 20-second server-authoritative window', () => {
  it('is minted ONCE per (match, hand) and never extended', () => {
    const room = bankrollRoom();
    expect(ensureRebuyDeadline(room, { now: () => 1_000 })).toBe(true);
    expect(room.pokerRebuyDeadlineAt).toBe(1_000 + REBUY_WINDOW_MS);
    expect(REBUY_WINDOW_MS).toBe(20_000);
    const rev = room.pokerRebuyRevision;
    expect(ensureRebuyDeadline(room, { now: () => 500_000 })).toBe(false);   // reconnect / rebroadcast
    expect(room.pokerRebuyDeadlineAt).toBe(1_000 + REBUY_WINDOW_MS);
    expect(room.pokerRebuyRevision).toBe(rev);
  });

  it('a NEW hand window mints a fresh deadline and bumps the revision', () => {
    const room = bankrollRoom();
    ensureRebuyDeadline(room, { now: () => 1_000 });
    const st = room.gameState as unknown as PokerState;
    st.handNumber = 5;
    st.rebuyWindow = { handNumber: 5, eligibleSeats: [1], decisionBySeat: ['pending', 'pending'] };
    expect(ensureRebuyDeadline(room, { now: () => 60_000 })).toBe(true);
    expect(room.pokerRebuyDeadlineAt).toBe(60_000 + REBUY_WINDOW_MS);
    expect(room.pokerRebuyRevision).toBe(2);
  });

  it('closes on the deadline, early on full agreement, and never while a debit is in flight', () => {
    const room = bankrollRoom();
    ensureRebuyDeadline(room, { now: () => 0 });
    expect(shouldCloseRebuyWindow(room, 19_999)).toBe(false);
    expect(shouldCloseRebuyWindow(room, 20_000)).toBe(true);          // timeout = decline
    const decided = bankrollRoom(windowState({
      rebuyWindow: { handNumber: 4, eligibleSeats: [1], decisionBySeat: ['pending', 'declined'] },
    } as Partial<PokerState>));
    ensureRebuyDeadline(decided, { now: () => 0 });
    expect(shouldCloseRebuyWindow(decided, 1)).toBe(true);            // early close
    decided.pokerRebuyInFlight = new Set([1]);
    expect(hasRebuyInFlight(decided)).toBe(true);
    expect(shouldCloseRebuyWindow(decided, 10_000_000)).toBe(false);  // in-flight debit blocks it
  });

  it('closing eliminates the undecided seat and clears the window bookkeeping', () => {
    const room = bankrollRoom();
    ensureRebuyDeadline(room, { now: () => 0 });
    expect(closeRebuyWindow(room)).toBe(true);
    const st = room.gameState as unknown as PokerState;
    expect(st.eliminatedBySeat[1]).toBe(true);
    expect(st.phase).toBe('game_finished');
    expect(room.pokerRebuyDeadlineAt).toBeUndefined();
    expect(room.pokerRebuyMatchId).toBeUndefined();
  });

  it('clearRebuyDeadline drops every field including the in-flight set', () => {
    const room = bankrollRoom();
    ensureRebuyDeadline(room, { now: () => 0 });
    room.pokerRebuyInFlight = new Set([1]);
    clearRebuyDeadline(room);
    expect(room.pokerRebuyDeadlineAt).toBeUndefined();
    expect(room.pokerRebuyHand).toBeUndefined();
    expect(room.pokerRebuyInFlight).toBeUndefined();
  });

  it('only a BANKROLL poker room is driven by the online window', () => {
    expect(inOnlineRebuyWindow(bankrollRoom())).toBe(true);
    const free = bankrollRoom(); free.pokerBuyIn = undefined;
    expect(inOnlineRebuyWindow(free)).toBe(false);
  });
});

describe('the durable rebuy key is parsed strictly', () => {
  it('round-trips and rejects every malformed shape', () => {
    const key = rebuyIdempotencyKey('m1', 7, 'u1');
    expect(key).toBe('rebuy:m1:7:u1');
    expect(parseRebuyKey(key)).toEqual({ matchId: 'm1', handNumber: 7, userId: 'u1' });
    for (const bad of [
      'rebuy:m1:7', 'rebuy:m1:7:u1:extra', 'buyin:m1:7:u1', 'rebuy::7:u1', 'rebuy:m1:7:',
      'rebuy:m1:x:u1', 'rebuy:m1:-1:u1', 'rebuy:m1:0:u1', 'rebuy:m1:7.5:u1', '',
    ]) expect(parseRebuyKey(bad), bad).toBe(null);
  });
});

describe('the temporary online auto-close is gone', () => {
  const core = readFileSync(join(process.cwd(), 'src/net/serverCore.ts'), 'utf8');

  it('a BANKROLL window is never closed by the generic advance', () => {
    expect(core).toMatch(/if \(bankroll\) return false;/);
  });

  it('a NON-bankroll poker room still closes immediately (no economy to wait for)', () => {
    expect(core).toMatch(/CLOSE_REBUY_WINDOW/);
  });
});
