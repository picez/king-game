import { useI18n } from '../../i18n';
import type { RoomVoice } from '../../voice/useRoomVoice';

interface Props {
  voice: RoomVoice;
  /** 'card' = the Lobby control (full); 'compact' = the in-game mic button. */
  variant?: 'card' | 'compact';
}

/** A short peer connection-state label ('' when connected/no issue). */
function connLabel(peers: RoomVoice['peers']): string {
  return peers.some((p) => p.connState === 'connecting' || p.connState === 'new') ? '…'
    : peers.some((p) => p.connState === 'failed' || p.connState === 'disconnected') ? '!'
      : '';
}

/**
 * Voice chat control (Stage 25.4). Opt-in: nothing happens until the user taps Join voice
 * (which prompts for the mic). Shows unsupported / permission-denied / connecting states and
 * a "Tap to enable audio" fallback when the browser blocks autoplay. Text chat is unaffected.
 */
export default function VoiceControl({ voice, variant = 'card' }: Props) {
  const { t } = useI18n();

  if (!voice.supported) {
    return variant === 'card'
      ? <p className="voice-card voice-card--muted field__hint">🎙️ {t('voice.notSupported')}</p>
      : null;
  }

  // ── compact (in-game): a single mic button + peer badge ───────────────────
  if (variant === 'compact') {
    if (voice.status === 'error') return null;
    const joined = voice.status === 'joined';
    return (
      <button
        type="button"
        className={`social-fab voice-fab ${joined ? 'voice-fab--on' : ''} ${voice.muted ? 'voice-fab--muted' : ''}`}
        aria-label={!joined ? t('voice.join') : voice.muted ? t('voice.unmute') : t('voice.mute')}
        title={!joined ? t('voice.join') : voice.muted ? t('voice.unmute') : t('voice.mute')}
        onClick={() => (!joined ? voice.join() : voice.toggleMute())}
      >
        {!joined ? '🎙️' : voice.muted ? '🔇' : '🎤'}
        {joined && voice.peers.length > 0 && <span className="voice-fab__count">{voice.peers.length}</span>}
      </button>
    );
  }

  // ── card (lobby): full controls ───────────────────────────────────────────
  return (
    <div className="voice-card">
      <div className="voice-card__head">
        <span className="voice-card__title">🎙️ {t('voice.title')}</span>
        {voice.status === 'idle' && <span className="voice-card__off field__hint">{t('voice.off')}</span>}
      </div>

      {voice.error === 'permission' && <p className="lobby-error voice-card__err">{t('voice.permissionDenied')}</p>}

      {voice.status === 'idle' || voice.status === 'error' ? (
        <button type="button" className="btn btn--primary btn--small" onClick={voice.join}>
          🎙️ {t('voice.join')}
        </button>
      ) : (
        <>
          <div className="voice-card__row">
            <button type="button" className="btn btn--outline btn--small" onClick={voice.toggleMute}>
              {voice.muted ? `🔇 ${t('voice.unmute')}` : `🎤 ${t('voice.mute')}`}
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={voice.leave}>
              {t('voice.leave')}
            </button>
            <span className="voice-card__status field__hint">
              {voice.status === 'requesting' ? t('voice.connecting') : `${t('voice.connected')} · ${voice.peers.length}${connLabel(voice.peers)}`}
            </span>
          </div>
          {voice.audioBlocked && (
            <button type="button" className="btn btn--outline btn--small" onClick={voice.enableAudio}>
              🔈 {t('voice.enableAudio')}
            </button>
          )}
          {voice.peers.length > 0 && (
            <ul className="voice-peers">
              {voice.peers.map((p) => (
                <li key={p.clientId} className="voice-peer">
                  <span className="voice-peer__name">{p.name}</span>
                  <span className="voice-peer__state field__hint">
                    {p.muted ? '🔇' : '🎤'}{p.connState === 'failed' || p.connState === 'disconnected' ? ` ${t('voice.failed')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
