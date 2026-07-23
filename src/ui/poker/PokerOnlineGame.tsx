import type { PokerAction, PokerState } from '../../games/poker/types';
import type { RematchUi } from '../online/RematchControls';
import PokerRecoveryBanner, { type PokerRecoveryStatus } from './PokerRecoveryBanner';
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
 * read-only when it is not its turn. A frozen / settlement-pending / payout-pending table
 * (§16, 37.7.6/37.7.7) is FULLY read-only and offers no rematch until settlement is confirmed.
 * This component owns the SINGLE recovery banner for the active + finished views (finished
 * renders it inside PokerFinished) so it is never shown twice (37.7.7 FAIL 3).
 */
export default function PokerOnlineGame({ state, myPlayerId, dispatch, onExit, rematch, recovery }: Props) {
  const mySeat = seatOf(myPlayerId);
  const blocked = recovery === 'frozen' || recovery === 'settlement_pending' || recovery === 'payout_pending';
  if (state.phase === 'game_finished') {
    // PokerFinished renders the (single) recovery banner itself; suppress rematch while blocked.
    return <PokerFinished state={state} mySeat={mySeat} onExit={onExit} rematch={blocked ? null : rematch} recovery={recovery} />;
  }
  // Active table: render the ONE recovery banner here (37.7.7 FAIL 3 — no duplicate from OnlineGame).
  return (
    <>
      <PokerRecoveryBanner status={recovery} />
      <PokerGameScreen state={state} mySeat={mySeat} apply={dispatch} onExit={onExit} online readOnly={blocked} />
    </>
  );
}
