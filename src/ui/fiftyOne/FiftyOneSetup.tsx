import { useState } from 'react';
import { useI18n } from '../../i18n';
import GameHelpModal from '../components/GameHelpModal';
import { fiftyOneDeckNote } from './deckNote';
import { DEFAULT_TARGET_PENALTY, ELIMINATION_SCORE_PRESETS } from '../../games/fiftyOne/rules';

interface Props {
  onStart: (playerCount: number, eliminationScore: number) => void;
  onExit: () => void;
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6] as const;

/**
 * Local 51 (Syrian 51) setup — pick 2–6 players (1 human + bots). Shows the deck
 * rule that follows from the count (§3): 2p = 1 deck + 2 jokers, 3–4p = 2 decks +
 * 2 jokers, 5–6p = 3 decks + 3 jokers (Stage 43.2). Released game (Stage 30.7): local + online + stats.
 */
export default function FiftyOneSetup({ onStart, onExit }: Props) {
  const { t } = useI18n();
  const [count, setCount] = useState<number>(4);
  // Elimination score (Stage 30.15): default 510; the player may pick a shorter match.
  const [eliminationScore, setEliminationScore] = useState<number>(DEFAULT_TARGET_PENALTY);
  const [showHelp, setShowHelp] = useState(false);

  const deckNote = fiftyOneDeckNote(t, count);

  return (
    <div className="screen menu-screen fiftyone-setup">
      {showHelp && <GameHelpModal game="fifty-one" onClose={() => setShowHelp(false)} />}

      <header className="menu-header">
        <h1 className="menu-title">🀄 {t('gameType.fifty-one')}</h1>
        <p className="menu-tagline">{t('fiftyOne.setupTagline')}</p>
      </header>

      <div className="setup-card">
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

        <label className="field__label">☠️ {t('fiftyOne.eliminationScore')}</label>
        <div className="fiftyone-setup__counts fiftyone-elim-picker" role="group" aria-label={t('fiftyOne.eliminationScore')}>
          {ELIMINATION_SCORE_PRESETS.map((v) => (
            <button
              key={v}
              type="button"
              className={`btn ${v === eliminationScore ? 'btn--primary' : 'btn--ghost'} fiftyone-setup__count`}
              aria-pressed={v === eliminationScore}
              onClick={() => setEliminationScore(v)}
            >
              {v}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="fiftyone-howto"
          aria-expanded={showHelp}
          onClick={() => setShowHelp(true)}
        >
          ❓ {t('help.howToPlay')}
        </button>

        <button type="button" className="btn btn--primary fiftyone-setup__start" onClick={() => onStart(count, eliminationScore)}>
          {t('fiftyOne.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>
          {t('btn.backToMenu')}
        </button>
      </div>
    </div>
  );
}
