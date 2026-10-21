import { useI18n } from '../../i18n';
import type { FiftyOneState } from '../../games/fiftyOne/types';
import MatchResult from '../components/MatchResult';
import { competitionPlaces, playerAvatar, type ResultSeat } from '../components/matchResultModel';
import RematchControls, { type RematchUi } from '../online/RematchControls';

interface Props {
  state: FiftyOneState;
  humanSeat: number;
  onPlayAgain: () => void;
  onExit: () => void;
  /** Online rematch controls (Stage 30.5); null/undefined for local play. */
  rematch?: RematchUi | null;
}

/** Match-over screen: the last seat standing wins (51_RULES §12). */
export default function FiftyOneFinished({ state, humanSeat, onPlayAgain, onExit, rematch }: Props) {
  const { t } = useI18n();
  const winner = state.winnerSeat;
  const name = winner === humanSeat ? t('fiftyOne.you') : (winner != null ? state.players[winner].name : '');
  const humanWon = winner === humanSeat;

  // The survivor first; then the others by running penalty (lower is better); the
  // eliminated (crossed the target) are marked "Out".
  const out = (seat: number) => !!state.eliminatedSeats[seat];
  const places = competitionPlaces(state.players, (a, b) =>
    Number(b.seatIndex === winner) - Number(a.seatIndex === winner)
    || Number(out(a.seatIndex)) - Number(out(b.seatIndex))
    || state.scoresBySeat[a.seatIndex] - state.scoresBySeat[b.seatIndex]);
  const seats: ResultSeat[] = state.players.map((p, i) => ({
    key: p.id, name: p.name, avatar: playerAvatar(p), isMe: p.seatIndex === humanSeat,
    place: places[i], value: String(state.scoresBySeat[p.seatIndex]),
    note: p.seatIndex !== winner && out(p.seatIndex) ? t('result.out') : undefined,
    tone: p.seatIndex !== winner && out(p.seatIndex) ? 'lose' : undefined,
  }));

  return (
    <MatchResult
      game="fifty-one"
      outcome={humanWon ? 'win' : 'loss'}
      title={t('fiftyOne.matchWinner').replace('{name}', name)}
      seats={seats}
      actions={<>
        {rematch
          ? <RematchControls {...rematch} />
          : <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('fiftyOne.playAgain')}</button>}
        <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
      </>}
    />
  );
}
