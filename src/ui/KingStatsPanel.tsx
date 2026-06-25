import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { apiBaseFromWsUrl, fetchMe } from '../net/profileApi';
import {
  fetchKingStats, fetchKingLeaderboard,
  type KingStats, type LeaderboardEntry, type Loadable,
} from '../net/statsApi';
import StatsPanel from './components/StatsPanel';
import LeaderboardPanel from './components/LeaderboardPanel';

interface Props {
  /** The WebSocket server URL the menu already resolved — API shares its host. */
  serverUrl: string;
}

type Tab = 'stats' | 'leaderboard';

/**
 * Collapsible "Statistics" section for the start menu (Stage 5.1). OPTIONAL and
 * non-blocking: it only talks to the server when opened, and every failure mode
 * (no DB, no session, offline) degrades to a soft message — play never depends
 * on it. Mirrors AccountPanel's inline-collapsible pattern so the first screen
 * stays uncluttered (collapsed by default).
 */
export default function KingStatsPanel({ serverUrl }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('stats');

  const [stats, setStats] = useState<Loadable<KingStats> | null>(null);
  const [board, setBoard] = useState<Loadable<LeaderboardEntry[]> | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const loadedOnce = useRef(false);

  const base = apiBaseFromWsUrl(serverUrl);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try { setStats(await fetchKingStats(base)); } finally { setLoadingStats(false); }
  }, [base]);

  const loadBoard = useCallback(async () => {
    setLoadingBoard(true);
    try { setBoard(await fetchKingLeaderboard(base)); } finally { setLoadingBoard(false); }
  }, [base]);

  // On first open, hydrate identity (for "me" highlight) + both datasets.
  useEffect(() => {
    if (!open || loadedOnce.current) return;
    loadedOnce.current = true;
    void (async () => {
      const me = await fetchMe(base);
      setMeId(me?.user?.id ?? null);
    })();
    void loadStats();
    void loadBoard();
  }, [open, base, loadStats, loadBoard]);

  function refresh() {
    if (tab === 'stats') void loadStats();
    else void loadBoard();
  }

  return (
    <div className="stats-section">
      <button className="btn btn--ghost btn--small stats-section__toggle"
        onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        📊 {t('stats.title')} {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className="stats-section__body">
          <div className="stats-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'stats'}
              className={`stats-tab ${tab === 'stats' ? 'stats-tab--active' : ''}`}
              onClick={() => setTab('stats')}>
              {t('stats.myStats')}
            </button>
            <button role="tab" aria-selected={tab === 'leaderboard'}
              className={`stats-tab ${tab === 'leaderboard' ? 'stats-tab--active' : ''}`}
              onClick={() => setTab('leaderboard')}>
              {t('stats.leaderboard')}
            </button>
            <button className="btn btn--ghost btn--small stats-refresh"
              onClick={refresh} disabled={loadingStats || loadingBoard}
              aria-label={t('stats.refresh')} title={t('stats.refresh')}>
              ↻
            </button>
          </div>

          <div className="stats-tabpanel" role="tabpanel">
            {tab === 'stats'
              ? <StatsPanel result={stats} loading={loadingStats} />
              : <LeaderboardPanel result={board} loading={loadingBoard} currentUserId={meId} />}
          </div>
        </div>
      )}
    </div>
  );
}
