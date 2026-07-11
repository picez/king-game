import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import DebercGameScreen from './DebercGameScreen';
import DebercFinished from './DebercFinished';
import type { RematchUi } from '../online/RematchControls';
import type { DebercAction, DebercState } from '../../games/deberc/types';

interface Props {
  /** The server's redacted Deberc state (own hand visible, opponents hidden). */
  state: DebercState;
  myPlayerId: string | null;
  /** Sends a DebercAction over the network (ACTION_REQUEST). */
  dispatch: (a: DebercAction) => void;
  onExit: () => void;
  /** Seats whose human is offline (for offline badges). */
  disconnectedSeats?: number[];
  /** Online rematch controls (Stage 25.9). */
  rematch?: RematchUi | null;
}

/**
 * Online Deberc adapter. Reuses the shared DebercGameScreen, but actions go over
 * the network and bots / other players + the public-screen advances (NEXT_TRICK /
 * NEXT_HAND) are driven by the server — this component never dispatches them.
 */
export default function DebercOnlineGame({ state, myPlayerId, dispatch, onExit, disconnectedSeats, rematch }: Props) {
  const { t } = useI18n();
  const me = myPlayerId ? state.players.find((p) => p.id === myPlayerId) : null;

  if (!me) {
    return <CenterNote title={t('gameType.deberc')} sub={t('deberc.spectating')} />;
  }
  if (state.phase === 'finished') {
    return <DebercFinished state={state} humanId={me.id} onPlayAgain={onExit} onExit={onExit} rematch={rematch} />;
  }
  return (
    <DebercGameScreen state={state} humanId={me.id} apply={dispatch} onExit={onExit} disconnectedSeats={disconnectedSeats} />
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
