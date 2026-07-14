import { useCallback, useEffect, useRef, useState } from 'react';
import { fiftyOneReducer } from '../../games/fiftyOne/engine';
import { fiftyOneBotAction } from '../../games/fiftyOne/ai';
import { getActingFiftyOneSeat } from '../../games/fiftyOne/rules';
import type { PlayerType } from '../../models/types';
import type { FiftyOneAction, FiftyOneState } from '../../games/fiftyOne/types';
import { localBotNames } from '../../games/botIdentities';
import FiftyOneSetup from './FiftyOneSetup';
import FiftyOneGameScreen from './FiftyOneGameScreen';
import FiftyOneFinished from './FiftyOneFinished';

/** Pause between bot moves so a human can watch the draw/meld/discard unfold. */
const BOT_DELAY_MS = 850;
/** The local human always occupies seat 0; the rest are bots. */
const HUMAN_SEAT = 0;

/**
 * Local-only 51 (Syrian 51): one human (seat 0) + 1–3 bots (51_RULES §2). Owns the
 * pure state via `fiftyOneReducer`, drives the bots through `fiftyOneBotAction`, and
 * renders the setup → table → finished flow. Entirely separate from any server /
 * online state — the local mode of the released 51 game (Stage 30.3; released 30.7).
 */
export default function FiftyOneLocalGame({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<FiftyOneState | null>(null);
  const apply = useCallback((action: FiftyOneAction) => setState((s) => fiftyOneReducer(s, action)), []);

  // Bot auto-play: while the acting seat is a bot (during a live round), play its
  // move after a short pause. Round hand-over (round_complete) waits for the human
  // to tap "Next round"; nothing fires at game_finished.
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state || state.phase !== 'playing') return;
    const seat = getActingFiftyOneSeat(state);
    if (seat == null || state.players[seat].type !== 'ai') return;
    const action = fiftyOneBotAction(state, seat);
    botTimer.current = setTimeout(() => apply(action), BOT_DELAY_MS);
    return () => { if (botTimer.current) clearTimeout(botTimer.current); };
  }, [state, apply]);

  function start(playerCount: number) {
    const botCount = playerCount - 1;
    const playerNames = ['You', ...localBotNames('fifty-one', botCount, ['You'])];
    const playerTypes: PlayerType[] = ['human', ...Array<PlayerType>(botCount).fill('ai')];
    apply({ type: 'START_GAME', playerNames, playerTypes, playerCount });
  }

  function playAgain() {
    setState(null);
  }

  if (!state) return <FiftyOneSetup onStart={start} onExit={onExit} />;
  if (state.phase === 'game_finished') {
    return <FiftyOneFinished state={state} humanSeat={HUMAN_SEAT} onPlayAgain={playAgain} onExit={onExit} />;
  }
  return <FiftyOneGameScreen state={state} humanSeat={HUMAN_SEAT} apply={apply} onExit={onExit} />;
}
