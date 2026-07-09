import { useCallback, useEffect, useRef, useState } from 'react';
import { durakReducer, getActingDurakPlayerId } from '../../games/durak/engine';
import { durakBotAction } from '../../games/durak/ai';
import type { DurakAction, DurakState, DurakVariant } from '../../games/durak/types';
import type { PlayerType } from '../../models/types';
import { localBotNames } from '../../games/botIdentities';
import DurakSetup from './DurakSetup';
import DurakGameScreen, { type DurakNotice } from './DurakGameScreen';
import DurakFinished from './DurakFinished';

const BOT_DELAY_MS = 850;
const NOTICE_MS = 1500;
/** The local human always occupies seat 0; the rest are bots (Stage 9.3 MVP). */
const HUMAN_ID = 'player-0';

/**
 * Local-only Durak prototype: one human (seat 0) + bots. Owns the Durak state
 * via the pure reducer, drives bots through `durakBotAction`, surfaces a short
 * "what just happened" notice after each bout, and routes setup → game →
 * finished. Entirely separate from King's LocalGame/GameRouter.
 */
export default function DurakLocalGame({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<DurakState | null>(null);
  const [notice, setNotice] = useState<DurakNotice | null>(null);
  const apply = useCallback((action: DurakAction) => setState((s) => durakReducer(s, action)), []);

  // Detect a bout resolving (table cleared) and show who took / that it was beaten.
  const prevRef = useRef<DurakState | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!prev || !state || state.status === 'finished') return;
    if (prev.table.length > 0 && state.table.length === 0) {
      // Cards discarded → successful defense; otherwise the defender took them.
      const took = state.discardPile.length === prev.discardPile.length;
      const next: DurakNotice = took ? { kind: 'took', name: prev.players[prev.defenderIndex].name } : { kind: 'beaten' };
      setNotice(next);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
    }
  }, [state]);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);

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
    const playerNames = ['You', ...localBotNames('durak', playerCount - 1, ['You'])];
    const playerTypes: PlayerType[] = ['human', ...Array.from({ length: playerCount - 1 }, () => 'ai' as const)];
    setNotice(null);
    apply({ type: 'START_DURAK', playerNames, playerTypes, variant });
  }

  if (!state) return <DurakSetup onStart={start} onExit={onExit} />;
  if (state.status === 'finished') {
    return <DurakFinished state={state} humanId={HUMAN_ID} onPlayAgain={() => { setNotice(null); setState(null); }} onExit={onExit} />;
  }
  return <DurakGameScreen state={state} humanId={HUMAN_ID} apply={apply} onExit={onExit} notice={notice} />;
}
