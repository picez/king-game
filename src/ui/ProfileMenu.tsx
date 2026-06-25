import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { apiBaseFromWsUrl } from '../net/profileApi';
import {
  fetchKingStats, fetchKingLeaderboard,
  type KingStats, type LeaderboardEntry, type Loadable,
} from '../net/statsApi';
import AccountPanel from './AccountPanel';
import StatsPanel from './components/StatsPanel';
import LeaderboardPanel from './components/LeaderboardPanel';

interface Props {
  serverUrl: string;
  name: string;
  onName: (v: string) => void;
  avatar: string;
  onAvatar: (v: string) => void;
  defaultTimer: number;
  onDefaultTimer: (v: number) => void;
}

type Tab = 'profile' | 'stats' | 'leaderboard';

/**
 * Unified, collapsible Profile / Statistics / Leaderboard menu (Stage 7).
 * Replaces the two separate AccountPanel + KingStatsPanel toggles with one
 * casino/felt panel that uses a segmented control. Collapsed by default (the
 * first screen stays uncluttered); each stats dataset is lazy-loaded the first
 * time its tab is shown. All prior functionality is preserved (Google sign-in,
 * avatar/nickname/language, default timer, stats + leaderboard).
 */
export default function ProfileMenu(props: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('profile');
  const [stats, setStats] = useState<Loadable<KingStats> | null>(null);
  const [board, setBoard] = useState<Loadable<LeaderboardEntry[]> | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const statsOnce = useRef(false);
  const boardOnce = useRef(false);

  const base = apiBaseFromWsUrl(props.serverUrl);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try { setStats(await fetchKingStats(base)); } finally { setLoadingStats(false); }
  }, [base]);
  const loadBoard = useCallback(async () => {
    setLoadingBoard(true);
    try { setBoard(await fetchKingLeaderboard(base)); } finally { setLoadingBoard(false); }
  }, [base]);

  // Lazy-load each dataset when its tab is first opened.
  useEffect(() => {
    if (!open) return;
    if (tab === 'stats' && !statsOnce.current) { statsOnce.current = true; void loadStats(); }
    if (tab === 'leaderboard' && !boardOnce.current) { boardOnce.current = true; void loadBoard(); }
  }, [open, tab, loadStats, loadBoard]);

  // After an OAuth redirect, auto-open on the Profile tab so the banner shows.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const login = new URLSearchParams(window.location.search).get('login');
    if (login === 'success' || login === 'error') { setOpen(true); setTab('profile'); }
  }, []);

  function refresh() {
    if (tab === 'stats') void loadStats();
    else if (tab === 'leaderboard') void loadBoard();
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'profile', label: t('account.title') },
    { key: 'stats', label: t('stats.myStats') },
    { key: 'leaderboard', label: t('stats.leaderboard') },
  ];

  return (
    <div className="profile-menu">
      <button className="btn btn--ghost btn--small profile-menu__toggle"
        onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        👤 {t('account.title')} · 📊 {t('stats.title')} {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className="profile-menu__body">
          <div className="segmented" role="tablist">
            {tabs.map((tb) => (
              <button key={tb.key} role="tab" aria-selected={tab === tb.key}
                className={`segmented__tab ${tab === tb.key ? 'segmented__tab--active' : ''}`}
                onClick={() => setTab(tb.key)}>
                {tb.label}
              </button>
            ))}
            {(tab === 'stats' || tab === 'leaderboard') && (
              <button className="btn btn--ghost btn--small profile-menu__refresh"
                onClick={refresh} disabled={loadingStats || loadingBoard}
                aria-label={t('stats.refresh')} title={t('stats.refresh')}>↻</button>
            )}
          </div>

          <div className="profile-menu__panel" role="tabpanel">
            {tab === 'profile' && <AccountPanel {...props} embedded />}
            {tab === 'stats' && <StatsPanel result={stats} loading={loadingStats} />}
            {tab === 'leaderboard' && <LeaderboardPanel result={board} loading={loadingBoard} />}
          </div>
        </div>
      )}
    </div>
  );
}
