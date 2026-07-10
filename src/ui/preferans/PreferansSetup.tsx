import { useState } from 'react';
import { useI18n } from '../../i18n';
import { PreferansRulesList } from './PreferansHelp';

interface Props {
  onStart: () => void;
  onExit: () => void;
}

/**
 * Local Preferans setup. Preferans is a fixed 3-player game (PREFERANS_RULES §2)
 * with an MVP target of 10 (§11), so there is nothing to configure — this screen
 * explains the table and starts a 1-human + 2-bot game. Experimental (Stage 19.3):
 * local prototype only, no online yet.
 */
export default function PreferansSetup({ onStart, onExit }: Props) {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="screen menu-screen preferans-setup">
      <header className="menu-header">
        <h1 className="menu-title">🎩 {t('gameType.preferans')}</h1>
        <p className="menu-tagline">{t('preferans.setupTagline')}</p>
      </header>

      <div className="setup-card">
        <p className="preferans-setup__badge">🧪 {t('preferans.experimentalNote')}</p>
        <p className="preferans-setup__players">👥 {t('preferans.botsHint')}</p>
        <p className="preferans-setup__target">
          🎯 {t('preferans.target')}: <strong>10</strong>
        </p>

        <button
          type="button"
          className="preferans-howto"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((s) => !s)}
        >
          ❓ {t('preferans.howToPlay')} <span aria-hidden="true">{showHelp ? '▴' : '▾'}</span>
        </button>
        {showHelp && <PreferansRulesList />}

        <button type="button" className="btn btn--primary preferans-setup__start" onClick={onStart}>
          {t('preferans.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>
          {t('btn.backToMenu')}
        </button>
      </div>
    </div>
  );
}
