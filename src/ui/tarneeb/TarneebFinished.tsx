import { useI18n } from '../../i18n';
import { isSoloTarneeb, teamOfSeat } from '../../games/tarneeb/rules';
import { teamDisplayName, pairTeamSeats } from '../teamName';
import type { TarneebState } from '../../games/tarneeb/types';
import MatchResult from '../components/MatchResult';
import { competitionPlaces, playerAvatar, type ResultSeat, type ResultTeam } from '../components/matchResultModel';
import RematchControls, { type RematchUi } from '../online/RematchControls';

interface Props {
  state: TarneebState;
  /** The human's seat (always 0 in the local game). */
  humanSeat: number;
  onPlayAgain: () => void;
  onExit: () => void;
  /** Online rematch controls (Stage 25.9). */
  rematch?: RematchUi | null;
}

/** End screen: did the human's team (Pairs) / self (Solo) win at the match target (default 41). */
export default function TarneebFinished({ state, humanSeat, onPlayAgain, onExit, rematch }: Props) {
  const { t } = useI18n();
  const actions = <>
    {rematch
      ? <RematchControls {...rematch} />
      : <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('tarneeb.playAgain')}</button>}
    <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
  </>;

  if (isSoloTarneeb(state)) {
    // Solo: an INDIVIDUAL winner; the others ranked by score (seat order breaks ties).
    const winnerSeat = state.soloWinnerSeat ?? -1;
    const scores = state.scoresBySeat ?? [0, 0, 0, 0];
    const humanWon = winnerSeat === humanSeat;
    const places = competitionPlaces(state.players, (a, b) =>
      Number(b.seatIndex === winnerSeat) - Number(a.seatIndex === winnerSeat)
      || scores[b.seatIndex] - scores[a.seatIndex]);
    const seats: ResultSeat[] = state.players.map((p, i) => ({
      key: p.id, name: p.name, avatar: playerAvatar(p), isMe: p.seatIndex === humanSeat,
      place: places[i], value: String(scores[p.seatIndex]),
    }));
    const winnerName = winnerSeat >= 0 ? (winnerSeat === humanSeat ? t('tarneeb.you') : state.players[winnerSeat]?.name ?? '') : '';
    return (
      <MatchResult
        game="tarneeb" outcome={humanWon ? 'win' : 'loss'}
        title={humanWon ? t('tarneeb.youWon') : t('tarneeb.youLost')}
        subtitle={winnerSeat >= 0 ? t('tarneeb.playerWon').replace('{name}', winnerName) : undefined}
        seats={seats} actions={actions}
      />
    );
  }

  // Pairs: two teams (A = seats 0 & 2, B = 1 & 3), named by their players.
  const myTeam = teamOfSeat(humanSeat);
  const humanWon = state.winnerTeam === myTeam;
  const nameOf = (seat: number) => state.players[seat]?.name;
  const team = (id: 'A' | 'B'): ResultTeam => {
    const seatsOf = pairTeamSeats(id === 'A' ? 0 : 1);
    return {
      key: id,
      label: teamDisplayName(seatsOf, nameOf, t, id === myTeam ? 'tarneeb.teamUs' : 'tarneeb.teamThem'),
      members: seatsOf.map((s) => {
        const p = state.players[s];
        return { name: p?.name ?? '', avatar: p ? playerAvatar(p) : '?', isMe: s === humanSeat };
      }),
      value: String(state.scoresByTeam[id]),
      won: state.winnerTeam === id,
    };
  };
  const other = myTeam === 'A' ? 'B' : 'A';
  return (
    <MatchResult
      game="tarneeb" outcome={humanWon ? 'win' : 'loss'}
      title={humanWon ? t('tarneeb.youWon') : t('tarneeb.youLost')}
      teams={[team(myTeam), team(other)]}
      actions={actions}
    />
  );
}
