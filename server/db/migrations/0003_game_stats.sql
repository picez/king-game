-- Stage 5 — stats from completed games (DB-backed; opt-in, per game_type).
-- Idempotent: safe to re-run. On game_finished the server lifts the score-only
-- roundHistory into games → game_players → rounds and recomputes user_stats.
-- All tables are tagged with game_type so a second game never mixes scores; none
-- hold private state (hands/discard/kitty) — rounds are score-only, exactly as
-- KING_RULES.md mandates. games.room_code is a PLAIN column (no FK to rooms) so
-- stats record even when ROOM_STORAGE=file. game_key makes recording idempotent.
-- See ARCHITECTURE_DB_AUTH.md §2.7–§2.10.

CREATE TABLE IF NOT EXISTS games (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_key        text NOT NULL UNIQUE,
  room_code       text,
  game_type       text NOT NULL DEFAULT 'king',
  ruleset_id      text NOT NULL DEFAULT 'king-v1',
  player_count    integer NOT NULL,
  status          text NOT NULL DEFAULT 'finished',
  winner_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  result          jsonb,
  finished_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seat_index  integer NOT NULL,
  player_id   text NOT NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  name        text NOT NULL,
  avatar      text,
  type        text NOT NULL,
  final_total integer NOT NULL,
  is_winner   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (game_id, seat_index)
);

CREATE TABLE IF NOT EXISTS rounds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_type        text NOT NULL DEFAULT 'king',
  round_index      integer NOT NULL,
  mode_id          text,
  dealer_player_id text,
  trump_occurrence integer NOT NULL DEFAULT 0,
  scores           jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS user_stats (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_type      text NOT NULL,
  games_played   integer NOT NULL DEFAULT 0,
  games_won      integer NOT NULL DEFAULT 0,
  games_lost     integer NOT NULL DEFAULT 0,
  rounds_played  integer NOT NULL DEFAULT 0,
  stats          jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_played_at timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_type)
);

CREATE INDEX IF NOT EXISTS game_players_user_id_idx ON game_players (user_id);
CREATE INDEX IF NOT EXISTS games_room_code_idx      ON games (room_code);
CREATE INDEX IF NOT EXISTS rounds_game_id_idx        ON rounds (game_id);
CREATE INDEX IF NOT EXISTS user_stats_leaderboard_idx ON user_stats (game_type, games_won DESC);
