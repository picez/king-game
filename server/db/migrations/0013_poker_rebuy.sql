-- Stage 38.0.3B — Poker between-hands REBUY: allow the `table_rebuy` ledger reason.
--
-- Owner rule: between hands, a player whose stack hit 0 may buy back in. Online that is a
-- real debit from the personal chip wallet for exactly one table buy-in, so it MUST be an
-- immutable ledger row like every other balance change.
--
-- WHY A MIGRATION IS REQUIRED (and why the reason cannot be reused):
--   • `poker_ledger.reason` carries a CHECK constraint listing exactly four values, so a
--     `table_rebuy` row simply cannot be written today — the debit would fail closed.
--   • Reusing `table_buy_in` is NOT an option: `validateDurableOwnership` requires EXACTLY
--     one `table_buy_in` row per participant and classifies any extra row as
--     `ledger_mismatch` → corrupt evidence → permanent freeze. A rebuy written under that
--     reason would therefore brick every recovery path for its own match.
-- Nothing else is needed: the existing ledger already carries `user_id`, signed `delta`,
-- `match_id`, `room_code` and a UNIQUE `idempotency_key`, which is the full durable
-- evidence a rebuy needs (`rebuy:<matchId>:<handNumber>:<userId>`). No new table, no new
-- column — the funded total of a match is its initial buy-ins plus its exact rebuy debits.
--
-- Additive + IDEMPOTENT + safe for existing rows: the widened list is a strict superset of
-- the old one, so every historical row still satisfies it. The constraint is located via
-- pg_constraint (never by a guessed name) and re-created under a canonical name, so
-- re-running this file converges instead of failing.

DO $$
DECLARE
  con_name text;
BEGIN
  -- The table must exist (0010 creates it); do nothing on a partially-migrated DB.
  IF to_regclass('public.poker_ledger') IS NULL THEN
    RAISE NOTICE 'poker_ledger missing — skipping (run 0010 first)';
    RETURN;
  END IF;

  -- Drop EVERY existing CHECK constraint that governs `reason`, whatever it is called
  -- (Postgres auto-named the original `poker_ledger_reason_check`, but never rely on that).
  FOR con_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.poker_ledger'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%reason%'
  LOOP
    EXECUTE format('ALTER TABLE public.poker_ledger DROP CONSTRAINT %I', con_name);
  END LOOP;

  -- Re-add the canonical, widened constraint. `table_rebuy` is the ONLY new value.
  ALTER TABLE public.poker_ledger
    ADD CONSTRAINT poker_ledger_reason_check
    CHECK (reason IN ('daily_claim', 'table_buy_in', 'table_rebuy', 'table_payout', 'table_cancel_refund'));
END $$;

-- Rebuy reconciliation scans by (match_id, reason); the existing
-- `poker_ledger_match_idx` on (match_id) already serves it, so no new index is added.
