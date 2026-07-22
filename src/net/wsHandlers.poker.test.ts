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
