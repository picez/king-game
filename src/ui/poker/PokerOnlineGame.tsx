import type { PokerAction, PokerState } from '../../games/poker/types';
import PokerGameScreen from './PokerGameScreen';
import PokerFinished from './PokerFinished';

interface Props {
  /** The server-redacted state for THIS client (own hole cards only). */
  state: PokerState;
  myPlayerId: string | null;
  dispatch: (action: PokerAction) => void;
  onExit: () => void;
}

/** Seat index encoded in a `player-<seat>` id, or null. */
function seatOf(playerId: string | null): number | null {
  if (!playerId) return null;
  const m = /^player-(\d+)$/.exec(playerId);
  return m ? Number(m[1]) : null;
}

/**
 * Online poker: renders the shared table from the server-authoritative, per-viewer
 * redacted state. The server drives bots + the between-hands advance (seeded
 * START_NEXT_HAND), so the client only dispatches this seat's own actions and is
 * read-only when it is not its turn.
 */
export default function PokerOnlineGame({ state, myPlayerId, dispatch, onExit }: Props) {
  const mySeat = seatOf(myPlayerId);
  if (state.phase === 'game_finished') {
    return <PokerFinished state={state} mySeat={mySeat} onExit={onExit} />;
  }
  return <PokerGameScreen state={state} mySeat={mySeat} apply={dispatch} onExit={onExit} online />;
}
