import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { DebercMatchSize } from '../../games/deberc/types';
import { DebercRulesList } from './DebercHelp';

interface Props {
  onStart: (matchSize: DebercMatchSize, playerCount: number) => void;
  onExit: () => void;
}

/** Local Deberc setup: pick the match size (small 510 / big 1020) and seat count (3–4). */
export default function DebercSetup({ onStart, onExit }: Props) {
  const { t } = useI18n();
  const [matchSize, setMatchSize] = useState<DebercMatchSize>('small');
  const [count, setCount] = useState(3);
  const [showHelp, setShowHelp] = useState(false);

  const sizes: { id: DebercMatchSize; name: string; desc: string }[] = [
    { id: 'small', name: t('deberc.small'), desc: t('deberc.smallDesc') },
    { id: 'big', name: t('deberc.big'), desc: t('deberc.bigDesc') },
  ];

  return (
    <div className="screen menu-screen durak-setup">
      <header className="menu-header">
        <h1 className="menu-title">🎴 {t('gameType.deberc')}</h1>
        <p className="menu-tagline">{t('deberc.setupTagline')}</p>
      </header>

      <div className="setup-card">
        <label className="field__label">{t('deberc.matchSize')}</label>
        <div className="durak-variant-cards">
          {sizes.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`durak-variant-card ${matchSize === v.id ? 'durak-variant-card--active' : ''}`}
              aria-pressed={matchSize === v.id}
              onClick={() => setMatchSize(v.id)}
            >
              <span className="durak-variant-card__name">{v.name}</span>
              <span className="durak-variant-card__desc">{v.desc}</span>
            </button>
          ))}
        </div>

        <label className="field__label">{t('deberc.players')}</label>
        <div className="segmented">
          {[3, 4].map((n) => (
            <button key={n} type="button" className={`segmented__tab ${count === n ? 'segmented__tab--active' : ''}`} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
        <p className="durak-setup__hint">{t('deberc.botsHint')}</p>

        <button type="button" className="durak-howto" aria-expanded={showHelp} onClick={() => setShowHelp((s) => !s)}>
          ❓ {t('deberc.howToPlay')} <span aria-hidden="true">{showHelp ? '▴' : '▾'}</span>
        </button>
        {showHelp && <DebercRulesList />}

        <button type="button" className="btn btn--primary durak-setup__start" onClick={() => onStart(matchSize, count)}>
          {t('deberc.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
      </div>
    </div>
  );
}
