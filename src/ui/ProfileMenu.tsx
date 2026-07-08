import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { Account } from '../hooks/useAccount';
import {
  fetchKingStats, fetchKingLeaderboard, fetchDurakStats, fetchDurakLeaderboard,
  fetchDebercStats, fetchDebercLeaderboard, fetchTarneebStats, fetchTarneebLeaderboard,
  type KingStats, type DurakStats, type DebercStats, type TarneebStats,
  type LeaderboardEntry, type DurakLeaderboardEntry, type DebercLeaderboardEntry,
  type TarneebLeaderboardEntry, type Loadable,
} from '../net/statsApi';
import ProfilePanel from './menu/ProfilePanel';
import StatsPanel from './components/StatsPanel';
import DurakStatsPanel from './components/DurakStatsPanel';
import DebercStatsPanel from './components/DebercStatsPanel';
import TarneebStatsPanel from './components/TarneebStatsPanel';
import LeaderboardPanel from './components/LeaderboardPanel';
import DurakLeaderboardPanel from './components/DurakLeaderboardPanel';
import DebercLeaderboardPanel from './components/DebercLeaderboardPanel';
import TarneebLeaderboardPanel from './components/TarneebLeaderboardPanel';

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
type GameKey = 'king' | 'durak' | 'deberc' | 'tarneeb';

const GAMES: readonly GameKey[] = ['king', 'durak', 'deberc', 'tarneeb'] as const;

/**
 * Secondary Profile / Statistics / Leaderboard drawer (Stage 7.1). A single
 * collapsible panel with a segmented control, kept OFF the first screen by
 * default so the main actions stay front-and-centre. Sign-in/out is NOT here
 * (that lives in the top AccountBar); the Profile tab holds settings only.
 *
 * Stats + leaderboard have a per-game sub-toggle (King / Durak / Deberc). Each
 * game's data loads lazily on first view (a `once` ref) and re-fetches on ↻.
 */
export default function ProfileMenu({ account, name, onName, avatar, onAvatar, defaultTimer, onDefaultTimer }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('profile');
  const [statsGame, setStatsGame] = useState<GameKey>('king');
  const [boardGame, setBoardGame] = useState<GameKey>('king');

  const [stats, setStats] = useState<Loadable<KingStats> | null>(null);
  const [durakStats, setDurakStats] = useState<Loadable<DurakStats> | null>(null);
  const [debercStats, setDebercStats] = useState<Loadable<DebercStats> | null>(null);
  const [tarneebStats, setTarneebStats] = useState<Loadable<TarneebStats> | null>(null);
  const [board, setBoard] = useState<Loadable<LeaderboardEntry[]> | null>(null);
  const [durakBoard, setDurakBoard] = useState<Loadable<DurakLeaderboardEntry[]> | null>(null);
  const [debercBoard, setDebercBoard] = useState<Loadable<DebercLeaderboardEntry[]> | null>(null);
  const [tarneebBoard, setTarneebBoard] = useState<Loadable<TarneebLeaderboardEntry[]> | null>(null);

  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingDurak, setLoadingDurak] = useState(false);
  const [loadingDeberc, setLoadingDeberc] = useState(false);
  const [loadingTarneeb, setLoadingTarneeb] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [loadingDurakBoard, setLoadingDurakBoard] = useState(false);
  const [loadingDebercBoard, setLoadingDebercBoard] = useState(false);
  const [loadingTarneebBoard, setLoadingTarneebBoard] = useState(false);

  const statsOnce = useRef(false);
  const durakOnce = useRef(false);
  const debercOnce = useRef(false);
  const tarneebOnce = useRef(false);
  const boardOnce = useRef(false);
  const durakBoardOnce = useRef(false);
  const debercBoardOnce = useRef(false);
  const tarneebBoardOnce = useRef(false);

  const base = account.base;

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try { setStats(await fetchKingStats(base)); } finally { setLoadingStats(false); }
  }, [base]);
  const loadDurakStats = useCallback(async () => {
    setLoadingDurak(true);
    try { setDurakStats(await fetchDurakStats(base)); } finally { setLoadingDurak(false); }
  }, [base]);
  const loadDebercStats = useCallback(async () => {
    setLoadingDeberc(true);
    try { setDebercStats(await fetchDebercStats(base)); } finally { setLoadingDeberc(false); }
  }, [base]);
  const loadTarneebStats = useCallback(async () => {
    setLoadingTarneeb(true);
    try { setTarneebStats(await fetchTarneebStats(base)); } finally { setLoadingTarneeb(false); }
  }, [base]);
  const loadBoard = useCallback(async () => {
    setLoadingBoard(true);
    try { setBoard(await fetchKingLeaderboard(base)); } finally { setLoadingBoard(false); }
  }, [base]);
  const loadDurakBoard = useCallback(async () => {
    setLoadingDurakBoard(true);
    try { setDurakBoard(await fetchDurakLeaderboard(base)); } finally { setLoadingDurakBoard(false); }
  }, [base]);
  const loadDebercBoard = useCallback(async () => {
    setLoadingDebercBoard(true);
    try { setDebercBoard(await fetchDebercLeaderboard(base)); } finally { setLoadingDebercBoard(false); }
  }, [base]);
  const loadTarneebBoard = useCallback(async () => {
    setLoadingTarneebBoard(true);
    try { setTarneebBoard(await fetchTarneebLeaderboard(base)); } finally { setLoadingTarneebBoard(false); }
  }, [base]);

  useEffect(() => {
    if (!open) return;
    if (tab === 'stats') {
      if (statsGame === 'king' && !statsOnce.current) { statsOnce.current = true; void loadStats(); }
      if (statsGame === 'durak' && !durakOnce.current) { durakOnce.current = true; void loadDurakStats(); }
      if (statsGame === 'deberc' && !debercOnce.current) { debercOnce.current = true; void loadDebercStats(); }
      if (statsGame === 'tarneeb' && !tarneebOnce.current) { tarneebOnce.current = true; void loadTarneebStats(); }
    }
    if (tab === 'leaderboard') {
      if (boardGame === 'king' && !boardOnce.current) { boardOnce.current = true; void loadBoard(); }
      if (boardGame === 'durak' && !durakBoardOnce.current) { durakBoardOnce.current = true; void loadDurakBoard(); }
      if (boardGame === 'deberc' && !debercBoardOnce.current) { debercBoardOnce.current = true; void loadDebercBoard(); }
      if (boardGame === 'tarneeb' && !tarneebBoardOnce.current) { tarneebBoardOnce.current = true; void loadTarneebBoard(); }
    }
  }, [open, tab, statsGame, boardGame,
    loadStats, loadDurakStats, loadDebercStats, loadTarneebStats,
    loadBoard, loadDurakBoard, loadDebercBoard, loadTarneebBoard]);

  function refresh() {
    if (tab === 'stats') {
      void (statsGame === 'durak' ? loadDurakStats() : statsGame === 'deberc' ? loadDebercStats()
        : statsGame === 'tarneeb' ? loadTarneebStats() : loadStats());
    } else if (tab === 'leaderboard') {
      void (boardGame === 'durak' ? loadDurakBoard() : boardGame === 'deberc' ? loadDebercBoard()
        : boardGame === 'tarneeb' ? loadTarneebBoard() : loadBoard());
    }
  }

  const anyLoading = loadingStats || loadingDurak || loadingDeberc || loadingTarneeb
    || loadingBoard || loadingDurakBoard || loadingDebercBoard || loadingTarneebBoard;

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
                disabled={anyLoading}
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
                  {GAMES.map((g) => (
                    <button key={g} role="tab" aria-selected={statsGame === g}
                      className={`segmented__tab ${statsGame === g ? 'segmented__tab--active' : ''}`}
                      onClick={() => setStatsGame(g)}>
                      {t(`gameType.${g}`)}
                    </button>
                  ))}
                </div>
                {statsGame === 'king' && <StatsPanel result={stats} loading={loadingStats} />}
                {statsGame === 'durak' && <DurakStatsPanel result={durakStats} loading={loadingDurak} />}
                {statsGame === 'deberc' && <DebercStatsPanel result={debercStats} loading={loadingDeberc} />}
                {statsGame === 'tarneeb' && <TarneebStatsPanel result={tarneebStats} loading={loadingTarneeb} />}
              </>
            )}
            {tab === 'leaderboard' && (
              <>
                <div className="segmented segmented--sub" role="tablist" aria-label={t('menu.game')}>
                  {GAMES.map((g) => (
                    <button key={g} role="tab" aria-selected={boardGame === g}
                      className={`segmented__tab ${boardGame === g ? 'segmented__tab--active' : ''}`}
                      onClick={() => setBoardGame(g)}>
                      {t(`gameType.${g}`)}
                    </button>
                  ))}
                </div>
                {boardGame === 'king' && <LeaderboardPanel result={board} loading={loadingBoard} />}
                {boardGame === 'durak' && <DurakLeaderboardPanel result={durakBoard} loading={loadingDurakBoard} />}
                {boardGame === 'deberc' && <DebercLeaderboardPanel result={debercBoard} loading={loadingDebercBoard} />}
                {boardGame === 'tarneeb' && <TarneebLeaderboardPanel result={tarneebBoard} loading={loadingTarneebBoard} />}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
