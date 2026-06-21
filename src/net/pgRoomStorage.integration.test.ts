import { describe, it, expect } from 'vitest';
import { createRoom } from './serverCore';

// Optional integration test for the Postgres-backed RoomStorage.
//
// It is SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres
// (run `npm run db:migrate` against it first). This keeps `npm test` green with
// no database, while still allowing a real round-trip check on demand:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// PgRoomStorage (and the drizzle/pg driver) is imported DYNAMICALLY inside the
// test, so normal runs never load the driver.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('PgRoomStorage (integration)', () => {
  it('round-trips a room through Postgres (save → init → load → delete)', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { PgRoomStorage } = await import('../../server/db/pgRoomStorage');

    const code = 'IT01';
    const room = createRoom({
      code,
      playerCount: 3,
      modeSelectionType: 'dealer_choice',
      host: { clientId: 'it-host', reconnectToken: 'it-tok', name: 'ITester', avatar: '🦊' },
      now: 1_000,
    });
    room.updatedAt = 2_000;

    // Write with one instance.
    const writer = new PgRoomStorage();
    await writer.init();
    writer.deleteRoom(code); // ensure a clean slate from a prior run
    writer.saveRoom(room);
    await writer.flush();

    // Read back with a fresh instance (proves it came from the DB, not memory).
    const reader = new PgRoomStorage();
    await reader.init();
    const loaded = reader.loadRooms().find((r) => r.code === code);
    expect(loaded).toBeTruthy();
    expect(loaded!.playerCount).toBe(3);
    expect(loaded!.members.get('it-host')!.name).toBe('ITester');
    // Humans reset to disconnected on restore, exactly like the file store.
    expect(loaded!.members.get('it-host')!.connected).toBe(false);

    // Clean up.
    reader.deleteRoom(code);
    await reader.flush();
    const after = new PgRoomStorage();
    await after.init();
    expect(after.loadRooms().find((r) => r.code === code)).toBeUndefined();
  });
});
