import { useState } from 'react';
import { useGame } from '../hooks/useGame';
import { useI18n } from '../i18n';
import { getCurrentPlayer } from '../core/gameEngine';
import { getValidCards } from '../core/rules';
import type { Card, Suit } from '../models/types';
import { SUIT_SYMBOL } from './components/CardView';
import PlayerHand from './components/PlayerHand';
import TablePlayers from './components/TablePlayers';
import CollectedPanel from './components/CollectedPanel';
import ScoreBoard from './components/ScoreBoard';

const SUIT_COLOR_CLASS: Record<Suit, string> = {
  hearts:   'trump-suit--red',
  diamonds: 'trump-suit--red',
  spades:   'trump-suit--black',
  clubs:    'trump-suit--black',
};

export default function GameScreen() {
  const { state, dispatch } = useGame();
  const { t } = useI18n();
  const [showScores, setShowScores] = useState(false);

  if (!state) return null;

  const { currentRound, currentTrick, players, scores } = state;
  const totalRounds = state.modeQueue.length;
  const roundNum = state.currentRoundIdx + 1;
  const dealer = players[state.dealerIndex];
  const currentPlayer = getCurrentPlayer(state);
  const isAI = currentPlayer.type === 'ai';
  const ledSuit = currentTrick?.ledSuit ?? null;
  const validCards = isAI ? [] : getValidCards(currentPlayer.hand, ledSuit, currentRound.mode.id);

  const modeLabel = t(`mode.${currentRound.mode.id}`);
  const modeType  = currentRound.mode.type;

  function handlePlay(card: Card) {
    dispatch({ type: 'PLAY_CARD', playerId: currentPlayer.id, card });
  }

  return (
    <div className="screen game-screen">

      {/* ── Header ── */}
      <div className="game-header">
        <div className="game-header__info">
          <span className={`mode-badge mode-badge--${modeType}`}>{modeLabel}</span>
          <span className="round-info">{t('common.round')} {roundNum} / {totalRounds}</span>

          <span className="dealer-info">
            <span className="dealer-crown" title="Dealer">👑</span>{dealer?.name}
            {dealer?.type === 'ai' && <span className="ai-badge">🤖</span>}
          </span>

          {state.trumpSuit ? (
            <span className={`trump-info trump-suit-badge ${SUIT_COLOR_CLASS[state.trumpSuit]}`}>
              {SUIT_SYMBOL[state.trumpSuit]}
            </span>
          ) : currentRound.mode.id === 'trump' ? (
            <span className="trump-info trump-info--none">∅</span>
          ) : null}
        </div>

        <button
          className="btn btn--ghost btn--small"
          onClick={() => setShowScores((s) => !s)}
        >
          {showScores ? t('game.hideScores') : t('game.scores')}
        </button>
      </div>

      {showScores && <ScoreBoard players={players} scores={scores} />}

      {/* ── Table: seats around a central trick zone ── */}
      <div className="game-body">
        <TablePlayers viewerId={currentPlayer.id} />
      </div>

      {/* ── Active player footer ── */}
      <div className="game-footer">
        {isAI ? (
          <div className="turn-banner turn-banner--ai">
            <span className="ai-thinking-icon">🤖</span>
            <span className="turn-banner__name">{currentPlayer.name} {t('game.thinking')}</span>
          </div>
        ) : (
          <div className="turn-banner turn-banner--active">
            <span className="turn-banner__indicator">▶</span>
            <span className="turn-banner__name">{currentPlayer.name} · {t('game.turn')}</span>
            <span className="turn-banner__cards">
              {currentPlayer.hand.length} {t('game.cards')}
            </span>
            {ledSuit && (
              <span className="turn-banner__led">
                {t('game.follow')}: <strong>{SUIT_SYMBOL[ledSuit]} {t(`suit.${ledSuit}`)}</strong>
              </span>
            )}
          </div>
        )}

        {!isAI && (
          <p className="mode-tip">
            {modeType === 'positive' ? t('tip.positive') : t(`tip.${currentRound.mode.id}`)}
          </p>
        )}

        {!isAI && <CollectedPanel playerId={currentPlayer.id} />}

        {isAI ? (
          <div className="ai-hand-placeholder">
            {currentPlayer.hand.map((_, i) => (
              <span key={i} className="ai-card-back">🂠</span>
            ))}
          </div>
        ) : (
          <PlayerHand
            hand={currentPlayer.hand}
            validCards={validCards}
            onPlay={handlePlay}
          />
        )}
      </div>
    </div>
  );
}
