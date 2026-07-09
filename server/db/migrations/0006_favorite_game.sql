-- Stage 13.3 — favorite game on the global user settings (pre-selects the picker).
-- Idempotent + additive (ADD COLUMN IF NOT EXISTS), backward compatible: existing
-- rows default to 'king'. Purely a UI preference — never game state, never in the
-- WS room protocol. Mirrors the card_style / animation_preference pattern.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS favorite_game text NOT NULL DEFAULT 'king';
