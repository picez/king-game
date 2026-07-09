import { useEffect, useState } from 'react';
import { useGame } from '../../hooks/useGame';
import { getActingPlayerId } from '../../core/gameEngine';
import { useTimerLowAlert } from '../../audio/useSoundAlerts';

/**
 * Per-turn countdown (online only). Reads `turnTimerSec` from the game context
 * (0/undefined = off → renders nothing) and restarts whenever the acting
 * player / step changes — i.e. on every STATE_UPDATE. Purely visual: the server
 * enforces the real timeout and auto-plays a safe move when it fires.
 */
export default function TurnTimer() {
  const { state, turnTimerSec, myPlayerId } = useGame();
  const total = turnTimerSec ?? 0;

  // A key that changes on every turn/step transition.
  const actingId = state ? getActingPlayerId(state) : null;
  const turnKey = state
    ? `${state.status}:${actingId ?? ''}:${state.currentTrick?.plays.length ?? 0}:${state.currentRoundIdx}`
    : '';

  const [left, setLeft] = useState(total);
  useEffect(() => {
    if (total <= 0) return;
    setLeft(total);
    const id = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [turnKey, total]);

  // Alert-only sound (Stage 15.4): fire ONCE when MY turn timer crosses below the
  // threshold. Gated on `active` = a running timer AND it is genuinely my turn
  // (never for opponents / public phases). No-op when sound is off (the default).
  useTimerLowAlert({
    secondsLeft: left,
    active: total > 0 && myPlayerId != null && actingId === myPlayerId,
    turnKey,
  });

  if (total <= 0 || !state) return null;
  return <div className={`turn-timer ${left <= 5 ? 'turn-timer--low' : ''}`}>⏱ {left}s</div>;
}
