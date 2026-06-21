// ---------------------------------------------------------------------------
// PgRoomStorage — Postgres-backed RoomStorage (Stage 2).
//
// Implements the same RoomStorage interface as FileRoomStorage/MemoryRoomStorage
// so it is a drop-in swap, selected via ROOM_STORAGE=pg (server/storage.ts).
//
// Shape note: RoomStorage is synchronous. We mirror FileRoomStorage's pattern —
// an in-memory cache feeds the sync loadRooms()/saveRoom()/deleteRoom(), while
// the actual SQL runs on a serialized async write-chain. `init()` fills the
// cache from the DB once at startup; the server awaits it before restore. A
// connection failure during init() propagates (fail fast), so a misconfigured
// pg deploy is obvious instead of silently starting empty.
// ---------------------------------------------------------------------------

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { rooms as roomsTable } from './schema';
import { getDb } from './client';
import { roomToRow, rowToRoom, type RoomRow } from '../../src/net/pgRoomRow';
import { type RoomStorage, type ServerRoom, type PersistedRoom } from '../../src/net/serverCore';

function rowValues(row: RoomRow) {
  return {
    code: row.code,
    gameType: row.gameType,
    playerCount: row.playerCount,
    started: row.started,
    data: row.data,
    updatedAt: new Date(row.updatedAt),
  };
}

export class PgRoomStorage implements RoomStorage {
  private cache = new Map<string, PersistedRoom>();
  private writeChain: Promise<void> = Promise.resolve();

  /**
   * Load all rooms from Postgres into the cache. Called once at startup BEFORE
   * loadRooms() (the server awaits it). Throws on a connection failure so a
   * broken pg config fails fast rather than starting with no rooms.
   */
  async init(): Promise<void> {
    const conn = await getDb();
    if (!conn) return; // no DATABASE_URL — selector prevents this for pg
    const db = conn.db as PostgresJsDatabase;
    const list = await db.select().from(roomsTable);
    this.cache.clear();
    for (const row of list) {
      const room = rowToRoom(row);
      if (room) this.cache.set(room.code, roomToRow(room).data);
    }
  }

  loadRooms(): ServerRoom[] {
    // Sync contract: returns whatever preload() populated (empty without a DB).
    const out: ServerRoom[] = [];
    for (const data of this.cache.values()) {
      const room = rowToRoom({ data });
      if (room) out.push(room);
    }
    return out;
  }

  saveRoom(room: ServerRoom): void {
    const row = roomToRow(room);
    this.cache.set(room.code, row.data);
    this.enqueue(async (db) => {
      await db.insert(roomsTable).values(rowValues(row))
        .onConflictDoUpdate({ target: roomsTable.code, set: rowValues(row) });
    });
  }

  deleteRoom(code: string): void {
    this.cache.delete(code);
    this.enqueue(async (db) => { await db.delete(roomsTable).where(eq(roomsTable.code, code)); });
  }

  /** Serialize writes so they apply in order; errors are logged, never thrown. */
  private enqueue(op: (db: PostgresJsDatabase) => Promise<void>): void {
    this.writeChain = this.writeChain.then(async () => {
      const conn = await getDb();
      if (!conn) return;
      try { await op(conn.db as PostgresJsDatabase); }
      catch (err) { console.error('[King] PgRoomStorage write failed:', String(err)); }
    });
  }

  /** Await all queued writes (used on graceful shutdown). */
  async flush(): Promise<void> { await this.writeChain; }
}
