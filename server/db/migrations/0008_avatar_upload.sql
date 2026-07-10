-- Stage 17.1 — server avatar upload storage (HIDDEN backend; no UI/WS wiring yet).
-- Additive + idempotent (safe to re-run). Stores ONLY the server-processed WebP
-- derivative (192x192, metadata stripped) — never a raw original, never an original
-- file name, never a remote URL. The whitelisted EMOJI avatar (user_settings.avatar)
-- is UNCHANGED and remains the fallback + the identity shown in the WS room protocol.
-- Touches no auth_accounts / stats / rooms table. See AVATAR_UPLOAD_PLAN.md §5.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

CREATE TABLE IF NOT EXISTS user_avatars (
  -- Opaque public id used in the served URL (/api/avatar/<id>.webp) — NOT the userId.
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  mime_type  text NOT NULL,          -- 'image/webp' (server-produced); jpeg reserved
  bytes      bytea NOT NULL,         -- the processed WebP derivative (hard-capped)
  byte_size  integer NOT NULL,
  width      integer NOT NULL,
  height     integer NOT NULL,
  version    integer NOT NULL DEFAULT 1,  -- bumped on replace → cache-busting ?v=
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Denormalised fast-flag for /api/me + future room seating (17.3): 0 = no uploaded
-- avatar, else the current version. Kept in sync by the avatar repository.
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS avatar_image_version integer NOT NULL DEFAULT 0;
