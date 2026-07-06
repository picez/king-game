import { describe, it, expect } from 'vitest';
import {
  consume, createBucket, ConnectionLimiter, DEFAULT_RATE_LIMITS,
  type BucketConfig,
} from './rateLimit';

const cfg: BucketConfig = { capacity: 3, refillPerSec: 1 };

describe('token bucket consume', () => {
  it('allows up to the burst capacity, then rejects', () => {
    const b = createBucket(cfg, 0);
    expect(consume(b, cfg, 0)).toBe(true);
    expect(consume(b, cfg, 0)).toBe(true);
    expect(consume(b, cfg, 0)).toBe(true);
    expect(consume(b, cfg, 0)).toBe(false); // bucket empty
  });

  it('refills over elapsed time at refillPerSec', () => {
    const b = createBucket(cfg, 0);
    consume(b, cfg, 0); consume(b, cfg, 0); consume(b, cfg, 0); // drained
    expect(consume(b, cfg, 0)).toBe(false);
    // 1s later → 1 token back
    expect(consume(b, cfg, 1000)).toBe(true);
    expect(consume(b, cfg, 1000)).toBe(false);
    // 2s later → 2 tokens
    expect(consume(b, cfg, 3000)).toBe(true);
    expect(consume(b, cfg, 3000)).toBe(true);
    expect(consume(b, cfg, 3000)).toBe(false);
  });

  it('never refills above capacity even after a long idle', () => {
    const b = createBucket(cfg, 0);
    consume(b, cfg, 0); // 2 left
    // huge gap → capped at capacity (3), not 3 + elapsed
    expect(consume(b, cfg, 1_000_000)).toBe(true);
    expect(consume(b, cfg, 1_000_000)).toBe(true);
    expect(consume(b, cfg, 1_000_000)).toBe(true);
    expect(consume(b, cfg, 1_000_000)).toBe(false);
  });

  it('treats a backwards clock as zero elapsed (no bonus tokens)', () => {
    const b = createBucket(cfg, 5000);
    consume(b, cfg, 5000); consume(b, cfg, 5000); consume(b, cfg, 5000);
    expect(consume(b, cfg, 1000)).toBe(false); // now < updatedAt → no refill
  });
});

describe('ConnectionLimiter', () => {
  it('has independent message and createRoom buckets', () => {
    const lim = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
    // Exhaust createRoom burst (5) without touching the message allowance.
    for (let i = 0; i < DEFAULT_RATE_LIMITS.createRoom.capacity; i++) {
      expect(lim.allowCreateRoom(0)).toBe(true);
    }
    expect(lim.allowCreateRoom(0)).toBe(false);
    // Messages are still allowed — separate bucket.
    expect(lim.allowMessage(0)).toBe(true);
  });

  it('default message bucket tolerates a normal interactive burst', () => {
    const lim = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
    // 60-message burst all allowed; the 61st (same instant) is throttled.
    for (let i = 0; i < DEFAULT_RATE_LIMITS.message.capacity; i++) {
      expect(lim.allowMessage(0)).toBe(true);
    }
    expect(lim.allowMessage(0)).toBe(false);
  });

  it('blocks joins only after the failed-join budget is exhausted (БЕЗ-6)', () => {
    const lim = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
    const budget = DEFAULT_RATE_LIMITS.joinFailure.capacity; // 10
    // A user who never fails can always attempt.
    expect(lim.canAttemptJoin(0)).toBe(true);
    // Burn the whole budget with failures.
    for (let i = 0; i < budget; i++) {
      expect(lim.canAttemptJoin(0)).toBe(true);
      lim.recordJoinFailure(0);
    }
    // Now blocked at the same instant.
    expect(lim.canAttemptJoin(0)).toBe(false);
    // A successful attempt is not charged, so peeking never restores it here…
    expect(lim.canAttemptJoin(0)).toBe(false);
    // …but refill over time re-opens it (0.5/s → 1 token after 2s).
    expect(lim.canAttemptJoin(2000)).toBe(true);
  });
});
