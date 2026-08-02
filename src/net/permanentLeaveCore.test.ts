// ---------------------------------------------------------------------------
// Stage 38.0.5 — the six-game IRREVERSIBLE seat-takeover matrix (pure serverCore).
//
// Every one of the six online non-Poker games is driven through the SAME functions the
// WS layer uses, and every property the feature promises is asserted per game:
//   • the AI lands on the SAME seat — no `assignSeats`, so nothing is re-numbered;
//   • the authoritative `gameState` is byte-identical afterwards (that single deep
//     comparison covers dealer/mode/turn, attacker/defender, teams, bid/contract,
//     declarer/role, melds and elimination state at once) — plus the game-specific
//     fields are ALSO named explicitly below, so a regression names itself;
//   • the departed reconnect identity is annulled (RECONNECT, RECLAIM_ROOM and
//     FIND_MY_ROOMS all stop working for it);
//   • the host badge never lands on a bot;
//   • the current turn deadline is untouched;
//   • serialize → restore preserves the frozen category/roster/forfeit and the takeover.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, snapshot, roomSummary,
  serializeRoom, deserializeRoom, actingMember, botMemberToAct,
  reconnectMember, reclaimMemberByUserId, findUserRoomCodes, beginTurnDeadline,
  freezeOnlineMatch, planPermanentLeave, takeoverSeatWithAi, hasOtherHuman,
  markRematchReady, rematchStateOf, activePlayers,
  type ServerRoom,
} from './serverCore';
import { markSeatForfeited, isSeatForfeited } from './onlineMatch';
import type { GameType } from '../games/catalog';

/** The six ONLINE non-Poker games + the smallest all-human table each supports. */
const GAMES: Array<{ gt: GameType; seats: 2 | 3 | 4 }> = [
  { gt: 'king', seats: 3 },
  { gt: 'durak', seats: 3 },
  { gt: 'deberc', seats: 3 },
  { gt: 'tarneeb', seats: 4 },
  { gt: 'preferans', seats: 3 },
  { gt: 'fifty-one', seats: 3 },
];

let counter = 0;
/** A STARTED all-human online room with frozen match metadata. */
function humanRoom(gt: GameType, seats: number, opts: { timerSec?: number } = {}): ServerRoom {
  const room = createRoom({
    code: `R${(counter++).toString(36).toUpperCase().padStart(3, '0')}`.slice(0, 4),
    gameType: gt, playerCount: seats as 2 | 3 | 4, modeSelectionType: 'fixed',
    host: { clientId: 'c0', reconnectToken: 't0', name: 'P0', userId: 'u0' }, now: 1,
    turnTimerSec: opts.timerSec ?? 0,
  });
  for (let i = 1; i < seats; i++) {
    expect(addMember(room, { clientId: `c${i}`, reconnectToken: `t${i}`, name: `P${i}`, userId: `u${i}` }).ok).toBe(true);
  }
  expect(startGame(room, { seed: 42, now: 1 }).ok).toBe(true);
  expect(freezeOnlineMatch(room, `match-${room.code}`, 1000)).not.toBeNull();
  return room;
}

const clientAtSeat = (room: ServerRoom, seat: number): string => {
  for (const [cid, m] of room.members) if (m.seatIndex === seat) return cid;
  throw new Error(`no member at seat ${seat}`);
};
const ids = (n: number) => ({ clientId: `ai-${n}`, reconnectToken: `ai-hash-${n}` });

/** Game-specific continuity fields, named so a regression is self-describing. */
const CONTINUITY: Record<string, (s: Record<string, unknown>) => unknown> = {
  king: (s) => ({ dealer: s.dealerId ?? s.dealerPlayerId, mode: s.currentMode ?? s.modeId, status: s.status }),
  durak: (s) => ({ attacker: s.attackerId ?? s.attackerSeat, defender: s.defenderId ?? s.defenderSeat, phase: s.phase ?? s.status }),
  deberc: (s) => ({ teams: s.teams ?? s.scoresByTeam, phase: s.phase }),
  tarneeb: (s) => ({ teams: s.scoresByTeam, bid: s.currentBid ?? s.bid, declarer: s.declarerSeat, phase: s.phase }),
  preferans: (s) => ({ declarer: s.declarerSeat, contract: s.contract, phase: s.phase }),
  'fifty-one': (s) => ({ turn: s.turnSeat ?? s.currentSeat, melds: s.melds, eliminated: s.eliminatedSeats ?? s.eliminated }),
};

describe.each(GAMES)('permanent leave — $gt', ({ gt, seats }) => {
  it('puts an AI on the SAME seat and re-numbers nothing', () => {
    const room = humanRoom(gt, seats);
    const seatOrderBefore = activePlayers(room).map((m) => m.seatIndex);
    const target = clientAtSeat(room, 1);
    const res = takeoverSeatWithAi(room, target, ids(1));

    expect(res.ok).toBe(true);
    expect(res.seatIndex).toBe(1);
    expect(res.bot?.type).toBe('ai');
    expect(res.bot?.seatIndex).toBe(1);
    // Nothing was re-numbered and no seat vanished.
    expect(activePlayers(room).map((m) => m.seatIndex)).toEqual(seatOrderBefore);
    expect(activePlayers(room)).toHaveLength(seats);
    // The map POSITION is preserved too (host promotion order depends on it).
    expect([...room.members.values()][1].seatIndex).toBe(1);
  });

  it('does not touch the authoritative game state (no restart, no re-deal)', () => {
    const room = humanRoom(gt, seats);
    const before = JSON.parse(JSON.stringify(room.gameState));
    const stateRef = room.gameState;
    takeoverSeatWithAi(room, clientAtSeat(room, 1), ids(2));
    expect(room.gameState).toBe(stateRef);                       // same object identity
    expect(JSON.parse(JSON.stringify(room.gameState))).toEqual(before);
    expect(room.started).toBe(true);
  });

  it('preserves the game-specific continuity fields', () => {
    const room = humanRoom(gt, seats);
    const read = CONTINUITY[gt];
    const before = JSON.parse(JSON.stringify(read(room.gameState as unknown as Record<string, unknown>) ?? null));
    takeoverSeatWithAi(room, clientAtSeat(room, 1), ids(3));
    const after = JSON.parse(JSON.stringify(read(room.gameState as unknown as Record<string, unknown>) ?? null));
    expect(after).toEqual(before);
  });

  it('annuls the departed reconnect identity (token, reclaim and discovery)', () => {
    const room = humanRoom(gt, seats);
    const target = clientAtSeat(room, 1);
    const token = room.members.get(target)!.reconnectToken;
    const userId = room.members.get(target)!.userId!;
    expect(reconnectMember(room, token)).not.toBeNull();          // works before
    expect(findUserRoomCodes([room], userId)).toHaveLength(1);

    takeoverSeatWithAi(room, target, ids(4));

    expect(reconnectMember(room, token)).toBeNull();              // dead token
    expect(reclaimMemberByUserId(room, userId)).toBeNull();       // cross-device reclaim fails
    expect(findUserRoomCodes([room], userId)).toEqual([]);        // FIND_MY_ROOMS excludes
    // Every OTHER seat still resumes normally.
    const other = room.members.get(clientAtSeat(room, 0))!;
    expect(reconnectMember(room, other.reconnectToken)).not.toBeNull();
  });

  it('the replacement AI inherits no account, no host badge and no rematch consent', () => {
    const room = humanRoom(gt, seats);
    const target = clientAtSeat(room, 1);
    markRematchReady(room, target);
    expect(rematchStateOf(room).ready).toContain(target);

    const res = takeoverSeatWithAi(room, target, ids(5));
    expect(res.bot?.userId).toBeNull();
    expect(res.bot?.isHost).toBe(false);
    expect(res.bot?.connected).toBe(true);
    expect(res.bot?.role).toBe('player');
    expect(res.bot?.clientId).not.toBe(target);
    expect(res.bot?.reconnectToken).not.toBe('t1');
    expect(rematchStateOf(room).ready).not.toContain(target);
    // The AI is visibly an AI — it never keeps the departed player's display name.
    expect(res.bot?.name).not.toBe('P1');
  });

  it('moves the host badge to a remaining HUMAN, never to a bot', () => {
    const room = humanRoom(gt, seats);
    const host = clientAtSeat(room, 0);
    // First replace a NON-host seat, so a bot already sits earlier in the member map
    // than at least one human — a naive "first remaining member" promotion would now
    // hand the room to that bot.
    takeoverSeatWithAi(room, clientAtSeat(room, 1), ids(60));
    const res = takeoverSeatWithAi(room, host, ids(6));
    expect(res.hostTransferred).toBe(true);
    const hosts = [...room.members.values()].filter((m) => m.isHost);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].type).toBe('human');
  });

  it('leaves the CURRENT turn deadline and revision untouched', () => {
    const room = humanRoom(gt, seats, { timerSec: 30 });
    beginTurnDeadline(room, 10_000);
    const deadline = room.turnDeadlineAt;
    const revision = room.turnTimerRevision;
    // A NON-acting seat leaves.
    const acting = actingMember(room)?.seatIndex ?? 0;
    const victim = [...Array(seats).keys()].find((s) => s !== acting)!;
    takeoverSeatWithAi(room, clientAtSeat(room, victim), ids(7));
    expect(room.turnDeadlineAt).toBe(deadline);
    expect(room.turnTimerRevision).toBe(revision);
  });

  it('hands the acting seat to the bot scheduler exactly once when the ACTOR leaves', () => {
    const room = humanRoom(gt, seats);
    const actingSeat = actingMember(room)?.seatIndex;
    expect(actingSeat).not.toBeUndefined();
    expect(botMemberToAct(room)).toBeNull();                      // all human before
    const res = takeoverSeatWithAi(room, clientAtSeat(room, actingSeat!), ids(8));
    // Exactly ONE member is now the bot to act — the very seat that was on the clock.
    const toAct = botMemberToAct(room);
    expect(toAct?.clientId).toBe(res.bot?.clientId);
    expect(toAct?.seatIndex).toBe(actingSeat);
  });

  it('refuses a spectator, a bot seat, an unknown client and a lobby room', () => {
    const room = humanRoom(gt, seats);
    expect(addMember(room, { clientId: 'spec', reconnectToken: 'ts', name: 'Spec', role: 'spectator' }).ok).toBe(false); // started
    expect(planPermanentLeave(room, 'nobody').refusal).toBe('not_a_member');

    const lobby = createRoom({
      code: 'LOB1', gameType: gt, playerCount: seats as 2 | 3 | 4, modeSelectionType: 'fixed',
      host: { clientId: 'h', reconnectToken: 'th', name: 'H' }, now: 1,
    });
    expect(planPermanentLeave(lobby, 'h').refusal).toBe('not_started');
    expect(takeoverSeatWithAi(lobby, 'h', ids(9)).ok).toBe(false);
    expect(lobby.members.size).toBe(1);                            // the lobby is untouched
  });

  it('survives serialize → restore with the category, roster, forfeit and takeover intact', () => {
    const room = humanRoom(gt, seats);
    const target = clientAtSeat(room, 1);
    markSeatForfeited(room.onlineMatch!, 1, 4242);
    const res = takeoverSeatWithAi(room, target, ids(10));

    const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))))!;
    expect(restored.onlineMatch?.category).toBe('human_only');
    expect(restored.onlineMatch?.roster).toEqual(room.onlineMatch!.roster);
    expect(isSeatForfeited(restored.onlineMatch!, 1)).toBe(true);
    // The AI is still on the same seat, still a bot, still account-less.
    const bot = [...restored.members.values()].find((m) => m.clientId === res.bot!.clientId)!;
    expect(bot.type).toBe('ai');
    expect(bot.seatIndex).toBe(1);
    expect(bot.userId).toBeNull();
    // And the old identity is STILL dead after a restart.
    expect(reconnectMember(restored, 't1')).toBeNull();
    expect(reclaimMemberByUserId(restored, 'u1')).toBeNull();
  });
});

describe('room composition rules', () => {
  it('detects when the leaver is the LAST human (the room must close instead)', () => {
    const room = humanRoom('durak', 2);
    expect(hasOtherHuman(room, clientAtSeat(room, 0))).toBe(true);
    takeoverSeatWithAi(room, clientAtSeat(room, 0), ids(20));
    // Now only one human is left; if they leave too, nobody remains.
    expect(hasOtherHuman(room, clientAtSeat(room, 1))).toBe(false);
  });

  it('a spectator can never be taken over (no AI, no seat)', () => {
    const room = createRoom({
      code: 'SPC1', gameType: 'durak', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'P0' }, now: 1,
    });
    expect(addMember(room, { clientId: 'c1', reconnectToken: 't1', name: 'P1' }).ok).toBe(true);
    expect(addMember(room, { clientId: 'sp', reconnectToken: 'ts', name: 'Spec', role: 'spectator' }).ok).toBe(true);
    expect(startGame(room, { seed: 3, now: 1 }).ok).toBe(true);
    freezeOnlineMatch(room, 'm-spc', 1);
    expect(planPermanentLeave(room, 'sp').refusal).toBe('not_seated');
    const before = room.members.size;
    expect(takeoverSeatWithAi(room, 'sp', ids(21)).ok).toBe(false);
    expect(room.members.size).toBe(before);
    expect([...room.members.values()].filter((m) => m.type === 'ai')).toHaveLength(0);
  });

  it('a starting BOT seat is never a permanent-leave target', () => {
    const room = createRoom({
      code: 'BOT1', gameType: 'durak', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'P0' }, now: 1,
    });
    expect(addBot(room, 'c0', { clientId: 'b1', reconnectToken: 'bt1' }).ok).toBe(true);
    expect(startGame(room, { seed: 3, now: 1 }).ok).toBe(true);
    const meta = freezeOnlineMatch(room, 'm-bot', 1)!;
    expect(meta.category).toBe('with_bots');
    expect(planPermanentLeave(room, 'b1').refusal).toBe('not_human');
  });

  it('Poker is out of scope — planning always refuses', () => {
    const room = createRoom({
      code: 'PKR1', gameType: 'poker', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'P0' }, now: 1,
    });
    expect(addMember(room, { clientId: 'c1', reconnectToken: 't1', name: 'P1' }).ok).toBe(true);
    expect(startGame(room, { seed: 3, now: 1 }).ok).toBe(true);
    expect(freezeOnlineMatch(room, 'm-poker', 1)).toBeNull();  // never freezes a poker match
    expect(room.onlineMatch).toBeUndefined();
    expect(planPermanentLeave(room, 'c0').refusal).toBe('unsupported_game');
  });
});

describe('privacy — the frozen metadata never reaches a client', () => {
  it('is absent from the room snapshot and the public summary', () => {
    const room = humanRoom('king', 3);
    markSeatForfeited(room.onlineMatch!, 1, 5);
    const snap = JSON.stringify(snapshot(room));
    const sum = JSON.stringify(roomSummary(room));
    for (const blob of [snap, sum]) {
      expect(blob).not.toMatch(/onlineMatch/);
      expect(blob).not.toMatch(/match-/);          // the match id
      expect(blob).not.toMatch(/human_only|with_bots/);
      expect(blob).not.toMatch(/"u0"|"u1"|"u2"/);  // account ids
      expect(blob).not.toMatch(/forfeit/i);
    }
  });

  it('IS persisted (the server needs it across a restart)', () => {
    const room = humanRoom('king', 3);
    expect(JSON.stringify(serializeRoom(room))).toMatch(/onlineMatch/);
  });
});
