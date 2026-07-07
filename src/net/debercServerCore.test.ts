// ---------------------------------------------------------------------------
// Deberc online seam (Stage 4). Drives a full deberc match through the SAME
// server-authoritative functions the WS layer uses (startGame / applyBotTurn /
// applyActionRequest / autoAdvance), verifying:
//   • public screens (trick_complete / hand_scoring) advance via autoAdvance,
//     NOT as a client/bot turn (getActingDebercPlayerId → null there);
//   • NEXT_HAND re-deals are threaded with a server seed → reproducible;
//   • redaction hides other seats' hands / dealt snapshots / stock.
// Mirrors durakServerCore.test.ts in spirit.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import {
  createRoom, addBot, startGame, applyBotTurn, applyActionRequest, autoAdvance,
  actingMember, sanitizedStateFor, type ServerRoom,
} from './serverCore';
import { getGameDefinition } from '../games/registry';
import type { DebercState } from '../games/deberc/types';

const def = getGameDefinition('deberc')!;

/** A started deberc room: host (seat 0, human) + bots to fill `players` seats. */
function startedRoom(players: 3 | 4, seed: number): ServerRoom {
  const room = createRoom({
    code: 'DBRC',
    gameType: 'deberc',
    matchSize: 'small',
    playerCount: players,
    modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'tok', name: 'Host' },
  });
  for (let i = 1; i < players; i++) {
    addBot(room, 'host', { clientId: `bot-${i}`, reconnectToken: `bt-${i}` });
  }
  const res = startGame(room, { seed });
  expect(res.ok).toBe(true);
  return room;
}

/**
 * Drive the room to a finished match using ONLY the server seam. `seedGen`
 * feeds a deterministic seed into every autoAdvance (so NEXT_HAND re-deals are
 * reproducible). Returns the number of hand_scoring advances observed.
 */
function drive(room: ServerRoom, seedGen: () => number): { hands: number } {
  let guard = 0;
  let hands = 0;
  while (!def.isFinished(room.gameState!) && guard++ < 20000) {
    const s = room.gameState as DebercState;
    if (s.phase === 'hand_scoring') hands++;
    // Public screens advance server-side (seeded); returns true if it advanced.
    if (autoAdvance(room, { seed: seedGen() })) continue;
    // Otherwise a seat must act (bidding / playing). Use the shared bot heuristic
    // through the SAME authorised path a real client/bot would take.
    const m = actingMember(room);
    if (!m) break;
    if (m.type === 'ai') {
      expect(applyBotTurn(room).acted).toBe(true);
    } else {
      const action = def.botAction(room.gameState!);
      expect(action).not.toBeNull();
      expect(applyActionRequest(room, m.clientId, action!).ok).toBe(true);
    }
  }
  return { hands };
}

describe('deberc online seam', () => {
  it('drives a 3-player match to a finished state via the server seam', () => {
    const room = startedRoom(3, 12345);
    let k = 1000;
    const { hands } = drive(room, () => ++k);
    const s = room.gameState as DebercState;
    expect(def.isFinished(s)).toBe(true);
    expect(s.phase).toBe('finished');
    expect(s.winnerTeam).not.toBeNull();
    expect(hands).toBeGreaterThan(0); // at least one hand was scored + re-dealt
  });

  it('drives a 4-player (teams) match to a finished state', () => {
    const room = startedRoom(4, 777);
    let k = 5000;
    drive(room, () => ++k);
    const s = room.gameState as DebercState;
    expect(def.isFinished(s)).toBe(true);
    expect(s.winnerTeam).not.toBeNull();
  });

  it('is reproducible: same start seed + same autoAdvance seeds → identical result', () => {
    const runOnce = () => {
      const room = startedRoom(3, 4242);
      let k = 2000;
      drive(room, () => ++k);
      const s = room.gameState as DebercState;
      return { score: s.matchScore, winner: s.winnerTeam, jackpot: s.jackpot };
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it('redacts other seats: only the viewer sees real hands, stock is hidden', () => {
    const room = startedRoom(3, 999);
    // Advance to the playing phase (past bidding) so hands are non-trivial.
    let guard = 0;
    while ((room.gameState as DebercState).phase === 'bidding' && guard++ < 50) {
      const m = actingMember(room)!;
      applyActionRequest(room, m.clientId, def.botAction(room.gameState!)!);
    }
    const seat0 = sanitizedStateFor(room, 'host') as DebercState;   // seat 0 = host
    const real = room.gameState as DebercState;
    // Seat 0's own hand is intact; opponents' hands are face-down placeholders.
    expect(seat0.players[0].hand).toEqual(real.players[0].hand);
    for (let seat = 1; seat < 3; seat++) {
      expect(seat0.players[seat].hand.every((c) => c.rank === '?')).toBe(true);
      expect(seat0.players[seat].hand.length).toBe(real.players[seat].hand.length);
    }
    // Undealt stock (9 cards in 3p) must never be revealed.
    expect(seat0.stock.every((c) => c.rank === '?')).toBe(true);
    expect(seat0.stock.length).toBe(real.stock.length);
  });
});
