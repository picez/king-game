// ---------------------------------------------------------------------------
// Client adaptor for the Stage 37.7 Poker chip-wallet API. SOFT like friendsApi:
// every call degrades gracefully (unreachable / no-DB / signed-out → a typed result,
// never a throw). The economy is server-authoritative — this layer never computes a
// balance or eligibility, it only fetches + null-safely parses the server's view.
// No UI here.
// ---------------------------------------------------------------------------

import { parsePokerWallet, type PokerWalletView, type PokerClaimResult } from './pokerWallet';

/** Why a wallet call could not return a fresh view. */
export type WalletUnavailable = 'signed_out' | 'no_economy' | 'error';

export type WalletResult =
  | { ok: true; wallet: PokerWalletView }
  | { ok: false; reason: WalletUnavailable };

export type ClaimResult =
  | { ok: true; claim: PokerClaimResult }
  | { ok: false; reason: WalletUnavailable };

async function call(base: string, path: string, init: RequestInit = {}): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(`${base}${path}`, {
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      ...init,
    });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* empty/non-JSON */ }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

/** Maps a non-2xx status to a typed reason (401/403 → signed_out, 503 → no_economy). */
function reasonFor(status: number): WalletUnavailable {
  if (status === 401 || status === 403) return 'signed_out';
  if (status === 503) return 'no_economy';
  return 'error';
}

/** GET /api/me/poker-wallet — current balance + daily-claim eligibility. */
export async function fetchPokerWallet(base: string): Promise<WalletResult> {
  const { status, data } = await call(base, '/api/me/poker-wallet');
  if (status === 200) return { ok: true, wallet: parsePokerWallet(data) };
  return { ok: false, reason: reasonFor(status) };
}

/** POST /api/me/poker-wallet/daily-claim — grant today's chips (idempotent server-side). */
export async function claimDailyChips(base: string): Promise<ClaimResult> {
  const { status, data } = await call(base, '/api/me/poker-wallet/daily-claim', { method: 'POST' });
  if (status === 200) {
    const view = parsePokerWallet(data);
    const top = (data && typeof data === 'object' ? data as Record<string, unknown> : {});
    const w = (top.wallet && typeof top.wallet === 'object' ? top.wallet : top) as Record<string, unknown>;
    return { ok: true, claim: { ...view, granted: w.granted === true } };
  }
  return { ok: false, reason: reasonFor(status) };
}
