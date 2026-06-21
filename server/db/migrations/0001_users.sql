-- Stage 3 — user profiles & settings (DB-backed foundation; opt-in).
-- Idempotent: safe to re-run. Identity is game-agnostic (users + user_settings);
-- per-game prefs live in user_game_settings keyed by game_type. No auth yet — a
-- guest is a users row with is_guest=true, found via guest_key (a device handle,
-- NOT a credential). See ARCHITECTURE_DB_AUTH.md §2.1/§2.4/§2.4b.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_key      text UNIQUE,
  display_name   text,
  is_guest       boolean NOT NULL DEFAULT false,
  email          text,
  email_verified boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lang       text NOT NULL DEFAULT 'en',
  avatar     text,
  card_style text NOT NULL DEFAULT 'classic',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_game_settings (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_type  text NOT NULL,
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_type)
);

CREATE INDEX IF NOT EXISTS users_guest_key_idx ON users (guest_key);
