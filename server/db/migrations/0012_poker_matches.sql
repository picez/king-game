-- Stage 37.7.2 — Poker match durability (crash recovery of committed buy-in debits).
-- Additive + idempotent. FAIL 1: performDebit() only marked room.pokerEscrow in RAM before
-- committing the wallet buy-in transaction, so a crash AFTER the debit commit but BEFORE the
-- room JSON was persisted lost all recovery metadata (matchId / seats) — real chip loss.
--
-- This table is written INSIDE the SAME transaction as the buy-in debits, so once the debit
-- commits the durable match record is guaranteed to exist regardless of room persistence.
-- Startup reconciliation finds committed-but-unresolved matches (a poker_matches row with no
-- poker_match_settlements row) INDEPENDENTLY of room.pokerEscrow, and either restores the
-- funded escrow (when an active started room unambiguously owns the match) or performs one
-- atomic idempotent refund. `seats` carries the exact seat→user→amount composition + buy-in +
-- room code + lifecycle, so a refund/payout can be reconstructed without any room JSON.
-- Terminal outcome stays in poker_match_settlements (migration 0011) — payout/refund mutual
-- exclusion is unchanged. See POKER_RULES.md §16 + ONLINE_ARCHITECTURE.md (escrow lifecycle).

CREATE TABLE IF NOT EXISTS poker_matches (
  match_id    text PRIMARY KEY,
  room_code   text NOT NULL,
  buy_in      bigint NOT NULL CHECK (buy_in > 0),
  -- [{ "seat": int, "userId": text, "amount": int }, ...] — the funded composition.
  seats       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast "which matches are unresolved?" scan at startup (LEFT JOIN poker_match_settlements).
CREATE INDEX IF NOT EXISTS poker_matches_room_idx ON poker_matches (room_code);
