// ---------------------------------------------------------------------------
// Per-IP connection rate limiting (БЕЗ-1 follow-up: the infra-level gate the
// per-connection ConnectionLimiter explicitly does NOT cover — see rateLimit.ts).
//
// Two independent guards per remote IP, both needed to blunt a connect-flood:
//   • concurrency — how many sockets one IP may hold OPEN at once (bounds a
//     slot-exhaustion / memory DoS from a single host);
//   • connect rate — a token bucket drained per accepted connection (bounds
//     churn: rapid connect/disconnect cycling that concurrency alone misses).
//
// Pure and deterministic (callers pass `now` in ms) so it unit-tests like the
// rest of src/net; the server (server/index.ts) holds one shared IpConnection
// Limiter, calls tryAccept() on 'connection' and release() on socket 'close'.
// Loopback is exempted by the caller (tests/LAN open many sockets from ::1).
// ---------------------------------------------------------------------------

import { type BucketConfig, type TokenBucket, createBucket, consume, peek } from './rateLimit';

export interface IpRateLimitConfig {
  /** Max sockets a single IP may hold open simultaneously. */
  maxConcurrent: number;
  /** Token bucket for the rate of newly ACCEPTED connections from one IP. */
  connect: BucketConfig;
}

// Generous defaults: a real user behind one NAT/household is a handful of tabs;
// e2e/LAN run from loopback (exempted by the caller). They bound a hostile host
// to `maxConcurrent` open sockets and `connect.refillPerSec` sustained opens.
export const DEFAULT_IP_RATE_LIMITS: IpRateLimitConfig = {
  maxConcurrent: 30,
  connect: { capacity: 40, refillPerSec: 5 }, // burst 40 opens, then 5/s
};

/** Why a connection was rejected (for the caller's log/close reason). */
export type IpRejectReason = 'concurrency' | 'rate';

interface IpEntry {
  active: number;        // sockets currently open from this IP
  bucket: TokenBucket;   // connect-rate token bucket
}

/**
 * Shared per-IP connection limiter. One instance guards the whole server. Entries
 * are created lazily and dropped once an IP has no open sockets AND a fully
 * refilled bucket, so idle IPs don't accumulate (bounded memory).
 */
export class IpConnectionLimiter {
  private readonly ips = new Map<string, IpEntry>();

  constructor(private readonly cfg: IpRateLimitConfig = DEFAULT_IP_RATE_LIMITS) {}

  /**
   * Try to accept a new connection from `ip`. On success reserves a concurrency
   * slot AND spends a connect token (caller MUST later call release(ip)). On
   * failure nothing is reserved and the reason is returned.
   */
  tryAccept(ip: string, now: number): { ok: true } | { ok: false; reason: IpRejectReason } {
    const entry = this.ips.get(ip) ?? { active: 0, bucket: createBucket(this.cfg.connect, now) };
    // Concurrency is checked first: it is the harder cap and never self-heals
    // without a release, so report it distinctly from transient rate limiting.
    if (entry.active >= this.cfg.maxConcurrent) {
      this.ips.set(ip, entry);
      return { ok: false, reason: 'concurrency' };
    }
    if (!consume(entry.bucket, this.cfg.connect, now)) {
      this.ips.set(ip, entry);
      return { ok: false, reason: 'rate' };
    }
    entry.active += 1;
    this.ips.set(ip, entry);
    return { ok: true };
  }

  /** Release a slot when a socket from `ip` closes. */
  release(ip: string, now: number): void {
    const entry = this.ips.get(ip);
    if (!entry) return;
    entry.active = Math.max(0, entry.active - 1);
  }

  /**
   * Drop tracking for every IP that currently has no open sockets AND whose
   * connect bucket has fully refilled (so forgetting it can't reset a live rate
   * limit). Bounds memory: an IP that connected once and left is reclaimed on a
   * later sweep. The server calls this on its periodic cleanup tick. Returns the
   * number of entries pruned.
   */
  sweep(now: number): number {
    let pruned = 0;
    for (const [ip, entry] of this.ips) {
      if (entry.active === 0 && peek(entry.bucket, this.cfg.connect, now) >= this.cfg.connect.capacity) {
        this.ips.delete(ip);
        pruned++;
      }
    }
    return pruned;
  }

  /** Current open-socket count for an IP (0 if unknown). Exposed for tests/metrics. */
  activeCount(ip: string): number {
    return this.ips.get(ip)?.active ?? 0;
  }

  /** Number of tracked IPs (for tests — verifies idle pruning). */
  trackedIps(): number {
    return this.ips.size;
  }
}
