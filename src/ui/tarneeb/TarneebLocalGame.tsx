import { useCallback, useEffect, useRef, useState } from 'react';
import { tarneebReducer } from '../../games/tarneeb/engine';
import { tarneebBotAction } from '../../games/tarneeb/ai';
import { getActingTarneebSeat } from '../../games/tarneeb/rules';
import type { PlayerType } from '../../models/types';
import type { TarneebAction, TarneebState, TarneebTrick, TarneebVariant } from '../../games/tarneeb/types';
import { localBotNames } from '../../games/botIdentities';
import TarneebSetup from './TarneebSetup';
import TarneebGameScreen from './TarneebGameScreen';
import TarneebFinished from './TarneebFinished';

const BOT_DELAY_MS = 800;
/** How long a just-resolved trick stays on the felt before play continues. */
const TRICK_REVIEW_MS = 2000;
/** The local human always occupies seat 0; seats 1–3 are bots. */
const HUMAN_SEAT = 0;

/**
 * Local-only Tarneeb: one human (seat 0) + three bots (TARNEEB_RULES §2). Owns the
 * pure Tarneeb state via `tarneebReducer`, drives bots through `tarneebBotAction`,
 * and briefly freezes each completed trick so it is readable. Entirely separate
 * from King's LocalGame/GameRouter and from any server/online state.
 */
export default function TarneebLocalGame({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<TarneebState | null>(null);
  const [reviewTrick, setReviewTrick] = useState<TarneebTrick | null>(null);
  const apply = useCallback((action: TarneebAction) => setState((s) => tarneebReducer(s, action)), []);

  // Freeze a just-resolved trick for a beat before continuing (only mid-hand; the
  // 13th trick rolls straight into the hand-complete summary).
  const prevCompleted = useRef(0);
  const reviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state) { prevCompleted.current = 0; return; }
    const n = state.completedTricks.length;
    if (n > prevCompleted.current && state.phase === 'playing') {
      setReviewTrick(state.completedTricks[n - 1]);
      if (reviewTimer.current) clearTimeout(reviewTimer.current);
      reviewTimer.current = setTimeout(() => setReviewTrick(null), TRICK_REVIEW_MS);
    }
    prevCompleted.current = n;
  }, [state]);
  useEffect(() => () => { if (reviewTimer.current) clearTimeout(reviewTimer.current); }, []);

  // Bot auto-play: while the acting seat is a bot (and we are not reviewing a
  // trick), play its move after a short pause. Stops when the human must act, at
  // hand_complete (human taps Next hand), or when the game is finished.
  useEffect(() => {
    if (!state || reviewTrick) return;
    const seat = getActingTarneebSeat(state);
    if (seat == null) return;                 // hand_complete / game_finished
    if (state.players[seat].type !== 'ai') return;
    const action = tarneebBotAction(state, seat);
    const timer = setTimeout(() => apply(action), BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, reviewTrick, apply]);

  function start(variant: TarneebVariant, targetScore: number) {
    const playerNames = ['You', ...localBotNames('tarneeb', 3, ['You'])];
    const playerTypes: PlayerType[] = ['human', 'ai', 'ai', 'ai'];
    setReviewTrick(null);
    prevCompleted.current = 0;
    // Solo passes variant:'solo'; Pairs omits it so the state is the released
    // default ('pairs'). The match target (Stage 29.8) rides in options; the reducer
    // normalises it (a missing/invalid value → the default 41).
    apply({
      type: 'START_GAME', playerNames, playerTypes,
      options: { targetScore },
      ...(variant === 'solo' ? { variant } : {}),
    });
  }

  function playAgain() {
    setReviewTrick(null);
    prevCompleted.current = 0;
    setState(null);
  }

  if (!state) return <TarneebSetup onStart={start} onExit={onExit} />;
  if (state.phase === 'game_finished') {
    return <TarneebFinished state={state} humanSeat={HUMAN_SEAT} onPlayAgain={playAgain} onExit={onExit} />;
  }
  return (
    <TarneebGameScreen
      state={state}
      humanSeat={HUMAN_SEAT}
      apply={apply}
      onExit={onExit}
      reviewTrick={reviewTrick}
    />
  );
}
