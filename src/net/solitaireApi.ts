// Ranked solitaire client (S3). Everything degrades to local play: no server,
// no session or a slow network → the deal is local and simply not ranked.

import { apiBaseFromWsUrl } from './profileApi';
import { loadCustomServer, resolveServerUrl } from './connection';
import type { VariantKey } from '../solitaire/engine';
import type { LeaderBoard, LeaderboardResponse, StartResponse } from '../solitaire/ranked';
import type { Session } from '../solitaire/session';

const ENV_WS_URL = (import.meta.env as Record<string, string | undefined>).VITE_WS_URL;
const base = () => apiBaseFromWsUrl(resolveServerUrl(loadCustomServer(), ENV_WS_URL));

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<{ status: number; data: T | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base()}${path}`, {
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      signal: ctl.signal,
      ...init,
    });
    let data: T | null = null;
    try { data = (await res.json()) as T; } catch { /* empty */ }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/** A server-seeded, signed deal; null → play a local (unranked) deal. */
export async function startRankedDeal(variant: VariantKey, daily: boolean): Promise<StartResponse | null> {
  const r = await call<StartResponse>('/api/solitaire/start', { method: 'POST', body: JSON.stringify({ variant, daily }) }, 2500);
  return r.status === 200 && r.data && typeof r.data.token === 'string' ? r.data : null;
}

export type RankedOutcome =
  | { kind: 'ranked'; ms: number; rank: number | null; board: LeaderBoard }
  | { kind: 'unranked' }
  | { kind: 'error'; code: string };

export async function submitSolitaireResult(s: Session): Promise<RankedOutcome> {
  if (!s.token || s.finished !== 'won') return { kind: 'unranked' };
  const r = await call<{ ms?: number; rank?: number | null; board?: LeaderBoard; error?: string }>('/api/solitaire/result', {
    method: 'POST',
    body: JSON.stringify({ token: s.token, moves: s.moves, undos: s.undos, hints: s.hints, elapsedMs: s.elapsedMs }),
  }, 15000);
  if (r.status === 201 && r.data?.ms) return { kind: 'ranked', ms: r.data.ms, rank: r.data.rank ?? null, board: r.data.board ?? 'time' };
  return { kind: 'error', code: r.data?.error ?? (r.status === 0 ? 'network' : `http_${r.status}`) };
}

export async function fetchSolitaireLeaderboard(variant: VariantKey, board: LeaderBoard, day?: string): Promise<LeaderboardResponse | null> {
  const q = new URLSearchParams({ variant, board });
  if (day) q.set('day', day);
  const r = await call<LeaderboardResponse>(`/api/solitaire/leaderboard?${q}`);
  return r.status === 200 && r.data ? r.data : null;
}
