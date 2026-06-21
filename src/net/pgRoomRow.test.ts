import { describe, it, expect } from 'vitest';
import { createRoom, addBot, serializeRoom, deserializeRoom } from './serverCore';
import { roomToRow, rowToRoom, DEFAULT_GAME_TYPE } from './pgRoomRow';

// These tests cover the pure ServerRoom <-> Postgres row mapping only. They need
// NO database — the driver-backed PgRoomStorage is exercised separately and is
// skipped without a live DATABASE_URL.

function sampleRoom() {
  const room = createRoom({
    code: 'AB12',
    playerCount: 3,
    modeSelectionType: 'dealer_choice',
    host: { clientId: 'host-1', reconnectToken: 'tok-1', name: 'Alice', avatar: '🦊' },
    password: 'secret',
    salt: 'salt-xyz',
    turnTimerSec: 60,
    now: 1_000,
  });
  addBot(room, 'host-1', { clientId: 'bot-1', reconnectToken: 'tok-bot' });
  room.updatedAt = 2_000;
  return room;
}

describe('pgRoomRow mapping', () => {
  it('lifts denormalised columns out of the room', () => {
    const row = roomToRow(sampleRoom());
    expect(row.code).toBe('AB12');
    expect(row.playerCount).toBe(3);
    expect(row.started).toBe(false);
    expect(row.updatedAt).toBe(2_000);
  });

  it('tags the row with a game_type (defaults to king, overridable)', () => {
    expect(roomToRow(sampleRoom()).gameType).toBe('king');
    expect(DEFAULT_GAME_TYPE).toBe('king');
    // The seam for future games: an explicit type is carried through.
    expect(roomToRow(sampleRoom(), 'hearts').gameType).toBe('hearts');
    // game_type is metadata, not part of the authoritative payload.
    expect(JSON.stringify(roomToRow(sampleRoom(), 'hearts').data)).not.toContain('hearts');
  });

  it('stores the full PersistedRoom payload in data', () => {
    const room = sampleRoom();
    const row = roomToRow(room);
    // data column is exactly what the file store would write.
    expect(row.data).toEqual(serializeRoom(room));
    expect(row.data.v).toBe(1);
    // Password hash is persisted (never plaintext); plaintext never appears.
    expect(row.data.passwordHash).not.toBeNull();
    expect(JSON.stringify(row.data)).not.toContain('secret');
  });

  it('round-trips a room through row and back', () => {
    const room = sampleRoom();
    const restored = rowToRoom(roomToRow(room));
    expect(restored).not.toBeNull();
    // Same JSON shape as a direct serialize/deserialize cycle.
    expect(serializeRoom(restored!)).toEqual(serializeRoom(deserializeRoom(serializeRoom(room))!));
    // Members survive (host + bot); the bot stays present, the human resets to
    // disconnected exactly like a file restore.
    expect(restored!.members.size).toBe(2);
    expect(restored!.members.get('host-1')!.connected).toBe(false);
    expect(restored!.members.get('bot-1')!.connected).toBe(true);
  });

  it('returns null for a malformed row', () => {
    expect(rowToRoom({ data: null })).toBeNull();
    expect(rowToRoom({ data: { v: 99 } })).toBeNull();
    // @ts-expect-error exercising the defensive guard
    expect(rowToRoom(null)).toBeNull();
  });
});
