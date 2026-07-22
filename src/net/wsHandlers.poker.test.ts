// ---------------------------------------------------------------------------
// wsHandlers online Poker is BANKROLL-ONLY (Stage 37.7.1 FAIL 4). CREATE_ROOM for
// poker must reject: no chip economy (no DB), no/forged stakes, and a guest/anonymous
// creator — there is NO free online Poker table. Local Poker is pass-and-play and never
// reaches CREATE_ROOM. Drives the real handleClientMessage with a minimal in-memory ctx.
// No real DB is touched (the CREATE path only reads isDbEnabled + validates stakes; the
// debit happens later at START_GAME).
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from 'vitest';
import { handleClientMessage, type WsContext, type SessionRef } from '../../server/wsHandlers';
import { removeMember, type ServerRoom } from './serverCore';
import { withRoomLock, isRoomBusy, clearRoomLock } from '../../server/pokerEscrow';
import { RoomSocialStore } from '../../server/roomSocial';
import { ConnectionLimiter, DEFAULT_RATE_LIMITS } from './rateLimit';
import type { ClientMessage, ErrorCode } from './messages';

const socket = {} as never;
const flush = () => new Promise((r) => setTimeout(r, 5)); // let the async auth IIFE settle

function makeCtx() {
  const rooms = new Map<string, ServerRoom>();
  const errors: ErrorCode[] = [];
  let n = 0;
  const ctx: WsContext = {
    rooms, sockets: new Map(), social: new RoomSocialStore(),
    send: () => {}, sendError: (_s, code) => { errors.push(code); },
    broadcastRoom: () => {}, broadcastToRoom: () => {}, broadcastAndAdvance: () => {},
    sendChatHistory: () => {}, persistRoom: () => {}, welcome: () => {},
    handleLeave: (room, clientId) => { const { empty } = removeMember(room, clientId); if (empty) rooms.delete(room.code); },
    makeRoomCode: () => `R${++n}`, logRoomEvent: () => {}, logLatestDeal: () => {},
  };
  return { ctx, rooms, errors };
}

function fresh(account: string | null = 'user-1') {
  const { ctx, rooms, errors } = makeCtx();
  const sessionRef: SessionRef = { value: null };
  const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
  const run = (msg: ClientMessage) =>
    handleClientMessage(ctx, socket, sessionRef, () => {}, msg, limiter, () => account, async () => account);
  return { rooms, errors, run };
}

const pokerCreate = (extra: Record<string, unknown> = {}): ClientMessage =>
  ({ t: 'CREATE_ROOM', name: 'Host', modeSelectionType: 'fixed', gameType: 'poker', ...extra } as ClientMessage);

afterEach(() => { delete process.env.DATABASE_URL; });

describe('online Poker CREATE is bankroll-only (FAIL 4)', () => {
  it('rejects online Poker with NO chip economy (no DB) — no room created', async () => {
    delete process.env.DATABASE_URL; // economy off
    const { rooms, errors, run } = fresh();
    run(pokerCreate({ pokerSmallBlind: 100, pokerBigBlind: 200 }));
    await flush();
    expect(rooms.size).toBe(0);
    expect(errors).toContain('BAD_MESSAGE');
  });

  it('rejects online Poker with NO / forged stakes (economy on) — no free table', async () => {
    process.env.DATABASE_URL = 'postgres://fake'; // isDbEnabled → true (no query in CREATE path)
    // No stakes at all.
    let s = fresh();
    s.run(pokerCreate());
    await flush();
    expect(s.rooms.size).toBe(0);
    expect(s.errors).toContain('BAD_MESSAGE');
    // Forged (non-whitelisted) stakes.
    s = fresh();
    s.run(pokerCreate({ pokerSmallBlind: 30, pokerBigBlind: 60 }));
    await flush();
    expect(s.rooms.size).toBe(0);
    expect(s.errors).toContain('BAD_MESSAGE');
  });

  it('rejects a guest / anonymous creator even with valid stakes', async () => {
    process.env.DATABASE_URL = 'postgres://fake';
    const { rooms, errors, run } = fresh(null); // getAccountUserId → null (guest/unauth)
    run(pokerCreate({ pokerSmallBlind: 100, pokerBigBlind: 200 }));
    await flush();
    expect(rooms.size).toBe(0);
    expect(errors).toContain('NOT_SIGNED_IN');
  });

  it('creates a bankroll room for a signed-in host with approved stakes (server derives buy-in)', async () => {
    process.env.DATABASE_URL = 'postgres://fake';
    const { rooms, run } = fresh('user-1');
    run(pokerCreate({ pokerSmallBlind: 100, pokerBigBlind: 200, pokerBlindGrowth: 5 }));
    await flush();
    expect(rooms.size).toBe(1);
    const room = [...rooms.values()][0];
    expect(room.pokerSmallBlind).toBe(100);
    expect(room.pokerBigBlind).toBe(200);
    expect(room.pokerBuyIn).toBe(20000);   // 100 BB, server-derived (client never supplies it)
    expect(room.pokerBlindGrowth).toBe(5);
  });

  it('local Poker never reaches CREATE_ROOM — the other games still host without a wallet', async () => {
    delete process.env.DATABASE_URL;
    const { rooms, run } = fresh(null); // no account, no DB
    run({ t: 'CREATE_ROOM', name: 'Host', modeSelectionType: 'fixed', gameType: 'king' } as ClientMessage);
    await flush();
    expect(rooms.size).toBe(1); // King is unaffected by the poker economy gate
  });
});

// A richer harness with a per-connection lifecycle + a controllable async account resolver,
// for the cancellable CREATE/JOIN (FAIL 3) and the navigation-vs-lock guard (FAIL 4).
function connHarness(account: string | null = 'acc-1') {
  const { ctx, rooms, errors } = makeCtx();
  const sessionRef: SessionRef = { value: null };
  const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
  let navSeq = 0; let open = true;
  const lifecycle = { beginNav: () => ++navSeq, isCurrentNav: (t: number) => t === navSeq && open };
  let resolveAccount!: (v: string | null) => void;
  let accountPromise = new Promise<string | null>((r) => { resolveAccount = r; });
  const run = (msg: ClientMessage) =>
    handleClientMessage(ctx, socket, sessionRef, () => {}, msg, limiter, () => account, () => accountPromise, lifecycle);
  return {
    rooms, errors, sessionRef, run,
    resolve: (v: string | null) => resolveAccount(v),
    rearm: () => { accountPromise = new Promise<string | null>((r) => { resolveAccount = r; }); },
    close: () => { open = false; },
  };
}

describe('cancellable async CREATE/JOIN lifecycle (FAIL 3)', () => {
  it('a delayed CREATE A superseded by CREATE B leaves no stale A room', async () => {
    process.env.DATABASE_URL = 'postgres://fake';
    const h = connHarness('acc-1');
    h.run(pokerCreate({ pokerSmallBlind: 100, pokerBigBlind: 200 }));           // A: nav 1, awaits account
    h.run({ t: 'CREATE_ROOM', name: 'Host', modeSelectionType: 'fixed', gameType: 'king' } as ClientMessage); // B: nav 2, creates now
    expect(h.rooms.size).toBe(1);
    h.resolve('acc-1'); await flush();
    expect(h.rooms.size).toBe(1);                                              // A did NOT spawn a 2nd room
    expect([...h.rooms.values()][0].gameType).toBe('king');                    // B is current
  });

  it('a socket close during auth creates no room', async () => {
    process.env.DATABASE_URL = 'postgres://fake';
    const h = connHarness('acc-1');
    h.run(pokerCreate({ pokerSmallBlind: 100, pokerBigBlind: 200 }));
    h.close();
    h.resolve('acc-1'); await flush();
    expect(h.rooms.size).toBe(0);
  });

  it('two parallel CREATE create only ONE room', async () => {
    process.env.DATABASE_URL = 'postgres://fake';
    const h = connHarness('acc-1');
    h.run(pokerCreate({ pokerSmallBlind: 100, pokerBigBlind: 200 }));          // nav 1
    h.rearm();
    h.run(pokerCreate({ pokerSmallBlind: 100, pokerBigBlind: 200 }));          // nav 2
    h.resolve('acc-1'); await flush();
    expect(h.rooms.size).toBe(1);
  });
});

describe('navigation refused during a bankroll lifecycle op (FAIL 4)', () => {
  it('LEAVE is rejected while the room lock is held; the seat stays', async () => {
    process.env.DATABASE_URL = 'postgres://fake';
    const h = connHarness('acc-1');
    h.run(pokerCreate({ pokerSmallBlind: 100, pokerBigBlind: 200 })); h.resolve('acc-1'); await flush();
    const room = [...h.rooms.values()][0];
    clearRoomLock(room.code);
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const op = withRoomLock(room.code, async () => { await gate; });
    expect(isRoomBusy(room.code)).toBe(true);
    h.errors.length = 0;
    h.run({ t: 'LEAVE_ROOM' } as ClientMessage);
    expect(h.errors).toContain('ILLEGAL_ACTION');
    expect(h.sessionRef.value).not.toBeNull();        // still seated (not silently detached)
    release(); await op;
    clearRoomLock(room.code);
  });
});

// Shared-ctx harness: multiple connections on ONE rooms map (for JOIN vs target-room tests).
function sharedHarness() {
  const { ctx, rooms, errors } = makeCtx();
  const welcomed: string[] = [];
  ctx.welcome = (_s, m) => { welcomed.push(m.clientId); };
  function conn(account: string | null = 'acc-1') {
    const sessionRef: SessionRef = { value: null };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
    let navSeq = 0; let open = true;
    const lifecycle = { beginNav: () => ++navSeq, isCurrentNav: (t: number) => t === navSeq && open };
    let resolveAccount!: (v: string | null) => void;
    let accountPromise = new Promise<string | null>((r) => { resolveAccount = r; });
    const run = (msg: ClientMessage) =>
      handleClientMessage(ctx, socket, sessionRef, () => {}, msg, limiter, () => account, () => accountPromise, lifecycle);
    return {
      sessionRef, run,
      resolve: (v: string | null) => resolveAccount(v),
      rearm: () => { accountPromise = new Promise<string | null>((r) => { resolveAccount = r; }); },
      close: () => { open = false; },
    };
  }
  return { ctx, rooms, errors, welcomed, conn };
}

async function makeBankrollRoom(h: ReturnType<typeof sharedHarness>, hostAcc = 'host-1') {
  process.env.DATABASE_URL = 'postgres://fake';
  const host = h.conn(hostAcc);
  host.run(pokerCreate({ pokerSmallBlind: 25, pokerBigBlind: 50 }));
  host.resolve(hostAcc); await flush();
  const room = [...h.rooms.values()][0];
  return { host, room };
}

describe('target-room JOIN serialization + host identity (Stage 37.7.3)', () => {
  it('FAIL 7: the Poker host member has an authoritative userId immediately after CREATE', async () => {
    const h = sharedHarness();
    const { room } = await makeBankrollRoom(h, 'host-xyz');
    const host = [...room.members.values()].find((m) => m.isHost)!;
    expect(host.userId).toBe('host-xyz');
  });

  it('FAIL 1: a player JOIN is rejected while the target bankroll room is busy (seats unchanged)', async () => {
    const h = sharedHarness();
    const { room } = await makeBankrollRoom(h);
    clearRoomLock(room.code);
    let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
    const op = withRoomLock(room.code, async () => { await gate; });   // room busy (debit in flight)
    expect(isRoomBusy(room.code)).toBe(true);
    const before = room.members.size;
    const joiner = h.conn('joiner-1');
    h.errors.length = 0;
    joiner.run({ t: 'JOIN_ROOM', code: room.code, name: 'Joiner' } as ClientMessage);
    joiner.resolve('joiner-1'); await flush();
    expect(h.errors).toContain('ILLEGAL_ACTION');
    expect(room.members.size).toBe(before);                            // no seat added mid-debit
    expect(joiner.sessionRef.value).toBeNull();
    release(); await op; clearRoomLock(room.code);
  });

  it('FAIL 2: a delayed JOIN whose target room was deleted creates no ghost member/session', async () => {
    const h = sharedHarness();
    const { room } = await makeBankrollRoom(h);
    const joiner = h.conn('joiner-2');
    joiner.run({ t: 'JOIN_ROOM', code: room.code, name: 'Joiner' } as ClientMessage); // awaits auth
    h.rooms.delete(room.code);                                         // room torn down during auth
    h.welcomed.length = 0; h.errors.length = 0;
    joiner.resolve('joiner-2'); await flush();
    expect(h.errors).toContain('ROOM_NOT_FOUND');
    expect(room.members.size).toBe(1);                                 // only the host; no ghost joiner
    expect(joiner.sessionRef.value).toBeNull();
    expect(h.welcomed).toHaveLength(0);                                // never welcomed into a ghost room
  });
});

describe('pending navigation is cancelled by every session transition (FAIL 6)', () => {
  for (const transition of ['RECONNECT', 'RECLAIM_ROOM', 'LEAVE_ROOM'] as const) {
    it(`a pending CREATE superseded by ${transition} does not create a room`, async () => {
      process.env.DATABASE_URL = 'postgres://fake';
      const h = sharedHarness();
      const c = h.conn('acc-1');
      c.run(pokerCreate({ pokerSmallBlind: 25, pokerBigBlind: 50 }));  // nav 1, awaits auth
      const msg = transition === 'LEAVE_ROOM' ? { t: 'LEAVE_ROOM' } : { t: transition, code: 'ZZZZ', reconnectToken: 'x' };
      c.run(msg as ClientMessage);                                     // bumps nav → cancels the CREATE
      c.resolve('acc-1'); await flush();
      expect(h.rooms.size).toBe(0);
      expect(c.sessionRef.value).toBeNull();
    });
  }
});

import { createRoom, addMember as addMemberSC } from './serverCore';
import type { PokerState } from '../games/poker/types';

// FAIL 2: a restored funded bankroll room on a server with NO economy (no DB) must FAIL CLOSED —
// no actions / start / rematch — and NOT be cancelled/refunded without DB proof.
describe('funded bankroll room with no economy fails closed (FAIL 2)', () => {
  function seatedBankrollNoDb() {
    delete process.env.DATABASE_URL; // economy OFF
    const { ctx, rooms, errors } = makeCtx();
    const room = createRoom({ code: 'PKNODB', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'h', reconnectToken: 't', name: 'Host', userId: 'u-h' }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMemberSC(room, { clientId: 'p2', reconnectToken: 't', name: 'B', userId: 'u-b' });
    room.pokerEscrow = { matchId: 'm1', buyIn: 5000, status: 'funded', seats: [{ seat: 0, userId: 'u-h', amount: 5000 }, { seat: 1, userId: 'u-b', amount: 5000 }] };
    room.gameState = { gameType: 'poker', phase: 'betting', playerCount: 2, players: [], toActSeat: 0 } as unknown as PokerState;
    room.started = true;
    rooms.set(room.code, room);
    const sessionRef: SessionRef = { value: { room, clientId: 'h' } };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
    const run = (msg: ClientMessage) => handleClientMessage(ctx, socket, sessionRef, () => {}, msg, limiter, () => 'u-h', async () => 'u-h');
    return { rooms, errors, room, run };
  }

  it('ACTION_REQUEST and START_GAME are rejected with ECONOMY_UNAVAILABLE; escrow + state preserved', () => {
    const h = seatedBankrollNoDb();
    h.run({ t: 'ACTION_REQUEST', action: { type: 'FOLD' } } as ClientMessage);
    expect(h.errors).toContain('ECONOMY_UNAVAILABLE');
    h.errors.length = 0;
    h.run({ t: 'START_GAME' } as ClientMessage);
    expect(h.errors).toContain('ECONOMY_UNAVAILABLE');
    // The funded escrow + game state are NOT cleared (never cancelled without DB proof).
    expect(h.room.pokerEscrow?.status).toBe('funded');
    expect(h.room.gameState).not.toBeNull();
    expect(h.room.pokerMatchCancelled).toBeFalsy();
  });
});

// FAIL 5: a superseded/closed async CREATE is FULLY SILENT — no stale error into a newer session.
describe('canceled async CREATE sends no stale error (FAIL 5)', () => {
  for (const transition of ['JOIN_ROOM', 'RECONNECT', 'LEAVE_ROOM'] as const) {
    it(`a delayed CREATE superseded by ${transition} with auth=null sends no NOT_SIGNED_IN`, async () => {
      process.env.DATABASE_URL = 'postgres://fake';
      const h = connHarness(null); // getAccountUserId resolves to null (guest)
      h.run(pokerCreate({ pokerSmallBlind: 25, pokerBigBlind: 50 }));         // nav 1, awaits auth
      const msg = transition === 'LEAVE_ROOM' ? { t: 'LEAVE_ROOM' } : { t: transition, code: 'ZZZZ', reconnectToken: 'x' };
      h.run(msg as ClientMessage);                                            // bumps nav → cancels the CREATE
      h.errors.length = 0;
      h.resolve(null); await flush();                                        // stale auth returns null
      expect(h.errors).not.toContain('NOT_SIGNED_IN');                       // fully silent
      expect(h.rooms.size).toBe(0);
    });
  }

  it('a socket close during auth (null) sends nothing', async () => {
    process.env.DATABASE_URL = 'postgres://fake';
    const h = connHarness(null);
    h.run(pokerCreate({ pokerSmallBlind: 25, pokerBigBlind: 50 }));
    h.close();
    h.errors.length = 0;
    h.resolve(null); await flush();
    expect(h.errors).toHaveLength(0);
  });

  it('a CURRENT unauthenticated CREATE still gets NOT_SIGNED_IN', async () => {
    process.env.DATABASE_URL = 'postgres://fake';
    const h = connHarness(null);
    h.run(pokerCreate({ pokerSmallBlind: 25, pokerBigBlind: 50 }));
    h.resolve(null); await flush();
    expect(h.errors).toContain('NOT_SIGNED_IN');
  });
});
