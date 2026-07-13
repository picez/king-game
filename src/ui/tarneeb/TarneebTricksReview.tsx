import { useI18n } from '../../i18n';
import { useEscToClose } from '../../hooks/useEscToClose';
import CardView from '../components/CardView';
import { isSoloTarneeb, teamOfSeat, otherTeam } from '../../games/tarneeb/rules';
import type { TarneebState } from '../../games/tarneeb/types';

/**
 * Review the tricks YOUR TEAM has taken this hand (Stage 27.3). Tarneeb is a 2×2 partnership game,
 * so this shows every completed trick won by your side, in play order with the lead card flagged.
 * Purely presentational: `completedTricks` already holds the PUBLIC played cards (no hidden hand is
 * read here — see the redaction note). The opponents' tally is shown as a count only.
 */
export default function TarneebTricksReview({ state, mySeat, onClose }: { state: TarneebState; mySeat: number; onClose: () => void }) {
  const { t } = useI18n();
  useEscToClose(onClose);
  const solo = isSoloTarneeb(state);
  const myTeam = teamOfSeat(mySeat);
  const nameOf = (seat: number) => state.players[seat]?.name ?? '';
  // Solo: only MY OWN tricks (no partner). Pairs: my whole team's tricks.
  const won = (winnerSeat: number) => (solo ? winnerSeat === mySeat : teamOfSeat(winnerSeat) === myTeam);
  const myTricks = state.completedTricks
    .map((trick, i) => ({ trick, no: i + 1 }))
    .filter(({ trick }) => trick.winnerSeat != null && won(trick.winnerSeat));
  const oppCount = solo
    ? state.completedTricks.length - myTricks.length
    : (state.tricksByTeam[otherTeam(myTeam)] ?? 0);
  const heading = solo ? t('tarneeb.myTricks') : t('tarneeb.teamTricks');

  return (
    <div className="durak-help-overlay" role="dialog" aria-modal="true" aria-label={heading} onClick={onClose}>
      <div className="durak-help tarneeb-tricks-modal" onClick={(e) => e.stopPropagation()}>
        <div className="durak-help__head">
          <h2 className="durak-help__title">🃏 {heading} · {myTricks.length}</h2>
          <button type="button" className="btn btn--ghost durak-help__x" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <p className="tarneeb-tricks__opp field__hint">{t('tarneeb.opponentTricks')}: {oppCount}</p>
        {myTricks.length === 0 ? (
          <p className="durak-help__variant">{t('tarneeb.noTricks')}</p>
        ) : (
          <div className="tarneeb-tricks">
            {myTricks.map(({ trick, no }) => {
              const plays = [...trick.plays].sort((a, b) => a.playOrder - b.playOrder);
              return (
                <div className="tarneeb-tricks__row" key={no}>
                  <span className="tarneeb-tricks__n">#{no}</span>
                  <span className="tarneeb-tricks__won">{trick.winnerSeat != null ? nameOf(trick.winnerSeat) : ''}</span>
                  <div className="tarneeb-tricks__cards">
                    {plays.map((p, j) => (
                      <CardView key={j} card={p.card} size="mini" disabled lead={p.seat === trick.leadSeat} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <button type="button" className="btn btn--primary durak-help__ok" onClick={onClose} autoFocus>{t('help.gotIt')}</button>
      </div>
    </div>
  );
}
