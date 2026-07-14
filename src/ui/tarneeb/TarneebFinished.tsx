import { useI18n } from '../../i18n';
import { isSoloTarneeb, teamOfSeat } from '../../games/tarneeb/rules';
import { teamDisplayName, pairTeamSeats } from '../teamName';
import type { TarneebState } from '../../games/tarneeb/types';
import WinnerCelebration from '../components/WinnerCelebration';
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
  if (isSoloTarneeb(state)) {
    return <SoloFinished state={state} humanSeat={humanSeat} onPlayAgain={onPlayAgain} onExit={onExit} rematch={rematch} />;
  }
  const myTeam = teamOfSeat(humanSeat);
  const humanWon = state.winnerTeam === myTeam;
  const title = humanWon ? t('tarneeb.youWon') : t('tarneeb.youLost');
  // Name the two pairs by their players ("Alex & Dina") — Team A = seats 0&2, B = 1&3.
  const nameOf = (seat: number) => state.players[seat]?.name;
  const usLabel = teamDisplayName(pairTeamSeats(myTeam === 'A' ? 0 : 1), nameOf, t, 'tarneeb.teamUs');
  const themLabel = teamDisplayName(pairTeamSeats(myTeam === 'A' ? 1 : 0), nameOf, t, 'tarneeb.teamThem');

  return (
    <div className="screen tarneeb-screen tarneeb-finished">
      <div className="tarneeb-finished__card finish-frame">
        {/* Celebrate the winning team; a loss renders the calm state. */}
        <WinnerCelebration kind={humanWon ? 'teamWin' : 'loss'} />
        <div className="tarneeb-finished__emoji" aria-hidden="true">{humanWon ? '🏆' : '🙁'}</div>
        <h1 className="tarneeb-finished__title">{title}</h1>
        <p className="tarneeb-finished__sub">
          {state.winnerTeam && t('tarneeb.teamWon').replace('{team}', state.winnerTeam)}
        </p>
        <div className="tarneeb-finished__scores">
          <div className={`tarneeb-finished__score ${humanWon ? 'tarneeb-finished__score--win' : ''}`}>
            <span className="tarneeb-finished__score-label">{usLabel}</span>
            <span className="tarneeb-finished__score-value">{state.scoresByTeam[myTeam]}</span>
          </div>
          <div className={`tarneeb-finished__score ${!humanWon ? 'tarneeb-finished__score--win' : ''}`}>
            <span className="tarneeb-finished__score-label">{themLabel}</span>
            <span className="tarneeb-finished__score-value">{state.scoresByTeam[myTeam === 'A' ? 'B' : 'A']}</span>
          </div>
        </div>
        <div className="tarneeb-finished__actions">
          {rematch
            ? <RematchControls {...rematch} />
            : <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('tarneeb.playAgain')}</button>}
          <button type="button" className="btn btn--ghost" onClick={onExit}>
            {t('btn.backToMenu')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Solo end screen: an INDIVIDUAL winner (no teams) + a 4-player final standings. */
function SoloFinished({ state, humanSeat, onPlayAgain, onExit, rematch }: Props) {
  const { t } = useI18n();
  const winnerSeat = state.soloWinnerSeat ?? -1;
  const humanWon = winnerSeat === humanSeat;
  const scores = state.scoresBySeat ?? [0, 0, 0, 0];
  const title = humanWon ? t('tarneeb.youWon') : t('tarneeb.youLost');
  const nameOf = (seat: number) => (seat === humanSeat ? t('tarneeb.you') : state.players[seat]?.name ?? '');
  // Standings, highest first (seat order breaks ties deterministically).
  const standings = state.players
    .map((p) => ({ seat: p.seatIndex, score: scores[p.seatIndex] }))
    .sort((a, b) => b.score - a.score || a.seat - b.seat);

  return (
    <div className="screen tarneeb-screen tarneeb-finished">
      <div className="tarneeb-finished__card finish-frame">
        <WinnerCelebration kind={humanWon ? 'win' : 'loss'} />
        <div className="tarneeb-finished__emoji" aria-hidden="true">{humanWon ? '🏆' : '🙁'}</div>
        <h1 className="tarneeb-finished__title">{title}</h1>
        <p className="tarneeb-finished__sub">
          {winnerSeat >= 0 && t('tarneeb.playerWon').replace('{name}', nameOf(winnerSeat))}
        </p>
        <div className="tarneeb-finished__scores tarneeb-finished__scores--solo">
          {standings.map(({ seat, score }) => (
            <div key={seat} className={`tarneeb-finished__score ${seat === winnerSeat ? 'tarneeb-finished__score--win' : ''}`}>
              <span className="tarneeb-finished__score-label">{nameOf(seat)}</span>
              <span className="tarneeb-finished__score-value">{score}</span>
            </div>
          ))}
        </div>
        <div className="tarneeb-finished__actions">
          {rematch
            ? <RematchControls {...rematch} />
            : <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('tarneeb.playAgain')}</button>}
          <button type="button" className="btn btn--ghost" onClick={onExit}>
            {t('btn.backToMenu')}
          </button>
        </div>
      </div>
    </div>
  );
}
