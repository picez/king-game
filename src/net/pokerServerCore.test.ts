// ---------------------------------------------------------------------------
// Poker online seam (Stage 37.4). Drives poker through the SAME server-authoritative
// functions the WS layer uses (startGame / applyActionRequest / applyBotTurn /
// autoAdvance / publicScreenOf / sanitizedStateFor / serialize+deserialize) to prove
// the definition is online-ready: turn ownership is authorised generically, illegal
// moves are rejected as reducer no-ops, the public between-hands screen advances under
// a server seed, redaction leaks no hole card / deck / burn, and a 6-seat room
// round-trips through persistence (validating the widened MAX_PLAYERS=6 limit).
// Mirrors fiftyOneServerCore.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, applyActionRequest, applyBotTurn,
  autoAdvance, publicScreenOf, actingMember, roomSummary, snapshot,
  sanitizedStateFor, serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';
import { getGameDefinition } from '../games/registry';
import { GAME_CATALOG } from '../games/catalog';
import { checkPokerInvariants } from '../games/poker/invariants';
import type { AnyGameAction } from '../games/anyGame';
import type { PokerState } from '../games/poker/types';

const def = getGameDefinition('poker')!;
const asP = (s: unknown) => s as unknown as PokerState;
const bot = (s: PokerState): AnyGameAction => def.botAction(s) as AnyGameAction;

/** A started N-player bot room (host seat 0 human + bots). */
function botRoom(playerCount: number, seed: number): ServerRoom {
  const room = createRoom({
    code: 'PKAB', gameType: 'poker', playerCount: playerCount as 2 | 3 | 4 | 5 | 6, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'ht', name: 'Host' }, now: 1,
  });
  for (let i = 1; i < playerCount; i++) addBot(room, 'host', { clientId: `bot-${i}`, reconnectToken: `bt-${i}` });
  const res = startGame(room, { seed, now: 1 });
  expect(res.ok).toBe(true);
  return room;
}

/** A started all-human room, addressable by seat (to test authorization). */
function seatedRoom(playerCount: number, seed: number): { room: ServerRoom; clientForSeat: (seat: number) => string } {
  const room = createRoom({
    code: 'PKHU', gameType: 'poker', playerCount: playerCount as 2 | 3 | 4 | 5 | 6, modeSelectionType: 'fixed',
    host: { clientId: 'c0', reconnectToken: 't0', name: 'P0' }, now: 1,
  });
  for (let i = 1; i < playerCount; i++) addMember(room, { clientId: `c${i}`, reconnectToken: `t${i}`, name: `P${i}` });
  const res = startGame(room, { seed, now: 1 });
  expect(res.ok).toBe(true);
  const clientForSeat = (seat: number) => {
    for (const [cid, m] of room.members) if (m.seatIndex === seat) return cid;
    throw new Error(`no client at seat ${seat}`);
  };
  return { room, clientForSeat };
}

/** Drive bots through a hand, auto-advancing hand_complete via the seeded autoAdvance. */
function drive(room: ServerRoom, opts: { stopFinished?: boolean; cap?: number } = {}): void {
  let guard = 0;
  const cap = opts.cap ?? 20_000;
  while (guard++ < cap) {
    const s = asP(room.gameState);
    if (def.isFinished(s)) break;
    if (s.phase === 'hand_complete') {
      if (opts.stopFinished) break;
      autoAdvance(room, { seed: 5000 + guard });
      continue;
    }
    const m = actingMember(room);
    if (!m) break;
    const ok = applyActionRequest(room, m.clientId, bot(s), { seed: 5000 + guard }).ok;
    expect(ok, `stalled at step ${guard} (phase ${s.phase})`).toBe(true);
  }
}

describe('serverCore runs poker internally (Stage 37.4)', () => {
  it('poker is online-available and records score-only stats', () => {
    expect(GAME_CATALOG.poker.supportsOnline).toBe(true);
    expect(GAME_CATALOG.poker.status).toBe('available');
    expect(def.recordsStats).toBe(true);
  });

  it('createRoom(poker) + startGame deals 2 hole cards each and posts blinds', () => {
    const room = botRoom(3, 7);
    expect(room.gameType).toBe('poker');
    const s = asP(room.gameState);
    expect(s.gameType).toBe('poker');
    expect(s.phase).toBe('betting');
    expect(s.players).toHaveLength(3);
    for (let seat = 0; seat < 3; seat++) expect(s.holeCardsBySeat[seat]).toHaveLength(2);
    expect(s.currentBet).toBe(20); // big blind
    expect(Math.max(...s.committedBySeat)).toBe(20);
  });

  it('sanitizedStateFor hides opponents\' hole cards + deck/burns; no id leaks; no mutation', () => {
    const room = botRoom(4, 11);
    const before = JSON.stringify(room.gameState);
    const view = asP(sanitizedStateFor(room, 'host')); // host = seat 0
    expect(view.holeCardsBySeat[0].every((c) => c.suit !== null)).toBe(true); // own hand real
    const json = JSON.stringify(view);
    const full = asP(room.gameState);
    for (let seat = 1; seat < 4; seat++) for (const c of full.holeCardsBySeat[seat]) {
      expect(json.includes(c.id), `viewer leaked seat ${seat} card ${c.id}`).toBe(false);
    }
    for (const c of full.deck) expect(json.includes(c.id)).toBe(false);
    expect(view.deck).toEqual([]);
    expect(view.burned).toEqual([]);
    expect(JSON.stringify(room.gameState)).toBe(before); // authoritative state untouched
    // A spectator (unknown client → seat null) sees no real hole card.
    const spec = asP(sanitizedStateFor(room, 'nobody'));
    for (let seat = 0; seat < 4; seat++) expect(spec.holeCardsBySeat[seat].every((c) => c.suit === null)).toBe(true);
  });

  it('authorises only the acting seat; a non-acting seat is rejected', () => {
    const { room, clientForSeat } = seatedRoom(3, 13);
    const actorSeat = Number(def.getActingPlayerId(asP(room.gameState))!.split('-')[1]);
    const otherSeat = (actorSeat + 1) % 3;
    const bad = applyActionRequest(room, clientForSeat(otherSeat), { type: 'FOLD' } as AnyGameAction);
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('NOT_YOUR_TURN');
    const good = applyActionRequest(room, clientForSeat(actorSeat), { type: 'FOLD' } as AnyGameAction);
    expect(good.ok).toBe(true);
  });

  it('an illegal move from the acting seat is rejected as a reducer no-op', () => {
    const { room, clientForSeat } = seatedRoom(3, 17);
    const actorSeat = Number(def.getActingPlayerId(asP(room.gameState))!.split('-')[1]);
    // A CHECK facing the big blind is illegal pre-flop.
    const res = applyActionRequest(room, clientForSeat(actorSeat), { type: 'CHECK' } as AnyGameAction);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ILLEGAL_ACTION');
  });

  it('applyBotTurn advances a bot seat', () => {
    const room = botRoom(3, 21);
    // Seat 0 (host) acts first pre-flop; fold it so a bot becomes the actor.
    expect(applyActionRequest(room, 'host', { type: 'FOLD' } as AnyGameAction).ok).toBe(true);
    const before = JSON.stringify(room.gameState);
    applyBotTurn(room, { seed: 99 });
    expect(JSON.stringify(room.gameState)).not.toBe(before);
  });

  it('the public between-hands screen advances under a server seed (reproducible re-deal)', () => {
    const room = botRoom(3, 33);
    drive(room, { stopFinished: true });
    const s = asP(room.gameState);
    if (!def.isFinished(s)) {
      expect(s.phase).toBe('hand_complete');
      expect(publicScreenOf(room)).toBe('round_scoring');
      expect(actingMember(room)).toBeNull();
      // Same seed → identical re-deal.
      const a = deserializeRoom(serializeRoom(room))!;
      const b = deserializeRoom(serializeRoom(room))!;
      autoAdvance(a, { seed: 777 });
      autoAdvance(b, { seed: 777 });
      expect(JSON.stringify(a.gameState)).toBe(JSON.stringify(b.gameState));
    }
  });

  it('a full 6-seat match round-trips through persistence and finishes (widened MAX_PLAYERS)', () => {
    const room = botRoom(6, 41);
    expect(asP(room.gameState).players).toHaveLength(6);
    // Persist + restore mid-hand — the 6-seat state must survive (deserialize whitelist).
    const restored = deserializeRoom(serializeRoom(room))!;
    expect(restored).not.toBeNull();
    expect(asP(restored.gameState).playerCount).toBe(6);
    // Drive the restored room to a finished match.
    drive(restored);
    expect(def.isFinished(asP(restored.gameState))).toBe(true);
    expect(asP(restored.gameState).winnerSeat).not.toBeNull();
  });

  it('roomSummary + snapshot never carry gameState or hidden cards', () => {
    const room = botRoom(3, 5);
    const sum = JSON.stringify(roomSummary(room));
    const snap = JSON.stringify(snapshot(room, 'host'));
    expect(sum.includes('holeCardsBySeat')).toBe(false);
    expect(sum.includes('gameState')).toBe(false);
    const full = asP(room.gameState);
    for (const c of full.deck) expect(snap.includes(c.id)).toBe(false);
  });
});

// ── Stage 37.4 corrective hardening (server boundary) ───────────────────────

describe('poker server boundary — clients cannot run lifecycle actions (P0-1)', () => {
  it('a forged START_GAME from the acting client is rejected; state is unchanged', () => {
    const { room, clientForSeat } = seatedRoom(3, 13);
    const actorSeat = Number(def.getActingPlayerId(asP(room.gameState))!.split('-')[1]);
    const before = JSON.stringify(room.gameState);
    const forged = { type: 'START_GAME', playerNames: ['X', 'Y'], playerCount: 2 } as unknown as AnyGameAction;
    const res = applyActionRequest(room, clientForSeat(actorSeat), forged);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ILLEGAL_ACTION');
    expect(JSON.stringify(room.gameState)).toBe(before); // not reset, content identical
    expect(asP(room.gameState).playerCount).toBe(3);
  });

  it('a forged START_NEXT_HAND from the acting client is rejected; state is unchanged', () => {
    const { room, clientForSeat } = seatedRoom(3, 15);
    const actorSeat = Number(def.getActingPlayerId(asP(room.gameState))!.split('-')[1]);
    const before = JSON.stringify(room.gameState);
    const res = applyActionRequest(room, clientForSeat(actorSeat), { type: 'START_NEXT_HAND' } as unknown as AnyGameAction);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ILLEGAL_ACTION');
    expect(JSON.stringify(room.gameState)).toBe(before);
  });
});

describe('poker server boundary — malformed WebSocket amounts (P0-2)', () => {
  it('a malformed RAISE payload does not mutate chips / pot / turn; invariants stay green', () => {
    const { room, clientForSeat } = seatedRoom(3, 19);
    const actorSeat = Number(def.getActingPlayerId(asP(room.gameState))!.split('-')[1]);
    const before = JSON.stringify(room.gameState);
    for (const amount of ['not-a-number', {}, null, NaN, Infinity, 20.5, -20, 0]) {
      const res = applyActionRequest(room, clientForSeat(actorSeat), { type: 'RAISE', amount } as unknown as AnyGameAction);
      expect(res.ok, `RAISE ${String(amount)}`).toBe(false);
    }
    expect(JSON.stringify(room.gameState)).toBe(before); // authoritative state untouched
    expect(checkPokerInvariants(asP(room.gameState))).toEqual([]);
  });

  it('any malformed action shape is rejected WITHOUT throwing; the session survives (FAIL 1)', () => {
    const { room, clientForSeat } = seatedRoom(3, 23);
    const actorSeat = Number(def.getActingPlayerId(asP(room.gameState))!.split('-')[1]);
    const before = JSON.stringify(room.gameState);
    const malformed: unknown[] = [
      null, undefined, 'FOLD', 42, [], {}, { type: 'NUKE' },
      { type: 'BET' }, { type: 'RAISE', amount: {} }, { type: 'BET', amount: 'x' },
      { type: 'START_GAME', playerNames: 'nope' }, { type: 'START_NEXT_HAND' },
    ];
    for (const action of malformed) {
      // Must NOT throw — a boundary rejection, not an uncaught exception.
      const res = applyActionRequest(room, clientForSeat(actorSeat), action as AnyGameAction);
      expect(res.ok, JSON.stringify(action)).toBe(false);
    }
    // Chips / pot / turn / reference all intact after every rejection.
    expect(JSON.stringify(room.gameState)).toBe(before);
    expect(checkPokerInvariants(asP(room.gameState))).toEqual([]);
    // The session is NOT corrupted — a subsequent VALID action from the actor succeeds.
    const ok = applyActionRequest(room, clientForSeat(actorSeat), { type: 'FOLD' } as AnyGameAction);
    expect(ok.ok).toBe(true);
    expect(JSON.stringify(room.gameState)).not.toBe(before);
  });
});

describe('poker deal metadata is recorded for every hand (P0-3)', () => {
  it('the initial deal + auto-advanced hands each write a distinct ordered deal record (no cards)', () => {
    const room = botRoom(3, 41);
    expect(room.dealLog.length).toBeGreaterThanOrEqual(1); // initial deal recorded by startGame
    let guard = 0;
    while (room.dealLog.length < 3 && !def.isFinished(asP(room.gameState)) && guard++ < 5000) {
      const s = asP(room.gameState);
      if (s.phase === 'hand_complete') { autoAdvance(room, { seed: 1000 + guard }); continue; }
      const m = actingMember(room);
      if (!m) break;
      applyActionRequest(room, m.clientId, bot(s), { seed: 1000 + guard });
    }
    const first3 = room.dealLog.slice(0, 3);
    expect(first3.length).toBe(3);
    // Ordered, distinct hand indices + distinct seeds.
    expect(first3.map((r) => r.roundIndex)).toEqual([1, 2, 3]);
    expect(new Set(first3.map((r) => r.seed)).size).toBe(3);
    // No private card / deck / hole data in any record.
    const json = JSON.stringify(room.dealLog);
    expect(json).not.toMatch(/hearts|spades|clubs|diamonds|hole|"rank"|"suit"/);
    // Persistence keeps the deal log intact.
    const restored = deserializeRoom(serializeRoom(room))!;
    expect(restored.dealLog).toEqual(room.dealLog);
  });
});
