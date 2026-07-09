-- Stage 13.2 — animation-intensity preference on the global user settings.
-- Idempotent + additive (ADD COLUMN IF NOT EXISTS), backward compatible: existing
-- rows default to 'system' (follow the device). Purely a visual UI preference —
-- never game state, never in the WS room protocol. Mirrors the card_style pattern.

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS animation_preference text NOT NULL DEFAULT 'system';
