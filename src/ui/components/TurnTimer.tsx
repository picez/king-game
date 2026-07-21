import { useGame } from '../../hooks/useGame';
import { getActingPlayerId } from '../../core/gameEngine';
import TurnTimerBar from './TurnTimerBar';

/**
 * King's per-turn countdown (online only). Reads `turnTimerSec` + the authoritative
 * `timer` (deadline/revision, Stage 37.5) from the game context and delegates the
 * countdown + low-time alert to the shared, game-agnostic `TurnTimerBar` (the other
 * online games mount that component directly with the same authoritative timer).
 */
export default function TurnTimer() {
  const { state, turnTimerSec, timer, myPlayerId } = useGame();
  const total = turnTimerSec ?? 0;
  if (total <= 0 || !state) return null;

  const actingId = getActingPlayerId(state);
  return (
    <TurnTimerBar
      turnTimerSec={total}
      deadlineAt={timer?.deadlineAt ?? null}
      revision={timer?.revision ?? 0}
      clockOffset={timer?.clockOffset ?? 0}
      active={myPlayerId != null && actingId === myPlayerId}
    />
  );
}
