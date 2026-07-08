import { useState } from 'react';
import { useI18n } from '../../i18n';
import { TarneebRulesList } from './TarneebHelp';

interface Props {
  onStart: () => void;
  onExit: () => void;
}

/**
 * Local Tarneeb setup. Tarneeb is a fixed 4-player, two-team game with a fixed
 * MVP target of 41 (TARNEEB_RULES §2, §10), so there is nothing to configure —
 * this screen just explains the teams and starts a 1-human + 3-bot table.
 */
export default function TarneebSetup({ onStart, onExit }: Props) {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="screen menu-screen tarneeb-setup">
      <header className="menu-header">
        <h1 className="menu-title">🃏 {t('gameType.tarneeb')}</h1>
        <p className="menu-tagline">{t('tarneeb.setupTagline')}</p>
      </header>

      <div className="setup-card">
        <p className="tarneeb-setup__teams">👥 {t('tarneeb.teamsHint')}</p>
        <p className="tarneeb-setup__target">
          🎯 {t('tarneeb.target')}: <strong>41</strong>
        </p>
        <p className="tarneeb-setup__hint">{t('tarneeb.botsHint')}</p>

        <button
          type="button"
          className="tarneeb-howto"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((s) => !s)}
        >
          ❓ {t('tarneeb.howToPlay')} <span aria-hidden="true">{showHelp ? '▴' : '▾'}</span>
        </button>
        {showHelp && <TarneebRulesList />}

        <button type="button" className="btn btn--primary tarneeb-setup__start" onClick={onStart}>
          {t('tarneeb.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>
          {t('btn.backToMenu')}
        </button>
      </div>
    </div>
  );
}
