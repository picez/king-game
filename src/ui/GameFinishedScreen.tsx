import { useGame } from '../hooks/useGame';
import { useI18n } from '../i18n';
import ScoreTracker from './components/ScoreTracker';

interface RankedPlayer {
  name: string;
  total: number;
  rank: number;
}

export default function GameFinishedScreen() {
  const { state, dispatch, online, onExit } = useGame();
  const { t } = useI18n();
  if (!state) return null;

  const { players, scores } = state;

  // Sort by total score descending (higher is better)
  const ranked: RankedPlayer[] = players
    .map((p) => ({ name: p.name, total: scores[p.id]?.total ?? 0, rank: 0 }))
    .sort((a, b) => b.total - a.total)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  const topScore = ranked[0].total;
  const winners = ranked.filter((p) => p.total === topScore);

  function handleReset() {
    dispatch({ type: 'RESET' });
  }

  return (
    <div className="screen center-screen">
      <div className="modal-card modal-card--wide">
        <h1 className="finished-title">{t('finished.title')}</h1>

        <div className="winner-banner">
          {winners.length === 1
            ? <><span className="trophy">🏆</span> {winners[0].name} {t('finished.wins')}</>
            : <><span className="trophy">🏆</span> {t('finished.tie')}: {winners.map((w) => w.name).join(' & ')}</>
          }
        </div>

        <table className="score-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{t('scoring.player')}</th>
              <th>{t('finished.finalScore')}</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.name} className={p.rank === 1 ? 'score-row--winner' : ''}>
                <td>{p.rank}</td>
                <td>{p.name}</td>
                <td className={p.total >= 0 ? 'score--positive' : 'score--negative'}>
                  {p.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Per-dealer score-tracker table (all 9 games of each dealer). */}
        <div className="finished-games">
          <h3 className="finished-games__title">{t('track.title')}</h3>
          <ScoreTracker state={state} />
        </div>

        {online ? (
          <button className="btn btn--primary btn--large" onClick={() => onExit?.()}>
            {t('btn.backToMenu')}
          </button>
        ) : (
          <button className="btn btn--primary btn--large" onClick={handleReset}>
            {t('finished.playAgain')}
          </button>
        )}
      </div>
    </div>
  );
}
