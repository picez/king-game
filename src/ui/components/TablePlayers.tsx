import { useGame } from '../../hooks/useGame';
import CardView from './CardView';
import SeatAvatar from './SeatAvatar';

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
 * Visual table: an oval felt with the opponents seated clockwise around it. The
 * current trick is laid out by SEAT POSITION (each card sits in front of the
 * player who played it) rather than as a central stack. Shows name, dealer 👑,
 * active-turn ▶, AI badge and a trick-count stack for every player. Never shows
 * anyone's hand — only the public current trick and per-player trick counts.
 * On trick_complete the winning seat and its played card pulse, then the cards
 * fade as the next trick is dealt (no chaotic fly-to-pile animation).
 */
export default function TablePlayers({ viewerId }: Props) {
  const { state, disconnectedSeats, seatAvatarImages } = useGame();
  if (!state) return null;
  const offline = new Set(disconnectedSeats ?? []);

  const players = state.players;
  const count = players.length;
  const positions = tablePositions(count);
  const viewerSeat = players.find((p) => p.id === viewerId)?.seatIndex ?? state.currentLeaderIdx;

  const trick = state.currentTrick;
  const collecting = state.status === 'trick_complete';
  const winnerId = collecting ? trick?.winnerId : null;
  const tricksWon = (pid: string) => state.currentRound.tricks.filter((t) => t.winnerId === pid).length;

  /** Relative seat position (bottom/left/top/right) of a player from the viewer. */
  const relPos = (seatIndex: number): SeatPos =>
    positions[(seatIndex - viewerSeat + count) % count];

  return (
    <div className={`table table--${count}`}>
      {/* Felt surface (decorative); seats and trick cards sit on top of it. */}
      <div className="table__surface" aria-hidden="true" />

      {players.map((p) => {
        const pos = relPos(p.seatIndex);
        const isDealer = p.id === state.currentRound.dealerId;
        const isActive = !collecting && state.players[
          state.currentTrick
            ? (state.currentLeaderIdx + state.currentTrick.plays.length) % count
            : state.currentLeaderIdx
        ]?.id === p.id;
        const isWinner = p.id === winnerId;
        const isViewer = p.id === viewerId;
        const isOffline = offline.has(p.seatIndex);
        return (
          <div
            key={p.id}
            className={`tseat tseat--${pos} ${isActive ? 'tseat--active' : ''} ${isWinner ? 'tseat--winner' : ''} ${isViewer ? 'tseat--you' : ''} ${isOffline ? 'tseat--offline' : ''}`}
          >
            <div className="tseat__name">
              {isDealer && <span title="Dealer">👑</span>}
              <SeatAvatar emoji={p.avatar} imageUrl={seatAvatarImages?.[p.seatIndex]} />
              {p.name}
              {p.type === 'ai' && <span className="ai-badge" title="AI">🤖</span>}
              {isOffline && <span className="tseat__offline" title="Offline">📴</span>}
              {isActive && <span className="tseat__turn"> ▶</span>}
            </div>
            <div className={`tseat__tricks ${isWinner ? 'tseat__tricks--bump' : ''}`} title="Tricks won">
              🂠 {tricksWon(p.id)}
            </div>
          </div>
        );
      })}

      {/* Current trick: each played card positioned in front of its player. */}
      <div className={`table__center ${collecting ? 'table__center--collecting' : ''}`}>
        {trick && trick.plays.length > 0 ? (
          trick.plays.map((play) => {
            const seat = players.find((p) => p.id === play.playerId)?.seatIndex ?? viewerSeat;
            const pos = relPos(seat);
            const isWinning = collecting && play.playerId === winnerId;
            return (
              <div
                key={play.playerId}
                className={`trick-slot trick-slot--${pos} ${isWinning ? 'trick-slot--winning' : ''}`}
              >
                <CardView card={play.card} size="table" highlight={isWinning} />
              </div>
            );
          })
        ) : (
          <span className="table__waiting">·</span>
        )}
      </div>
    </div>
  );
}
