// ---------------------------------------------------------------------------
// Room-browser filtering + sorting (Stage 11.3). PURE, client-only helpers — no
// network, no protocol change. They derive a view over the raw `RoomSummary[]`
// the room-list hook already returns; the server room-list payload is untouched.
// ---------------------------------------------------------------------------

import type { RoomSummary } from '../../net/messages';
import { GAME_TYPES, type GameType } from '../../games/catalog';

/** Game filter: a specific game or 'all'. */
export type GameFilter = 'all' | GameType;

/** Sort keys for the browser. */
export type RoomSort = 'open' | 'recent' | 'players' | 'connection';

export const ROOM_SORTS: readonly RoomSort[] = ['open', 'recent', 'players', 'connection'];

/** Rooms of the selected game (or all). Never mutates the input array. */
export function filterRooms(rooms: readonly RoomSummary[], filter: GameFilter): RoomSummary[] {
  return filter === 'all' ? rooms.slice() : rooms.filter((r) => r.gameType === filter);
}

/** Joinable (lobby) first, then full, then in-game — the "open first" ordering. */
const STATUS_RANK: Record<RoomSummary['status'], number> = { lobby: 0, full: 1, in_game: 2 };

/**
 * A stable, NON-mutating sort of rooms by `sort`. All keys fall back to most-
 * recently-updated within ties so the order is deterministic:
 *  - 'open'       → status rank (lobby<full<in_game), then recent;
 *  - 'recent'     → updatedAt desc;
 *  - 'players'    → most occupied seats first, then recent;
 *  - 'connection' → connected hosts first, then recent.
 */
export function sortRooms(rooms: readonly RoomSummary[], sort: RoomSort): RoomSummary[] {
  const byRecent = (a: RoomSummary, b: RoomSummary) => b.updatedAt - a.updatedAt;
  const cmp: Record<RoomSort, (a: RoomSummary, b: RoomSummary) => number> = {
    recent: byRecent,
    open: (a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || byRecent(a, b),
    players: (a, b) => (b.occupiedSeats - a.occupiedSeats) || byRecent(a, b),
    connection: (a, b) => (Number(b.hostConnected) - Number(a.hostConnected)) || byRecent(a, b),
  };
  return rooms.slice().sort(cmp[sort]);
}

/** Room counts per game plus the total, for the filter chips. */
export function countRoomsByGame(rooms: readonly RoomSummary[]): Record<GameFilter, number> {
  const counts = { all: rooms.length } as Record<GameFilter, number>;
  for (const g of GAME_TYPES) counts[g] = 0;
  for (const r of rooms) counts[r.gameType] = (counts[r.gameType] ?? 0) + 1;
  return counts;
}
