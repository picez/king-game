import { useI18n } from '../../i18n';
import type { DebercState } from '../../games/deberc/types';
import { DebercScoreSheet } from './DebercScoreTable';
import MatchResult from '../components/MatchResult';
import { competitionPlaces, playerAvatar, type ResultSeat, type ResultTeam } from '../components/matchResultModel';
import RematchControls, { type RematchUi } from '../online/RematchControls';

interface Props {
  state: DebercState;
  humanId: string;
  onPlayAgain: () => void;
  onExit: () => void;
  /** Online rematch controls (Stage 25.9). */
  rematch?: RematchUi | null;
}

/** End screen: did the human's team win the match (target reached or деберц jackpot). */
export default function DebercFinished({ state, humanId, onPlayAgain, onExit, rematch }: Props) {
  const { t } = useI18n();
  const me = state.players.find((p) => p.id === humanId);
  const myTeam = me ? state.teamOf[me.seatIndex] : 0;
  const won = state.winnerTeam === myTeam;
  const membersOf = (team: number) => state.players.filter((p) => state.teamOf[p.seatIndex] === team);

  const actions = <>
    {rematch
      ? <RematchControls {...rematch} />
      : <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('deberc.playAgain')}</button>}
    <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
  </>;
  const details = <>
    {state.jackpot && <p className="result__subtitle">🎴 {t('deberc.jackpot')}</p>}
    {state.handHistory.length > 0 && <DebercScoreSheet state={state} />}
  </>;

  // 4p Pairs: two team cards. 3p Solo: every player is a "team" of one → ranked cards.
  if (state.teamCount === 2) {
    const team = (id: number): ResultTeam => ({
      key: String(id),
      label: membersOf(id).map((p) => p.name).join(' & '),
      members: membersOf(id).map((p) => ({ name: p.name, avatar: playerAvatar(p), isMe: p.id === humanId })),
      value: String(state.matchScore[id]),
      won: state.winnerTeam === id,
    });
    return (
      <MatchResult game="deberc" outcome={won ? 'win' : 'loss'}
        title={won ? t('deberc.youWon') : t('deberc.youLost')}
        teams={[team(myTeam), team(myTeam === 0 ? 1 : 0)]} actions={actions}>
        {details}
      </MatchResult>
    );
  }

  const teamOfP = (p: { seatIndex: number }) => state.teamOf[p.seatIndex];
  const places = competitionPlaces(state.players, (a, b) =>
    Number(teamOfP(b) === state.winnerTeam) - Number(teamOfP(a) === state.winnerTeam)
    || state.matchScore[teamOfP(b)] - state.matchScore[teamOfP(a)]);
  const seats: ResultSeat[] = state.players.map((p, i) => ({
    key: p.id, name: p.name, avatar: playerAvatar(p), isMe: p.id === humanId,
    place: places[i], value: String(state.matchScore[teamOfP(p)]),
  }));
  return (
    <MatchResult game="deberc" outcome={won ? 'win' : 'loss'}
      title={won ? t('deberc.youWon') : t('deberc.youLost')} seats={seats} actions={actions}>
      {details}
    </MatchResult>
  );
}
