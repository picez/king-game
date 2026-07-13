import { useGame } from '../../hooks/useGame';
import { getActingPlayerId } from '../../core/gameEngine';
import TurnTimerBar from './TurnTimerBar';

/**
 * King's per-turn countdown (online only). Reads `turnTimerSec`/state from the game
 * context and delegates the countdown + low-time alert to the shared, game-agnostic
 * `TurnTimerBar` (Stage 29.2 — the other online games mount that component directly).
 */
export default function TurnTimer() {
  const { state, turnTimerSec, myPlayerId } = useGame();
  const total = turnTimerSec ?? 0;
  if (total <= 0 || !state) return null;

  const actingId = getActingPlayerId(state);
  const turnKey = `${state.status}:${actingId ?? ''}:${state.currentTrick?.plays.length ?? 0}:${state.currentRoundIdx}`;
  return (
    <TurnTimerBar
      turnTimerSec={total}
      turnKey={turnKey}
      active={myPlayerId != null && actingId === myPlayerId}
    />
  );
}
