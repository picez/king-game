-- Stage 25.1 — Friends foundation (signed-in social graph; opt-in, DB-gated).
-- Additive + idempotent (safe to re-run). Adds a stable, shareable per-user FRIEND
-- CODE so accounts add each other WITHOUT exposing email or allowing enumeration, and
-- a `friendships` table (one directed row per request; an accepted row IS the
-- friendship, queried in both directions). Touches no rooms/stats/gameplay. Presence is
-- in-memory (server/friendsPresence.ts), NOT a column here. See FRIENDS_PLAN.md §4.

-- Shareable friend code, e.g. `CM-A2B3-C4D5`. Nullable + backfilled lazily on first
-- Friends-screen open (getOrCreateFriendCode) so this migration needs no data step.
ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code text UNIQUE;

CREATE TABLE IF NOT EXISTS friendships (
  requester_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'pending'  → requester asked addressee (shows in addressee's incoming list)
  -- 'accepted' → friends (either side may remove → row deleted)
  -- 'blocked'  → reserved for post-MVP; not written by 25.1
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)  -- no self-friending
);

-- Fast "my friends / my incoming / my outgoing" lookups in BOTH directions + by status.
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships (addressee_id, status);
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships (requester_id, status);
