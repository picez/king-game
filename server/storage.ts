// ---------------------------------------------------------------------------
// Room persistence for the server (Node I/O; run via tsx).
//
// Pure (de)serialization lives in src/net/serverCore.ts and is unit-tested.
// This file only adds the file system layer + an env-driven factory:
//
//   ROOM_STORAGE=memory          → no persistence (no durability)
//   ROOM_STORAGE=pg              → Postgres (Stage 2; requires DATABASE_URL)
//   ROOM_STORAGE=file | (unset)  → JSON file (default; current behaviour)
//   ROOM_STORAGE_FILE=/path.json → JSON file at this path
//   DATA_DIR=/some/dir           → JSON file at <DATA_DIR>/rooms.json
//   (none of the above)          → ./.data/rooms.json  (created on demand)
//
// Writes are atomic-ish (temp file + rename) and debounced so rapid actions
// don't thrash the disk. A corrupt/unreadable file is logged and ignored
// (server starts with no rooms) rather than crashing.
//
// The Postgres backend (PgRoomStorage) is imported DYNAMICALLY, only on the
// ROOM_STORAGE=pg path — so the file/memory default never loads the DB driver.
// ---------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  serializeRoom, deserializeRoom, MemoryRoomStorage,
  type RoomStorage, type ServerRoom, type PersistedRoom,
} from '../src/net/serverCore';
import { resolveStorageKind, assertStorageEnv } from '../src/net/storageConfig';

/**
 * Storage as the server consumes it: the RoomStorage contract plus two optional
 * lifecycle hooks. `init()` runs once at startup before loadRooms() (Postgres
 * uses it to preload its cache); `flush()` drains pending writes on shutdown.
 * File/memory backends omit init() and have a synchronous flush().
 */
export type AppStorage = RoomStorage & {
  init?: () => Promise<void>;
  flush?: () => void | Promise<void>;
};

const WRITE_DEBOUNCE_MS = 250;

class FileRoomStorage implements RoomStorage {
  private cache = new Map<string, PersistedRoom>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private file: string) {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch { /* ignore */ }
  }

  loadRooms(): ServerRoom[] {
    if (!existsSync(this.file)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (err) {
      console.warn(`[King] room store ${this.file} is unreadable/corrupt — starting empty.`, String(err));
      return [];
    }
    const list = Array.isArray(parsed) ? parsed : [];
    const rooms: ServerRoom[] = [];
    for (const entry of list) {
      const room = deserializeRoom(entry);
      if (room) {
        this.cache.set(room.code, serializeRoom(room));
        rooms.push(room);
      } else {
        console.warn('[King] skipped a malformed room entry during restore.');
      }
    }
    return rooms;
  }

  saveRoom(room: ServerRoom): void {
    this.cache.set(room.code, serializeRoom(room));
    this.scheduleWrite();
  }

  deleteRoom(code: string): void {
    this.cache.delete(code);
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, WRITE_DEBOUNCE_MS);
  }

  /** Synchronous atomic write of the whole store (also used on shutdown). */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify([...this.cache.values()]));
      renameSync(tmp, this.file); // atomic on the same filesystem
    } catch (err) {
      console.error('[King] failed to persist rooms:', String(err));
    }
  }
}

/**
 * Resolves the configured storage from env. Async because the Postgres backend
 * is dynamically imported (keeping the driver off the file/memory path). Throws
 * a clear StorageConfigError when ROOM_STORAGE=pg but DATABASE_URL is missing.
 */
export async function createStorage(): Promise<AppStorage> {
  const kind = resolveStorageKind(process.env.ROOM_STORAGE);
  assertStorageEnv(kind, process.env); // fail fast for pg without DATABASE_URL

  if (kind === 'memory') {
    console.log('[King] room storage: memory (no durability)');
    return new MemoryRoomStorage();
  }

  if (kind === 'pg') {
    const { PgRoomStorage } = await import('./db/pgRoomStorage');
    console.log('[King] room storage: postgres (run `npm run db:migrate` before first use)');
    return new PgRoomStorage();
  }

  const file = process.env.ROOM_STORAGE_FILE
    ?? join(process.env.DATA_DIR ?? '.data', 'rooms.json');
  console.log(`[King] room storage: file ${file}`);
  return new FileRoomStorage(file);
}
