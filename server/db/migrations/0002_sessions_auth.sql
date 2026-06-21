-- Stage 4 — sessions & external auth accounts (DB-backed; opt-in).
-- Idempotent: safe to re-run. Both are game-agnostic identity tables (no
-- game_type). Sessions store only the HASH of the cookie token (never plaintext)
-- so a DB dump can't be replayed; auth_accounts is the forward-compat seam for
-- Google/Apple login (unused until OAuth lands). See ARCHITECTURE_DB_AUTH.md
-- §2.2/§2.3/§5.

CREATE TABLE IF NOT EXISTS sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  kind         text NOT NULL DEFAULT 'web_cookie',
  user_agent   text,
  ip_hash      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx   ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  email_at_provider   text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_accounts_provider_account_uq UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS auth_accounts_user_id_idx ON auth_accounts (user_id);
