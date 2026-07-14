import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { TarneebVariant } from '../../games/tarneeb/types';
import { DEFAULT_TARGET_SCORE, TARGET_SCORE_PRESETS } from '../../games/tarneeb/rules';
import { TarneebRulesList } from './TarneebHelp';

interface Props {
  onStart: (variant: TarneebVariant, targetScore: number) => void;
  onExit: () => void;
}

/**
 * Local Tarneeb setup. Two released modes (Stage 28.3), chosen with a segmented
 * selector, default Pairs so existing behaviour is unchanged:
 *  - Pairs — the classic 4-player, 2×2 partnership game (teams 0&2 vs 1&3);
 *  - Solo  — 4-player cutthroat, every player for themselves (Stage 28.1 core).
 * Both start a 1-human + 3-bot table; the host picks the match target (default 41,
 * presets 31/41/61/101 — Stage 29.8). Both modes are also released online (Stage 28.4).
 */
export default function TarneebSetup({ onStart, onExit }: Props) {
  const { t } = useI18n();
  const [showHelp, setShowHelp] = useState(false);
  const [variant, setVariant] = useState<TarneebVariant>('pairs');
  // Match target (Stage 29.8): choose how many points wins the match. Default 41 (unchanged).
  const [targetScore, setTargetScore] = useState<number>(DEFAULT_TARGET_SCORE);

  const modes: { id: TarneebVariant; name: string; desc: string }[] = [
    { id: 'pairs', name: t('tarneeb.modePairs'), desc: t('tarneeb.modePairsDesc') },
    { id: 'solo', name: t('tarneeb.modeSolo'), desc: t('tarneeb.modeSoloDesc') },
  ];

  return (
    <div className="screen menu-screen tarneeb-setup">
      <header className="menu-header">
        <h1 className="menu-title">🃏 {t('gameType.tarneeb')}</h1>
        <p className="menu-tagline">{t('tarneeb.setupTagline')}</p>
      </header>

      <div className="setup-card">
        <label className="field__label">{t('tarneeb.mode')}</label>
        <div className="durak-variant-cards">
          {modes.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`durak-variant-card ${variant === m.id ? 'durak-variant-card--active' : ''}`}
              aria-pressed={variant === m.id}
              onClick={() => setVariant(m.id)}
            >
              <span className="durak-variant-card__name">{m.name}</span>
              <span className="durak-variant-card__desc">{m.desc}</span>
            </button>
          ))}
        </div>

        <label className="field__label tarneeb-setup__target-label">🎯 {t('tarneeb.targetScore')}</label>
        <div className="segmented segmented--inline tarneeb-target-picker" role="group" aria-label={t('tarneeb.targetScore')}>
          {TARGET_SCORE_PRESETS.map((v) => (
            <button key={v} type="button"
              className={`segmented__tab ${targetScore === v ? 'segmented__tab--active' : ''}`}
              aria-pressed={targetScore === v}
              onClick={() => setTargetScore(v)}>
              {v}
            </button>
          ))}
        </div>
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

        <button type="button" className="btn btn--primary tarneeb-setup__start" onClick={() => onStart(variant, targetScore)}>
          {t('tarneeb.start')}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>
          {t('btn.backToMenu')}
        </button>
      </div>
    </div>
  );
}
