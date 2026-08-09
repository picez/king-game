import { useCallback, useEffect, useRef, useState } from 'react';
import { pokerReducer } from '../../games/poker/engine';
import { pokerBotAction } from '../../games/poker/ai';
import { getActingPokerSeat } from '../../games/poker/rules';
import { pokerRedactStateFor } from '../../games/poker/redact';
import { localBotNames } from '../../games/botIdentities';
import { useI18n } from '../../i18n';
import type { PlayerType } from '../../models/types';
import type { PokerAction, PokerState } from '../../games/poker/types';
import PokerSetup, { type PokerSeatConfig, type PokerLocalOptions } from './PokerSetup';
import PokerGameScreen from './PokerGameScreen';
import PokerFinished from './PokerFinished';
import PokerActionLog from './PokerActionLog';
import PokerRebuyPanel from './PokerRebuyPanel';
import { rebuyWindowOf, rebuyAmount } from '../../games/poker/rules';
import { needsHandover, viewerFor } from './passAndPlay';

/** Pause between bot moves so humans can follow the betting unfold. */
const BOT_DELAY_MS = 750;

/**
 * Local poker (No-Limit Texas Hold'em) — true PASS-AND-PLAY (§14). Any valid mix of
 * 2–6 human/bot seats. Owns the pure state via `pokerReducer`; bots auto-play ONLY on
 * AI seats.
 *
 * Stage 38.0.2 handover policy (owner-confirmed). The handover is a PRIVACY step
 * between two humans, not a per-turn ritual:
 *   • ONE human + bots → no handover screen at all; that human is the stable local
 *     viewer and keeps their hole cards across every bot turn.
 *   • Two or more humans → the confirmation STICKS to its seat, so human A → bots → A
 *     never re-prompts, while A → bots → B (and A → B) shows the handover for B and
 *     A's hand is already hidden. While a bot acts, no human's hand is on screen.
 * The confirmed seat is tracked separately from the redacted viewer (`viewerFor`), so a
 * bot interval can restore the same human automatically without ever revealing another.
 * Fully separate from online state.
 */
export default function PokerLocalGame({ onExit }: { onExit: () => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<PokerState | null>(null);
  /** The LAST human seat that confirmed the handover (null = nobody holds the device yet). */
  const [confirmedSeat, setConfirmedSeat] = useState<number | null>(null);
  const apply = useCallback((action: PokerAction) => setState((s) => pokerReducer(s, action)), []);

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

  function start(seats: PokerSeatConfig[], opts: PokerLocalOptions) {
    // Assign bot identities to the AI seats; humans keep their chosen names (which may
    // duplicate — the acting human is always resolved by SEAT, never by name).
    const takenNames = seats.filter((s) => s.type === 'human').map((s) => s.name);
    const botNames = localBotNames('poker', seats.filter((s) => s.type === 'ai').length, takenNames);
    let b = 0;
    const playerNames = seats.map((s) => (s.type === 'human' ? s.name : botNames[b++]));
    const playerTypes: PlayerType[] = seats.map((s) => s.type);
    // A fresh match never inherits a stale confirmation from the previous one.
    setConfirmedSeat(null);
    // Local free sandbox (§16 C): the chosen starting stack flows into the SAME pure
    // reducer — bots get the same stack; blinds stay 10/20; NO wallet is touched.
    apply({
      type: 'START_GAME', playerNames, playerTypes, playerCount: seats.length,
      options: { startingStack: opts.startingStack, mode: 'local_free' },
    });
  }

  function playAgain() {
    setState(null);
    setConfirmedSeat(null);
  }

  if (!state) return <PokerSetup onStart={start} onExit={onExit} />;
  if (state.phase === 'game_finished') {
    // Shared device: show the winner neutrally (no single "you"); reveal nothing private.
    return <PokerFinished state={pokerRedactStateFor(state, null)} mySeat={null} onPlayAgain={playAgain} onExit={onExit} />;
  }

  // Handover: shown ONLY when the device really changes hands between two humans —
  // the previous player's hand is already hidden and never seen by the next (§14).
  // The acting human is resolved by SEAT (duplicate names are safe).
  if (needsHandover(state, confirmedSeat)) {
    const actor = state.toActSeat;
    return (
      <div className="screen poker-handover">
        <div className="poker-handover__card">
          <p className="poker-handover__title">{t('poker.handover.title')}</p>
          <p className="poker-handover__pass">{t('poker.handover.pass').replace('{name}', state.players[actor].name)}</p>
          <p className="poker-handover__body">{t('poker.handover.body')}</p>
          <button type="button" className="btn btn--primary" onClick={() => setConfirmedSeat(actor)}>
            {t('poker.handover.reveal')}
          </button>
        </div>
      </div>
    );
  }

  // The seat whose hole cards the local screen may reveal (solo human, the confirmed
  // human actor, or none).
  const seat = viewerFor(state, confirmedSeat);
  const view = pokerRedactStateFor(state, seat);
  // Local has no RoomSocial, so the SAME compact history control rides in the shared
  // in-flow social dock between the table and the action row (Stage 38.0.3) — a fixed
  // corner cluster provably covered the betting controls on a phone.
  // §17 LOCAL rebuy: free, and the device owner decides for EVERY busted seat — human or
  // bot — so a solo player can keep a bot in the game. No wallet, no network, no DB.
  const win = rebuyWindowOf(view);
  const rebuySlot = win ? (
    <PokerRebuyPanel
      state={view}
      amount={rebuyAmount(view)}
      actionableSeats={win.eligibleSeats}
      onRebuy={(s) => apply({ type: 'REBUY', seat: s })}
      onDecline={(s) => apply({ type: 'DECLINE_REBUY', seat: s })}
      onContinue={() => apply({ type: 'CLOSE_REBUY_WINDOW' })}
    />
  ) : null;

  return (
    <PokerGameScreen
      state={view} mySeat={seat} apply={apply} onExit={onExit}
      rebuySlot={rebuySlot}
      socialSlot={
        <div className="room-social">
          <div className="room-social__bar">
            <PokerActionLog state={view} variant="standalone" docked />
          </div>
        </div>
      }
    />
  );
}
