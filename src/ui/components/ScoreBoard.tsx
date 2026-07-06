import type { Player, Score } from '../../models/types';
import { useI18n } from '../../i18n';

interface ScoreBoardProps {
  players: Player[];
  scores: Record<string, Score>;
  highlightRoundIdx?: number;
}

export default function ScoreBoard({
  players,
  scores,
  highlightRoundIdx,
}: ScoreBoardProps) {
  const { t } = useI18n();
  return (
    <div className="scoreboard">
      <table className="scoreboard__table">
        <thead>
          <tr>
            <th>{t('scoring.player')}</th>
            {highlightRoundIdx !== undefined && <th>{t('scoring.thisRound')}</th>}
            <th>{t('scoring.total')}</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const score = scores[p.id];
            const roundScore =
              highlightRoundIdx !== undefined
                ? score?.roundScores[highlightRoundIdx]
                : undefined;
            return (
              <tr key={p.id}>
                <td>{p.name}</td>
                {highlightRoundIdx !== undefined && (
                  <td className={roundScore !== undefined && roundScore >= 0 ? 'score--positive' : 'score--negative'}>
                    {roundScore !== undefined ? (roundScore >= 0 ? `+${roundScore}` : `${roundScore}`) : '—'}
                  </td>
                )}
                <td className={score?.total >= 0 ? 'score--positive' : 'score--negative'}>
                  {score?.total ?? 0}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
