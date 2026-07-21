import { useState } from 'react';
import { useI18n } from '../../i18n';
import GameHelpModal from '../components/GameHelpModal';
import { MAX_PLAYERS, MIN_PLAYERS } from '../../games/poker/rules';

interface Props {
  onStart: (playerCount: number) => void;
  onExit: () => void;
}

const PLAYER_COUNTS = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i); // 2..6

/** Local poker setup — pick 2–6 seats (1 human + bots). No-Limit Hold'em, fixed blinds. */
export default function PokerSetup({ onStart, onExit }: Props) {
  const { t } = useI18n();
  const [count, setCount] = useState<number>(4);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="screen menu-screen poker-setup">
      {showHelp && <GameHelpModal game="poker" onClose={() => setShowHelp(false)} />}

      <header className="menu-header">
        <h1 className="menu-title">♠️ {t('gameType.poker')}</h1>
        <p className="menu-tagline">{t('poker.setupTagline')}</p>
      </header>

      <div className="setup-card">
        <label className="field__label">{t('poker.players')}</label>
        <div className="poker-setup__counts" role="group" aria-label={t('poker.players')}>
          {PLAYER_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              className={`btn ${n === count ? 'btn--primary' : 'btn--ghost'} poker-setup__count`}
              aria-pressed={n === count}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="poker-setup__hint">👥 {t('poker.playersHint').replace('{n}', String(count))}</p>
        <p className="poker-setup__blinds">🪙 {t('poker.blindsNote')}</p>

        <button type="button" className="poker-howto" aria-expanded={showHelp} onClick={() => setShowHelp(true)}>
          ❓ {t('help.howToPlay')}
        </button>

        <button type="button" className="btn btn--primary poker-setup__start" onClick={() => onStart(count)}>
          {t('poker.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
      </div>
    </div>
  );
}
