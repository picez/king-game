// ---------------------------------------------------------------------------
// Poker chip wallet — pure, client-safe shared helpers (Stage 37.7). No DB / React
// / I/O. The chip economy is server-authoritative; this only holds the shared
// constants, the once-per-UTC-day date math, the public view shape, and a null-safe
// parser. Chip amounts are safe integers (never fractional / unsafe). Used by BOTH
// the server wallet repository and the client Profile inventory UI.
// ---------------------------------------------------------------------------

/** The fixed daily grant: exactly 1,000,000 chips, once per UTC calendar day (owner rule). */
export const DAILY_CLAIM_CHIPS = 1_000_000;

/** Ledger reasons (mirrors the DB CHECK). */
export type PokerLedgerReason = 'daily_claim' | 'table_buy_in' | 'table_payout' | 'table_cancel_refund';

/** The public wallet view returned by GET /api/me/poker-wallet + POST daily-claim. */
export interface PokerWalletView {
  /** Authoritative chip balance (safe integer; never negative). */
  balance: number;
  /** Whether a daily claim is available right now (no claim yet this UTC day). */
  canClaimToday: boolean;
  /** When the NEXT claim unlocks (epoch ms, next UTC midnight) — null when claimable now. */
  nextClaimAt: number | null;
}

/** The result of a daily-claim POST. */
export interface PokerClaimResult extends PokerWalletView {
  /** True only when THIS request added chips; false on a repeat claim the same UTC day. */
  granted: boolean;
}

/** A safe, non-negative integer chip amount (rejects string/NaN/Infinity/fraction/negative). */
export function isValidChipAmount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isSafeInteger(v) && v >= 0;
}

/** The UTC calendar date `YYYY-MM-DD` for an epoch-ms / Date instant. */
export function utcDateString(now: number | Date): string {
  const d = new Date(now);
  return d.toISOString().slice(0, 10); // ISO is UTC → date-only prefix is the UTC date
}

/** Epoch ms of the next UTC midnight after `now` (when the next daily claim unlocks). */
export function nextUtcMidnightMs(now: number | Date): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

/** Flatten a `{ wallet: <view> }` (or bare view) API payload into a PokerWalletView (null-safe). */
export function parsePokerWallet(raw: unknown): PokerWalletView {
  const top = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const w = (top.wallet && typeof top.wallet === 'object' ? top.wallet : top) as Record<string, unknown>;
  const balance = typeof w.balance === 'number' && Number.isSafeInteger(w.balance) && w.balance >= 0 ? w.balance : 0;
  return {
    balance,
    canClaimToday: w.canClaimToday === true,
    nextClaimAt: typeof w.nextClaimAt === 'number' ? w.nextClaimAt : null,
  };
}
