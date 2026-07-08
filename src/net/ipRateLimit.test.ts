import { describe, it, expect } from 'vitest';
import { IpConnectionLimiter, type IpRateLimitConfig } from './ipRateLimit';

// Small, explicit config so the thresholds are obvious in each assertion.
const CFG: IpRateLimitConfig = {
  maxConcurrent: 3,
  connect: { capacity: 4, refillPerSec: 1 }, // burst 4 opens, then 1/s
};

describe('IpConnectionLimiter — concurrency cap', () => {
  it('allows up to maxConcurrent open sockets, then rejects with reason "concurrency"', () => {
    const lim = new IpConnectionLimiter(CFG);
    expect(lim.tryAccept('1.1.1.1', 0)).toEqual({ ok: true });
    expect(lim.tryAccept('1.1.1.1', 0)).toEqual({ ok: true });
    expect(lim.tryAccept('1.1.1.1', 0)).toEqual({ ok: true });
    expect(lim.activeCount('1.1.1.1')).toBe(3);
    expect(lim.tryAccept('1.1.1.1', 0)).toEqual({ ok: false, reason: 'concurrency' });
  });

  it('release frees a slot so a new connection is accepted again', () => {
    const lim = new IpConnectionLimiter(CFG);
    for (let i = 0; i < 3; i++) lim.tryAccept('2.2.2.2', 0);
    expect(lim.tryAccept('2.2.2.2', 0).ok).toBe(false);
    lim.release('2.2.2.2', 0);
    expect(lim.activeCount('2.2.2.2')).toBe(2);
    expect(lim.tryAccept('2.2.2.2', 0)).toEqual({ ok: true });
  });

  it('tracks each IP independently', () => {
    const lim = new IpConnectionLimiter(CFG);
    for (let i = 0; i < 3; i++) lim.tryAccept('a', 0);
    // A different IP has its own budget and concurrency.
    expect(lim.tryAccept('b', 0)).toEqual({ ok: true });
    expect(lim.activeCount('a')).toBe(3);
    expect(lim.activeCount('b')).toBe(1);
  });
});

describe('IpConnectionLimiter — connect rate', () => {
  it('rejects with reason "rate" once the connect bucket is drained (below concurrency)', () => {
    // capacity 4 opens, but release immediately so concurrency never binds — only
    // the rate bucket can reject here.
    const lim = new IpConnectionLimiter(CFG);
    for (let i = 0; i < 4; i++) { expect(lim.tryAccept('9.9.9.9', 0).ok).toBe(true); lim.release('9.9.9.9', 0); }
    expect(lim.tryAccept('9.9.9.9', 0)).toEqual({ ok: false, reason: 'rate' });
  });

  it('refills the connect bucket over time', () => {
    const lim = new IpConnectionLimiter(CFG);
    for (let i = 0; i < 4; i++) { lim.tryAccept('9.9.9.9', 0); lim.release('9.9.9.9', 0); }
    expect(lim.tryAccept('9.9.9.9', 0).ok).toBe(false);      // drained at t=0
    expect(lim.tryAccept('9.9.9.9', 1000).ok).toBe(true);    // +1s → 1 token back
  });

  it('a rejected connection reserves nothing (no slot, no token spent)', () => {
    const lim = new IpConnectionLimiter({ maxConcurrent: 1, connect: { capacity: 5, refillPerSec: 0 } });
    expect(lim.tryAccept('x', 0).ok).toBe(true);
    expect(lim.tryAccept('x', 0).ok).toBe(false); // concurrency reject
    expect(lim.activeCount('x')).toBe(1);         // still just the one open socket
    lim.release('x', 0);
    // Only 2 tokens should have been spent total (2 successful accepts), so 3 remain.
    expect(lim.tryAccept('x', 0).ok).toBe(true);
    lim.release('x', 0);
    expect(lim.tryAccept('x', 0).ok).toBe(true);
  });
});

describe('IpConnectionLimiter — sweep (bounded memory)', () => {
  it('sweep prunes idle IPs whose bucket has fully refilled, keeps the rest', () => {
    const lim = new IpConnectionLimiter(CFG);
    lim.tryAccept('idle', 0);
    lim.release('idle', 0);         // idle but bucket not full (1 token spent)
    lim.tryAccept('busy', 0);       // still has an open socket
    expect(lim.trackedIps()).toBe(2);

    expect(lim.sweep(0)).toBe(0);   // 'idle' bucket not full yet; 'busy' still open
    expect(lim.trackedIps()).toBe(2);

    // After enough time for 'idle' to refill fully, sweep reclaims only it.
    expect(lim.sweep(10_000)).toBe(1);
    expect(lim.trackedIps()).toBe(1);
    expect(lim.activeCount('busy')).toBe(1);
  });

  it('sweep never drops an IP with open sockets, however long it idles', () => {
    const lim = new IpConnectionLimiter(CFG);
    lim.tryAccept('held', 0);
    expect(lim.sweep(1_000_000)).toBe(0);
    expect(lim.activeCount('held')).toBe(1);
  });
});
