import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createRoom, addMember, addBot, startGame, applyTimeoutAction,
  sanitizedStateFor, actingMember, serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';
import { getActingDurakPlayerId } from '../games/durak/engine';
import { canTransfer } from '../games/durak/rules';
import { cardValue } from '../games/durak/deck';
import type { Card } from '../models/types';
import type { DurakPlayer, DurakState } from '../games/durak/types';

const id = () => randomUUID();

/** A seated 3-player Durak room (host + 1 human + 1 bot). Internal only — Durak
 *  is NOT joinable online from the UI; this exercises serverCore directly. */
function durakRoom(): ServerRoom {
  const r = createRoom({
    code: 'DRK', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'ht', name: 'Host' }, gameType: 'durak', now: 1,
  });
  addMember(r, { clientId: id(), reconnectToken: id(), name: 'B' });
  addBot(r, 'host', { clientId: id(), reconnectToken: id() });
  return r;
}

describe('serverCore runs Durak internally (Stage 9.5)', () => {
  it('createRoom(gameType:durak) + startGame builds a DurakState (no King deal log)', () => {
    const r = durakRoom();
    expect(r.gameType).toBe('durak');
    const res = startGame(r, { seed: 5, now: 1 });
    expect(res.ok).toBe(true);
    const s = r.gameState as DurakState;
    expect(s.gameType).toBe('durak');
    expect(s.players).toHaveLength(3);
    expect(s.drawPile).toHaveLength(36 - 18);
    expect(r.dealLog).toHaveLength(0); // Durak skips King's deal audit
  });

  it('actingMember + applyTimeoutAction progress a Durak game via the definition', () => {
    const r = durakRoom();
    startGame(r, { seed: 5, now: 1 });
    expect(actingMember(r)).not.toBeNull();
    const before = JSON.stringify(r.gameState);
    expect(applyTimeoutAction(r).acted).toBe(true); // def.botAction through the reducer path
    expect(JSON.stringify(r.gameState)).not.toBe(before);
  });

  it('sanitizedStateFor redacts opponents for the Durak viewer (no hand leak)', () => {
    const r = durakRoom();
    startGame(r, { seed: 5, now: 1 });
    const view = sanitizedStateFor(r, 'host') as DurakState; // host = seat 0
    const me = view.players.find((p) => p.seatIndex === 0)!;
    const opp = view.players.find((p) => p.seatIndex !== 0)!;
    expect(me.hand.every((c) => c.rank !== '?')).toBe(true);  // own hand visible
    expect(opp.hand.every((c) => c.rank === '?')).toBe(true); // opponents hidden
    expect(opp.hand).toHaveLength(6);                          // count preserved
    expect(view.drawPile.every((c) => c.rank === '?')).toBe(true);
  });

  it('serialize → restore keeps the room as Durak with its state', () => {
    const r = durakRoom();
    startGame(r, { seed: 5, now: 1 });
    const restored = deserializeRoom(serializeRoom(r))!;
    expect(restored.gameType).toBe('durak');
    expect((restored.gameState as DurakState).gameType).toBe('durak');
  });
});

// ---------------------------------------------------------------------------
// Restart (serialize→deserialize) AND reconnect (sanitizedStateFor) DURING the
// three phases the audit calls out: defense, taking, and a transfer chain.
// Restart must preserve variant/status/roles/thrower/passes; reconnect must
// return the acting player's OWN hand + correct role and never leak others.
// ---------------------------------------------------------------------------
const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit, value: cardValue(rank) });
const P = (seat: number, hand: Card[]): DurakPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human', hand });

/** A 3-seat Durak room whose seats we can address by clientId. */
function seatedDurakRoom(): { room: ServerRoom; clientForSeat: (seat: number) => string } {
  const r = createRoom({
    code: 'DRK', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'ht', name: 'Host' }, gameType: 'durak', now: 1,
  });
  addMember(r, { clientId: 'cB', reconnectToken: 'tb', name: 'B' });
  addMember(r, { clientId: 'cC', reconnectToken: 'tc', name: 'C' });
  const clientForSeat = (seat: number) => {
    for (const [cid, m] of r.members) if (m.seatIndex === seat) return cid;
    throw new Error(`no client at seat ${seat}`);
  };
  return { room: r, clientForSeat };
}

/** Assert the restart round-trip preserves every role/phase field of a Durak state. */
function expectRestartPreserves(room: ServerRoom): DurakState {
  const before = room.gameState as DurakState;
  const restored = deserializeRoom(serializeRoom(room))!;
  const after = restored.gameState as DurakState;
  for (const k of ['variant', 'status', 'attackerIndex', 'defenderIndex',
    'throwerIndex', 'lastThrowerIndex', 'boutLimit'] as const) {
    expect(after[k], `restart preserves ${k}`).toEqual(before[k]);
  }
  expect(after.passedAttackers).toEqual(before.passedAttackers);
  expect(after.table).toEqual(before.table);
  expect(restored.variant).toBe(room.variant);
  return after;
}

/** Reconnect: the viewer sees their OWN hand; opponents + piles stay hidden. */
function expectReconnectHidesOthers(room: ServerRoom, viewerSeat: number, clientId: string): DurakState {
  const view = sanitizedStateFor(room, clientId) as DurakState;
  const me = view.players.find((p) => p.seatIndex === viewerSeat)!;
  expect(me.hand.every((c) => c.rank !== '?'), 'own hand visible on reconnect').toBe(true);
  for (const p of view.players) {
    if (p.seatIndex !== viewerSeat) expect(p.hand.every((c) => c.rank === '?'), `seat ${p.seatIndex} hidden`).toBe(true);
  }
  expect(view.drawPile.every((c) => c.rank === '?')).toBe(true);
  expect(view.discardPile.every((c) => c.rank === '?')).toBe(true);
  return view;
}

describe('Durak restart + reconnect mid-phase (Stage 9.13)', () => {
  it('DEFENSE: restart preserves the defending state; the defender reconnects to their hand + role', () => {
    const { room, clientForSeat } = seatedDurakRoom();
    // Seat 0 is defending an unbeaten 7♥ thrown by seat 2 (primary attacker).
    room.gameState = {
      gameType: 'durak', variant: 'simple',
      players: [P(0, [C('K', 'spades'), C('9', 'hearts')]), P(1, [C('6', 'clubs')]), P(2, [C('Q', 'spades')])],
      drawPile: [C('A', 'spades')], trumpSuit: 'spades', trumpCard: C('A', 'spades'),
      attackerIndex: 2, defenderIndex: 0, throwerIndex: 2, lastThrowerIndex: 2, passedAttackers: [],
      table: [{ attack: C('7', 'hearts'), defense: null }], discardPile: [C('6', 'hearts')],
      status: 'defense', boutLimit: 2, foolId: null, winnerIds: [], isDraw: false,
    } as DurakState;
    const after = expectRestartPreserves(room);
    expect(after.status).toBe('defense');
    expect(getActingDurakPlayerId(after)).toBe('player-0'); // the defender acts
    const view = expectReconnectHidesOthers(room, 0, clientForSeat(0));
    expect(view.defenderIndex).toBe(0); // role survives redaction
    expect(getActingDurakPlayerId(view)).toBe('player-0');
  });

  it('TAKING: restart preserves the take-phase (defender taking, attacker throwing); both reconnect correctly', () => {
    const { room, clientForSeat } = seatedDurakRoom();
    // Seat 0 chose TAKE; seat 2 is the acting thrower piling a matching 7.
    room.gameState = {
      gameType: 'durak', variant: 'transfer',
      players: [P(0, [C('K', 'spades')]), P(1, [C('6', 'clubs')]), P(2, [C('7', 'clubs'), C('9', 'spades')])],
      drawPile: [C('A', 'spades')], trumpSuit: 'spades', trumpCard: C('A', 'spades'),
      attackerIndex: 1, defenderIndex: 0, throwerIndex: 2, lastThrowerIndex: 1, passedAttackers: [1],
      table: [{ attack: C('7', 'hearts'), defense: null }], discardPile: [],
      status: 'taking', boutLimit: 3, foolId: null, winnerIds: [], isDraw: false,
    } as DurakState;
    const after = expectRestartPreserves(room);
    expect(after.status).toBe('taking');
    expect(after.passedAttackers).toEqual([1]);   // pass-state survives the restart
    expect(getActingDurakPlayerId(after)).toBe('player-2'); // the thrower acts, NOT the taking defender
    // The taking defender (seat 0) reconnects to their own hand + their (defender) role.
    const defView = expectReconnectHidesOthers(room, 0, clientForSeat(0));
    expect(defView.status).toBe('taking');
    expect(defView.defenderIndex).toBe(0);
    // The acting thrower (seat 2) reconnects to their own hand and is the actor.
    const thrView = expectReconnectHidesOthers(room, 2, clientForSeat(2));
    expect(getActingDurakPlayerId(thrView)).toBe('player-2');
  });

  it('TRANSFER chain: restart keeps the transfer variant + chained table; the new defender reconnects able to transfer again', () => {
    const { room, clientForSeat } = seatedDurakRoom();
    // A chain in progress: seat 1 transferred a 7 onto seat 2's opening 7, so the
    // table holds two unbeaten 7s and seat 0 is now defending and could chain again.
    room.gameState = {
      gameType: 'durak', variant: 'transfer',
      players: [P(0, [C('7', 'diamonds'), C('8', 'clubs')]), P(1, [C('K', 'spades'), C('K', 'diamonds'), C('K', 'hearts')]), P(2, [C('Q', 'spades')])],
      drawPile: [C('A', 'spades')], trumpSuit: 'spades', trumpCard: C('A', 'spades'),
      attackerIndex: 2, defenderIndex: 0, throwerIndex: 2, lastThrowerIndex: 2, passedAttackers: [],
      table: [{ attack: C('7', 'hearts'), defense: null }, { attack: C('7', 'clubs'), defense: null }],
      discardPile: [], status: 'defense', boutLimit: 3, foolId: null, winnerIds: [], isDraw: false,
    } as DurakState;
    expect(canTransfer(room.gameState as DurakState)).toBe(true); // seat 0 holds a 7♦, next seat (seat 1) has capacity for 3
    const after = expectRestartPreserves(room);
    expect(after.variant).toBe('transfer');
    expect(after.table.map((p) => p.attack.rank)).toEqual(['7', '7']);
    expect(canTransfer(after)).toBe(true); // the chain can still continue after a restart
    // The new defender (seat 0) reconnects to their own hand and the transfer is still legal.
    const view = expectReconnectHidesOthers(room, 0, clientForSeat(0));
    expect(view.defenderIndex).toBe(0);
    expect(canTransfer(view)).toBe(true);
  });
});
