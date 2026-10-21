import { useI18n } from '../../i18n';
import type { PreferansState } from '../../games/preferans/types';
import MatchResult from '../components/MatchResult';
import { competitionPlaces, playerAvatar, type ResultSeat } from '../components/matchResultModel';
import RematchControls, { type RematchUi } from '../online/RematchControls';

interface Props {
  state: PreferansState;
  /** The human's seat (always 0 in the local game). */
  humanSeat: number;
  onPlayAgain: () => void;
  onExit: () => void;
  /** Online rematch controls (Stage 25.9). */
  rematch?: RematchUi | null;
}

/** End screen: did the human reach the target first (a draw is possible, §11). */
export default function PreferansFinished({ state, humanSeat, onPlayAgain, onExit, rematch }: Props) {
  const { t } = useI18n();
  const isDraw = state.winnerSeat == null;
  const humanWon = state.winnerSeat === humanSeat;
  const winnerName = state.winnerSeat != null
    ? state.winnerSeat === humanSeat ? t('preferans.you') : state.players[state.winnerSeat].name
    : null;
  const title = isDraw ? t('preferans.draw') : humanWon ? t('preferans.youWon') : t('preferans.youLost');

  // The engine's winner is first; the others are ranked by score (higher is better).
  const scores = state.players.map((p) => state.scores[p.seatIndex]);
  const ranked = competitionPlaces(state.players, (a, b) =>
    Number(b.seatIndex === state.winnerSeat) - Number(a.seatIndex === state.winnerSeat)
    || state.scores[b.seatIndex] - state.scores[a.seatIndex]);
  const seats: ResultSeat[] = state.players.map((p, i) => ({
    key: p.id, name: p.name, avatar: playerAvatar(p), isMe: p.seatIndex === humanSeat,
    // On a draw nobody holds first place alone — the tied leaders share it.
    place: isDraw ? competitionPlaces(scores, (a, b) => b - a)[i] : ranked[i],
    value: String(scores[i]),
  }));

  return (
    <MatchResult
      game="preferans"
      outcome={isDraw ? 'draw' : humanWon ? 'win' : 'loss'}
      title={title}
      subtitle={winnerName && !humanWon ? t('preferans.winnerIs').replace('{name}', winnerName) : undefined}
      seats={seats}
      actions={<>
        {rematch
          ? <RematchControls {...rematch} />
          : <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('preferans.playAgain')}</button>}
        <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
      </>}
    />
  );
}
