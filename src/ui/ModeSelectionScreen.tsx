import { useGame } from '../hooks/useGame';
import { useI18n } from '../i18n';
import type { GameModeId } from '../models/types';
import { sortHand } from '../core/rules';
import CardView from './components/CardView';

const MODE_META: Record<GameModeId, 'negative' | 'positive'> = {
  no_tricks: 'negative', no_hearts: 'negative', no_queens: 'negative', no_jacks: 'negative',
  king_of_hearts: 'negative', last_two_tricks: 'negative', trump: 'positive',
};

export default function ModeSelectionScreen() {
  const { state, dispatch } = useGame();
  const { t } = useI18n();
  if (!state) return null;
  const st = state; // non-null alias for use inside closures

  const dealer = st.players[st.dealerIndex];
  const roundNum = st.currentRoundIdx + 1;
  const totalRounds = st.modeQueue.length;
  // This dealer's OWN remaining modes — not a global shared pool.
  const remaining = st.dealerModes[dealer.id];
  const gamesLeft = (Object.values(remaining) as number[]).reduce((a, b) => a + b, 0);

  function handleChoose(modeId: GameModeId) {
    // App.tsx shows the PassScreen for whoever acts next (leader for negative
    // modes, dealer again for trump kitty/trump selection).
    dispatch({ type: 'CHOOSE_MODE', modeId });
  }

  const isFirstRound = st.currentRoundIdx === 0;

  return (
    <div className="screen center-screen">
      <div className="modal-card modal-card--wide">
        <h2>{t('mode.choose')}</h2>
        <p className="modal-card__sub">
          {t('common.round')} {roundNum}/{totalRounds} · {t('common.dealer')}: <strong>{dealer.name}</strong>
        </p>
        {isFirstRound && (
          <p className="first-dealer-note">🎲 {t('game.firstDealer')}: <strong>{dealer.name}</strong></p>
        )}
        <p className="modal-card__desc">
          {dealer.name}: {t('mode.lookPick')} ({gamesLeft} {t('mode.gamesLeft')}).
        </p>

        {/* Dealer sees their own initial hand (before taking the kitty).
            Larger, readable preview cards that wrap on a phone (no overflow). */}
        <div className="mode-hand mode-hand--preview">
          {sortHand(dealer.hand).map((c, i) => (
            <CardView key={i} card={c} preview disabled />
          ))}
        </div>

        <div className="mode-selection-grid">
          {(Object.keys(MODE_META) as GameModeId[]).map((id) => {
            const type = MODE_META[id];
            const count = remaining[id] ?? 0;
            const isAvailable = count > 0;
            const label = id === 'trump' ? `${t('mode.trump')} (${count} ${t('mode.gamesLeft')})` : t(`mode.${id}`);
            return (
              <button
                key={id}
                className={`mode-btn mode-btn--${type} ${!isAvailable ? 'mode-btn--used' : ''}`}
                onClick={() => isAvailable && handleChoose(id)}
                disabled={!isAvailable}
                title={!isAvailable ? t('mode.used') : undefined}
              >
                <span className="mode-btn__name">{label}</span>
                <span className="mode-btn__desc">{t(`modeDesc.${id}`)}</span>
                <span className={`mode-btn__type mode-btn__type--${type}`}>
                  {t(`type.${type}`)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
