import { useCallback, useEffect, useRef, useState } from 'react';
import { pokerReducer } from '../../games/poker/engine';
import { pokerBotAction } from '../../games/poker/ai';
import { getActingPokerSeat } from '../../games/poker/rules';
import { pokerRedactStateFor } from '../../games/poker/redact';
import { localBotNames } from '../../games/botIdentities';
import { useI18n } from '../../i18n';
import type { PlayerType } from '../../models/types';
import type { PokerAction, PokerState } from '../../games/poker/types';
import PokerSetup, { type PokerSeatConfig } from './PokerSetup';
import PokerGameScreen from './PokerGameScreen';
import PokerFinished from './PokerFinished';
import { needsHandover, viewerFor } from './passAndPlay';

/** Pause between bot moves so humans can follow the betting unfold. */
const BOT_DELAY_MS = 750;

/**
 * Local poker (No-Limit Texas Hold'em) — true PASS-AND-PLAY (§14). Any valid mix of
 * 2–6 human/bot seats. Owns the pure state via `pokerReducer`; bots auto-play ONLY on
 * AI seats. Before EACH private decision by a human, a handover screen hides the
 * table until that human confirms, so one player's hole cards are never exposed to
 * the next — the table is redacted for the acting human's seat only. Between hands and
 * during a bot's turn no player's private hand leaks. Fully separate from online state.
 */
export default function PokerLocalGame({ onExit }: { onExit: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<PokerState | null>(null);
  /** The human seat currently allowed to view the table (null = handover pending / public). */
  const [viewerSeat, setViewerSeat] = useState<number | null>(null);
  const apply = useCallback((action: PokerAction) => setState((s) => pokerReducer(s, action)), []);

  // Whenever the ACTING seat changes (a new turn, a bot's turn, or a new hand), the
  // prior confirmation is dropped so the next human must confirm a fresh handover —
  // in particular after any bot turn (bot → human ALWAYS re-prompts), even if it is
  // the same human who acted before the bot. Combined with `viewerFor` returning null
  // on a bot's turn, no player's hole cards are ever shown while a bot acts.
  const prevActor = useRef<number | null>(-1);
  useEffect(() => {
    const actor = state ? getActingPokerSeat(state) : null;
    if (actor !== prevActor.current) {
      prevActor.current = actor;
      setViewerSeat(null);
    }
  }, [state]);

  // Bot auto-play — ONLY on AI seats, during a live betting round.
  const botTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state || state.phase !== 'betting') return;
    const seat = getActingPokerSeat(state);
    if (seat == null || state.players[seat].type !== 'ai') return;
    const action = pokerBotAction(state, seat);
    botTimer.current = setTimeout(() => apply(action), BOT_DELAY_MS);
    return () => { if (botTimer.current) clearTimeout(botTimer.current); };
  }, [state, apply]);

  function start(seats: PokerSeatConfig[]) {
    // Assign bot identities to the AI seats; humans keep their chosen names (which may
    // duplicate — the acting human is always resolved by SEAT, never by name).
    const takenNames = seats.filter((s) => s.type === 'human').map((s) => s.name);
    const botNames = localBotNames('poker', seats.filter((s) => s.type === 'ai').length, takenNames);
    let b = 0;
    const playerNames = seats.map((s) => (s.type === 'human' ? s.name : botNames[b++]));
    const playerTypes: PlayerType[] = seats.map((s) => s.type);
    prevActor.current = -1;
    setViewerSeat(null);
    apply({ type: 'START_GAME', playerNames, playerTypes, playerCount: seats.length });
  }

  function playAgain() {
    setState(null);
    prevActor.current = -1;
    setViewerSeat(null);
  }

  if (!state) return <PokerSetup onStart={start} onExit={onExit} />;
  if (state.phase === 'game_finished') {
    // Shared device: show the winner neutrally (no single "you"); reveal nothing private.
    return <PokerFinished state={pokerRedactStateFor(state, null)} mySeat={null} onPlayAgain={playAgain} onExit={onExit} />;
  }

  // Handover: a human must confirm before their private view is shown — so the
  // previous player's hand is already hidden and never seen by the next (§14). The
  // acting human is resolved by SEAT (duplicate names are safe).
  if (needsHandover(state, viewerSeat)) {
    const actor = state.toActSeat;
    return (
      <div className="screen poker-handover">
        <div className="poker-handover__card">
          <p className="poker-handover__title">{t('poker.handover.title')}</p>
          <p className="poker-handover__pass">{t('poker.handover.pass').replace('{name}', state.players[actor].name)}</p>
          <p className="poker-handover__body">{t('poker.handover.body')}</p>
          <button type="button" className="btn btn--primary" onClick={() => setViewerSeat(actor)}>
            {t('poker.handover.reveal')}
          </button>
        </div>
      </div>
    );
  }

  // The seat whose hole cards the local screen may reveal (confirmed human, or none).
  const seat = viewerFor(state, viewerSeat);
  const view = pokerRedactStateFor(state, seat);
  return <PokerGameScreen state={view} mySeat={seat} apply={apply} onExit={onExit} />;
}
