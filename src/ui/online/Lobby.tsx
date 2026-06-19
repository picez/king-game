import type { RoomSnapshot } from '../../net/messages';
import { useI18n } from '../../i18n';

interface Props {
  room: RoomSnapshot;
  isHost: boolean;
  myPlayerId: string | null;
  onStart: () => void;
  onLeave: () => void;
  error: string | null;
}

/**
 * Minimal lobby: shows the room code to share, the members, and (for the host)
 * a Start button enabled once enough players have joined.
 */
export default function Lobby({ room, isHost, myPlayerId, onStart, onLeave, error }: Props) {
  const { t } = useI18n();
  const players = room.members.filter((m) => m.role === 'player');
  const enough = players.length === room.playerCount;

  return (
    <div className="screen setup-screen">
      <h1 className="screen__title">{t('lobby.title')}</h1>

      <div className="setup-card">
        <div className="field-group">
          <label>{t('lobby.share')}</label>
          <div className="room-code">
            {room.code}{room.hasPassword && <span className="room-lock" title="🔒"> 🔒</span>}
          </div>
          <p className="setup-hint">
            {players.length} / {room.playerCount} {t('lobby.playersWord')} ·{' '}
            {room.modeSelectionType === 'dealer_choice' ? t('form.dealerChoice') : t('form.fixedOrder')}
            {room.hasPassword ? ` · 🔒 ${t('lobby.passwordRequired')}` : ''}
          </p>
        </div>

        <div className="field-group">
          <label>{t('lobby.players')}</label>
          <ul className="lobby-members">
            {room.members.map((m) => {
              const isMe = `player-${m.seatIndex}` === myPlayerId;
              return (
                <li key={m.clientId} className="lobby-member">
                  <span className="lobby-member__name">
                    {m.name}{isMe ? ` ${t('lobby.you')}` : ''}
                  </span>
                  <span className="lobby-member__tags">
                    {m.isHost && <span className="tag tag--host">{t('lobby.host')}</span>}
                    {m.role === 'spectator' && <span className="tag">{t('lobby.spectator')}</span>}
                    <span className={`tag ${m.connected ? 'tag--ok' : 'tag--off'}`}>
                      {m.connected ? t('lobby.online') : t('lobby.offline')}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {error && <p className="lobby-error">{error}</p>}

        {isHost ? (
          <button className="btn btn--primary btn--large" disabled={!enough} onClick={onStart}>
            {enough ? t('btn.start') : `${t('wait.waitingFor')} ${room.playerCount - players.length} ${t('lobby.waitingMore')}`}
          </button>
        ) : (
          <p className="setup-hint">{t('lobby.waitingHost')}</p>
        )}

        <button className="btn btn--ghost" onClick={onLeave}>{t('btn.leave')}</button>
      </div>
    </div>
  );
}
