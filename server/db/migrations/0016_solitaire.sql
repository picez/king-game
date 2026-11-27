-- Stage S3 (solitaire section): one row per WON solitaire, verified by the server
-- (the move list is replayed from the seed before the row is written).
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS solitaire_results (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant      text NOT NULL,
  seed         bigint NOT NULL,
  -- UTC day of the deal of the day; NULL = a random deal.
  daily        date,
  moves        integer NOT NULL CHECK (moves > 0),
  -- Server-measured wall time from the start token to the result.
  duration_ms  integer NOT NULL CHECK (duration_ms > 0),
  undos        integer NOT NULL DEFAULT 0,
  hints        integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solitaire_results_variant_time_idx ON solitaire_results (variant, duration_ms);
CREATE INDEX IF NOT EXISTS solitaire_results_user_idx ON solitaire_results (user_id, variant);
CREATE INDEX IF NOT EXISTS solitaire_results_daily_idx ON solitaire_results (daily, variant, duration_ms) WHERE daily IS NOT NULL;
-- The deal of the day counts once per player and variant (the first win).
CREATE UNIQUE INDEX IF NOT EXISTS solitaire_results_daily_once ON solitaire_results (user_id, variant, daily) WHERE daily IS NOT NULL;
-- A random deal (one start token = one server seed) can only be submitted once.
CREATE UNIQUE INDEX IF NOT EXISTS solitaire_results_seed_once ON solitaire_results (user_id, variant, seed) WHERE daily IS NULL;
