import { useCallback, useEffect, useRef, useState } from 'react';
import { preferansReducer } from '../../games/preferans/engine';
import { preferansBotAction } from '../../games/preferans/ai';
import { getActingPreferansSeat } from '../../games/preferans/rules';
import type { PlayerType } from '../../models/types';
import type { PreferansAction, PreferansState, PreferansTrick } from '../../games/preferans/types';
import { localBotNames } from '../../games/botIdentities';
import PreferansSetup from './PreferansSetup';
import PreferansGameScreen from './PreferansGameScreen';
import PreferansFinished from './PreferansFinished';

const BOT_DELAY_MS = 800;
/** How long a just-resolved trick stays on the felt before play continues. */
const TRICK_REVIEW_MS = 1100;
/** The local human always occupies seat 0; seats 1–2 are bots. */
const HUMAN_SEAT = 0;
/** MVP match target (PREFERANS_RULES §11). */
const TARGET_SCORE = 10;

/**
 * Local-only Preferans: one human (seat 0) + two bots (PREFERANS_RULES §2).
 * Owns the pure Preferans state via `preferansReducer`, drives the bots through
 * `preferansBotAction`, and briefly freezes each completed trick so it is readable.
 * Entirely separate from King's LocalGame/GameRouter and from any server/online
 * state (experimental local prototype, Stage 19.3 — no online, no stats).
 */
export default function PreferansLocalGame({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<PreferansState | null>(null);
  const [reviewTrick, setReviewTrick] = useState<PreferansTrick | null>(null);
  const apply = useCallback((action: PreferansAction) => setState((s) => preferansReducer(s, action)), []);

  // Freeze a just-resolved trick for a beat before continuing (only mid-hand; the
  // 10th trick rolls straight into the hand-complete summary).
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
    const seat = getActingPreferansSeat(state);
    if (seat == null) return;                 // hand_complete / game_finished
    if (state.players[seat].type !== 'ai') return;
    const action = preferansBotAction(state, seat);
    const timer = setTimeout(() => apply(action), BOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, reviewTrick, apply]);

  function start() {
    const playerNames = ['You', ...localBotNames('preferans', 2, ['You'])];
    const playerTypes: PlayerType[] = ['human', 'ai', 'ai'];
    setReviewTrick(null);
    prevCompleted.current = 0;
    apply({ type: 'START_GAME', playerNames, playerTypes, options: { targetScore: TARGET_SCORE } });
  }

  function playAgain() {
    setReviewTrick(null);
    prevCompleted.current = 0;
    setState(null);
  }

  if (!state) return <PreferansSetup onStart={start} onExit={onExit} />;
  if (state.phase === 'game_finished') {
    return <PreferansFinished state={state} humanSeat={HUMAN_SEAT} onPlayAgain={playAgain} onExit={onExit} />;
  }
  return (
    <PreferansGameScreen
      state={state}
      humanSeat={HUMAN_SEAT}
      apply={apply}
      onExit={onExit}
      reviewTrick={reviewTrick}
    />
  );
}
