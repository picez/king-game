import { describe, it, expect } from 'vitest';
import { getCurrentPlayer } from '../core/gameEngine';
import { getValidCards } from '../core/rules';
import {
  createRoom, addMember, startGame, applyActionRequest, autoAdvance,
  sanitizedStateFor, reconnectMember, markDisconnected, snapshot, roomHasPassword,
  verifyPassword, serializeRoom, deserializeRoom, MemoryRoomStorage,
  roomSummary, listRoomSummaries, roomsToExpire, kickMember,
  type ServerRoom,
} from './serverCore';

let nextId = 0;
const id = () => `c${nextId++}`;

function room4pFixed(): ServerRoom {
  const r = createRoom({
    code: 'AAAA', playerCount: 4, modeSelectionType: 'fixed',
    host: { clientId: id(), reconnectToken: id(), name: 'Host' },
  });
  addMember(r, { clientId: id(), reconnectToken: id(), name: 'B' });
  addMember(r, { clientId: id(), reconnectToken: id(), name: 'C' });
  addMember(r, { clientId: id(), reconnectToken: id(), name: 'D' });
  return r;
}

function room3pDealerChoice(): ServerRoom {
  const r = createRoom({
    code: 'BBBB', playerCount: 3, modeSelectionType: 'dealer_choice',
    host: { clientId: id(), reconnectToken: id(), name: 'Host' },
  });
  addMember(r, { clientId: id(), reconnectToken: id(), name: 'B' });
  addMember(r, { clientId: id(), reconnectToken: id(), name: 'C' });
  return r;
}

function clientForSeat(room: ServerRoom, seat: number): string {
  return [...room.members.values()].find((m) => m.seatIndex === seat)!.clientId;
}

describe('room auto-clean (TTL)', () => {
  const TTL = 1000, HARD = 5000, NOW = 100000;
  function roomAt(code: string, updatedAt: number, connected: boolean): ServerRoom {
    const r = createRoom({
      code, playerCount: 4, modeSelectionType: 'fixed',
      host: { clientId: id(), reconnectToken: id(), name: 'H' },
    });
    r.updatedAt = updatedAt;
    if (!connected) markDisconnected(r, [...r.members.values()][0].clientId);
    return r;
  }

  it('deletes an old idle room, keeps a recently-active one', () => {
    const old = roomAt('OLD', NOW - 2000, false); // idle 2000 > TTL
    const fresh = roomAt('NEW', NOW - 500, false); // idle 500 < TTL
    const expired = roomsToExpire([old, fresh], NOW, TTL, HARD);
    expect(expired).toEqual(['OLD']);
  });

  it('keeps a room with a connected player until the hard TTL', () => {
    const active = roomAt('ACT', NOW - 2000, true); // idle 2000 > TTL but < HARD, connected
    expect(roomsToExpire([active], NOW, TTL, HARD)).toEqual([]);
    const stale = roomAt('STL', NOW - 6000, true);  // idle 6000 > HARD even though connected
    expect(roomsToExpire([stale], NOW, TTL, HARD)).toEqual(['STL']);
  });

  it('a deleted room is removed from persistence', () => {
    const storage = new MemoryRoomStorage();
    storage.saveRoom(roomAt('GONE', NOW - 9999, false));
    expect(storage.loadRooms()).toHaveLength(1);
    storage.deleteRoom('GONE'); // what the server does for expired rooms
    expect(storage.loadRooms()).toHaveLength(0);
  });

  it('startup cleanup: deletes expired rooms from storage on load, keeps fresh ones', () => {
    // Mirrors server/index.ts startup: restore from storage, sweep, delete the
    // expired from storage. Rooms on disk have no live sockets (connected=false),
    // so the idle TTL applies to all of them.
    const storage = new MemoryRoomStorage();
    storage.saveRoom(roomAt('OLD1', NOW - 5000, true)); // stored "connected" but no socket after load
    storage.saveRoom(roomAt('OLD2', NOW - 2000, false));
    storage.saveRoom(roomAt('KEEP', NOW - 500, false)); // idle 500 < TTL → survives

    const restored = storage.loadRooms();
    expect(restored).toHaveLength(3);
    // After a restore there are no live sockets.
    expect(restored.every((r) => [...r.members.values()].every((m) => !m.connected))).toBe(true);

    const expired = roomsToExpire(restored, NOW, TTL, HARD);
    for (const code of expired) storage.deleteRoom(code);

    expect(expired.sort()).toEqual(['OLD1', 'OLD2']);
    const left = storage.loadRooms().map((r) => r.code);
    expect(left).toEqual(['KEEP']);
  });
});

describe('room discovery (public summaries)', () => {
  function lobbyRoom(): ServerRoom {
    // host only → 1/4 seats → joinable lobby
    return createRoom({
      code: 'LOBB', playerCount: 4, modeSelectionType: 'fixed',
      host: { clientId: id(), reconnectToken: id(), name: 'Host' },
    });
  }

  it('summary exposes only public fields (no private data)', () => {
    const room = createRoom({
      code: 'SECR', playerCount: 4, modeSelectionType: 'fixed',
      host: { clientId: id(), reconnectToken: 'token-xyz', name: 'Host' },
      password: 'hunter2', salt: 'salt-z',
    });
    addMember(room, { clientId: id(), reconnectToken: id(), name: 'B', password: 'hunter2' });
    addMember(room, { clientId: id(), reconnectToken: id(), name: 'C', password: 'hunter2' });
    addMember(room, { clientId: id(), reconnectToken: id(), name: 'D', password: 'hunter2' });
    startGame(room, { seed: 1 }); // produces gameState + dealLog + seed

    const summary = roomSummary(room);
    expect(Object.keys(summary).sort()).toEqual(
      ['code', 'hasPassword', 'hostName', 'occupiedSeats', 'playerCount', 'status', 'updatedAt'],
    );
    expect(summary.hasPassword).toBe(true);
    expect(summary.hostName).toBe('Host');

    const json = JSON.stringify(summary);
    expect(json).not.toContain('hunter2');         // password plaintext
    expect(json).not.toContain(room.passwordHash); // hash
    expect(json).not.toContain('token-xyz');       // reconnect token
    expect(json).not.toMatch(/dealLog|gameState|seed|hand/i);
  });

  it('marks status: lobby / full / in_game', () => {
    expect(roomSummary(lobbyRoom()).status).toBe('lobby');

    const full = room4pFixed(); // 4/4 seats, not started
    expect(roomSummary(full).status).toBe('full');
    expect(roomSummary(full).occupiedSeats).toBe(4);

    startGame(full);
    expect(roomSummary(full).status).toBe('in_game');
  });

  it('open room reports hasPassword=false', () => {
    expect(roomSummary(lobbyRoom()).hasPassword).toBe(false);
  });

  it('listRoomSummaries returns one summary per room', () => {
    const summaries = listRoomSummaries([lobbyRoom(), room4pFixed()]);
    expect(summaries).toHaveLength(2);
    expect(summaries.every((s) => typeof s.code === 'string')).toBe(true);
  });
});

describe('persistence (serialize / restore)', () => {
  it('restores gameState and dealLog through a save/load round-trip', () => {
    const room = room4pFixed();
    startGame(room, { seed: 99, now: 123 });
    const storage = new MemoryRoomStorage();
    storage.saveRoom(room);

    const [restored] = storage.loadRooms();
    expect(restored.code).toBe(room.code);
    expect(restored.gameState).toEqual(room.gameState); // full deal restored
    expect(restored.dealLog).toEqual(room.dealLog);     // private audit restored
    expect(restored.started).toBe(true);
  });

  it('keeps the score-tracker round history through a save/load round-trip', () => {
    const room = room4pFixed();
    startGame(room, { seed: 7 });
    // Inject a completed-round record (scores only) as the engine would.
    room.gameState = {
      ...room.gameState!,
      roundHistory: [
        { roundNumber: 0, dealerId: 'player-0', modeId: 'trump', trumpOccurrence: 1, scoreByPlayer: { 'player-0': 24, 'player-1': 0, 'player-2': 8, 'player-3': 0 } },
      ],
    };
    const storage = new MemoryRoomStorage();
    storage.saveRoom(room);
    const [restored] = storage.loadRooms();
    expect(restored.gameState!.roundHistory).toEqual(room.gameState!.roundHistory);
  });

  it('reconnect works after a restore (token survives, sockets do not)', () => {
    const room = room4pFixed();
    startGame(room, { seed: 5 });
    const token = [...room.members.values()][1].reconnectToken;

    const restored = deserializeRoom(serializeRoom(room))!;
    // No live sockets after a restart: everyone is marked disconnected.
    expect([...restored.members.values()].every((m) => m.connected === false)).toBe(true);

    const member = reconnectMember(restored, token);
    expect(member).not.toBeNull();
    expect(member!.connected).toBe(true);

    // Redaction still works on the restored state.
    const view = sanitizedStateFor(restored, member!.clientId)!;
    const mine = view.players.find((p) => p.id === `player-${member!.seatIndex}`)!;
    expect(mine.hand.every((c) => c.rank === '?')).toBe(false); // own hand visible
  });

  it('persists the salted password hash but never the plaintext', () => {
    const room = createRoom({
      code: 'SEC1', playerCount: 4, modeSelectionType: 'fixed',
      host: { clientId: id(), reconnectToken: id(), name: 'Host' },
      password: 'hunter2', salt: 'salt-x',
    });
    const persisted = serializeRoom(room);
    expect(JSON.stringify(persisted)).not.toContain('hunter2');
    expect(persisted.passwordHash).toBe(room.passwordHash);
    expect(persisted.passwordSalt).toBe(room.passwordSalt);

    const restored = deserializeRoom(persisted)!;
    expect(verifyPassword(restored, 'hunter2')).toBe(true);
    expect(verifyPassword(restored, 'wrong')).toBe(false);
  });

  it('does not persist transient socket/connection state', () => {
    const room = room4pFixed();
    const json = JSON.stringify(serializeRoom(room));
    expect(json).not.toContain('socket');
    // Member shape is the documented set only.
    const persisted = serializeRoom(room);
    expect(Object.keys(persisted.members[0]).sort()).toEqual(
      ['clientId', 'connected', 'isHost', 'name', 'reconnectToken', 'role', 'seatIndex'],
    );
  });

  it('handles corrupt / malformed entries predictably (returns null, never throws)', () => {
    expect(deserializeRoom(null)).toBeNull();
    expect(deserializeRoom('not an object')).toBeNull();
    expect(deserializeRoom({ v: 999, code: 'X' })).toBeNull();          // wrong version
    expect(deserializeRoom({ v: 1, code: 'X' })).toBeNull();            // missing members
    expect(deserializeRoom({ v: 1, code: 'X', members: [], playerCount: 5, modeSelectionType: 'fixed' })).toBeNull();
  });

  it('MemoryRoomStorage skips corrupt entries and keeps valid ones', () => {
    const storage = new MemoryRoomStorage();
    storage.saveRoom(room4pFixed());
    // loadRooms only returns deserializable rooms.
    expect(storage.loadRooms()).toHaveLength(1);
    storage.deleteRoom('AAAA');
    expect(storage.loadRooms()).toHaveLength(0);
  });

  it('sanitized snapshot of a restored room never carries the deal log', () => {
    const room = room4pFixed();
    startGame(room, { seed: 1 });
    const restored = deserializeRoom(serializeRoom(room))!;
    const view = sanitizedStateFor(restored, clientForSeat(restored, 0))! as Record<string, unknown>;
    expect(view.dealLog).toBeUndefined();
  });
});

describe('room password (MVP join secret)', () => {
  function protectedRoom(password: string): ServerRoom {
    return createRoom({
      code: 'PWPW', playerCount: 4, modeSelectionType: 'fixed',
      host: { clientId: id(), reconnectToken: id(), name: 'Host' },
      password, salt: 'fixed-salt',
    });
  }

  it('open room: join works without a password', () => {
    const r = createRoom({
      code: 'OPEN', playerCount: 4, modeSelectionType: 'fixed',
      host: { clientId: id(), reconnectToken: id(), name: 'Host' },
    });
    expect(roomHasPassword(r)).toBe(false);
    expect(addMember(r, { clientId: id(), reconnectToken: id(), name: 'B' }).ok).toBe(true);
  });

  it('protected room: rejects missing password', () => {
    const r = protectedRoom('hunter2');
    expect(roomHasPassword(r)).toBe(true);
    const res = addMember(r, { clientId: id(), reconnectToken: id(), name: 'B' });
    expect(res).toEqual({ ok: false, error: 'BAD_PASSWORD' });
  });

  it('protected room: rejects wrong password', () => {
    const r = protectedRoom('hunter2');
    const res = addMember(r, { clientId: id(), reconnectToken: id(), name: 'B', password: 'nope' });
    expect(res).toEqual({ ok: false, error: 'BAD_PASSWORD' });
  });

  it('protected room: accepts correct password', () => {
    const r = protectedRoom('hunter2');
    const res = addMember(r, { clientId: id(), reconnectToken: id(), name: 'B', password: 'hunter2' });
    expect(res.ok).toBe(true);
  });

  it('snapshot exposes hasPassword but never the secret/hash/salt', () => {
    const r = protectedRoom('hunter2');
    const snap = snapshot(r) as Record<string, unknown>;
    expect(snap.hasPassword).toBe(true);
    expect(snap.password).toBeUndefined();
    expect(snap.passwordHash).toBeUndefined();
    expect(snap.passwordSalt).toBeUndefined();
    // Belt-and-braces: the serialized snapshot must not contain the plaintext.
    expect(JSON.stringify(snap)).not.toContain('hunter2');
  });

  it('does not store the plaintext password anywhere on the room', () => {
    const r = protectedRoom('hunter2');
    expect(JSON.stringify({ ...r, members: [...r.members.values()] })).not.toContain('hunter2');
    expect(r.passwordHash).not.toBeNull();
  });

  it('rejects a new player when the room is full (ROOM_FULL)', () => {
    const full = room4pFixed(); // 4/4 seats, not started
    const res = addMember(full, { clientId: id(), reconnectToken: id(), name: 'E' });
    expect(res).toEqual({ ok: false, error: 'ROOM_FULL' });
  });

  it('rejects a new player after the game started (GAME_ALREADY_STARTED)', () => {
    const room = room3pDealerChoice();
    startGame(room);
    const res = addMember(room, { clientId: id(), reconnectToken: id(), name: 'Late' });
    expect(res).toEqual({ ok: false, error: 'GAME_ALREADY_STARTED' });
  });

  it('reconnect works via token without re-supplying the password', () => {
    const r = protectedRoom('hunter2');
    const token = id();
    addMember(r, { clientId: id(), reconnectToken: token, name: 'B', password: 'hunter2' });
    const member = reconnectMember(r, token); // no password passed
    expect(member).not.toBeNull();
    expect(member!.connected).toBe(true);
  });
});

describe('startGame — server owns the initial deal', () => {
  it('builds an initial GameState via the reducer (server-side deal)', () => {
    const room = room4pFixed();
    expect(room.gameState).toBeNull();
    const res = startGame(room);
    expect(res.ok).toBe(true);
    expect(room.started).toBe(true);
    expect(room.gameState).not.toBeNull();
    expect(room.gameState!.players).toHaveLength(4);
    expect(room.gameState!.status).toBe('playing'); // 4p, no kitty, negative mode
  });

  it('refuses to start without the full table', () => {
    const r = createRoom({
      code: 'CCCC', playerCount: 4, modeSelectionType: 'fixed',
      host: { clientId: id(), reconnectToken: id(), name: 'Host' },
    });
    expect(startGame(r).ok).toBe(false);
  });
});

describe('applyActionRequest — authorisation', () => {
  it('rejects PLAY_CARD from a player who is not on turn', () => {
    const room = room4pFixed();
    startGame(room);
    const turnSeat = getCurrentPlayer(room.gameState!).seatIndex;
    const turnCard = getValidCards(getCurrentPlayer(room.gameState!).hand, null)[0];
    const wrongClient = clientForSeat(room, (turnSeat + 1) % 4);

    const before = room.gameState;
    const res = applyActionRequest(room, wrongClient, {
      type: 'PLAY_CARD', playerId: `player-${turnSeat}`, card: turnCard,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('NOT_YOUR_TURN');
    expect(room.gameState).toBe(before); // unchanged
  });

  it('accepts a valid PLAY_CARD from the player on turn and advances the state', () => {
    const room = room4pFixed();
    startGame(room);
    const turnSeat = getCurrentPlayer(room.gameState!).seatIndex;
    const turnClient = clientForSeat(room, turnSeat);
    const card = getValidCards(getCurrentPlayer(room.gameState!).hand, null)[0];

    const before = room.gameState;
    const res = applyActionRequest(room, turnClient, {
      type: 'PLAY_CARD', playerId: `player-${turnSeat}`, card,
    });
    expect(res.ok).toBe(true);
    expect(room.gameState).not.toBe(before);
    expect(room.gameState!.currentTrick?.plays).toHaveLength(1);
  });

  it('rejects CHOOSE_MODE from a non-dealer', () => {
    const room = room3pDealerChoice();
    startGame(room);
    expect(room.gameState!.status).toBe('mode_selection');
    const dealerSeat = room.gameState!.dealerIndex;
    const nonDealer = clientForSeat(room, (dealerSeat + 1) % 3);

    const res = applyActionRequest(room, nonDealer, { type: 'CHOOSE_MODE', modeId: 'no_tricks' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('NOT_YOUR_TURN');
  });

  it('rejects client-sent NEXT_TRICK / NEXT_ROUND (server advances public screens)', () => {
    const room = room4pFixed();
    startGame(room);
    const anyClient = clientForSeat(room, 0);
    expect(applyActionRequest(room, anyClient, { type: 'NEXT_TRICK' }).error).toBe('NOT_YOUR_TURN');
    expect(applyActionRequest(room, anyClient, { type: 'NEXT_ROUND' }).error).toBe('NOT_YOUR_TURN');
  });

  it('rejects an illegal kitty discard even from the dealer', () => {
    // Drive a 3p Dealer's-Choice room into no_hearts and find a dealer holding a heart.
    let room: ServerRoom | null = null;
    for (let i = 0; i < 100 && !room; i++) {
      const r = room3pDealerChoice();
      startGame(r);
      const dealerSeat = r.gameState!.dealerIndex;
      const dealerClient = clientForSeat(r, dealerSeat);
      applyActionRequest(r, dealerClient, { type: 'CHOOSE_MODE', modeId: 'no_hearts' });
      const dealerHand = r.gameState!.players[dealerSeat].hand;
      const hasHeart = dealerHand.some((c) => c.suit === 'hearts');
      const nonHearts = dealerHand.filter((c) => c.suit !== 'hearts');
      if (r.gameState!.status === 'kitty_exchange' && hasHeart && nonHearts.length >= 2) room = r;
    }
    expect(room).not.toBeNull();
    const r = room!;
    const dealerSeat = r.gameState!.dealerIndex;
    const dealerClient = clientForSeat(r, dealerSeat);
    const dealerHand = r.gameState!.players[dealerSeat].hand;
    const heart = dealerHand.find((c) => c.suit === 'hearts')!;
    const otherCard = dealerHand.find((c) => c.suit !== 'hearts')!;

    const before = r.gameState;
    const res = applyActionRequest(r, dealerClient, { type: 'EXCHANGE_KITTY', discards: [heart, otherCard] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ILLEGAL_ACTION');
    expect(r.gameState).toBe(before); // unchanged
  });
});

describe('sanitizedStateFor — server-side redaction', () => {
  it('reveals only the requesting client\'s own hand', () => {
    const room = room4pFixed();
    startGame(room);
    const seat0Client = clientForSeat(room, 0);
    const view = sanitizedStateFor(room, seat0Client)!;

    const mine = view.players.find((p) => p.id === 'player-0')!;
    const real = room.gameState!.players.find((p) => p.id === 'player-0')!;
    expect(mine.hand).toEqual(real.hand);

    for (const p of view.players) {
      if (p.id === 'player-0') continue;
      expect(p.hand.every((c) => c.rank === '?')).toBe(true);
    }
    // Public info stays visible.
    expect(view.dealerModes).toBeDefined();
    expect(view.scores).toBeDefined();
  });
});

describe('deal metadata (server-controlled randomness)', () => {
  it('records a deal record on startGame', () => {
    const room = room4pFixed();
    startGame(room, { seed: 100, now: 1234 });
    expect(room.dealLog).toHaveLength(1);
    const d = room.dealLog[0];
    expect(d.roundIndex).toBe(0);
    expect(d.seed).toBe(100);
    expect(d.timestamp).toBe(1234);
    expect(d.deckHash).toMatch(/^[0-9a-f]{8}$/);
    expect(d.dealerId).toBe(room.gameState!.currentRound.dealerId);
  });

  it('same seed → identical deal; different seed → different deal', () => {
    const a = room4pFixed(); startGame(a, { seed: 55 });
    const b = room4pFixed(); startGame(b, { seed: 55 });
    const c = room4pFixed(); startGame(c, { seed: 56 });
    expect(a.gameState!.players.map((p) => p.hand)).toEqual(b.gameState!.players.map((p) => p.hand));
    expect(a.dealLog[0].deckHash).toBe(b.dealLog[0].deckHash);
    expect(a.dealLog[0].deckHash).not.toBe(c.dealLog[0].deckHash);
  });

  it('autoAdvance through NEXT_ROUND appends the next round deal record', () => {
    const room = room4pFixed();
    startGame(room, { seed: 7 });
    // Jump to the end of round 0 so NEXT_ROUND deals round 1.
    room.gameState = { ...room.gameState!, status: 'round_scoring', currentRoundIdx: 0 };
    const advanced = autoAdvance(room, { seed: 8, now: 999 });
    expect(advanced).toBe(true);
    expect(room.dealLog).toHaveLength(2);
    expect(room.dealLog[1].roundIndex).toBe(1);
    expect(room.dealLog[1].seed).toBe(8);
  });

  it('Dealer\'s Choice backfills the chosen mode into the deal record', () => {
    const room = room3pDealerChoice();
    startGame(room, { seed: 3 });
    expect(room.dealLog[0].modeId).toBeNull(); // unknown until the dealer picks
    const dealerSeat = room.gameState!.dealerIndex;
    const dealerClient = clientForSeat(room, dealerSeat);
    applyActionRequest(room, dealerClient, { type: 'CHOOSE_MODE', modeId: 'no_queens' });
    expect(room.dealLog[0].modeId).toBe('no_queens');
  });

  it('sanitized state never carries the deal log or a full deck', () => {
    const room = room4pFixed();
    startGame(room, { seed: 1 });
    const view = sanitizedStateFor(room, clientForSeat(room, 0))! as Record<string, unknown>;
    expect(view.dealLog).toBeUndefined();
    expect(view.seed).toBeUndefined();
    expect(view.deck).toBeUndefined();
    // Opponent hands remain redacted in the sanitized payload.
    const players = (view.players as { id: string; hand: { rank: string }[] }[]);
    for (const p of players) {
      if (p.id === 'player-0') continue;
      expect(p.hand.every((c) => c.rank === '?')).toBe(true);
    }
  });
});

describe('kickMember (host removes a lobby member before start)', () => {
  const arr = (room: ServerRoom) => [...room.members.values()];

  it('host can kick a player before the game starts; seats are renumbered', () => {
    const room = room4pFixed();
    const host = arr(room)[0];
    const victim = arr(room)[2]; // 'C'
    expect(host.isHost).toBe(true);
    const res = kickMember(room, host.clientId, victim.clientId);
    expect(res.ok).toBe(true);
    expect(res.removed?.clientId).toBe(victim.clientId);
    expect(room.members.has(victim.clientId)).toBe(false);
    expect(arr(room).filter((m) => m.role === 'player').map((m) => m.seatIndex)).toEqual([0, 1, 2]);
  });

  it('rejects a non-host kicker (NOT_HOST)', () => {
    const room = room4pFixed();
    const [, nonHost, other] = arr(room);
    expect(kickMember(room, nonHost.clientId, other.clientId)).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(room.members.has(other.clientId)).toBe(true); // unchanged
  });

  it('rejects kicking after the game has started (ILLEGAL_ACTION)', () => {
    const room = room4pFixed();
    const [host, b] = arr(room);
    startGame(room);
    expect(kickMember(room, host.clientId, b.clientId)).toEqual({ ok: false, error: 'ILLEGAL_ACTION' });
    expect(room.members.has(b.clientId)).toBe(true);
  });

  it('host cannot kick themselves (use Leave instead)', () => {
    const room = room4pFixed();
    const host = arr(room)[0];
    expect(kickMember(room, host.clientId, host.clientId)).toEqual({ ok: false, error: 'ILLEGAL_ACTION' });
  });

  it('rejects an unknown target (BAD_MESSAGE)', () => {
    const room = room4pFixed();
    expect(kickMember(room, arr(room)[0].clientId, 'no-such-client')).toEqual({ ok: false, error: 'BAD_MESSAGE' });
  });

  it('a kicked member is removed from persistence', () => {
    const room = room4pFixed();
    const [host, victim] = arr(room);
    const storage = new MemoryRoomStorage();
    storage.saveRoom(room);
    kickMember(room, host.clientId, victim.clientId);
    storage.saveRoom(room); // server persists after a kick
    const [restored] = storage.loadRooms();
    expect(restored.members.has(victim.clientId)).toBe(false);
    expect([...restored.members.values()]).toHaveLength(3);
  });

  it('a kicked member cannot reconnect with the old token', () => {
    const room = room4pFixed();
    const [host, victim] = arr(room);
    const token = victim.reconnectToken;
    kickMember(room, host.clientId, victim.clientId);
    expect(reconnectMember(room, token)).toBeNull();
  });

  it('snapshot reflects the updated seats after a kick', () => {
    const room = room4pFixed();
    const [host, , c] = arr(room);
    kickMember(room, host.clientId, c.clientId);
    const snap = snapshot(room);
    expect(snap.members.filter((m) => m.role === 'player').map((m) => m.seatIndex)).toEqual([0, 1, 2]);
  });
});

describe('reconnect — returns current sanitized state', () => {
  it('re-attaches a member and serves their own hand', () => {
    const room = room4pFixed();
    startGame(room);
    const token = [...room.members.values()][1].reconnectToken;
    const clientId = [...room.members.values()][1].clientId;

    markDisconnected(room, clientId);
    expect(room.members.get(clientId)!.connected).toBe(false);

    const member = reconnectMember(room, token);
    expect(member).not.toBeNull();
    expect(member!.connected).toBe(true);

    const view = sanitizedStateFor(room, clientId)!;
    const mine = view.players.find((p) => p.id === `player-${member!.seatIndex}`)!;
    expect(mine.hand.every((c) => c.rank === '?')).toBe(false); // own hand is real
  });
});
