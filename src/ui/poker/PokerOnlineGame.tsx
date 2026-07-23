import type { PokerAction, PokerState } from '../../games/poker/types';
import type { RematchUi } from '../online/RematchControls';
import type { PokerRecoveryStatus } from './PokerRecoveryBanner';
import PokerGameScreen from './PokerGameScreen';
import PokerFinished from './PokerFinished';

interface Props {
  /** The server-redacted state for THIS client (own hole cards only). */
  state: PokerState;
  myPlayerId: string | null;
  dispatch: (action: PokerAction) => void;
  onExit: () => void;
  /** Online rematch controls (Stage 25.9 / 37.7.6); null/undefined suppresses them. */
  rematch?: RematchUi | null;
  /** Public recovery status (§16, 37.7.6). Frozen / settlement-pending → read-only, no rematch. */
  recovery?: PokerRecoveryStatus;
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
 * read-only when it is not its turn. A frozen / settlement-pending table (§16, 37.7.6)
 * is FULLY read-only and offers no rematch until the economy recovers.
 */
export default function PokerOnlineGame({ state, myPlayerId, dispatch, onExit, rematch, recovery }: Props) {
  const mySeat = seatOf(myPlayerId);
  const blocked = recovery === 'frozen' || recovery === 'settlement_pending';
  if (state.phase === 'game_finished') {
    // Suppress the rematch controls while recovery blocks a new paid match.
    return <PokerFinished state={state} mySeat={mySeat} onExit={onExit} rematch={blocked ? null : rematch} recovery={recovery} />;
  }
  return <PokerGameScreen state={state} mySeat={mySeat} apply={dispatch} onExit={onExit} online readOnly={blocked} />;
}
