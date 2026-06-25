-- Stage 6 — Google OAuth: snapshot the provider's name + picture on auth_accounts.
-- Idempotent (ADD COLUMN IF NOT EXISTS). These are login-only profile basics; we
-- still do NOT store Google access/refresh tokens. See ARCHITECTURE_DB_AUTH.md §1.4.

ALTER TABLE auth_accounts ADD COLUMN IF NOT EXISTS name_at_provider    text;
ALTER TABLE auth_accounts ADD COLUMN IF NOT EXISTS picture_at_provider text;
