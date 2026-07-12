import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import PreferansGameScreen from './PreferansGameScreen';
import PreferansFinished from './PreferansFinished';
import type { RematchUi } from '../online/RematchControls';
import { useTrickReview } from '../components/useTrickReview';
import type { PreferansAction, PreferansState } from '../../games/preferans/types';

interface Props {
  /** The server's redacted Preferans state (own hand visible, opponents hidden). */
  state: PreferansState;
  myPlayerId: string | null;
  /** Sends a PreferansAction over the network (ACTION_REQUEST). */
  dispatch: (a: PreferansAction) => void;
  onExit: () => void;
  /** Seats whose human is offline (for offline badges / "AI may play" hints). */
  disconnectedSeats?: number[];
  /** Online rematch controls (Stage 25.9). */
  rematch?: RematchUi | null;
}

/**
 * Online Preferans adapter (experimental, Stage 19.5). Reuses the shared
 * PreferansGameScreen, but actions go over the network and bots / other players +
 * the public hand_complete advance (START_NEXT_HAND) are driven by the SERVER —
 * this component never dispatches them, holds no local reducer/bot loop, and
 * renders nothing King-specific (no GameRouter). The `online` flag makes the
 * screen read-only when it is not this client's turn and hides "Next hand".
 */
export default function PreferansOnlineGame({ state, myPlayerId, dispatch, onExit, disconnectedSeats, rematch }: Props) {
  const { t } = useI18n();
  const me = myPlayerId ? state.players.find((p) => p.id === myPlayerId) : null;
  // 2 s reveal after each trick (Stage 27.0) — no server trick_complete screen, so hold it client-side.
  const reviewTrick = useTrickReview(state.completedTricks, state.phase === 'playing');

  if (!me) {
    // Spectator / unseated: minimal read-only note (Preferans MVP is player-only).
    return <CenterNote title={t('gameType.preferans')} sub={t('preferans.spectating')} />;
  }
  if (state.phase === 'game_finished') {
    return <PreferansFinished state={state} humanSeat={me.seatIndex} onPlayAgain={onExit} onExit={onExit} rematch={rematch} />;
  }
  return (
    <PreferansGameScreen
      state={state}
      humanSeat={me.seatIndex}
      apply={dispatch}
      onExit={onExit}
      reviewTrick={reviewTrick}
      online
      disconnectedSeats={disconnectedSeats}
    />
  );
}

function CenterNote({ title, sub }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="screen center-screen">
      <div className="modal-card">
        <h2>{title}</h2>
        {sub && <p className="modal-card__sub">{sub}</p>}
      </div>
    </div>
  );
}
