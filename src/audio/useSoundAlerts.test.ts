// Stage 15.4 — sound is ALERT-ONLY. The React hook is a thin ref wrapper around the
// pure reducer `timerLowStep`, which holds ALL the anti-spam logic; the node test env
// has no DOM, so we drive the reducer directly (fold a sequence of ticks) and spy the
// engine to prove a crossing routes through playSound.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  timerLowStep, TIMER_LOW_INITIAL, TIMER_LOW_THRESHOLD_SEC, TIMER_LOW_SOUND,
  type TimerLowInput, type TimerLowMemo,
} from './useSoundAlerts';

/** Fold a sequence of inputs through the reducer; return how many times it played. */
function fold(inputs: TimerLowInput[], start: TimerLowMemo = TIMER_LOW_INITIAL) {
  let memo = start;
  let plays = 0;
  for (const input of inputs) {
    const r = timerLowStep(memo, input);
    memo = r.memo;
    if (r.play) plays++;
  }
  return { memo, plays };
}

/** A running countdown on one turn: seconds t..t-n, all with the same turnKey. */
const countdown = (from: number, to: number, active: boolean, turnKey = 'T1'): TimerLowInput[] => {
  const out: TimerLowInput[] = [];
  for (let s = from; s >= to; s--) out.push({ secondsLeft: s, active, turnKey });
  return out;
};

describe('timerLowStep (pure anti-spam reducer)', () => {
  it('threshold is 10 and the alert reuses the ui-error sound', () => {
    expect(TIMER_LOW_THRESHOLD_SEC).toBe(10);
    expect(TIMER_LOW_SOUND).toBe('ui-error');
  });

  it('does NOT play while seconds stay above the threshold', () => {
    expect(fold(countdown(30, 11, true)).plays).toBe(0);
  });

  it('plays exactly ONCE when the countdown crosses from >10 to <=10 on my turn', () => {
    // 30..1 includes the 11→10 crossing; must fire once, not every tick below 10.
    expect(fold(countdown(30, 1, true)).plays).toBe(1);
  });

  it('fires on the exact crossing tick (11 → 10) and not again at 9, 8, ...', () => {
    const first = fold(countdown(30, 10, true)); // ends right at the crossing
    expect(first.plays).toBe(1);
    const rest = fold(countdown(9, 1, true), first.memo); // keep ticking down, same turn
    expect(rest.plays).toBe(0);
  });

  it('does NOT play for another player\'s turn (active=false)', () => {
    expect(fold(countdown(30, 1, false)).plays).toBe(0);
  });

  it('does NOT play on mount / reconnect into an already-low timer (no prior >10 value)', () => {
    // First observation is already 8 — no previously-seen above-threshold value.
    expect(fold([{ secondsLeft: 8, active: true, turnKey: 'T1' }, { secondsLeft: 7, active: true, turnKey: 'T1' }]).plays).toBe(0);
  });

  it('resets on a new turn: a fresh turn that crosses again fires again', () => {
    const t1 = fold(countdown(30, 5, true, 'T1'));
    expect(t1.plays).toBe(1);
    const t2 = fold(countdown(30, 5, true, 'T2'), t1.memo); // new turnKey
    expect(t2.plays).toBe(1);
  });

  it('a crossing that lands on 0 does not fire (only >0 counts)', () => {
    // Jump straight from 11 to 0 (e.g. a state skip) — secondsLeft must stay >0.
    expect(fold([
      { secondsLeft: 11, active: true, turnKey: 'T1' },
      { secondsLeft: 0, active: true, turnKey: 'T1' },
    ]).plays).toBe(0);
  });

  it('becoming my turn AFTER mount fires on the fresh countdown', () => {
    // Mount during someone else's turn (inactive), then it becomes my turn (new key).
    const other = fold(countdown(30, 3, false, 'OPP'));
    const mine = fold(countdown(30, 1, true, 'ME'), other.memo);
    expect(mine.plays).toBe(1);
  });
});

// Prove the hook body routes a play through the engine; the engine's own
// off/hidden/throttle no-ops live in soundEngine.test.ts.
vi.mock('./soundEngine', () => ({ playSound: vi.fn() }));
import { playSound } from './soundEngine';

describe('alert → engine wiring', () => {
  beforeEach(() => vi.mocked(playSound).mockClear());

  it('calls playSound(ui-error) on a genuine crossing, once', () => {
    let memo = TIMER_LOW_INITIAL;
    for (const input of countdown(30, 1, true)) {
      const r = timerLowStep(memo, input);
      memo = r.memo;
      if (r.play) playSound(TIMER_LOW_SOUND);
    }
    expect(playSound).toHaveBeenCalledExactlyOnceWith('ui-error');
  });

  it('never calls playSound when it is not my turn', () => {
    let memo = TIMER_LOW_INITIAL;
    for (const input of countdown(30, 1, false)) {
      const r = timerLowStep(memo, input);
      memo = r.memo;
      if (r.play) playSound(TIMER_LOW_SOUND);
    }
    expect(playSound).not.toHaveBeenCalled();
  });
});
