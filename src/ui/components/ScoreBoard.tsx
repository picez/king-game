import type { Player, Score } from '../../models/types';

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
  return (
    <div className="scoreboard">
      <table className="scoreboard__table">
        <thead>
          <tr>
            <th>Player</th>
            {highlightRoundIdx !== undefined && <th>This Round</th>}
            <th>Total</th>
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
