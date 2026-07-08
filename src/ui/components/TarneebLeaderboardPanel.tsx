import { useI18n } from '../../i18n';
import { type TarneebLeaderboardEntry, type Loadable } from '../../net/statsApi';

interface Props {
  result: Loadable<TarneebLeaderboardEntry[]> | null;
  loading: boolean;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Compact, mobile-first Tarneeb leaderboard (TARNEEB-STATS-4). Public data only:
 * rank, avatar, name, games, wins, win rate + contract success. Two-line rows (no
 * wide table) so it never overflows on 360/390 and stays correct under RTL. The
 * caller's own row is highlighted via the server `self` flag (no user id reaches
 * the client).
 */
export default function TarneebLeaderboardPanel({ result, loading }: Props) {
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
      {rows.map((r, i) => (
        <li key={i} className={`lb-row ${r.self ? 'lb-row--me' : ''}`}>
          <span className="lb-rank">{i < 3 ? MEDALS[i] : i + 1}</span>
          <span className="lb-av" aria-hidden="true">{r.avatar ?? '👤'}</span>
          <span className="lb-main">
            <span className="lb-line">
              <span className="lb-name" title={r.displayName ?? t('stats.anonymous')}>
                {r.displayName ?? t('stats.anonymous')}
                {r.self && <span className="lb-you"> {t('lobby.you')}</span>}
              </span>
              <span className="lb-wr">{r.winRate == null ? '—' : `${r.winRate}%`}</span>
            </span>
            <span className="lb-meta">
              {r.gamesPlayed} {t('stats.gpShort')} · {r.gamesWon} {t('stats.wShort')}
              {' · '}{t('stats.contractShort')} {r.contractSuccessRate == null ? '—' : `${r.contractSuccessRate}%`}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
