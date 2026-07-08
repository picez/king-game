// ---------------------------------------------------------------------------
// Per-connection WebSocket rate limiting (Stage: hardening / БЕЗ-1).
//
// Pure token-bucket logic — deterministic (callers pass `now` in ms), no Node /
// ws / DOM deps, so it is unit-testable like the rest of src/net. The server
// (server/index.ts) creates one `ConnectionLimiter` per socket and consults it
// in server/wsHandlers.ts before doing any work for a client message.
//
// Two buckets per connection:
//   • message   — every inbound client message (throttles general flooding);
//   • createRoom — CREATE_ROOM only (bounds room churn / code-space exhaustion).
//
// NOTE: this is per-connection — its job is to cap amplification through ONE
// socket. Bounding how many sockets a single host may open (concurrency) and how
// fast it may open them (connect-flood) is handled separately by the per-IP
// IpConnectionLimiter in ipRateLimit.ts, wired in server/index.ts.
// ---------------------------------------------------------------------------

export interface BucketConfig {
  /** Maximum burst — tokens available when idle. */
  capacity: number;
  /** Sustained refill rate (tokens per second). */
  refillPerSec: number;
}

export interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitConfig {
  message: BucketConfig;
  createRoom: BucketConfig;
  /** Drained only by FAILED joins (wrong code / password) — throttles guessing. */
  joinFailure: BucketConfig;
}

// Generous defaults: comfortably above any legitimate interactive/e2e flow
// (human play is a few actions/sec; automated e2e uses one room per socket), yet
// they bound a hostile socket to `refillPerSec` sustained after the burst.
export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  message: { capacity: 60, refillPerSec: 30 },        // burst 60, then 30 msg/s
  createRoom: { capacity: 5, refillPerSec: 0.2 },     // burst 5, then 1 room / 5s
  joinFailure: { capacity: 10, refillPerSec: 0.5 },   // 10 bad joins, then 1 / 2s
};

export function createBucket(cfg: BucketConfig, now: number): TokenBucket {
  return { tokens: cfg.capacity, updatedAt: now };
}

/** Refill by elapsed time (capped at capacity) and return the available tokens
 *  WITHOUT consuming. Mutates the bucket's refill state only. */
export function peek(bucket: TokenBucket, cfg: BucketConfig, now: number): number {
  const elapsedSec = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsedSec * cfg.refillPerSec);
  bucket.updatedAt = now;
  return bucket.tokens;
}

/**
 * Refill by elapsed time (capped at capacity), then try to spend `cost` tokens.
 * Mutates the bucket. Returns true when the request is allowed, false when the
 * bucket is empty (caller should reject with RATE_LIMITED).
 */
export function consume(bucket: TokenBucket, cfg: BucketConfig, now: number, cost = 1): boolean {
  if (peek(bucket, cfg, now) >= cost) {
    bucket.tokens -= cost;
    return true;
  }
  return false;
}

/** One connection's rate-limit state (message + createRoom buckets). */
export class ConnectionLimiter {
  private readonly message: TokenBucket;
  private readonly createRoom: TokenBucket;
  private readonly joinFailure: TokenBucket;

  constructor(private readonly cfg: RateLimitConfig, now: number) {
    this.message = createBucket(cfg.message, now);
    this.createRoom = createBucket(cfg.createRoom, now);
    this.joinFailure = createBucket(cfg.joinFailure, now);
  }

  /** Charge one message; false → over the general message rate. */
  allowMessage(now: number): boolean {
    return consume(this.message, this.cfg.message, now);
  }

  /** Charge one room creation; false → creating rooms too fast. */
  allowCreateRoom(now: number): boolean {
    return consume(this.createRoom, this.cfg.createRoom, now);
  }

  /** True while the connection still has a budget of failed joins left. Peeks
   *  (does not consume) — a legitimate first-time join is never blocked. */
  canAttemptJoin(now: number): boolean {
    return peek(this.joinFailure, this.cfg.joinFailure, now) >= 1;
  }

  /** Record one failed join (wrong code/password) — spends a failure token. */
  recordJoinFailure(now: number): void {
    consume(this.joinFailure, this.cfg.joinFailure, now);
  }
}
