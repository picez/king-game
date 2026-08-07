// ---------------------------------------------------------------------------
// Stage 38.0.5 — protocol separation, LEAVE_ROOM scope, and the finish-attribution
// ownership split.
//
// Half of this is BEHAVIOURAL (the real `handleClientMessage` is driven with a spying
// context), and half pins the composition-root wiring that only lives in `server/index.ts`
// — the same pattern the Poker stages use for code that cannot be imported standalone.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleClientMessage, type WsContext, type SessionRef } from '../../server/wsHandlers';
import {
  createRoom, addMember, startGame, removeMember, type ServerRoom,
} from './serverCore';
import { RoomSocialStore } from '../../server/roomSocial';
import { ConnectionLimiter, DEFAULT_RATE_LIMITS } from './rateLimit';
import type { ClientMessage } from './messages';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/** Source with COMMENTS stripped — these guards are about the code, not the prose that
 *  documents it (every one of these files legitimately NAMES the things it must not do). */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments
  .replace(/^\s*--.*$/gm, ' ')        // SQL line comments
  .replace(/(^|[^:])\/\/.*$/gm, '$1'); // JS line comments (not '://')
const socket = {} as never;

interface Harness {
  ctx: WsContext;
  rooms: Map<string, ServerRoom>;
  calls: string[];
  started: string[];
}

function makeCtx(): Harness {
  const rooms = new Map<string, ServerRoom>();
  const calls: string[] = [];
  const started: string[] = [];
  const ctx: WsContext = {
    rooms,
    sockets: new Map(),
    social: new RoomSocialStore(),
    send: () => {},
    sendError: () => {},
    broadcastRoom: () => {},
    broadcastToRoom: () => {},
    broadcastAndAdvance: () => {},
    sendChatHistory: () => {},
    persistRoom: () => {},
    welcome: () => {},
    beginOnlineMatch: (room) => { started.push(room.code); },
    handleLeave: (room, clientId) => {
      calls.push('handleLeave');
      const { empty } = removeMember(room, clientId);
      const hasHuman = [...room.members.values()].some((m) => m.type === 'human');
      if (empty || !hasHuman) rooms.delete(room.code);
    },
    detachSession: () => { calls.push('detachSession'); },
    makeRoomCode: () => 'RM01',
    logRoomEvent: () => {},
    logLatestDeal: () => {},
  };
  return { ctx, rooms, calls, started };
}

/** A started 2-player Durak room registered in the harness, plus a live session for seat 1. */
function startedSession(h: Harness): SessionRef {
  const room = createRoom({
    code: 'WIR1', gameType: 'durak', playerCount: 2, modeSelectionType: 'fixed',
    host: { clientId: 'c0', reconnectToken: 't0', name: 'P0' }, now: 1,
  });
  addMember(room, { clientId: 'c1', reconnectToken: 't1', name: 'P1' });
  expect(startGame(room, { seed: 5, now: 1 }).ok).toBe(true);
  h.rooms.set(room.code, room);
  return { value: { room, clientId: 'c1' } };
}

describe('LEAVE_ROOM is LOBBY-ONLY (38.0.5)', () => {
  const limiter = () => new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

  it('in the LOBBY it still removes the member (no loss, no bot) — unchanged', () => {
    const h = makeCtx();
    const room = createRoom({
      code: 'LOB2', gameType: 'durak', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'P0' }, now: 1,
    });
    addMember(room, { clientId: 'c1', reconnectToken: 't1', name: 'P1' });
    h.rooms.set(room.code, room);
    const ref: SessionRef = { value: { room, clientId: 'c1' } };

    handleClientMessage(h.ctx, socket, ref, () => {}, { t: 'LEAVE_ROOM' } as ClientMessage, limiter());

    expect(h.calls).toEqual(['handleLeave']);
    expect(room.members.has('c1')).toBe(false);
    expect([...room.members.values()].some((m) => m.type === 'ai')).toBe(false);
    expect(ref.value).toBeNull();
  });

  it('during an ACTIVE game it keeps the seat reconnectable and NEVER renumbers', () => {
    const h = makeCtx();
    const ref = startedSession(h);
    const room = ref.value!.room;
    const seatsBefore = [...room.members.values()].map((m) => m.seatIndex);

    handleClientMessage(h.ctx, socket, ref, () => {}, { t: 'LEAVE_ROOM' } as ClientMessage, limiter());

    expect(h.calls).toEqual(['detachSession']);         // NOT handleLeave
    expect(room.members.has('c1')).toBe(true);          // the seat is kept
    expect([...room.members.values()].map((m) => m.seatIndex)).toEqual(seatsBefore);
    expect([...room.members.values()].some((m) => m.type === 'ai')).toBe(false); // no bot spawned
    expect(ref.value).toBeNull();                       // this connection is done with the room
  });

  it('never routes the permanent forfeit through LEAVE_ROOM', () => {
    const ws = code('server/wsHandlers.ts');
    const leaveCase = ws.slice(ws.indexOf("case 'LEAVE_ROOM'"), ws.indexOf("case 'SEND_REACTION'"));
    expect(leaveCase).not.toMatch(/takeoverSeatWithAi|runPermanentLeave|forfeit/i);
    expect(leaveCase).toMatch(/cur\.room\.started\) ctx\.detachSession/);
    // The permanent intent is NOT part of the generic dispatch switch at all.
    expect(ws).not.toContain('LEAVE_GAME_PERMANENTLY');
  });
});

describe('the protocol keeps the three exits separate', () => {
  const msgs = read('src/net/messages.ts');
  it('defines a dedicated client intent and a dedicated server ACK', () => {
    expect(msgs).toContain("| { t: 'LEAVE_GAME_PERMANENTLY' }");
    expect(msgs).toContain("| { t: 'PERMANENT_LEAVE_ACCEPTED' }");
  });
  it('both carry NO payload (nothing about the forfeit comes from the client)', () => {
    expect(msgs).not.toMatch(/LEAVE_GAME_PERMANENTLY';\s*\w+:/);
    expect(msgs).not.toMatch(/PERMANENT_LEAVE_ACCEPTED';\s*\w+:/);
  });
  it('has its own retryable error code', () => {
    expect(msgs).toContain("| 'PERMANENT_LEAVE_UNAVAILABLE'");
  });
  it('LEAVE_ROOM is still its own, unchanged message', () => {
    expect(msgs).toContain("| { t: 'LEAVE_ROOM' }");
  });
});

describe('the composition root wires the orchestration correctly', () => {
  const idx = read('server/index.ts');
  it('routes the intent outside the generic dispatch, with the socket + resolved account', () => {
    expect(idx).toMatch(/if \(msg\.t === 'LEAVE_GAME_PERMANENTLY'\) \{[\s\S]{0,200}handlePermanentLeave\(sessionRef, socket, \(\) => resolvedUserId\)/);
  });
  it('serializes on the ROOM lock, exactly like every other lifecycle op', () => {
    expect(idx).toMatch(/withRoomLock\(code, \(\) =>\s*\n?\s*runPermanentLeave\(code, clientId, accountUserId\(\), permanentLeaveDeps\(\)\)/);
  });
  it('a rejected promise degrades to a RETRYABLE refusal, never a silent success', () => {
    expect(idx).toMatch(/\.catch\(\(\) => \(\{ ok: false, reason: 'retryable' \} as const\)\)/);
  });
  it('ACKs only on success, and only after clearing this connection’s session', () => {
    const fn = idx.slice(idx.indexOf('async function handlePermanentLeave'), idx.indexOf('function rescheduleAdvance'));
    expect(fn).toMatch(/if \(!result\.ok\) \{ refuse\(\); return; \}/);
    expect(fn).toMatch(/ref\.value = null;[\s\S]{0,120}send\(socket, \{ t: 'PERMANENT_LEAVE_ACCEPTED' \}\)/);
  });
  it('re-evaluates the room with the CONNECTION-EVENT variant (no new turn deadline)', () => {
    const src = code('server/index.ts');
    const deps = src.slice(src.indexOf('function permanentLeaveDeps'), src.indexOf('async function handlePermanentLeave'));
    expect(deps).toContain('advance: (room) => broadcastAndAdvance(room),');
    expect(deps).not.toContain('turnAdvanced');
  });
  it('freezes the match at START and again for a rematch (a NEW match id each time)', () => {
    expect(read('server/wsHandlers.ts')).toContain('ctx.beginOnlineMatch?.(room);');
    expect(idx).toMatch(/beginOnlineMatch\(room\);\s*\n\s*logLatestDeal\(room\);/);
    expect(idx).toMatch(/freezeOnlineMatch\(room, randomUUID\(\), Date\.now\(\)\)/);
  });
});

describe('START_GAME freezes the match for every non-Poker online game', () => {
  it('the WS start path calls beginOnlineMatch', () => {
    const h = makeCtx();
    const room = createRoom({
      code: 'STR1', gameType: 'durak', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'P0' }, now: 1,
    });
    addMember(room, { clientId: 'c1', reconnectToken: 't1', name: 'P1' });
    h.rooms.set(room.code, room);
    const ref: SessionRef = { value: { room, clientId: 'c0' } };
    handleClientMessage(h.ctx, socket, ref, () => {}, { t: 'START_GAME' } as ClientMessage, new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0));
    expect(h.started).toEqual(['STR1']);
  });
});

describe('finish attribution ownership (B6)', () => {
  const idx = read('server/index.ts');
  it('the rating gate reads the FROZEN category, not live membership', () => {
    expect(idx).toContain('if (!ratedByFrozenCategory(meta))');
    // The legacy live-membership rule survives ONLY as the pre-38.0.5 fallback.
    const gate = idx.slice(idx.indexOf('const meta = room.onlineMatch;'), idx.indexOf('const gt = room.gameType;'));
    expect(gate).toMatch(/\} else \{[\s\S]*botPlayers > 0 \|\| humanPlayers < 2/);
  });
  it('the seat→account map comes from the immutable roster (forfeited seats dropped)', () => {
    expect(idx).toContain('for (const [seat, uid] of finishSeatUsers(meta, liveUserBySeat)) seatUsers.set(seat, uid);');
  });
  it('the canonical participant outcomes are recorded for BOTH categories', () => {
    expect(idx).toMatch(/if \(meta\) recordOnlineMatchOutcome\(room, meta, state\);/);
    const fn = idx.slice(idx.indexOf('function recordOnlineMatchOutcome'), idx.indexOf('/** The confirmed-stats recorder deps'));
    expect(fn).toContain('recordOnlineMatchFinish');
    expect(fn).not.toContain('ratedByFrozenCategory');   // independent of the rating gate
  });
  it('the canonical model NEVER writes the legacy rating tables (one owner each)', () => {
    const repo = code('server/db/onlineMatches.ts');
    expect(repo).not.toMatch(/\b(userStats|gamePlayers|rounds)\b/);
    expect(repo).not.toMatch(/\bgames\b/);
    expect(repo).not.toMatch(/user_stats|game_players/);
  });
  it('the legacy rating writers are untouched by this stage', () => {
    expect(code('server/db/stats.ts')).not.toMatch(/onlineMatch|forfeit/i);
    for (const f of ['durakStats', 'debercStats', 'tarneebStats', 'preferansStats', 'fiftyOneStats']) {
      expect(code(`server/db/${f}.ts`), f).not.toMatch(/onlineMatch|forfeit/i);
    }
  });
});

describe('Poker and local play are out of scope', () => {
  it('the bankroll poker finish returns BEFORE the new attribution gate', () => {
    const idx = read('server/index.ts');
    const fn = idx.slice(idx.indexOf('function maybeRecordFinished'), idx.indexOf('function broadcastAndAdvance'));
    expect(fn.indexOf('settleAndRecordBankrollPokerFinish')).toBeLessThan(fn.indexOf('recordOnlineMatchOutcome'));
  });
  it('no Poker economy module mentions the permanent leave', () => {
    for (const f of ['pokerEscrow', 'pokerFinish', 'pokerRebuy', 'pokerBinding', 'pokerBootstrap', 'pokerRematch', 'pokerParticipants', 'pokerDurableOwnership']) {
      expect(code(`server/${f}.ts`), f).not.toMatch(/permanentLeave|LEAVE_GAME_PERMANENTLY|onlineMatch/i);
    }
  });
  it('migration 0014 touches no existing table and no poker object', () => {
    const sql = code('server/db/migrations/0014_online_matches.sql');
    expect(sql).not.toMatch(/ALTER TABLE public\.(users|games|game_players|rounds|user_stats|rooms|poker_\w+)/i);
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|UPDATE /i);
    // Additive + idempotent.
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS online_matches/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS online_match_participants/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/);
    // No private material.
    expect(sql).not.toMatch(/email|token|card|hand|balance|chip/i);
  });
  it('local play has no permanent-leave surface at all', () => {
    for (const f of ['src/ui/LocalGame.tsx', 'src/ui/GameRouter.tsx']) {
      expect(read(f), f).not.toMatch(/permanentLeave|PermanentLeaveControl|LEAVE_GAME_PERMANENTLY/);
    }
  });
});

describe('the takeover never uses the lobby removal path', () => {
  const core = code('src/net/serverCore.ts');
  it('takeoverSeatWithAi calls neither removeMember nor assignSeats', () => {
    const fn = core.slice(core.indexOf('export function takeoverSeatWithAi'), core.indexOf('export function startGame'));
    expect(fn).not.toMatch(/\bassignSeats\(/);
    expect(fn).not.toMatch(/\bremoveMember\(/);
    expect(fn).toContain('room.members = new Map(entries)');   // replace in place
  });
  it('the orchestrator never touches the game state or the turn deadline', () => {
    const pl = code('server/permanentLeave.ts');
    expect(pl).not.toMatch(/gameState\s*=/);
    expect(pl).not.toMatch(/beginTurnDeadline|turnDeadlineAt|restartGame|startGame\(/);
  });
  it('the durable forfeit is awaited BEFORE the takeover, in the source order', () => {
    const pl = code('server/permanentLeave.ts');
    // (38.0.5.1) The post-commit teardown uses the identity-only helper.
    expect(pl.indexOf('deps.applyForfeit(')).toBeLessThan(pl.indexOf('takeoverSeatAfterForfeit(live'));
    expect(pl.indexOf('deps.applyForfeit(')).toBeLessThan(pl.indexOf('deps.closeRoom(live)'));
  });
});
