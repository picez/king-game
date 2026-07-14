import { useEffect, useState } from 'react';
import { useTimerLowAlert } from '../../audio/useSoundAlerts';

interface Props {
  /** Per-turn seconds; 0/undefined = off → renders nothing. */
  turnTimerSec: number;
  /** A key that changes on every turn/step transition → restarts the countdown. */
  turnKey: string;
  /** True ONLY when it is genuinely MY turn — gates the low-time sound alert. */
  active: boolean;
  className?: string;
}

/**
 * Game-agnostic per-turn countdown (online only). Purely visual: the server
 * enforces the real timeout and auto-plays a safe move when it fires; this just
 * restarts a local 1 s tick whenever `turnKey` changes. Shared by King's
 * `TurnTimer` (context-driven) and every other online game screen (Stage 29.2),
 * so the timer is visible in ALL online games when the host set 30/60/90.
 */
export default function TurnTimerBar({ turnTimerSec, turnKey, active, className = '' }: Props) {
  const total = turnTimerSec ?? 0;
  const [left, setLeft] = useState(total);

  useEffect(() => {
    if (total <= 0) return;
    setLeft(total);
    const id = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [turnKey, total]);

  // Alert-only sound (Stage 15.4): fire ONCE when MY turn timer crosses the low
  // threshold. `active` must be my-turn-only so opponents/public phases never beep.
  useTimerLowAlert({ secondsLeft: left, active: total > 0 && active, turnKey });

  if (total <= 0) return null;
  // Icon + numeric countdown as separate spans so the clock can be enlarged for the bottom-of-table
  // HUD placement (Stage 29.5) without scaling the whole pill. `role="timer"` for a11y.
  return (
    <div className={`turn-timer ${left <= 5 ? 'turn-timer--low' : ''} ${className}`.trim()} role="timer" aria-live="off">
      <span className="turn-timer__icon" aria-hidden="true">⏱</span>
      <span className="turn-timer__num">{left}s</span>
    </div>
  );
}
