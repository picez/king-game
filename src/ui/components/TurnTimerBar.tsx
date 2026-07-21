import { useEffect, useState } from 'react';
import { useTimerLowAlert } from '../../audio/useSoundAlerts';

interface Props {
  /** Per-turn seconds the host enabled; 0/undefined = off → renders nothing. */
  turnTimerSec: number;
  /** Authoritative server deadline (epoch ms) for the current turn, or null (no timer). */
  deadlineAt: number | null;
  /** Stable turn identity — changes only on a real transition (resets the alert). */
  revision: number;
  /** serverNow − Date.now() at receipt, so the countdown runs against the server clock. */
  clockOffset: number;
  /** True ONLY when it is genuinely MY turn — gates the low-time sound alert. */
  active: boolean;
  className?: string;
}

/**
 * Seconds left until the authoritative deadline, from the CURRENT wall clock, correcting
 * for server skew via `clockOffset` (= serverNow − Date.now() at receipt). Never < 0;
 * rounds up (`ceil`) so the last second is shown. Exported for deterministic testing.
 */
export function remainingSec(deadlineAt: number | null, clockOffset: number): number {
  if (deadlineAt == null) return 0;
  return Math.ceil(Math.max(0, deadlineAt - (Date.now() + clockOffset)) / 1000);
}

/**
 * Game-agnostic per-turn countdown (online only, Stage 37.5). The server owns the
 * authoritative deadline; this derives the remaining seconds from `deadlineAt` (an
 * epoch ms) using `Date.now()` on every tick, so a reload/remount, a reconnect, or a
 * throttled background tab all resolve to the SAME server-anchored value instead of a
 * fresh full countdown. `revision` identifies the turn (so a new turn restarts the
 * clock + re-enables the once-per-turn low alert). Purely visual — the server still
 * enforces the real timeout and auto-plays a safe move when it fires.
 */
export default function TurnTimerBar({ turnTimerSec, deadlineAt, revision, clockOffset, active, className = '' }: Props) {
  const total = turnTimerSec ?? 0;
  const [left, setLeft] = useState(() => remainingSec(deadlineAt, clockOffset));

  useEffect(() => {
    if (total <= 0) return;
    setLeft(remainingSec(deadlineAt, clockOffset)); // resync immediately on a new deadline/revision
    // Tick faster than 1 s so a woken background tab catches up promptly; the value is
    // recomputed from Date.now() each tick, so throttling never accumulates drift.
    const id = setInterval(() => setLeft(remainingSec(deadlineAt, clockOffset)), 250);
    return () => clearInterval(id);
  }, [total, deadlineAt, clockOffset, revision]);

  // Alert-only sound (Stage 15.4): fire ONCE when MY turn timer crosses the low
  // threshold. `active` must be my-turn-only so opponents/public phases never beep.
  // `revision` is the authoritative turn identity, so a harmless rebroadcast (same
  // revision) never re-triggers the alert.
  useTimerLowAlert({ secondsLeft: left, active: total > 0 && active, turnKey: String(revision) });

  if (total <= 0) return null;               // host disabled the timer
  if (deadlineAt == null) return null;       // no active human deadline (public screen / bot / between turns)
  // Icon + numeric countdown as separate spans so the clock can be enlarged for the bottom-of-table
  // HUD placement (Stage 29.5) without scaling the whole pill. `role="timer"` for a11y.
  return (
    <div className={`turn-timer ${left <= 5 ? 'turn-timer--low' : ''} ${className}`.trim()} role="timer" aria-live="off">
      <span className="turn-timer__icon" aria-hidden="true">⏱</span>
      <span className="turn-timer__num">{left}s</span>
    </div>
  );
}
