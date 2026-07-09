-- Stage 13.5 — card face theme on the global user settings (visual only).
-- Idempotent + additive (ADD COLUMN IF NOT EXISTS), backward compatible: existing
-- rows default to 'classic'. Never game state, never in the WS room protocol.
-- (New card BACK styles reuse the existing card_style text column — no migration.)

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS card_face_theme text NOT NULL DEFAULT 'classic';
