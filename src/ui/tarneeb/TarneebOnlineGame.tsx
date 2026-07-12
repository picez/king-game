import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import TarneebGameScreen from './TarneebGameScreen';
import TarneebFinished from './TarneebFinished';
import type { RematchUi } from '../online/RematchControls';
import { useTrickReview } from '../components/useTrickReview';
import type { TarneebAction, TarneebState } from '../../games/tarneeb/types';

interface Props {
  /** The server's redacted Tarneeb state (own hand visible, opponents hidden). */
  state: TarneebState;
  myPlayerId: string | null;
  /** Sends a TarneebAction over the network (ACTION_REQUEST). */
  dispatch: (a: TarneebAction) => void;
  onExit: () => void;
  /** Seats whose human is offline (for offline badges / "AI may play" hints). */
  disconnectedSeats?: number[];
  /** Online rematch controls (Stage 25.9). */
  rematch?: RematchUi | null;
}

/**
 * Online Tarneeb adapter (released, Stage 10.8). Reuses the shared
 * TarneebGameScreen, but actions go over the network and bots / other players +
 * the public hand_complete advance (START_NEXT_HAND) are driven by the SERVER —
 * this component never dispatches them. Renders nothing King-specific (no
 * GameRouter) and holds no local state. The `online` flag makes the screen
 * read-only when it is not this client's turn and hides the "Next hand" button.
 */
export default function TarneebOnlineGame({ state, myPlayerId, dispatch, onExit, disconnectedSeats, rematch }: Props) {
  const { t } = useI18n();
  const me = myPlayerId ? state.players.find((p) => p.id === myPlayerId) : null;
  // 2 s reveal after each trick (Stage 27.0) — online resolves the trick inside PLAY_CARD (no
  // server trick_complete screen), so hold the last completed trick client-side, in sync.
  const reviewTrick = useTrickReview(state.completedTricks, state.phase === 'playing');

  if (!me) {
    // Spectator / unseated: minimal read-only note (Tarneeb MVP is player-only).
    return <CenterNote title={t('gameType.tarneeb')} sub={t('tarneeb.spectating')} />;
  }
  if (state.phase === 'game_finished') {
    return <TarneebFinished state={state} humanSeat={me.seatIndex} onPlayAgain={onExit} onExit={onExit} rematch={rematch} />;
  }
  return (
    <TarneebGameScreen
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
