import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { Account } from '../hooks/useAccount';
import type { GameType } from '../games/catalog';
import {
  fetchKingStats, fetchKingLeaderboard, fetchDurakStats, fetchDurakLeaderboard,
  fetchDebercStats, fetchDebercLeaderboard, fetchTarneebStats, fetchTarneebLeaderboard,
  fetchPreferansStats, fetchPreferansLeaderboard,
  type KingStats, type DurakStats, type DebercStats, type TarneebStats, type PreferansStats,
  type LeaderboardEntry, type DurakLeaderboardEntry, type DebercLeaderboardEntry,
  type TarneebLeaderboardEntry, type PreferansLeaderboardEntry, type Loadable,
} from '../net/statsApi';
import ProfilePanel from './menu/ProfilePanel';
import AchievementsPanel from './components/AchievementsPanel';
import AchievementToast from './components/AchievementToast';
import {
  ACHIEVEMENTS, evaluateAchievements, type AllStats, type Achievement,
} from '../stats/achievements';
import { earnedIds, loadSeen, unseenEarned, markSeen } from '../stats/achievementsSeen';
import StatsPanel from './components/StatsPanel';
import DurakStatsPanel from './components/DurakStatsPanel';
import DebercStatsPanel from './components/DebercStatsPanel';
import TarneebStatsPanel from './components/TarneebStatsPanel';
import PreferansStatsPanel from './components/PreferansStatsPanel';
import LeaderboardPanel from './components/LeaderboardPanel';
import DurakLeaderboardPanel from './components/DurakLeaderboardPanel';
import DebercLeaderboardPanel from './components/DebercLeaderboardPanel';
import TarneebLeaderboardPanel from './components/TarneebLeaderboardPanel';
import PreferansLeaderboardPanel from './components/PreferansLeaderboardPanel';

interface Props {
  account: Account;
  name: string;
  onName: (v: string) => void;
  avatar: string;
  onAvatar: (v: string) => void;
  defaultTimer: number;
  onDefaultTimer: (v: number) => void;
  favoriteGame: GameType;
  onFavoriteGame: (v: GameType) => void;
  /** Custom server URL (null = default); Stage 14.2 connection setting. */
  customServer: string | null;
  onCustomServer: (v: string | null) => void;
}

type Tab = 'profile' | 'stats' | 'achievements' | 'leaderboard';
type GameKey = 'king' | 'durak' | 'deberc' | 'tarneeb' | 'preferans';

// Preferans (Stage 19.6) has stats + leaderboard sub-tabs. It is intentionally NOT
// part of the achievements derivation (AllStats), which stays on the four released
// games until Preferans exits experimental (Stage 19.7).
const GAMES: readonly GameKey[] = ['king', 'durak', 'deberc', 'tarneeb', 'preferans'] as const;

/**
 * Profile / Statistics / Leaderboard sections (Stage 13.3). Rendered inside the
 * dedicated Profile SCREEN (StartMenu `pane === 'profile'`) — no longer a
 * collapsible drawer on the main menu. A segmented control switches sections.
 * Sign-in/out is NOT here (that lives in the top AccountBar); the Profile tab
 * holds settings only.
 *
 * Stats + leaderboard have a per-game sub-toggle (King / Durak / Deberc / Tarneeb).
 * Each game's data loads lazily on first view (a `once` ref) and re-fetches on ↻.
 */
export default function ProfileMenu({
  account, name, onName, avatar, onAvatar, defaultTimer, onDefaultTimer, favoriteGame, onFavoriteGame,
  customServer, onCustomServer,
}: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('profile');
  const [statsGame, setStatsGame] = useState<GameKey>('king');
  const [boardGame, setBoardGame] = useState<GameKey>('king');

  // Achievement unlock toast (Stage 16.1) — device-local, post-stats-load only.
  // `seenAtOpen` is snapshotted once on mount so the toast queue AND the grid's
  // "New" chips stay stable while the screen is open; dismissing persists the
  // ids (markSeen) so nothing re-announces next time.
  const [seenAtOpen] = useState<string[]>(() => loadSeen());
  const [toastQueue, setToastQueue] = useState<readonly Achievement[]>([]);
  const detectedRef = useRef(false);

  const [stats, setStats] = useState<Loadable<KingStats> | null>(null);
  const [durakStats, setDurakStats] = useState<Loadable<DurakStats> | null>(null);
  const [debercStats, setDebercStats] = useState<Loadable<DebercStats> | null>(null);
  const [tarneebStats, setTarneebStats] = useState<Loadable<TarneebStats> | null>(null);
  const [preferansStats, setPreferansStats] = useState<Loadable<PreferansStats> | null>(null);
  const [board, setBoard] = useState<Loadable<LeaderboardEntry[]> | null>(null);
  const [durakBoard, setDurakBoard] = useState<Loadable<DurakLeaderboardEntry[]> | null>(null);
  const [debercBoard, setDebercBoard] = useState<Loadable<DebercLeaderboardEntry[]> | null>(null);
  const [tarneebBoard, setTarneebBoard] = useState<Loadable<TarneebLeaderboardEntry[]> | null>(null);
  const [preferansBoard, setPreferansBoard] = useState<Loadable<PreferansLeaderboardEntry[]> | null>(null);

  const [loadingStats, setLoadingStats] = useState(false);
  const [loadingDurak, setLoadingDurak] = useState(false);
  const [loadingDeberc, setLoadingDeberc] = useState(false);
  const [loadingTarneeb, setLoadingTarneeb] = useState(false);
  const [loadingPreferans, setLoadingPreferans] = useState(false);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [loadingDurakBoard, setLoadingDurakBoard] = useState(false);
  const [loadingDebercBoard, setLoadingDebercBoard] = useState(false);
  const [loadingTarneebBoard, setLoadingTarneebBoard] = useState(false);
  const [loadingPreferansBoard, setLoadingPreferansBoard] = useState(false);

  const statsOnce = useRef(false);
  const durakOnce = useRef(false);
  const debercOnce = useRef(false);
  const tarneebOnce = useRef(false);
  const preferansOnce = useRef(false);
  const boardOnce = useRef(false);
  const durakBoardOnce = useRef(false);
  const debercBoardOnce = useRef(false);
  const tarneebBoardOnce = useRef(false);
  const preferansBoardOnce = useRef(false);

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
  const loadPreferansStats = useCallback(async () => {
    setLoadingPreferans(true);
    try { setPreferansStats(await fetchPreferansStats(base)); } finally { setLoadingPreferans(false); }
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
  const loadPreferansBoard = useCallback(async () => {
    setLoadingPreferansBoard(true);
    try { setPreferansBoard(await fetchPreferansLeaderboard(base)); } finally { setLoadingPreferansBoard(false); }
  }, [base]);

  useEffect(() => {
    if (tab === 'stats') {
      if (statsGame === 'king' && !statsOnce.current) { statsOnce.current = true; void loadStats(); }
      if (statsGame === 'durak' && !durakOnce.current) { durakOnce.current = true; void loadDurakStats(); }
      if (statsGame === 'deberc' && !debercOnce.current) { debercOnce.current = true; void loadDebercStats(); }
      if (statsGame === 'tarneeb' && !tarneebOnce.current) { tarneebOnce.current = true; void loadTarneebStats(); }
      if (statsGame === 'preferans' && !preferansOnce.current) { preferansOnce.current = true; void loadPreferansStats(); }
    }
    // Achievements are derived from ALL five stat sets — load each once (reusing
    // the same `once` refs, so opening the stats tab later won't refetch).
    if (tab === 'achievements') {
      if (!statsOnce.current) { statsOnce.current = true; void loadStats(); }
      if (!durakOnce.current) { durakOnce.current = true; void loadDurakStats(); }
      if (!debercOnce.current) { debercOnce.current = true; void loadDebercStats(); }
      if (!tarneebOnce.current) { tarneebOnce.current = true; void loadTarneebStats(); }
      if (!preferansOnce.current) { preferansOnce.current = true; void loadPreferansStats(); }
    }
    if (tab === 'leaderboard') {
      if (boardGame === 'king' && !boardOnce.current) { boardOnce.current = true; void loadBoard(); }
      if (boardGame === 'durak' && !durakBoardOnce.current) { durakBoardOnce.current = true; void loadDurakBoard(); }
      if (boardGame === 'deberc' && !debercBoardOnce.current) { debercBoardOnce.current = true; void loadDebercBoard(); }
      if (boardGame === 'tarneeb' && !tarneebBoardOnce.current) { tarneebBoardOnce.current = true; void loadTarneebBoard(); }
      if (boardGame === 'preferans' && !preferansBoardOnce.current) { preferansBoardOnce.current = true; void loadPreferansBoard(); }
    }
  }, [tab, statsGame, boardGame,
    loadStats, loadDurakStats, loadDebercStats, loadTarneebStats, loadPreferansStats,
    loadBoard, loadDurakBoard, loadDebercBoard, loadTarneebBoard, loadPreferansBoard]);

  function refresh() {
    if (tab === 'stats') {
      void (statsGame === 'durak' ? loadDurakStats() : statsGame === 'deberc' ? loadDebercStats()
        : statsGame === 'tarneeb' ? loadTarneebStats() : statsGame === 'preferans' ? loadPreferansStats() : loadStats());
    } else if (tab === 'leaderboard') {
      void (boardGame === 'durak' ? loadDurakBoard() : boardGame === 'deberc' ? loadDebercBoard()
        : boardGame === 'tarneeb' ? loadTarneebBoard() : boardGame === 'preferans' ? loadPreferansBoard() : loadBoard());
    }
  }

  const anyLoading = loadingStats || loadingDurak || loadingDeberc || loadingTarneeb || loadingPreferans
    || loadingBoard || loadingDurakBoard || loadingDebercBoard || loadingTarneebBoard || loadingPreferansBoard;

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'profile', label: t('account.title') },
    { key: 'stats', label: t('stats.myStats') },
    { key: 'achievements', label: t('profile.achievements') },
    { key: 'leaderboard', label: t('stats.leaderboard') },
  ];

  // Achievements are derived from the five per-game stat loadables (read-only).
  const dataOf = <T,>(l: Loadable<T> | null): T | null => (l && l.state === 'ok' ? l.data : null);
  const allStats: AllStats = {
    king: dataOf(stats), durak: dataOf(durakStats), deberc: dataOf(debercStats),
    tarneeb: dataOf(tarneebStats), preferans: dataOf(preferansStats),
  };
  const allResolved = !!(stats && durakStats && debercStats && tarneebStats && preferansStats);
  const achLoading = tab === 'achievements' && !allResolved;
  // Only a clean "no session" state (every set unauthenticated) shows the sign-in
  // hint; a mix (some ok, some error) still renders the grid with what we have.
  const needsSignIn = allResolved
    && stats!.state === 'unauthenticated' && durakStats!.state === 'unauthenticated'
    && debercStats!.state === 'unauthenticated' && tarneebStats!.state === 'unauthenticated'
    && preferansStats!.state === 'unauthenticated';

  // Once the four stat sets have resolved, compare earned badges against the
  // seen ledger and queue any that are new. Runs at most once per screen open;
  // logged-out / no stats → nothing queued (unseenEarned over an empty set).
  useEffect(() => {
    if (detectedRef.current || !allResolved || needsSignIn) return;
    detectedRef.current = true;
    const earned = earnedIds(evaluateAchievements(allStats));
    const unseen = unseenEarned(earned, seenAtOpen);
    if (unseen.length > 0) {
      setToastQueue(ACHIEVEMENTS.filter((a) => unseen.includes(a.id)));
    }
    // allStats is derived from the five loadables in the dep list; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allResolved, needsSignIn, seenAtOpen, stats, durakStats, debercStats, tarneebStats, preferansStats]);

  function dismissToast() {
    markSeen(earnedIds(evaluateAchievements(allStats)));
    setToastQueue([]);
  }

  return (
    <div className="profile-screen">
      <div className="segmented profile-screen__tabs" role="tablist">
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
            defaultTimer={defaultTimer} onDefaultTimer={onDefaultTimer}
            favoriteGame={favoriteGame} onFavoriteGame={onFavoriteGame}
            customServer={customServer} onCustomServer={onCustomServer} />
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
                {statsGame === 'preferans' && <PreferansStatsPanel result={preferansStats} loading={loadingPreferans} />}
              </>
            )}
            {tab === 'achievements' && (
              <AchievementsPanel stats={allStats} loading={achLoading} needsSignIn={needsSignIn} seen={seenAtOpen} />
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
                {boardGame === 'preferans' && <PreferansLeaderboardPanel result={preferansBoard} loading={loadingPreferansBoard} />}
              </>
            )}
      </div>

      {toastQueue.length > 0 && (
        <AchievementToast achievements={toastQueue} onDismiss={dismissToast} />
      )}
    </div>
  );
}
