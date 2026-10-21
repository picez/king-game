import { useI18n } from '../../i18n';
import type { PokerState } from '../../games/poker/types';
import MatchResult from '../components/MatchResult';
import { competitionPlaces, playerAvatar, type ResultSeat } from '../components/matchResultModel';
import RematchControls, { type RematchUi } from '../online/RematchControls';
import PokerRecoveryBanner, { type PokerRecoveryStatus } from './PokerRecoveryBanner';

interface Props {
  state: PokerState;
  mySeat: number | null;
  onPlayAgain?: () => void;
  onExit: () => void;
  /** Online rematch controls (Stage 37.7.6); null/undefined for local play → local Play Again. */
  rematch?: RematchUi | null;
  /** Public recovery status (§16, 37.7.6). */
  recovery?: PokerRecoveryStatus;
}

/** Match-over screen: the last player standing holds every chip (§11). */
export default function PokerFinished({ state, mySeat, onPlayAgain, onExit, rematch, recovery }: Props) {
  const { t } = useI18n();
  const winner = state.winnerSeat;
  const iWon = winner != null && winner === mySeat;
  const winnerName = winner != null ? state.players[winner]?.name ?? '' : '';

  // The winner first; everyone else by remaining stack (busted seats tie at 0).
  const stack = (seat: number) => state.stacksBySeat[seat] ?? 0;
  const places = competitionPlaces(state.players, (a, b) =>
    Number(b.seatIndex === winner) - Number(a.seatIndex === winner) || stack(b.seatIndex) - stack(a.seatIndex));
  const seats: ResultSeat[] = state.players.map((p, i) => {
    const busted = p.seatIndex !== winner && stack(p.seatIndex) === 0;
    return {
      key: p.id, name: p.name, avatar: playerAvatar(p), isMe: p.seatIndex === mySeat,
      place: places[i], value: `🪙 ${stack(p.seatIndex)}`,
      note: busted ? t('result.busted') : undefined, tone: busted ? 'lose' : undefined,
    };
  });

  return (
    <MatchResult
      game="poker"
      outcome={iWon ? 'win' : 'loss'}
      title={iWon ? t('poker.youWin') : t('poker.matchOver')}
      subtitle={!iWon && winnerName ? t('poker.winnerIs').replace('{name}', winnerName) : undefined}
      seats={seats}
      actions={<>
        {/* Online (Stage 37.7.6): shared rematch readiness starts a new PAID match; local: Play Again. */}
        {rematch
          ? <RematchControls {...rematch} />
          : onPlayAgain && <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('poker.playAgain')}</button>}
        <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
      </>}
    >
      {/* Recovery (§16, 37.7.6): a frozen/settlement-pending finished table shows the banner
          and offers NO rematch (the rematch controls are suppressed by the caller). */}
      <PokerRecoveryBanner status={recovery} />
    </MatchResult>
  );
}
