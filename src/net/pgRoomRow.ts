// ---------------------------------------------------------------------------
// Pure mapping between a ServerRoom and a Postgres `rooms` row (Stage 1).
//
// This module has NO database/driver imports — it is a plain transform built on
// the existing serialize/deserialize helpers, so it can be unit-tested without a
// live database. The Postgres-backed storage (server/db/pgRoomStorage.ts) wires
// these to drizzle; everything DB-specific stays out of here.
//
// Stage 1 keeps the row deliberately minimal: the full PersistedRoom is stored
// as JSONB in `data`, with a few denormalised columns (code/player_count/
// started/updated_at) lifted out for indexing and TTL sweeps. The normalised
// schema (members/games/rounds/snapshots) arrives in later migration stages.
// ---------------------------------------------------------------------------

import {
  serializeRoom, deserializeRoom,
  type ServerRoom, type PersistedRoom,
} from './serverCore';
import { DEFAULT_GAME_TYPE, type GameType } from '../games/catalog';

/**
 * Plain, driver-agnostic shape of one `rooms` table row. The `game_type` column
 * exists so the same table can host other games later without a backfill
 * (ARCHITECTURE_DB_AUTH.md §2.0); King rooms use `DEFAULT_GAME_TYPE` from the
 * game catalog (`src/games/catalog.ts`).
 */
export interface RoomRow {
  code: string;
  /** Which game this room is (multi-game foundation; 'king' for now). */
  gameType: GameType;
  playerCount: number;
  started: boolean;
  /** Epoch ms; mirrors ServerRoom.updatedAt (also lives inside `data`). */
  updatedAt: number;
  /** Authoritative room payload (same JSON the file store writes). */
  data: PersistedRoom;
}

/**
 * ServerRoom → row. The `data` column is exactly `serializeRoom(room)`; the
 * `gameType` is metadata for routing/filtering and is not part of the payload.
 * Defaults to the room's own gameType (Stage 8.5); the param can still override.
 */
export function roomToRow(room: ServerRoom, gameType: GameType = room.gameType ?? DEFAULT_GAME_TYPE): RoomRow {
  return {
    code: room.code,
    gameType,
    playerCount: room.playerCount,
    started: room.started,
    updatedAt: room.updatedAt,
    data: serializeRoom(room),
  };
}

/**
 * Row → ServerRoom. Reads the authoritative payload from `data`, reusing the
 * shared deserializer (so the same validation/skip-on-corrupt rules apply).
 * Returns null for a malformed row, matching deserializeRoom's contract.
 */
export function rowToRoom(row: { data: unknown }): ServerRoom | null {
  if (row == null || typeof row !== 'object') return null;
  return deserializeRoom(row.data);
}
