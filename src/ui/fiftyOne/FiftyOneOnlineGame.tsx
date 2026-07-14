import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import FiftyOneGameScreen from './FiftyOneGameScreen';
import FiftyOneFinished from './FiftyOneFinished';
import type { RematchUi } from '../online/RematchControls';
import type { FiftyOneAction, FiftyOneState } from '../../games/fiftyOne/types';

interface Props {
  /** The server's redacted 51 state (own hand visible, opponents/draw pile hidden). */
  state: FiftyOneState;
  myPlayerId: string | null;
  /** Sends a FiftyOneAction over the network (ACTION_REQUEST). */
  dispatch: (a: FiftyOneAction) => void;
  onExit: () => void;
  /**
   * Seats whose human is offline. Accepted for parity with the other online adapters
   * (OnlineGame passes it uniformly); the 51 scoreboard surfaces the acting player and
   * hand counts and does not yet render per-seat offline badges, so it is unused here.
   */
  disconnectedSeats?: number[];
  /** Online rematch controls (Stage 25.9 / 30.5). */
  rematch?: RematchUi | null;
}

/**
 * Online 51 adapter (Stage 30.5; released 30.7). Reuses the shared FiftyOneGameScreen,
 * but every action goes over the network (`dispatch` → ACTION_REQUEST) and the bots /
 * other players + the public `round_complete` advance (seeded START_NEXT_ROUND) are
 * driven by the SERVER — this component never dispatches them and holds no local
 * reducer/state. The `online` flag makes the screen read-only when it is not this
 * client's turn (the action bar disables off-turn) and replaces the "Next round"
 * button with a waiting note. Renders nothing King-specific (no GameRouter).
 */
export default function FiftyOneOnlineGame({ state, myPlayerId, dispatch, onExit, rematch }: Props) {
  const { t } = useI18n();
  const me = myPlayerId ? state.players.find((p) => p.id === myPlayerId) : null;

  if (!me) {
    // Spectator / unseated: minimal read-only note (51 MVP is player-only).
    return <CenterNote title={t('gameType.fifty-one')} sub={t('fiftyOne.spectating')} />;
  }
  if (state.phase === 'game_finished') {
    return <FiftyOneFinished state={state} humanSeat={me.seatIndex} onPlayAgain={onExit} onExit={onExit} rematch={rematch} />;
  }
  return (
    <FiftyOneGameScreen
      state={state}
      humanSeat={me.seatIndex}
      apply={dispatch}
      onExit={onExit}
      online
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
