// ---------------------------------------------------------------------------
// Client turn-timer derivation (Stage 37.5). The countdown is derived from the
// authoritative server DEADLINE via the current wall clock — NOT a per-second local
// decrement. These deterministic tests (fake system clock) prove: a partially-spent
// deadline resolves to the correct remaining (a reload/remount can't reset it to
// full), clock skew is corrected, a delayed tick catches up, the value never goes
// negative, and a new revision/deadline starts a fresh countdown. The once-per-turn
// low-time alert dedup by turnKey is covered in ../../audio/useSoundAlerts.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from 'vitest';
import { remainingSec } from './TurnTimerBar';

afterEach(() => vi.useRealTimers());

/** Anchor the fake system clock so Date.now() is deterministic. */
function at(now: number) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
}

describe('remainingSec — countdown derived from the authoritative deadline', () => {
  it('reads the time left from the deadline against the current clock', () => {
    at(0);
    expect(remainingSec(30_000, 0)).toBe(30); // full at the start of the turn
    at(12_000);
    expect(remainingSec(30_000, 0)).toBe(18); // 12 s spent → 18 left (deadline unchanged)
  });

  it('a partially-spent deadline never resolves back to full (reload/remount safe)', () => {
    // Simulate a client that only STARTS observing the deadline 12 s in (a fresh mount).
    at(12_000);
    expect(remainingSec(30_000, 0)).toBe(18); // NOT 30 — anchored to the deadline
    at(25_000);
    expect(remainingSec(30_000, 0)).toBe(5);
  });

  it('corrects for server clock skew via clockOffset', () => {
    at(10_000);
    // Server clock is 5 s AHEAD of ours (offset +5000): server-now = 15_000 → 15 s left.
    expect(remainingSec(30_000, 5_000)).toBe(15);
    // Server clock 5 s BEHIND (offset −5000): server-now = 5_000 → 25 s left.
    expect(remainingSec(30_000, -5_000)).toBe(25);
  });

  it('a delayed (throttled) tick immediately catches up to the real remaining', () => {
    at(5_000);
    expect(remainingSec(30_000, 0)).toBe(25);
    // A background tab wakes 20 s later — the very next read is correct, not 24.
    at(25_000);
    expect(remainingSec(30_000, 0)).toBe(5);
  });

  it('never goes below 0 (a past deadline reads 0)', () => {
    at(45_000);
    expect(remainingSec(30_000, 0)).toBe(0);
    at(30_050);
    expect(remainingSec(30_000, 0)).toBe(0);
  });

  it('a new deadline (next turn) starts a fresh full countdown', () => {
    at(70_000);
    // The next turn's deadline is 70_000 + 30_000.
    expect(remainingSec(100_000, 0)).toBe(30);
    at(82_000);
    expect(remainingSec(100_000, 0)).toBe(18);
  });

  it('a null deadline (timer off / public screen / bot turn) reads 0', () => {
    at(1_000);
    expect(remainingSec(null, 0)).toBe(0);
  });
});
