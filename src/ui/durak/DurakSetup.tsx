import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { DurakVariant } from '../../games/durak/types';
import { DurakRulesList } from './DurakHelp';

interface Props {
  onStart: (variant: DurakVariant, playerCount: number) => void;
  onExit: () => void;
}

/** Local Durak setup: pick the variant (Simple/Transfer) and seat count (2–4). */
export default function DurakSetup({ onStart, onExit }: Props) {
  const { t } = useI18n();
  const [variant, setVariant] = useState<DurakVariant>('simple');
  const [count, setCount] = useState(2);
  const [showHelp, setShowHelp] = useState(false);

  const variants: { id: DurakVariant; name: string; desc: string }[] = [
    { id: 'simple', name: t('durak.variantSimple'), desc: t('durak.simpleDesc') },
    { id: 'transfer', name: t('durak.variantTransfer'), desc: t('durak.transferDesc') },
  ];

  return (
    <div className="screen menu-screen durak-setup">
      <header className="menu-header">
        <h1 className="menu-title">🃏 {t('gameType.durak')}</h1>
        <p className="menu-tagline">{t('durak.setupTagline')}</p>
      </header>

      <div className="setup-card">
        <label className="field__label">{t('durak.variant')}</label>
        <div className="durak-variant-cards">
          {variants.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`durak-variant-card ${variant === v.id ? 'durak-variant-card--active' : ''}`}
              aria-pressed={variant === v.id}
              onClick={() => setVariant(v.id)}
            >
              <span className="durak-variant-card__name">{v.name}</span>
              <span className="durak-variant-card__desc">{v.desc}</span>
            </button>
          ))}
        </div>

        <label className="field__label">{t('durak.players')}</label>
        <div className="segmented">
          {[2, 3, 4, 5].map((n) => (
            <button key={n} type="button" className={`segmented__tab ${count === n ? 'segmented__tab--active' : ''}`} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>
        <p className="durak-setup__hint">{t('durak.botsHint')}</p>

        <button type="button" className="durak-howto" aria-expanded={showHelp} onClick={() => setShowHelp((s) => !s)}>
          ❓ {t('durak.howToPlay')} <span aria-hidden="true">{showHelp ? '▴' : '▾'}</span>
        </button>
        {showHelp && <DurakRulesList variant={variant} />}

        <button type="button" className="btn btn--primary durak-setup__start" onClick={() => onStart(variant, count)}>
          {t('durak.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
      </div>
    </div>
  );
}
