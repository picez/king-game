// ---------------------------------------------------------------------------
// One-shot room cleanup (admin/dev). Run via:  npm run rooms:cleanup
//
// Loads the configured room storage (same env as the server — ROOM_STORAGE,
// ROOM_STORAGE_FILE, DATA_DIR), deletes every expired room from the persistence
// file, and exits. Does NOT start a server or open any socket.
//
// A room with no connected players idle longer than ROOM_TTL_HOURS (default 24)
// is removed. Rooms loaded from disk have no live sockets, so all are treated as
// idle here — exactly what we want for an offline sweep. Use ROOM_HARD_TTL_HOURS
// (default 48) to match the server's hard cap.
// ---------------------------------------------------------------------------

import { createStorage } from './storage';
import { roomsToExpire } from '../src/net/serverCore';

const HOUR_MS = 60 * 60 * 1000;
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_HOURS ?? 24) * HOUR_MS;
const ROOM_HARD_TTL_MS = Number(process.env.ROOM_HARD_TTL_HOURS ?? 48) * HOUR_MS;

const storage = createStorage();
const rooms = storage.loadRooms();
const expired = roomsToExpire(rooms, Date.now(), ROOM_TTL_MS, ROOM_HARD_TTL_MS);

for (const code of expired) {
  storage.deleteRoom(code);
  console.log(`[King] rooms:cleanup removed ${code}`);
}

// Flush the pending write synchronously so the file reflects the deletions.
const s = storage as { flush?: () => void };
if (typeof s.flush === 'function') s.flush();

console.log(
  `[King] rooms:cleanup — ${rooms.length} loaded, ${expired.length} expired & removed, ` +
  `${rooms.length - expired.length} kept (TTL ${ROOM_TTL_MS / HOUR_MS}h, hard ${ROOM_HARD_TTL_MS / HOUR_MS}h)`,
);
process.exit(0);
