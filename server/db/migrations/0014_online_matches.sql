-- Stage 38.0.5 — durable ONLINE match record + normalized participant outcomes.
--
-- WHY A MIGRATION IS REQUIRED
--   The permanent "Leave game" forfeit must record ONE technical loss the moment the
--   player leaves — long before the match finishes, and for a match that may never
--   finish at all. Nothing in the existing schema can express that:
--     • `games` is a FINISHED-match row keyed by a final-score fingerprint, so it
--       cannot exist yet at forfeit time;
--     • `game_players` is a child of `games` (FK + PK on game_id) — no game row, no
--       participant row;
--     • `user_stats` is a rebuildable CACHE (`rebuildUserStats` recomputes it purely
--       from `games`/`game_players`/`rounds`), so a loss written only there would be
--       silently erased by the next rebuild;
--     • the room JSON is not a database — it is deleted with the room.
--
-- OWNERSHIP (exactly-once, no duplication with the legacy stats)
--   `online_match_participants.outcome` is the ONE canonical per-participant result of
--   an ONLINE match. It is written exactly once per (match_id, seat_index):
--     • at FORFEIT time for the leaver  → outcome='loss', forfeited=true;
--     • at FINISH time for everyone else → win/loss/draw.
--   The legacy `games`/`game_players`/`rounds`/`user_stats` path keeps its own,
--   unchanged ownership of the RATING aggregate; it never sees a forfeited seat twice
--   (the finish attribution drops forfeited seats), and the forfeit never writes there.
--   Stage 38.0.6's profile tracker reads THIS model (overall + per-game,
--   human_only vs with_bots, online only) — never `user_stats`.
--
-- PRIVACY: no cards, no game state, no email, no reconnect token, no chip amount.
--   Only: a match id, a room code, the game type, the frozen category, seat indexes,
--   an optional account id (FK to users) and an outcome.
--
-- SAFETY: additive + idempotent (IF NOT EXISTS everywhere, constraints located via
--   pg_constraint and re-created under canonical names, so a re-run converges). No
--   existing table is altered, so every current stats/leaderboard query is unaffected
--   and the Poker economy schema (0010–0013) is untouched.

CREATE TABLE IF NOT EXISTS online_matches (
  -- Stable server-minted id for one started ONLINE match (a rematch is a NEW match).
  match_id      text PRIMARY KEY,
  room_code     text NOT NULL,
  game_type     text NOT NULL,
  -- FROZEN at START_GAME and never recomputed: an AI takeover of a departed human
  -- does NOT move a human_only match to with_bots.
  category      text NOT NULL,
  player_count  integer NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

CREATE TABLE IF NOT EXISTS online_match_participants (
  match_id     text NOT NULL REFERENCES online_matches(match_id) ON DELETE CASCADE,
  seat_index   integer NOT NULL,
  -- NULL for a bot seat and for a guest human (no account attribution).
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  -- The seat's type AT START ('human' | 'ai') — never rewritten by a takeover.
  member_type  text NOT NULL,
  outcome      text NOT NULL DEFAULT 'pending',
  forfeited    boolean NOT NULL DEFAULT false,
  forfeited_at timestamptz,
  CONSTRAINT online_match_participants_pkey PRIMARY KEY (match_id, seat_index)
);

DO $$
DECLARE
  con_name text;
BEGIN
  -- ── online_matches CHECKs ────────────────────────────────────────────────
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.online_matches'::regclass AND contype = 'c'
      AND conname IN ('online_matches_category_check', 'online_matches_status_check',
                      'online_matches_player_count_check', 'online_matches_finished_check')
  LOOP
    EXECUTE format('ALTER TABLE public.online_matches DROP CONSTRAINT %I', con_name);
  END LOOP;

  ALTER TABLE public.online_matches
    ADD CONSTRAINT online_matches_category_check
    CHECK (category IN ('human_only', 'with_bots'));
  ALTER TABLE public.online_matches
    ADD CONSTRAINT online_matches_status_check
    CHECK (status IN ('active', 'finished', 'abandoned'));
  ALTER TABLE public.online_matches
    ADD CONSTRAINT online_matches_player_count_check
    CHECK (player_count BETWEEN 2 AND 6);
  -- A finished match must carry its finish time; an active one must not.
  ALTER TABLE public.online_matches
    ADD CONSTRAINT online_matches_finished_check
    CHECK ((status = 'finished') = (finished_at IS NOT NULL));

  -- ── online_match_participants CHECKs ─────────────────────────────────────
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.online_match_participants'::regclass AND contype = 'c'
      AND conname IN ('omp_seat_index_check', 'omp_member_type_check', 'omp_outcome_check',
                      'omp_forfeit_shape_check', 'omp_bot_seat_check')
  LOOP
    EXECUTE format('ALTER TABLE public.online_match_participants DROP CONSTRAINT %I', con_name);
  END LOOP;

  ALTER TABLE public.online_match_participants
    ADD CONSTRAINT omp_seat_index_check CHECK (seat_index BETWEEN 0 AND 5);
  ALTER TABLE public.online_match_participants
    ADD CONSTRAINT omp_member_type_check CHECK (member_type IN ('human', 'ai'));
  ALTER TABLE public.online_match_participants
    ADD CONSTRAINT omp_outcome_check CHECK (outcome IN ('pending', 'win', 'loss', 'draw'));
  -- A forfeit is ALWAYS a timestamped loss — the two can never disagree.
  ALTER TABLE public.online_match_participants
    ADD CONSTRAINT omp_forfeit_shape_check
    CHECK (forfeited = false OR (outcome = 'loss' AND forfeited_at IS NOT NULL));
  -- A bot seat can never hold an account and can never forfeit.
  ALTER TABLE public.online_match_participants
    ADD CONSTRAINT omp_bot_seat_check
    CHECK (member_type = 'human' OR (user_id IS NULL AND forfeited = false));
END $$;

-- EXACTLY-ONCE ACCOUNT ATTRIBUTION: one account holds at most one seat per match, so a
-- match can never record two results (or two forfeits) for the same user.
CREATE UNIQUE INDEX IF NOT EXISTS online_match_participants_user_uq
  ON online_match_participants (match_id, user_id)
  WHERE user_id IS NOT NULL;

-- Stage 38.0.6 tracker reads: per-user, per-game, per-category counters.
CREATE INDEX IF NOT EXISTS online_match_participants_user_idx
  ON online_match_participants (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS online_matches_type_category_idx
  ON online_matches (game_type, category);
CREATE INDEX IF NOT EXISTS online_matches_room_idx
  ON online_matches (room_code);
