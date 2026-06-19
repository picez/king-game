import { useGame } from '../hooks/useGame';
import { useI18n } from '../i18n';
import type { Suit } from '../models/types';
import { SUIT_SYMBOL } from './components/CardView';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

export default function SelectTrumpScreen() {
  const { state, dispatch } = useGame();
  const { t } = useI18n();
  if (!state) return null;

  const st = state; // non-null alias for use inside closures
  const dealer = st.players[st.dealerIndex];
  const roundNum = st.currentRoundIdx + 1;
  const totalRounds = st.modeQueue.length;

  function handleSelect(suit: Suit | null) {
    // App.tsx shows the PassScreen for the first leader after trump is set.
    dispatch({ type: 'SELECT_TRUMP', suit });
  }

  return (
    <div className="screen center-screen">
      <div className="modal-card">
        <h2>{t('trump.title')}</h2>
        <p className="modal-card__sub">
          {t('common.round')} {roundNum}/{totalRounds} · {t('common.dealer')}: <strong>{dealer.name}</strong>
        </p>
        <p className="modal-card__desc">{t('trump.desc')}</p>

        <div className="suit-buttons">
          {SUITS.map((suit) => (
            <button
              key={suit}
              className={`suit-btn suit-btn--${suit}`}
              onClick={() => handleSelect(suit)}
            >
              <span className="suit-btn__symbol">{SUIT_SYMBOL[suit]}</span>
              <span className="suit-btn__name">{t(`suit.${suit}`)}</span>
            </button>
          ))}
          <button
            className="suit-btn suit-btn--notrump"
            onClick={() => handleSelect(null)}
          >
            <span className="suit-btn__symbol">∅</span>
            <span className="suit-btn__name">{t('common.noTrump')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
