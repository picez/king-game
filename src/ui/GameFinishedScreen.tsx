import { useGame } from '../hooks/useGame';
import { useI18n } from '../i18n';
import ScoreTracker from './components/ScoreTracker';
import MatchResult from './components/MatchResult';
import { competitionPlaces, playerAvatar, type ResultSeat } from './components/matchResultModel';
import RematchControls from './online/RematchControls';

export default function GameFinishedScreen() {
  const { state, dispatch, online, onExit, rematch, myPlayerId } = useGame();
  const { t } = useI18n();
  if (!state) return null;

  const { players, scores } = state;
  const totals = players.map((p) => scores[p.id]?.total ?? 0);
  // Higher total is better; equal totals share a place.
  const places = competitionPlaces(totals, (a, b) => b - a);
  const seats: ResultSeat[] = players.map((p, i) => ({
    key: p.id, name: p.name, avatar: playerAvatar(p), isMe: p.id === myPlayerId,
    place: places[i], value: String(totals[i]), tone: places[i] === 1 ? 'win' : 'neutral',
  }));
  const winners = seats.filter((s) => s.place === 1);
  const tie = winners.length > 1;
  // Online the viewer is a seat; a local pass-and-play table has no single viewer.
  const me = seats.find((s) => s.isMe);
  const outcome = tie ? 'draw' : !me || me.place === 1 ? 'win' : 'loss';

  return (
    <MatchResult
      game="king"
      outcome={outcome}
      title={tie
        ? `${t('finished.tie')}: ${winners.map((w) => w.name).join(' & ')}`
        : `${winners[0].name} ${t('finished.wins')}`}
      subtitle={t('finished.title')}
      seats={seats}
      actions={online ? <>
        {/* Online rematch (Stage 25.9): "Play again" restarts the same room's game. */}
        {rematch && <RematchControls {...rematch} />}
        <button className="btn btn--ghost" onClick={() => onExit?.()}>{t('btn.backToMenu')}</button>
      </> : (
        <button className="btn btn--primary btn--large" onClick={() => dispatch({ type: 'RESET' })}>
          {t('finished.playAgain')}
        </button>
      )}
    >
      {/* Per-dealer score-tracker table (all 9 games of each dealer). */}
      <div className="finished-games">
        <h3 className="finished-games__title">{t('track.title')}</h3>
        <ScoreTracker state={state} />
      </div>
    </MatchResult>
  );
}
