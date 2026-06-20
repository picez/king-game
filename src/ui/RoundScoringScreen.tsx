import { useEffect, useState } from 'react';
import { useGame } from '../hooks/useGame';
import { useI18n } from '../i18n';
import { SUIT_SYMBOL } from './components/CardView';
import ScoreTracker from './components/ScoreTracker';
import type { Card, Suit } from '../models/types';

const SUIT_ORDER: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
/** Matches the server's ROUND_ADVANCE_MS so the countdown reads true online. */
const ROUND_COUNTDOWN_S = 10;

function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const si = SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit);
    return si !== 0 ? si : b.value - a.value;
  });
}

function isRed(suit: Suit) {
  return suit === 'hearts' || suit === 'diamonds';
}

export default function RoundScoringScreen() {
  const { state, dispatch, online } = useGame();
  const { t } = useI18n();
  if (!state) return null;
  const st = state; // non-null alias for use inside closures

  const { currentRound, players, scores } = st;
  const roundIdx = st.currentRoundIdx;
  const roundNum = roundIdx + 1;
  const totalRounds = st.modeQueue.length;
  const isLastRound = roundIdx + 1 >= totalRounds;

  const dealer = players.find((p) => p.id === currentRound.dealerId);

  const [showCollected, setShowCollected] = useState(false);
  const [showGames, setShowGames] = useState(false);

  // Online: the server auto-advances after ROUND_ADVANCE_MS — show a countdown
  // so the screen doesn't vanish without warning.
  const [secondsLeft, setSecondsLeft] = useState(ROUND_COUNTDOWN_S);
  useEffect(() => {
    if (!online) return;
    const t = setInterval(() => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [online]);

  function handleNext() {
    // App.tsx centrally shows the PassScreen for whoever acts first in the
    // next round (dealer for setup steps, leader for negative modes), keyed
    // by playerId. Works identically for fixed and dealer's-choice modes.
    dispatch({ type: 'NEXT_ROUND' });
  }

  return (
    <div className="screen scoring-screen">
      <div className="scoring-card">
        <div className="scoring-header">
          <span className={`mode-badge mode-badge--${currentRound.mode.type}`}>
            {t(`mode.${currentRound.mode.id}`)}
          </span>
          <h2>{t('common.round')} {roundNum} / {totalRounds} {t('scoring.complete')}</h2>
          <p>{t('common.dealer')}: {dealer?.name}</p>
        </div>


        {/* Round scores table */}
        <table className="score-table">
          <thead>
            <tr>
              <th>{t('scoring.player')}</th>
              <th>{t('scoring.thisRound')}</th>
              <th>{t('scoring.total')}</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const roundScore = currentRound.scores[p.id] ?? 0;
              const total = scores[p.id]?.total ?? 0;
              return (
                <tr key={p.id}>
                  <td>{p.name}{p.id === currentRound.dealerId ? ' 🂡' : ''}</td>
                  <td className={roundScore >= 0 ? 'score--positive' : 'score--negative'}>
                    {roundScore >= 0 ? `+${roundScore}` : roundScore}
                  </td>
                  <td className={total >= 0 ? 'score--positive' : 'score--negative'}>
                    {total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Score tracker: per-dealer game matrix with totals */}
        <div className="collected-section">
          <button
            className="btn btn--outline btn--small"
            onClick={() => setShowGames((v) => !v)}
          >
            {t('track.title')} {showGames ? '▴' : '▾'}
          </button>
          {showGames && <ScoreTracker state={st} />}
        </div>

        {/* Collected cards toggle */}
        <div className="collected-section">
          <button
            className="btn btn--outline btn--small"
            onClick={() => setShowCollected((v) => !v)}
          >
            {showCollected ? t('scoring.hideCollected') : t('scoring.showCollected')}
          </button>

          {showCollected && (
            <div className="collected-players">
              {players.map((p) => {
                const cards = sortHand(currentRound.collectedCards[p.id] ?? []);
                return (
                  <div key={p.id} className="collected-player">
                    <div className="collected-player__name">
                      {p.name} <span className="collected-count">({cards.length} {t('scoring.cards')})</span>
                    </div>
                    <div className="mini-cards">
                      {cards.map((card, i) => (
                        <span
                          key={i}
                          className={`mini-card ${isRed(card.suit) ? 'mini-card--red' : 'mini-card--black'}`}
                        >
                          {card.rank}{SUIT_SYMBOL[card.suit as Suit]}
                        </span>
                      ))}
                      {cards.length === 0 && <span className="mini-card--none">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {online ? (
          <p className="mode-tip" style={{ textAlign: 'center' }}>
            {isLastRound
              ? `${t('scoring.finalIn')} ${secondsLeft}s…`
              : `${t('scoring.nextRoundIn')} ${secondsLeft}s…`}
          </p>
        ) : (
          <button className="btn btn--primary btn--large" onClick={handleNext}>
            {isLastRound ? t('scoring.seeResults') : t('scoring.nextRound')}
          </button>
        )}
      </div>
    </div>
  );
}
