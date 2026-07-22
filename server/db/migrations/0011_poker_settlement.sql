-- Stage 37.7.1 — Poker match settlement gate (DB-authoritative payout/refund mutual
-- exclusion). Additive + idempotent (safe to re-run). One row per ECONOMY MATCH records
-- the single terminal outcome — a 'payout' OR a 'cancel_refund'. The settlement code
-- CLAIMS this row (INSERT ... ON CONFLICT DO NOTHING) inside the SAME transaction as the
-- wallet mutations, so across a crash/restart payout and refund can NEVER both mint
-- chips for one match: whichever outcome inserts the row first wins; the opposite outcome
-- conflicts and aborts with no wallet change; a repeat of the SAME outcome is an
-- idempotent no-op (the per-user ledger keys already exist). The poker_ledger idempotency
-- keys guard per-user double-credits; this table guards the whole-match mutual exclusion
-- (payout:<m>:<u> and refund:<m>:<u> are DIFFERENT keys, so the ledger alone cannot).
-- See POKER_RULES.md §16 + ONLINE_ARCHITECTURE.md (escrow lifecycle).

CREATE TABLE IF NOT EXISTS poker_match_settlements (
  -- The server-generated economy match id (also referenced by poker_ledger.match_id).
  match_id    text PRIMARY KEY,
  -- The terminal outcome that won the resolution gate.
  outcome     text NOT NULL CHECK (outcome IN ('payout', 'cancel_refund')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
