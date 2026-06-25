import { useI18n } from '../../i18n';
import { type LeaderboardEntry, type Loadable, winRatePct } from '../../net/statsApi';

interface Props {
  result: Loadable<LeaderboardEntry[]> | null;
  loading: boolean;
  /** Highlight the signed-in user's own row, if present. */
  currentUserId?: string | null;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Compact, mobile-first King leaderboard (public data only: rank, display name,
 * games played, wins, win rate). A vertical row list — NO wide table — so it
 * never overflows on 360/390 and stays correct under RTL.
 */
export default function LeaderboardPanel({ result, loading, currentUserId }: Props) {
  const { t } = useI18n();

  if (loading && !result) return <p className="stats-msg">{t('net.connecting')}…</p>;
  if (!result) return null;
  if (result.state === 'unavailable') return <p className="stats-msg">{t('stats.unavailable')}</p>;
  if (result.state === 'unauthenticated') return <p className="stats-msg">{t('stats.unavailable')}</p>;
  if (result.state === 'error') return <p className="stats-msg">{t('stats.error')}</p>;

  const rows = result.data;
  if (rows.length === 0) return <p className="stats-msg stats-msg--soft">{t('stats.noGames')}</p>;

  return (
    <ol className="leaderboard" aria-label={t('stats.leaderboard')}>
      <li className="leaderboard__head" aria-hidden="true">
        <span className="lb-rank">#</span>
        <span className="lb-name">{t('stats.player')}</span>
        <span className="lb-num">{t('stats.gpShort')}</span>
        <span className="lb-num">{t('stats.wShort')}</span>
        <span className="lb-num">{t('stats.wrShort')}</span>
      </li>
      {rows.map((r, i) => {
        const rate = winRatePct(r.gamesWon, r.gamesPlayed);
        const me = !!currentUserId && r.userId === currentUserId;
        return (
          <li key={r.userId || i} className={`leaderboard__row ${me ? 'leaderboard__row--me' : ''}`}>
            <span className="lb-rank">{i < 3 ? MEDALS[i] : i + 1}</span>
            <span className="lb-name" title={r.displayName ?? t('stats.anonymous')}>
              {r.displayName ?? t('stats.anonymous')}
              {me && <span className="lb-you"> {t('lobby.you')}</span>}
            </span>
            <span className="lb-num">{r.gamesPlayed}</span>
            <span className="lb-num">{r.gamesWon}</span>
            <span className="lb-num">{rate == null ? '—' : `${rate}%`}</span>
          </li>
        );
      })}
    </ol>
  );
}
