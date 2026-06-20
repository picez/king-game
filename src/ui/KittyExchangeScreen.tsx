import { useState } from 'react';
import { useGame } from '../hooks/useGame';
import { useI18n } from '../i18n';
import type { Card } from '../models/types';
import { sortHand, cardEquals } from '../core/rules';
import { canDiscardToKitty } from '../core/kitty';
import CardView, { SUIT_SYMBOL } from './components/CardView';
import TurnTimer from './components/TurnTimer';

export default function KittyExchangeScreen() {
  const { state, dispatch } = useGame();
  const { t } = useI18n();
  const [selected, setSelected] = useState<Card[]>([]);

  if (!state) return null;

  const dealer = state.players[state.dealerIndex];
  const kittySize = state.config.kittySize;
  const modeId = state.currentRound.mode.id;
  const modeName = t(`mode.${modeId}`);
  const isTrump = modeId === 'trump';
  const sorted = sortHand(dealer.hand);

  function toggleCard(card: Card) {
    // Illegal discards (current mode's penalty cards) can never be selected.
    if (!canDiscardToKitty(card, modeId)) return;
    setSelected((prev) => {
      const exists = prev.some((c) => cardEquals(c, card));
      if (exists) return prev.filter((c) => !cardEquals(c, card));
      if (prev.length >= kittySize) return prev; // max selection reached
      return [...prev, card];
    });
  }

  function handleConfirm() {
    if (selected.length !== kittySize) return;
    if (selected.some((c) => !canDiscardToKitty(c, modeId))) return; // safety net
    dispatch({ type: 'EXCHANGE_KITTY', discards: selected });
  }

  return (
    <div className="screen center-screen">
      <div className="modal-card modal-card--wide">
        <div className="modal-card__timer"><TurnTimer /></div>
        <h2>{t('kitty.title')}</h2>
        <p className="modal-card__sub">
          <strong>{modeName}</strong>
          {isTrump && (
            <> · {t('common.trump')}: <strong>{state.trumpSuit ? SUIT_SYMBOL[state.trumpSuit] : t('common.noTrump')}</strong></>
          )}
          {' '}· {t('common.dealer')}: <strong>{dealer.name}</strong>
        </p>
        <p className="modal-card__desc">
          {t('kitty.intro')}
          {modeId !== 'no_tricks' && modeId !== 'last_two_tricks' && !isTrump && (
            <> {t('kitty.locked')}</>
          )}
        </p>

        <p className="kitty-counter">
          {t('kitty.selected')}: {selected.length} / {kittySize}
        </p>

        <div className="player-hand">
          {sorted.map((card, i) => {
            const isLegal = canDiscardToKitty(card, modeId);
            const isSelected = selected.some((c) => cardEquals(c, card));
            const maxedOut = !isSelected && selected.length >= kittySize;
            const isDisabled = !isLegal || maxedOut;
            return (
              <CardView
                key={`${card.suit}-${card.rank}-${i}`}
                card={card}
                onClick={() => toggleCard(card)}
                selected={isSelected}
                dimmed={isDisabled}
                disabled={!isLegal}
              />
            );
          })}
        </div>

        <button
          className="btn btn--primary"
          disabled={selected.length !== kittySize}
          onClick={handleConfirm}
        >
          {`${t('kitty.discard')} ${kittySize} →`}
        </button>
      </div>
    </div>
  );
}
