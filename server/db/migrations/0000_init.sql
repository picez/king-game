-- Stage 1 — rooms table (Postgres is OPTIONAL; mirrors the file store).
-- Idempotent: safe to re-run. The full PersistedRoom lives in `data` (JSONB);
-- the other columns are denormalised for indexing and TTL sweeps. Normalised
-- tables (users/auth/members/games/rounds/snapshots) arrive in later stages.
--
-- `game_type` is the multi-game foundation (ARCHITECTURE_DB_AUTH.md §2.0): King
-- is the only game today (default 'king'), added early so a future game needs no
-- backfill. The room payload itself is unchanged.

CREATE TABLE IF NOT EXISTS rooms (
  code         text PRIMARY KEY,
  game_type    text NOT NULL DEFAULT 'king',
  player_count integer NOT NULL,
  started      boolean NOT NULL DEFAULT false,
  data         jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Forward-compat: add game_type to a rooms table created before this column
-- existed (no-op on a fresh table above).
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS game_type text NOT NULL DEFAULT 'king';

CREATE INDEX IF NOT EXISTS rooms_updated_at_idx ON rooms (updated_at);
CREATE INDEX IF NOT EXISTS rooms_game_type_idx ON rooms (game_type);
