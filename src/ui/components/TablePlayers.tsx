import { useGame } from '../../hooks/useGame';
import CardView from './CardView';

export type SeatPos = 'bottom' | 'left' | 'top' | 'right';

/**
 * Physical seat positions around the table, clockwise from the viewer (bottom).
 * relIndex 0 = viewer (bottom). The order is logical/clockwise and is NOT
 * mirrored in RTL — only the text direction flips, not the rules' turn order.
 */
export function tablePositions(playerCount: number): SeatPos[] {
  return playerCount === 3
    ? ['bottom', 'left', 'right']
    : ['bottom', 'left', 'top', 'right'];
}

interface Props {
  /** The player shown at the bottom (the local/acting viewer). */
  viewerId: string | null;
}

/**
 * Visual table: opponent seats arranged clockwise around a central trick zone.
 * Shows name, dealer 👑, active-turn ▶, AI badge and a trick-count stack for
 * every player. Never shows anyone's hand — only the public current trick in
 * the centre and per-player trick counts. On trick_complete the centre cards
 * "collect" and the winning seat pulses.
 */
export default function TablePlayers({ viewerId }: Props) {
  const { state } = useGame();
  if (!state) return null;

  const players = state.players;
  const count = players.length;
  const positions = tablePositions(count);
  const viewerSeat = players.find((p) => p.id === viewerId)?.seatIndex ?? state.currentLeaderIdx;

  const trick = state.currentTrick;
  const collecting = state.status === 'trick_complete';
  const winnerId = collecting ? trick?.winnerId : null;
  const tricksWon = (pid: string) => state.currentRound.tricks.filter((t) => t.winnerId === pid).length;

  return (
    <div className={`table table--${count}`}>
      {players.map((p) => {
        const rel = (p.seatIndex - viewerSeat + count) % count;
        const pos = positions[rel];
        const isDealer = p.id === state.currentRound.dealerId;
        const isActive = !collecting && state.players[
          state.currentTrick
            ? (state.currentLeaderIdx + state.currentTrick.plays.length) % count
            : state.currentLeaderIdx
        ]?.id === p.id;
        const isWinner = p.id === winnerId;
        const isViewer = p.id === viewerId;
        return (
          <div
            key={p.id}
            className={`tseat tseat--${pos} ${isActive ? 'tseat--active' : ''} ${isWinner ? 'tseat--winner' : ''} ${isViewer ? 'tseat--you' : ''}`}
          >
            <div className="tseat__name">
              {isDealer && <span title="Dealer">👑</span>}
              {p.name}
              {p.type === 'ai' && <span className="ai-badge" title="AI">🤖</span>}
              {isActive && <span className="tseat__turn"> ▶</span>}
            </div>
            <div className={`tseat__tricks ${isWinner ? 'tseat__tricks--bump' : ''}`} title="Tricks won">
              🂠 {tricksWon(p.id)}
            </div>
          </div>
        );
      })}

      <div className={`table__center ${collecting ? 'table__center--collecting' : ''}`}>
        {trick && trick.plays.length > 0 ? (
          trick.plays.map((play) => (
            <div key={play.playerId} className="table-card">
              <CardView card={play.card} />
            </div>
          ))
        ) : (
          <span className="table__waiting">·</span>
        )}
      </div>
    </div>
  );
}
