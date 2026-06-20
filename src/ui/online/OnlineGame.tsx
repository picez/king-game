import type { ReactNode } from 'react';
import { GameContext } from '../../hooks/useGame';
import { useNetworkGame } from '../../hooks/useNetworkGame';
import type { OnlineIntent } from '../../hooks/useNetworkGame';
import { getActingPlayerId } from '../../core/gameEngine';
import { isJoinError } from '../../net/online';
import type { ErrorCode } from '../../net/messages';
import { clearSession } from '../../net/session';
import { useI18n } from '../../i18n';
import GameRouter from '../GameRouter';
import Lobby from './Lobby';
import OnlineWaitingScreen from './OnlineWaitingScreen';

const JOIN_ERR_CODES = new Set(['ROOM_NOT_FOUND', 'ROOM_FULL', 'BAD_PASSWORD', 'NAME_TAKEN', 'GAME_ALREADY_STARTED']);

interface Props {
  url: string;
  intent: OnlineIntent;
  /** Return to the menu. A join error code is passed back so the menu can
   *  highlight the offending field. */
  onExit: (joinError?: ErrorCode) => void;
}

const PUBLIC_STATUSES = new Set(['trick_complete', 'round_scoring', 'game_finished']);

/**
 * Online game root. Connects via useNetworkGame, shows the lobby until the
 * game starts, then renders the shared game screens. A client sees the action
 * screen only on its own turn; otherwise a read-only waiting view. Each client
 * receives only its own hand (server-side redaction).
 */
export default function OnlineGame({ url, intent, onExit }: Props) {
  const net = useNetworkGame(url, intent);
  const { t } = useI18n();
  const errText = (code: ErrorCode | null) => t(code && JOIN_ERR_CODES.has(code) ? `err.${code}` : 'err.generic');

  if (net.status === 'connecting') {
    return <CenterNote title={t('net.connecting')} sub={url} />;
  }

  if (net.status === 'error') {
    const joinRejected = isJoinError(net.errorCode);
    const title = joinRejected ? t('net.joinFailTitle') : t('net.problemTitle');
    const sub = net.errorCode ? errText(net.errorCode) : (net.error ?? t('err.generic'));
    return (
      <CenterNote title={title} sub={sub}>
        <div className="button-row">
          <button
            className="btn btn--primary"
            onClick={() => onExit(joinRejected ? (net.errorCode ?? undefined) : undefined)}
          >
            {joinRejected ? t('net.backRetry') : t('btn.backToMenu')}
          </button>
          {!joinRejected && (
            <button className="btn btn--ghost" onClick={() => { clearSession(); onExit(); }}>
              {t('net.forgetSaved')}
            </button>
          )}
        </div>
      </CenterNote>
    );
  }

  if (net.status === 'disconnected') {
    return (
      <CenterNote title={t('net.reconnecting')} sub={t('net.reconnectingSub')}>
        <button className="btn btn--ghost" onClick={() => onExit()}>{t('btn.backToMenu')}</button>
      </CenterNote>
    );
  }

  if (net.status === 'kicked') {
    // Host removed this client from the lobby. Show a clear message; the menu
    // also surfaces err.KICKED_BY_HOST when we exit.
    return (
      <CenterNote title={t('lobby.title')} sub={t('err.KICKED_BY_HOST')}>
        <button className="btn btn--primary" onClick={() => onExit('KICKED_BY_HOST')}>
          {t('btn.backToMenu')}
        </button>
      </CenterNote>
    );
  }

  // Lobby (room exists, game not started yet).
  if (net.room && !net.room.started) {
    return (
      <Lobby
        room={net.room}
        isHost={net.isHost}
        myPlayerId={net.myPlayerId}
        myClientId={net.myClientId}
        onStart={net.startGame}
        onLeave={() => { net.leave(); onExit(); }}
        onKick={net.kick}
        error={net.error}
      />
    );
  }

  // Game started but the first authoritative state has not arrived yet.
  if (!net.state) {
    return <CenterNote title={t('net.dealing')} />;
  }

  const status = net.state.status;
  const isPublic = PUBLIC_STATUSES.has(status);
  const actorId = getActingPlayerId(net.state);
  const showAction = isPublic || actorId === net.myPlayerId;
  const exitToMenu = () => { net.leave(); onExit(); };

  return (
    <GameContext.Provider value={{ state: net.state, dispatch: net.dispatch, online: true, onExit: exitToMenu }}>
      {showAction ? <GameRouter /> : <OnlineWaitingScreen myPlayerId={net.myPlayerId} />}
    </GameContext.Provider>
  );
}

function CenterNote({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="screen center-screen">
      <div className="modal-card">
        <h2>{title}</h2>
        {sub && <p className="modal-card__sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}
