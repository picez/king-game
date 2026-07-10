// ---------------------------------------------------------------------------
// User avatar repository (Stage 17.1) — the processed-avatar blob store.
//
// Uses the RAW postgres.js connection (not drizzle) for the `bytea` column, which
// postgres.js maps to/from a Node Buffer cleanly. One row per user (unique user_id);
// a replace overwrites the row and bumps `version` (→ cache-busting served URL). The
// denormalised `user_settings.avatar_image_version` is kept in sync here so /api/me
// and future room seating can flag "has avatar" without reading the blob.
//
// Requires Postgres (opt-in): throws a clear error if DATABASE_URL is unset, exactly
// like the other db/* repositories. No original file name is ever stored; the public
// id is an opaque UUID, not the userId. Emoji avatar (user_settings.avatar) untouched.
// ---------------------------------------------------------------------------

import { getDb } from './client';

type Row = Record<string, unknown>;
type Sql = {
  (strings: TemplateStringsArray, ...args: unknown[]): Promise<Row[]>;
};

async function sqlConn(): Promise<Sql> {
  const conn = await getDb();
  if (!conn) {
    throw new Error('user_avatars repository requires DATABASE_URL (Postgres). It is opt-in.');
  }
  return conn.sql as unknown as Sql;
}

export interface AvatarRef { id: string; version: number; }
export interface ProcessedAvatar {
  mimeType: string;
  bytes: Buffer;
  byteSize: number;
  width: number;
  height: number;
}
export interface StoredAvatar { bytes: Buffer; mimeType: string; version: number; }

/** The (id, version) for a user's avatar, or null when none — used to build the URL. */
export async function getAvatarForUser(userId: string): Promise<AvatarRef | null> {
  const sql = await sqlConn();
  const rows = await sql`SELECT id, version FROM user_avatars WHERE user_id = ${userId} LIMIT 1`;
  const r = rows[0];
  return r ? { id: String(r.id), version: Number(r.version) } : null;
}

/** The stored bytes + type + version for the opaque public id, or null — used to serve. */
export async function getAvatarByPublicId(id: string): Promise<StoredAvatar | null> {
  const sql = await sqlConn();
  const rows = await sql`SELECT bytes, mime_type, version FROM user_avatars WHERE id = ${id} LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  return { bytes: r.bytes as Buffer, mimeType: String(r.mime_type), version: Number(r.version) };
}

/**
 * Inserts or replaces the user's processed avatar, bumping `version` on replace, and
 * mirrors the version into user_settings. Returns the opaque id + new version.
 */
export async function upsertAvatar(userId: string, img: ProcessedAvatar): Promise<AvatarRef> {
  const sql = await sqlConn();
  const rows = await sql`
    INSERT INTO user_avatars (user_id, mime_type, bytes, byte_size, width, height, version, updated_at)
    VALUES (${userId}, ${img.mimeType}, ${img.bytes}, ${img.byteSize}, ${img.width}, ${img.height}, 1, now())
    ON CONFLICT (user_id) DO UPDATE SET
      mime_type = EXCLUDED.mime_type,
      bytes = EXCLUDED.bytes,
      byte_size = EXCLUDED.byte_size,
      width = EXCLUDED.width,
      height = EXCLUDED.height,
      version = user_avatars.version + 1,
      updated_at = now()
    RETURNING id, version`;
  const ref: AvatarRef = { id: String(rows[0].id), version: Number(rows[0].version) };
  await sql`UPDATE user_settings SET avatar_image_version = ${ref.version}, updated_at = now() WHERE user_id = ${userId}`;
  return ref;
}

/** Removes the user's avatar (row + settings flag). Idempotent — no row is fine. */
export async function deleteAvatar(userId: string): Promise<void> {
  const sql = await sqlConn();
  await sql`DELETE FROM user_avatars WHERE user_id = ${userId}`;
  await sql`UPDATE user_settings SET avatar_image_version = 0, updated_at = now() WHERE user_id = ${userId}`;
}
