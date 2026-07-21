import { useCallback, useEffect, useRef, useState } from 'react';
import { pokerReducer } from '../../games/poker/engine';
import { pokerBotAction } from '../../games/poker/ai';
import { getActingPokerSeat } from '../../games/poker/rules';
import { localBotNames } from '../../games/botIdentities';
import { useI18n } from '../../i18n';
import type { PlayerType } from '../../models/types';
import type { PokerAction, PokerState } from '../../games/poker/types';
import PokerSetup from './PokerSetup';
import PokerGameScreen from './PokerGameScreen';
import PokerFinished from './PokerFinished';
import { pokerRedactStateFor } from '../../games/poker/redact';

/** Pause between bot moves so a human can follow the betting unfold. */
const BOT_DELAY_MS = 750;
/** The local human always occupies seat 0; the rest are bots. */
const HUMAN_SEAT = 0;

/**
 * Local-only poker (No-Limit Texas Hold'em): one human (seat 0) + 1–5 bots. Owns the
 * pure state via `pokerReducer`, drives the bots through `pokerBotAction`, and renders
 * setup → handover → table → finished. A handover screen gates the human's first
 * private view each hand so hole cards are never shown before they choose to reveal
 * (§14). Entirely separate from any server / online state.
 */
export default function PokerLocalGame({ onExit }: { onExit: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<PokerState | null>(null);
  const [revealedHand, setRevealedHand] = useState<number>(0);
  const apply = useCallback((action: PokerAction) => setState((s) => pokerReducer(s, action)), []);

  // Bot auto-play during a live betting round.
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state || state.phase !== 'betting') return;
    const seat = getActingPokerSeat(state);
    if (seat == null || state.players[seat].type !== 'ai') return;
    const action = pokerBotAction(state, seat);
    botTimer.current = setTimeout(() => apply(action), BOT_DELAY_MS);
    return () => { if (botTimer.current) clearTimeout(botTimer.current); };
  }, [state, apply]);

  function start(playerCount: number) {
    const botCount = playerCount - 1;
    const playerNames = ['You', ...localBotNames('poker', botCount, ['You'])];
    const playerTypes: PlayerType[] = ['human', ...Array<PlayerType>(botCount).fill('ai')];
    setRevealedHand(0);
    apply({ type: 'START_GAME', playerNames, playerTypes, playerCount });
  }

  if (!state) return <PokerSetup onStart={start} onExit={onExit} />;
  if (state.phase === 'game_finished') {
    return <PokerFinished state={state} mySeat={HUMAN_SEAT} onPlayAgain={() => { setState(null); setRevealedHand(0); }} onExit={onExit} />;
  }

  // Handover: before the human's first decision of a NEW hand, hide the table until
  // they choose to reveal — so hole cards are never exposed on pass-and-play (§14).
  const humanToAct = state.phase === 'betting' && state.toActSeat === HUMAN_SEAT;
  if (humanToAct && revealedHand !== state.handNumber) {
    return (
      <div className="screen poker-handover">
        <div className="poker-handover__card">
          <p className="poker-handover__title">{t('poker.handover.title')}</p>
          <p className="poker-handover__body">{t('poker.handover.body')}</p>
          <button type="button" className="btn btn--primary" onClick={() => setRevealedHand(state.handNumber)}>
            {t('poker.handover.reveal')}
          </button>
        </div>
      </div>
    );
  }

  // The human only ever sees seat 0's hole cards (redact the rest even locally).
  const view = pokerRedactStateFor(state, HUMAN_SEAT);
  return <PokerGameScreen state={view} mySeat={HUMAN_SEAT} apply={apply} onExit={onExit} />;
}
