import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { Account } from '../hooks/useAccount';
import {
  fetchKingStats, fetchKingLeaderboard, fetchDurakStats, fetchDurakLeaderboard,
  type KingStats, type DurakStats, type LeaderboardEntry, type DurakLeaderboardEntry, type Loadable,
} from '../net/statsApi';
import ProfilePanel from './menu/ProfilePanel';
import StatsPanel from './components/StatsPanel';
import DurakStatsPanel from './components/DurakStatsPanel';
import LeaderboardPanel from './components/LeaderboardPanel';
import DurakLeaderboardPanel from './components/DurakLeaderboardPanel';

interface Props {
  account: Account;
  name: string;
  onName: (v: string) => void;
  avatar: string;
  onAvatar: (v: string) => void;
  defaultTimer: number;
  onDefaultTimer: (v: number) => void;
}

type Tab = 'profile' | 'stats' | 'leaderboard';

/**
 * Secondary Profile / Statistics / Leaderboard drawer (Stage 7.1). A single
 * collapsible panel with a segmented control, kept OFF the first screen by
 * default so the main actions stay front-and-centre. Sign-in/out is NOT here
 * (that lives in the top AccountBar); the Profile tab holds settings only.
 */
export default function ProfileMenu({ account, name, onName, avatar, onAvatar, defaultTimer, onDefaultTimer }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('profile');
  const [statsGame, setStatsGame] = useState<'king' | 'durak'>('king');
  const [stats, setStats] = useState<Loadable<KingStats> | null>(null);
  const [durakStats, setDurakStats] = useState<Loadable<DurakStats> | null>(null);
  const [boardGame, setBoardGame] = useState<'king' | 'durak'>('king');
  const [board, setBoard] = useState<Loadable<LeaderboardEntry[]> | null>(null);
  const [durakBoard, setDurakBoard] = useState<Loadable<DurakLeaderboardEntry[]> | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingDurak, setLoadingDurak] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [loadingDurakBoard, setLoadingDurakBoard] = useState(false);
  const statsOnce = useRef(false);
  const durakOnce = useRef(false);
  const boardOnce = useRef(false);
  const durakBoardOnce = useRef(false);

  const base = account.base;

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try { setStats(await fetchKingStats(base)); } finally { setLoadingStats(false); }
  }, [base]);
  const loadDurakStats = useCallback(async () => {
    setLoadingDurak(true);
    try { setDurakStats(await fetchDurakStats(base)); } finally { setLoadingDurak(false); }
  }, [base]);
  const loadBoard = useCallback(async () => {
    setLoadingBoard(true);
    try { setBoard(await fetchKingLeaderboard(base)); } finally { setLoadingBoard(false); }
  }, [base]);
  const loadDurakBoard = useCallback(async () => {
    setLoadingDurakBoard(true);
    try { setDurakBoard(await fetchDurakLeaderboard(base)); } finally { setLoadingDurakBoard(false); }
  }, [base]);

  useEffect(() => {
    if (!open) return;
    if (tab === 'stats') {
      if (statsGame === 'king' && !statsOnce.current) { statsOnce.current = true; void loadStats(); }
      if (statsGame === 'durak' && !durakOnce.current) { durakOnce.current = true; void loadDurakStats(); }
    }
    if (tab === 'leaderboard') {
      if (boardGame === 'king' && !boardOnce.current) { boardOnce.current = true; void loadBoard(); }
      if (boardGame === 'durak' && !durakBoardOnce.current) { durakBoardOnce.current = true; void loadDurakBoard(); }
    }
  }, [open, tab, statsGame, boardGame, loadStats, loadDurakStats, loadBoard, loadDurakBoard]);

  function refresh() {
    if (tab === 'stats') void (statsGame === 'durak' ? loadDurakStats() : loadStats());
    else if (tab === 'leaderboard') void (boardGame === 'durak' ? loadDurakBoard() : loadBoard());
  }

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'profile', label: t('account.title') },
    { key: 'stats', label: t('stats.myStats') },
    { key: 'leaderboard', label: t('stats.leaderboard') },
  ];

  return (
    <div className="drawer">
      <button className="drawer__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>⚙️ {t('account.title')} · {t('stats.title')}</span>
        <span className="drawer__chev">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="drawer__body">
          <div className="segmented" role="tablist">
            {tabs.map((tb) => (
              <button key={tb.key} role="tab" aria-selected={tab === tb.key}
                className={`segmented__tab ${tab === tb.key ? 'segmented__tab--active' : ''}`}
                onClick={() => setTab(tb.key)}>
                {tb.label}
              </button>
            ))}
            {(tab === 'stats' || tab === 'leaderboard') && (
              <button className="drawer__refresh" onClick={refresh}
                disabled={loadingStats || loadingDurak || loadingBoard || loadingDurakBoard}
                aria-label={t('stats.refresh')} title={t('stats.refresh')}>↻</button>
            )}
          </div>

          <div className="drawer__panel" role="tabpanel">
            {tab === 'profile' && (
              <ProfilePanel account={account}
                name={name} onName={onName} avatar={avatar} onAvatar={onAvatar}
                defaultTimer={defaultTimer} onDefaultTimer={onDefaultTimer} />
            )}
            {tab === 'stats' && (
              <>
                <div className="segmented segmented--sub" role="tablist" aria-label={t('menu.game')}>
                  {(['king', 'durak'] as const).map((g) => (
                    <button key={g} role="tab" aria-selected={statsGame === g}
                      className={`segmented__tab ${statsGame === g ? 'segmented__tab--active' : ''}`}
                      onClick={() => setStatsGame(g)}>
                      {t(`gameType.${g}`)}
                    </button>
                  ))}
                </div>
                {statsGame === 'king'
                  ? <StatsPanel result={stats} loading={loadingStats} />
                  : <DurakStatsPanel result={durakStats} loading={loadingDurak} />}
              </>
            )}
            {tab === 'leaderboard' && (
              <>
                <div className="segmented segmented--sub" role="tablist" aria-label={t('menu.game')}>
                  {(['king', 'durak'] as const).map((g) => (
                    <button key={g} role="tab" aria-selected={boardGame === g}
                      className={`segmented__tab ${boardGame === g ? 'segmented__tab--active' : ''}`}
                      onClick={() => setBoardGame(g)}>
                      {t(`gameType.${g}`)}
                    </button>
                  ))}
                </div>
                {boardGame === 'king'
                  ? <LeaderboardPanel result={board} loading={loadingBoard} />
                  : <DurakLeaderboardPanel result={durakBoard} loading={loadingDurakBoard} />}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
