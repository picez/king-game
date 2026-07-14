import { useState } from 'react';
import { useI18n } from '../../i18n';
import GameHelpModal from '../components/GameHelpModal';
import { deckCountFor, totalDeckSize } from '../../games/fiftyOne/deck';

interface Props {
  onStart: (playerCount: number) => void;
  onExit: () => void;
}

const PLAYER_COUNTS = [2, 3, 4] as const;

/**
 * Local 51 (Syrian 51) setup — pick 2–4 players (1 human + bots). Shows the deck
 * rule that follows from the count (§3): 2p = 1 deck + 2 jokers, 3–4p = 2 decks +
 * 2 jokers. Experimental local prototype (Stage 30.3): no online, no stats.
 */
export default function FiftyOneSetup({ onStart, onExit }: Props) {
  const { t } = useI18n();
  const [count, setCount] = useState<number>(4);
  const [showHelp, setShowHelp] = useState(false);

  const decks = deckCountFor(count);
  const deckNote = t(decks === 1 ? 'fiftyOne.deckNote2' : 'fiftyOne.deckNote34')
    .replace('{total}', String(totalDeckSize(count)));

  return (
    <div className="screen menu-screen fiftyone-setup">
      {showHelp && <GameHelpModal game="fifty-one" onClose={() => setShowHelp(false)} />}

      <header className="menu-header">
        <h1 className="menu-title">🀄 {t('gameType.fifty-one')}</h1>
        <p className="menu-tagline">{t('fiftyOne.setupTagline')}</p>
      </header>

      <div className="setup-card">
        <p className="fiftyone-setup__note fiftyone-setup__note--exp">🧪 {t('fiftyOne.experimentalNote')}</p>

        <label className="field__label">{t('fiftyOne.players')}</label>
        <div className="fiftyone-setup__counts" role="group" aria-label={t('fiftyOne.players')}>
          {PLAYER_COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              className={`btn ${n === count ? 'btn--primary' : 'btn--ghost'} fiftyone-setup__count`}
              aria-pressed={n === count}
              onClick={() => setCount(n)}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="fiftyone-setup__players">👥 {t('fiftyOne.playersHint').replace('{n}', String(count))}</p>
        <p className="fiftyone-setup__deck">🂠 {deckNote}</p>

        <button
          type="button"
          className="fiftyone-howto"
          aria-expanded={showHelp}
          onClick={() => setShowHelp(true)}
        >
          ❓ {t('help.howToPlay')}
        </button>

        <button type="button" className="btn btn--primary fiftyone-setup__start" onClick={() => onStart(count)}>
          {t('fiftyOne.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>
          {t('btn.backToMenu')}
        </button>
      </div>
    </div>
  );
}
