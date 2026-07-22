-- Stage 37.7 — Poker chip wallet + append-only ledger (bankroll economy; opt-in, DB-gated).
-- Additive + idempotent (safe to re-run). Backs the ONLINE/global Poker economy: a per-user
-- chip balance, a once-per-UTC-day 1,000,000-chip claim, and an IMMUTABLE ledger of every
-- balance change (daily claim / table buy-in / payout / cancellation refund). LOCAL free-play
-- Poker never touches these tables. Chip amounts are BIGINT (server-authoritative); the
-- balance can never go negative (CHECK). Every mutation is idempotent via a unique
-- idempotency key, so a concurrent double claim, a duplicate START_GAME, or a rebroadcast
-- finish can never double-credit/-debit. Touches no rooms/stats/gameplay tables. See
-- POKER_RULES.md (economy) + ARCHITECTURE_DB_AUTH.md §2.11.

CREATE TABLE IF NOT EXISTS poker_wallets (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Authoritative chip balance. BIGINT; never negative.
  balance          bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  -- UTC calendar date of the last successful daily claim (null = never claimed). The
  -- once-per-day rule compares against the SERVER's current UTC date, so a client clock /
  -- timezone change cannot unlock an extra claim.
  last_claim_date  date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS poker_ledger (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'daily_claim' | 'table_buy_in' | 'table_payout' | 'table_cancel_refund'
  reason           text NOT NULL CHECK (reason IN ('daily_claim', 'table_buy_in', 'table_payout', 'table_cancel_refund')),
  -- Signed chip change applied by this entry (+claim/+payout/+refund, −buy-in).
  delta            bigint NOT NULL,
  -- Balance AFTER this entry was applied (audit; never negative).
  balance_after    bigint NOT NULL CHECK (balance_after >= 0),
  -- Unique per LOGICAL operation (e.g. `daily:<user>:<utc-date>`, `buyin:<matchId>:<user>`,
  -- `payout:<matchId>:<user>`, `refund:<matchId>:<user>`). A re-run of the same operation
  -- conflicts here and no-ops — the economy is idempotent.
  idempotency_key  text NOT NULL UNIQUE,
  -- Optional economy-match reference (server-generated match id) + room code, for audit.
  match_id         text,
  room_code        text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Fast per-user ledger scans (audit / statement).
CREATE INDEX IF NOT EXISTS poker_ledger_user_idx ON poker_ledger (user_id, created_at DESC);
-- Fast per-match reconciliation (buy-in ↔ payout/refund).
CREATE INDEX IF NOT EXISTS poker_ledger_match_idx ON poker_ledger (match_id);
