// Stage 36.0 — same-user cross-device reconnect: server-authoritative userId reclaim,
// discovery, the client protocol builders, and the close-handler race guard.
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createRoom, addMember, addBot, markDisconnected,
  reclaimMemberByUserId, findUserRoomCodes, type ServerRoom,
} from './serverCore';
import { firstConnectMessage, findMyRoomsMessage } from './online';

const id = () => randomUUID();
function room(code: string): ServerRoom {
  return createRoom({
    code, playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'tok', name: 'Host' }, now: 1000,
  });
}

describe('reclaimMemberByUserId (same-user cross-device)', () => {
  it('matches a human seat by the authoritative userId and marks it connected', () => {
    const r = room('AAAA');
    r.members.get('host')!.userId = 'user-1';
    markDisconnected(r, 'host');
    expect(r.members.get('host')!.connected).toBe(false);
    const m = reclaimMemberByUserId(r, 'user-1');
    expect(m?.clientId).toBe('host');
    expect(m?.connected).toBe(true); // reclaim reconnects the seat
  });

  it('never matches a blank/null userId — guests cannot reclaim each other', () => {
    const r = room('BBBB'); // host.userId stays null (a guest seat)
    expect(reclaimMemberByUserId(r, null)).toBeNull();
    expect(reclaimMemberByUserId(r, '')).toBeNull();
    expect(reclaimMemberByUserId(r, undefined)).toBeNull();
  });

  it('does not match a different account, and never a bot', () => {
    const r = room('CCCC');
    r.members.get('host')!.userId = 'user-1';
    addBot(r, 'host', { clientId: 'bot', reconnectToken: id() });
    expect(reclaimMemberByUserId(r, 'user-2')).toBeNull();          // different user
    expect(reclaimMemberByUserId(r, 'user-1')?.clientId).toBe('host'); // never the bot
  });
});

describe('findUserRoomCodes (discovery — privacy-safe)', () => {
  it('returns only code/gameType/started for rooms where the user has a seat', () => {
    const r1 = room('R1'); r1.members.get('host')!.userId = 'u1'; r1.started = true;
    const r2 = room('R2'); // no u1 seat
    const r3 = room('R3'); addMember(r3, { clientId: 'c2', reconnectToken: id(), name: 'X' });
    r3.members.get('c2')!.userId = 'u1';
    const refs = findUserRoomCodes([r1, r2, r3], 'u1');
    expect(refs.map((x) => x.code).sort()).toEqual(['R1', 'R3']);
    const one = refs.find((x) => x.code === 'R1')!;
    expect(one).toEqual({ code: 'R1', gameType: r1.gameType, started: true });
    // No tokens / hands / other identities ever leak in a discovery ref.
    expect(Object.keys(one).sort()).toEqual(['code', 'gameType', 'started']);
  });

  it('a guest (null/blank userId) discovers nothing', () => {
    const r = room('R'); r.members.get('host')!.userId = 'u1';
    expect(findUserRoomCodes([r], null)).toEqual([]);
    expect(findUserRoomCodes([r], '')).toEqual([]);
  });
});

describe('client reclaim protocol builders', () => {
  it('firstConnectMessage builds RECLAIM_ROOM (no token on the wire)', () => {
    const m = firstConnectMessage({ kind: 'reclaim', code: 'ABCD' });
    expect(m).toEqual({ t: 'RECLAIM_ROOM', code: 'ABCD' });
    expect(JSON.stringify(m)).not.toMatch(/token/i);
  });
  it('findMyRoomsMessage builds FIND_MY_ROOMS', () => {
    expect(findMyRoomsMessage()).toEqual({ t: 'FIND_MY_ROOMS' });
  });
});

describe('server wiring + race guard (source guards)', () => {
  const index = readFileSync(join(process.cwd(), 'server/index.ts'), 'utf8');
  const ws = readFileSync(join(process.cwd(), 'server/wsHandlers.ts'), 'utf8');

  it('close handler only disconnects when THIS socket still owns the clientId (race guard)', () => {
    expect(index).toMatch(/sockets\.get\(session\.clientId\) !== socket\) return/);
  });

  it('RECLAIM_ROOM is server-userId-matched, refuses guests, and mints a FRESH token', () => {
    expect(ws).toContain("case 'RECLAIM_ROOM'");
    expect(ws).toContain('reclaimMemberByUserId(room, uid)');
    expect(ws).toContain("if (!uid) return sendError");
    expect(ws).toContain('member.reconnectToken = hashReconnectToken(reconnectToken)');
    // The reclaim path never trusts a client-supplied identity — it reads getUserId().
    expect(ws).toContain('const uid = getUserId()');
  });

  it('orphan room TTL default is 5 minutes (Stage 36.0)', () => {
    expect(index).toMatch(/ORPHAN_ROOM_TTL_MS\s*=\s*Number\(process\.env\.ORPHAN_ROOM_TTL_MS \?\? 5 \* 60 \* 1000\)/);
  });
});
