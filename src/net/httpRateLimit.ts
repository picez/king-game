// ---------------------------------------------------------------------------
// Per-IP HTTP rate limiting (Stage 41.2) — the HTTP half of the per-IP limits the
// WebSocket side already has (ipRateLimit.ts). ARCHITECTURE_DB_AUTH.md asked for
// per-IP limits on `/auth/*` (OAuth start/callback abuse) and on `/api/*`
// MUTATIONS; reads (profile, room browser, stats, leaderboard) stay unlimited so
// ordinary browsing can never trip it.
//
//   • auth     — every `/auth/*` request (one sign-in is two requests);
//   • mutation — POST/PUT/PATCH/DELETE on `/api/*` (settings, avatar, friends,
//                wallet claim, …). Feature limits (avatar, friends) still apply
//                on top, per user; this one bounds a single host.
//
// Pure and deterministic (callers pass `now` in ms) like the rest of src/net. The
// map self-bounds: an entry whose buckets are full again is dropped on the next
// sweep, and a hard cap evicts the oldest entries under a spray of fake IPs.
// ---------------------------------------------------------------------------

import { type BucketConfig, type TokenBucket, createBucket, consume, peek } from './rateLimit';

export type HttpLimitKind = 'auth' | 'mutation';

export interface HttpRateLimitConfig {
  auth: BucketConfig;
  mutation: BucketConfig;
}

// Generous: a person signs in a few times a day and saves settings a few times a
// minute. They bound a hostile host to ~1 sign-in attempt every 2s and 2 writes/s.
export const DEFAULT_HTTP_RATE_LIMITS: HttpRateLimitConfig = {
  auth: { capacity: 20, refillPerSec: 0.5 },     // burst 20, then 1 / 2s
  mutation: { capacity: 60, refillPerSec: 2 },   // burst 60, then 2 / s
};

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Which bucket a request drains, or null when it is not limited. */
export function httpLimitKind(method: string | undefined, path: string): HttpLimitKind | null {
  if (path.startsWith('/auth/')) return 'auth';
  if ((path === '/api' || path.startsWith('/api/')) && MUTATING.has((method ?? 'GET').toUpperCase())) return 'mutation';
  return null;
}

/**
 * A private / link-local peer address. Without TRUST_PROXY such a peer is almost
 * always the hosting provider's reverse proxy (Render), i.e. EVERY player at once —
 * limiting it would throttle the whole site, so the caller lets it through instead.
 */
export function isPrivateIp(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^10\./.test(v4) || /^192\.168\./.test(v4) || /^169\.254\./.test(v4)) return true;
  const m = /^172\.(\d+)\./.exec(v4);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  const lower = ip.toLowerCase();
  return /^f[cd][0-9a-f]{2}:/.test(lower) || lower.startsWith('fe80:');
}

export type HttpLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

const MAX_TRACKED_IPS = 10_000;
const SWEEP_EVERY = 500;

export class HttpIpRateLimiter {
  private readonly ips = new Map<string, Partial<Record<HttpLimitKind, TokenBucket>>>();
  private calls = 0;

  constructor(private readonly cfg: HttpRateLimitConfig = DEFAULT_HTTP_RATE_LIMITS) {}

  check(ip: string, kind: HttpLimitKind, now: number): HttpLimitResult {
    if (++this.calls % SWEEP_EVERY === 0) this.sweep(now);
    let entry = this.ips.get(ip);
    if (!entry) {
      if (this.ips.size >= MAX_TRACKED_IPS) {
        // Map iteration is insertion order: the first key is the oldest entry.
        const oldest = this.ips.keys().next().value;
        if (oldest !== undefined) this.ips.delete(oldest);
      }
      entry = {};
      this.ips.set(ip, entry);
    }
    const cfg = this.cfg[kind];
    const bucket = entry[kind] ?? (entry[kind] = createBucket(cfg, now));
    if (consume(bucket, cfg, now)) return { ok: true };
    const missing = 1 - bucket.tokens;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(missing / cfg.refillPerSec)) };
  }

  /** Drop IPs whose every bucket has refilled — they carry no state worth keeping. */
  sweep(now: number): void {
    for (const [ip, entry] of this.ips) {
      const idle = (Object.keys(entry) as HttpLimitKind[]).every((k) => {
        const cfg = this.cfg[k];
        return peek(entry[k]!, cfg, now) >= cfg.capacity;
      });
      if (idle) this.ips.delete(ip);
    }
  }

  /** Tracked IP count (tests / diagnostics). */
  get size(): number { return this.ips.size; }
}
