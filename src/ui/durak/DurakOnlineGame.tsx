import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import DurakGameScreen from './DurakGameScreen';
import DurakFinished from './DurakFinished';
import type { DurakAction, DurakState } from '../../games/durak/types';

interface Props {
  /** The server's redacted Durak state (own hand visible, opponents hidden). */
  state: DurakState;
  myPlayerId: string | null;
  /** Sends a DurakAction over the network (ACTION_REQUEST). */
  dispatch: (a: DurakAction) => void;
  onExit: () => void;
  /** Seats whose human is offline (for offline badges / "AI may play" hints). */
  disconnectedSeats?: number[];
}

/**
 * Online Durak adapter (Stage 9.6 — experimental). Reuses the local
 * DurakGameScreen, but actions go through the network and bots/other players are
 * driven by the server. Renders nothing King-specific (no GameRouter).
 */
export default function DurakOnlineGame({ state, myPlayerId, dispatch, onExit, disconnectedSeats }: Props) {
  const { t } = useI18n();
  const me = myPlayerId ? state.players.find((p) => p.id === myPlayerId) : null;

  if (!me) {
    // Spectator / unseated: minimal read-only note (Durak MVP is player-only).
    return <CenterNote title={t('gameType.durak')} sub={t('durak.spectating')} />;
  }
  if (state.status === 'finished') {
    return <DurakFinished state={state} humanId={me.id} onPlayAgain={onExit} onExit={onExit} />;
  }
  return (
    <DurakGameScreen state={state} humanId={me.id} apply={dispatch} onExit={onExit} disconnectedSeats={disconnectedSeats} />
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
