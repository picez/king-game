// ---------------------------------------------------------------------------
// Room persistence for the server (Node I/O; run via tsx).
//
// Pure (de)serialization lives in src/net/serverCore.ts and is unit-tested.
// This file only adds the file system layer + an env-driven factory:
//
//   ROOM_STORAGE=memory          → no persistence (LAN/dev default behaviour
//                                   unless a file is configured)
//   ROOM_STORAGE_FILE=/path.json → JSON file at this path
//   DATA_DIR=/some/dir           → JSON file at <DATA_DIR>/rooms.json
//   (none of the above)          → ./.data/rooms.json  (created on demand)
//
// Writes are atomic-ish (temp file + rename) and debounced so rapid actions
// don't thrash the disk. A corrupt/unreadable file is logged and ignored
// (server starts with no rooms) rather than crashing.
// ---------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  serializeRoom, deserializeRoom, MemoryRoomStorage,
  type RoomStorage, type ServerRoom, type PersistedRoom,
} from '../src/net/serverCore';

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

/** Resolves the configured storage from env. */
export function createStorage(): RoomStorage & { flush?: () => void } {
  const mode = process.env.ROOM_STORAGE;
  if (mode === 'memory') {
    console.log('[King] room storage: memory (no durability)');
    return new MemoryRoomStorage();
  }
  const file = process.env.ROOM_STORAGE_FILE
    ?? join(process.env.DATA_DIR ?? '.data', 'rooms.json');
  console.log(`[King] room storage: file ${file}`);
  return new FileRoomStorage(file);
}
