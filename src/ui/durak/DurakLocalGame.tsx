import { useCallback, useEffect, useState } from 'react';
import { durakReducer, getActingDurakPlayerId } from '../../games/durak/engine';
import { durakBotAction } from '../../games/durak/ai';
import type { DurakAction, DurakState, DurakVariant } from '../../games/durak/types';
import type { PlayerType } from '../../models/types';
import DurakSetup from './DurakSetup';
import DurakGameScreen from './DurakGameScreen';
import DurakFinished from './DurakFinished';

const BOT_DELAY_MS = 800;
/** The local human always occupies seat 0; the rest are bots (Stage 9.3 MVP). */
const HUMAN_ID = 'player-0';

/**
 * Local-only Durak prototype: one human (seat 0) + bots. Owns the Durak state
 * via the pure reducer, drives bots through `durakBotAction`, and routes
 * setup → game → finished. Entirely separate from King's LocalGame/GameRouter.
 */
export default function DurakLocalGame({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<DurakState | null>(null);
  const apply = useCallback((action: DurakAction) => setState((s) => durakReducer(s, action)), []);

  // Bot auto-play: when the acting player is a bot, play its move after a pause.
  useEffect(() => {
    if (!state || state.status === 'finished') return;
    const actingId = getActingDurakPlayerId(state);
    const actor = state.players.find((p) => p.id === actingId);
    if (!actor || actor.type !== 'ai') return;
    const action = durakBotAction(state);
    if (!action) return;
    const timer = setTimeout(() => apply(action), BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, apply]);

  function start(variant: DurakVariant, playerCount: number) {
    const playerNames = ['You', ...Array.from({ length: playerCount - 1 }, (_, i) => `Bot ${i + 1}`)];
    const playerTypes: PlayerType[] = ['human', ...Array.from({ length: playerCount - 1 }, () => 'ai' as const)];
    apply({ type: 'START_DURAK', playerNames, playerTypes, variant });
  }

  if (!state) return <DurakSetup onStart={start} onExit={onExit} />;
  if (state.status === 'finished') {
    return <DurakFinished state={state} humanId={HUMAN_ID} onPlayAgain={() => setState(null)} onExit={onExit} />;
  }
  return <DurakGameScreen state={state} humanId={HUMAN_ID} apply={apply} onExit={onExit} />;
}
