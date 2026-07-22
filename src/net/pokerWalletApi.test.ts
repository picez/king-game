import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPokerWallet, claimDailyChips } from './pokerWalletApi';

// Client adaptor: sends credentialed requests to the right endpoints, maps HTTP
// statuses to typed reasons (401/403 → signed_out, 503 → no_economy), and never
// throws on an offline fetch.

interface Call { url: string; init: RequestInit }
function mockFetch(res: { status: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (res instanceof Error) throw res;
    return {
      ok: res.status >= 200 && res.status < 300, status: res.status,
      json: async () => { if (res.body === undefined) throw new Error('no body'); return res.body; },
    } as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return calls;
}
afterEach(() => { vi.restoreAllMocks(); });

describe('fetchPokerWallet', () => {
  it('GETs /api/me/poker-wallet with credentials and parses the view', async () => {
    const calls = mockFetch({ status: 200, body: { wallet: { balance: 3_000_000, canClaimToday: false, nextClaimAt: 999 } } });
    const r = await fetchPokerWallet('http://h');
    expect(r).toEqual({ ok: true, wallet: { balance: 3_000_000, canClaimToday: false, nextClaimAt: 999 } });
    expect(calls[0].url).toBe('http://h/api/me/poker-wallet');
    expect(calls[0].init.credentials).toBe('include');
  });
  it('maps statuses to typed reasons', async () => {
    for (const [status, reason] of [[401, 'signed_out'], [403, 'signed_out'], [503, 'no_economy'], [500, 'error']] as const) {
      mockFetch({ status, body: {} });
      expect(await fetchPokerWallet('http://h'), String(status)).toEqual({ ok: false, reason });
    }
  });
  it('offline fetch → error, no throw', async () => {
    mockFetch(new Error('offline'));
    expect(await fetchPokerWallet('http://h')).toEqual({ ok: false, reason: 'error' });
  });
});

describe('claimDailyChips', () => {
  it('POSTs the claim and returns granted + view', async () => {
    const calls = mockFetch({ status: 200, body: { wallet: { balance: 1_000_000, canClaimToday: false, nextClaimAt: 111, granted: true } } });
    const r = await claimDailyChips('http://h');
    expect(r).toEqual({ ok: true, claim: { balance: 1_000_000, canClaimToday: false, nextClaimAt: 111, granted: true } });
    expect(calls[0].url).toBe('http://h/api/me/poker-wallet/daily-claim');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('include');
  });
  it('a repeat claim the same day → granted:false', async () => {
    mockFetch({ status: 200, body: { wallet: { balance: 1_000_000, canClaimToday: false, nextClaimAt: 111, granted: false } } });
    const r = await claimDailyChips('http://h');
    expect(r.ok && r.claim.granted).toBe(false);
  });
  it('signed-out claim → signed_out reason', async () => {
    mockFetch({ status: 403, body: { error: 'guest_forbidden' } });
    expect(await claimDailyChips('http://h')).toEqual({ ok: false, reason: 'signed_out' });
  });
});
