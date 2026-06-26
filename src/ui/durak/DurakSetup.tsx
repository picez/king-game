import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { DurakVariant } from '../../games/durak/types';

interface Props {
  onStart: (variant: DurakVariant, playerCount: number) => void;
  onExit: () => void;
}

/** Local Durak setup: pick the variant (Simple/Transfer) and seat count (2–4). */
export default function DurakSetup({ onStart, onExit }: Props) {
  const { t } = useI18n();
  const [variant, setVariant] = useState<DurakVariant>('simple');
  const [count, setCount] = useState(2);

  return (
    <div className="screen menu-screen durak-setup">
      <header className="menu-header">
        <h1 className="menu-title">🃏 {t('gameType.durak')}</h1>
        <p className="menu-tagline">{t('durak.setupTagline')}</p>
      </header>

      <div className="setup-card">
        <label className="field__label">{t('durak.variant')}</label>
        <div className="segmented">
          <button type="button" className={`segmented__tab ${variant === 'simple' ? 'segmented__tab--active' : ''}`} onClick={() => setVariant('simple')}>
            {t('durak.variantSimple')}
          </button>
          <button type="button" className={`segmented__tab ${variant === 'transfer' ? 'segmented__tab--active' : ''}`} onClick={() => setVariant('transfer')}>
            {t('durak.variantTransfer')}
          </button>
        </div>

        <label className="field__label">{t('durak.players')}</label>
        <div className="segmented">
          {[2, 3, 4].map((n) => (
            <button key={n} type="button" className={`segmented__tab ${count === n ? 'segmented__tab--active' : ''}`} onClick={() => setCount(n)}>
              {n}
            </button>
          ))}
        </div>

        <p className="durak-setup__hint">{t('durak.botsHint')}</p>
        <button type="button" className="btn btn--primary durak-setup__start" onClick={() => onStart(variant, count)}>
          {t('durak.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
      </div>
    </div>
  );
}
