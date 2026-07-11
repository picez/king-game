import { useI18n } from '../../i18n';
import type { RoomSnapshot } from '../../net/messages';
import type { RematchProgress } from '../../hooks/useNetworkGame';

/**
 * Rematch / "Play again" controls for an ONLINE finish screen (Stage 25.9). Replaces the old
 * behaviour where online "Play again" quietly left the room. It reads the shared rematch state:
 *  - one human (rest bots) → "Play again" restarts immediately (bots are always ready);
 *  - multiple humans → "Play again" marks READY; others see "<name> wants a rematch"; when
 *    everyone is ready the server restarts the same game. Cancel drops readiness.
 * Presentational only — all decisions are server-authoritative; this just sends READY/DECLINE.
 */
export interface RematchUi {
  /** Latest rematch progress (net.rematch), or null before anyone readies. */
  progress: RematchProgress | null;
  /** Room members (net.room.members) — for names + the connected-human count. */
  members: RoomSnapshot['members'];
  /** This client's id (to know if I have readied). */
  myClientId: string | null;
  onReady: () => void;
  onDecline: () => void;
}

export default function RematchControls({ progress, members, myClientId, onReady, onDecline }: RematchUi) {
  const { t } = useI18n();
  const humans = members.filter((m) => m.role === 'player' && m.type === 'human' && m.connected);
  const needed = humans.length;
  const soloOrBots = needed <= 1;
  const ready = progress?.ready ?? [];
  const iAmReady = !!myClientId && ready.includes(myClientId);
  const readyOtherNames = members.filter((m) => m.clientId !== myClientId && ready.includes(m.clientId)).map((m) => m.name);
  const waitingFor = Math.max(0, needed - ready.length);

  if (!iAmReady) {
    return (
      <div className="rematch">
        {readyOtherNames.length > 0 && (
          <p className="rematch__note">🔁 {readyOtherNames.join(', ')} {t('rematch.wantsToPlay')}</p>
        )}
        <button type="button" className="btn btn--primary" onClick={onReady}>🔁 {t('rematch.playAgain')}</button>
      </div>
    );
  }

  return (
    <div className="rematch">
      <p className="rematch__note">
        {soloOrBots || waitingFor === 0
          ? `⏳ ${t('rematch.starting')}`
          : `⏳ ${t('rematch.waitingFor')} ${ready.length}/${needed}`}
      </p>
      {!soloOrBots && waitingFor > 0 && (
        <button type="button" className="btn btn--ghost btn--small" onClick={onDecline}>{t('rematch.cancel')}</button>
      )}
    </div>
  );
}
