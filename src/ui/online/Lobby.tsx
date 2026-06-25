import type { RoomSnapshot } from '../../net/messages';
import { useI18n } from '../../i18n';

interface Props {
  room: RoomSnapshot;
  isHost: boolean;
  myPlayerId: string | null;
  /** This client's connection id — used to never show "Kick" against yourself. */
  myClientId: string | null;
  onStart: () => void;
  onLeave: () => void;
  /** Host-only: remove another member (by clientId) before the game starts. */
  onKick: (clientId: string) => void;
  /** Host-only: add a server-side AI bot to a free seat before the game starts. */
  onAddBot: () => void;
  /** Host-only: set the per-turn timer (seconds; 0 = off). */
  onSetTimer: (turnTimerSec: number) => void;
  error: string | null;
}

const TIMER_OPTIONS = [0, 30, 60, 90];

/**
 * Minimal lobby: shows the room code to share, the members, and (for the host)
 * a Start button enabled once enough players have joined. The host can also
 * remove other members before the game starts.
 */
export default function Lobby({ room, isHost, myPlayerId, myClientId, onStart, onLeave, onKick, onAddBot, onSetTimer, error }: Props) {
  const { t } = useI18n();
  const players = room.members.filter((m) => m.role === 'player');
  const enough = players.length === room.playerCount;
  const hasFreeSeat = players.length < room.playerCount;

  function handleKick(clientId: string) {
    // The lobby is pre-start; a simple confirm is enough to avoid mis-taps.
    if (typeof window === 'undefined' || window.confirm(t('lobby.kickConfirm'))) onKick(clientId);
  }

  function handleLeave() {
    // A host leaving transfers the host role (or deletes an empty room), so
    // confirm to avoid a mis-tap. A non-host just frees their seat — leave now.
    if (isHost && typeof window !== 'undefined' && !window.confirm(t('lobby.leaveConfirm'))) return;
    onLeave();
  }

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
                <li key={m.clientId} className={`lobby-member ${m.type === 'human' && !m.connected ? 'lobby-member--offline' : ''}`}>
                  <span className="lobby-member__name">
                    {m.avatar && <span className="member-avatar">{m.avatar}</span>}
                    {m.name}{isMe ? ` ${t('lobby.you')}` : ''}
                  </span>
                  <span className="lobby-member__tags">
                    {m.isHost && <span className="tag tag--host">{t('lobby.host')}</span>}
                    {m.type === 'ai' && <span className="tag tag--bot" title={t('lobby.aiPlayer')}>🤖 {t('lobby.bot')}</span>}
                    {m.role === 'spectator' && <span className="tag">{t('lobby.spectator')}</span>}
                    {m.type !== 'ai' && (
                      <span className={`tag ${m.connected ? 'tag--ok' : 'tag--off'}`}>
                        {m.connected ? t('lobby.online') : t('lobby.offline')}
                      </span>
                    )}
                    {isHost && !room.started && m.clientId !== myClientId && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--small lobby-kick"
                        onClick={() => handleKick(m.clientId)}
                      >
                        {t('lobby.kick')}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {isHost && !room.started && hasFreeSeat && (
          <button className="btn btn--outline" onClick={onAddBot}>🤖 {t('lobby.addBot')}</button>
        )}

        {/* Per-turn timer (host sets; others see the current value). */}
        <div className="field-group">
          <label>⏱ {t('lobby.turnTimer')}</label>
          {isHost && !room.started ? (
            <div className="button-row">
              {TIMER_OPTIONS.map((sec) => (
                <button key={sec}
                  className={`btn btn--outline btn--small ${room.turnTimerSec === sec ? 'btn--active' : ''}`}
                  onClick={() => onSetTimer(sec)}>
                  {sec === 0 ? t('lobby.timerOff') : `${sec}s`}
                </button>
              ))}
            </div>
          ) : (
            <p className="setup-hint">{room.turnTimerSec === 0 ? t('lobby.timerOff') : `${room.turnTimerSec}s`}</p>
          )}
        </div>

        {error && <p className="lobby-error">{error}</p>}

        {isHost ? (
          <button className="btn btn--primary btn--large" disabled={!enough} onClick={onStart}>
            {enough ? t('btn.start') : `${t('wait.waitingFor')} ${room.playerCount - players.length} ${t('lobby.waitingMore')}`}
          </button>
        ) : (
          <p className="setup-hint">{t('lobby.waitingHost')}</p>
        )}

        <button className="btn btn--danger lobby-leave" onClick={handleLeave}>🚪 {t('lobby.leave')}</button>
      </div>
    </div>
  );
}
