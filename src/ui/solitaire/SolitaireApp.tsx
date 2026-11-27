// ---------------------------------------------------------------------------
// Solitaire section (S2): the hub ↔ game navigation, the saved game and the
// local stats. A lazy chunk of its own (src/gameScreens.ts).
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState } from 'react';
import { ACHIEVEMENTS, type Achievement, type AllStats } from '../../stats/achievements';
import type { VariantKey } from '../../solitaire/engine';
import { current, fromSaved, newSession, started, toSaved, type Session } from '../../solitaire/session';
import type { HeartsState } from '../../solitaire/hearts';
import { loadSavedGame, loadStats, recordResult, saveGame, saveStats, type GameResult, type SolitaireStats } from '../../solitaire/stats';
import { dailySeed, utcDay } from '../../solitaire/daily';
import { startRankedDeal, submitSolitaireResult, type RankedOutcome } from '../../net/solitaireApi';
import SolitaireHub from './SolitaireHub';
import SolitaireGame from './SolitaireGame';
import SolitaireTutorial from './SolitaireTutorial';
import type { SolitaireId } from '../../solitaire/engine';
import '../../styles/solitaire.css';

interface Props { onExit: () => void }

/** Only the solitaire group can change after a solitaire win. */
const solitaireOnly = (solitaire: SolitaireStats): AllStats => ({
  king: null, durak: null, deberc: null, tarneeb: null, preferans: null, fiftyOne: null, poker: null, solitaire,
});
export function newlyEarned(before: SolitaireStats, after: SolitaireStats): Achievement[] {
  return ACHIEVEMENTS.filter((a) => a.group === 'solitaire' && !a.evaluate(solitaireOnly(before)) && a.evaluate(solitaireOnly(after)));
}

const resultOf = (s: Session, won: boolean): GameResult => ({
  key: s.key, won, ms: s.elapsedMs, moves: s.moves.length, undos: s.undos, hints: s.hints, daily: s.daily,
  moons: s.key === 'hearts' ? (current(s) as HeartsState).moons[0] : 0,
});

export default function SolitaireApp({ onExit }: Props) {
  const [stats, setStats] = useState<SolitaireStats>(loadStats);
  const [saved, setSaved] = useState<Session | null>(() => fromSaved(loadSavedGame()));
  const [session, setSession] = useState<Session | null>(null);
  const [ranked, setRanked] = useState<RankedOutcome | 'pending' | null>(null);
  const [starting, setStarting] = useState(false);
  const [badges, setBadges] = useState<Achievement[]>([]);
  const [guide, setGuide] = useState<SolitaireId | null>(null);
  const statsRef = useRef(stats);
  statsRef.current = stats;

  /** Records a result; returns the solitaire badges it unlocked. */
  const record = useCallback((r: GameResult): Achievement[] => {
    const before = statsRef.current;
    const next = recordResult(before, r);
    statsRef.current = next;
    saveStats(next);
    setStats(next);
    return newlyEarned(before, next);
  }, []);

  /** A started, unfinished game that is replaced counts as a loss (breaks the streak). */
  const abandon = useCallback((s: Session | null) => {
    if (s && started(s) && !s.finished) record(resultOf(s, false));
  }, [record]);

  async function start(key: VariantKey, daily: boolean) {
    if (starting) return;
    abandon(session ?? saved);
    setSaved(null);
    saveGame(null);
    setRanked(null);
    setBadges([]);
    setStarting(true);
    // A server-seeded deal can be ranked; offline / signed out → the same game, unranked.
    const srv = await startRankedDeal(key, daily);
    setStarting(false);
    const day = srv?.daily ?? (daily ? utcDay() : null);
    const s = srv
      ? newSession(key, srv.seed, day, srv.token)
      : newSession(key, daily ? dailySeed(key, day!) : undefined, day);
    setSession(s);
  }

  function resume() {
    if (!saved) return;
    setSession(saved);
    setSaved(null);
  }

  const onChange = useCallback((s: Session) => {
    setSession(s);
    if (s.finished === 'won') {
      saveGame(null);
      setBadges(record(resultOf(s, true)));
      setRanked('pending');
      void submitSolitaireResult(s).then(setRanked);
    } else if (s.finished === 'lost') {
      saveGame(null);
      setBadges(record(resultOf(s, false)));
      setRanked(null);
    } else if (started(s)) {
      saveGame(toSaved(s));
    }
  }, [record]);

  if (guide) {
    return <SolitaireTutorial id={guide} onExit={() => setGuide(null)} onPlay={(k) => { setGuide(null); void start(k, false); }} />;
  }
  if (session) {
    return (
      <SolitaireGame
        key={`${session.key}:${session.seed}:${session.daily ?? ''}`}
        session={session}
        stats={stats}
        ranked={ranked}
        badges={badges}
        onChange={onChange}
        onNewDeal={() => void start(session.key, false)}
        onExit={() => {
          // Back to the hub: an unfinished game stays as "Continue".
          if (started(session) && !session.finished) { setSaved(session); saveGame(toSaved(session)); }
          setSession(null);
        }}
      />
    );
  }
  return <SolitaireHub stats={stats} saved={saved} busy={starting} onStart={(k, d) => void start(k, d)} onResume={resume} onExit={onExit} onGuide={setGuide} />;
}
