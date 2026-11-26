-- Stage 44.0 — admin panel + player feedback (complaints & suggestions).
--
-- Additive + idempotent (IF NOT EXISTS everywhere). No existing table is altered except
-- the poker_ledger reason CHECK, which gains `admin_adjust` (an admin chip correction,
-- always with match_id NULL, so no table/recovery path ever reads it as a match row).
--
-- PRIVACY: feedback text is what the player typed; no IP is stored anywhere here. The
-- audit log keeps the admin's and target's DISPLAY NAMES as they were at action time.

-- A ban blocks sign-in, guest sessions and the WebSocket identity. Permanent until lifted.
CREATE TABLE IF NOT EXISTS user_bans (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason     text,
  banned_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  banned_at  timestamptz NOT NULL DEFAULT now()
);

-- Audit log: every admin write (and a throttled few views).
CREATE TABLE IF NOT EXISTS admin_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at              timestamptz NOT NULL DEFAULT now(),
  admin_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  admin_label     text,
  kind            text NOT NULL,
  target_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  target_label    text,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS admin_actions_at_idx       ON admin_actions (at DESC);
CREATE INDEX IF NOT EXISTS admin_actions_admin_at_idx ON admin_actions (admin_id, at DESC);

-- Player feedback: complaint (about a player / behaviour), suggestion (a wish), bug.
CREATE TABLE IF NOT EXISTS player_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  author_label text,
  kind         text NOT NULL CHECK (kind IN ('complaint', 'suggestion', 'bug')),
  text         text NOT NULL,
  about_player text,
  room_code    text,
  game_type    text,
  context      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  reply        text,
  replied_at   timestamptz,
  resolved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_feedback_status_idx ON player_feedback (status, created_at DESC);
CREATE INDEX IF NOT EXISTS player_feedback_user_idx   ON player_feedback (user_id, created_at DESC);

-- Server errors, grouped by fingerprint while unresolved.
CREATE TABLE IF NOT EXISTS server_errors (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint  text NOT NULL,
  "where"      text NOT NULL,
  message      text NOT NULL,
  stack        text,
  count        integer NOT NULL DEFAULT 1,
  first_at     timestamptz NOT NULL DEFAULT now(),
  last_at      timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'resolved')),
  resolved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS server_errors_open_fp_uq ON server_errors (fingerprint) WHERE status = 'new';
CREATE INDEX IF NOT EXISTS server_errors_last_idx ON server_errors (status, last_at DESC);

-- Site banner. Every change inserts a row; the live one is the newest not cleared/expired.
CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text        text NOT NULL,
  url         text,
  expires_at  timestamptz,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  cleared_at  timestamptz
);

-- Broadcast messages from the admin to players' inbox.
CREATE TABLE IF NOT EXISTS admin_broadcasts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  title         text NOT NULL,
  text          text NOT NULL,
  recipients    text NOT NULL CHECK (recipients IN ('all', 'people')),
  people_count  integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A player's inbox: broadcasts and replies to their feedback.
CREATE TABLE IF NOT EXISTS inbox_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('broadcast', 'feedback_reply')),
  broadcast_id  uuid REFERENCES admin_broadcasts(id) ON DELETE CASCADE,
  feedback_id   uuid REFERENCES player_feedback(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz
);
CREATE INDEX IF NOT EXISTS inbox_items_user_idx ON inbox_items (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_broadcast_uq ON inbox_items (user_id, broadcast_id) WHERE broadcast_id IS NOT NULL;

-- Active days per user (DAU/WAU/MAU in the admin metrics). Touched by GET /api/me.
CREATE TABLE IF NOT EXISTS activity_days (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      date NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS activity_days_day_idx ON activity_days (day);

-- poker_ledger: allow the admin chip correction reason (same pattern as 0013).
DO $$
DECLARE con_name text;
BEGIN
  FOR con_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.poker_ledger'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%reason%'
  LOOP
    EXECUTE format('ALTER TABLE public.poker_ledger DROP CONSTRAINT %I', con_name);
  END LOOP;
  ALTER TABLE public.poker_ledger
    ADD CONSTRAINT poker_ledger_reason_check
    CHECK (reason IN ('daily_claim', 'table_buy_in', 'table_rebuy', 'table_payout', 'table_cancel_refund', 'admin_adjust'));
END $$;
