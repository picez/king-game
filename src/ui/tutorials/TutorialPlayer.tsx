// ---------------------------------------------------------------------------
// TutorialPlayer (Stage 31.1) — data-driven walk-through for one game's scripted
// tutorial. Renders the current step's scene (TutorialBoard) + caption + controls
// (Back / Next / Skip·Done) + progress. Keyboard: ← / → / Esc. Client-only — no
// network, account, stats or achievements; Done/Skip return to the hub via onExit.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import type { GameType } from '../../games/catalog';
import { getTutorial } from '../../tutorials/catalog';
import { GAME_EMOJI } from '../components/GameIcon';
import TutorialBoard from './TutorialBoard';

interface Props {
  game: GameType;
  /** Return to the tutorial hub (Skip / Done / Esc / ✕). Never routes to a live game. */
  onExit: () => void;
}

export default function TutorialPlayer({ game, onExit }: Props) {
  const { t } = useI18n();
  const tutorial = getTutorial(game);
  const steps = tutorial.steps;
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const total = steps.length;
  const isLast = index >= total - 1;

  const back = () => setIndex((i) => Math.max(0, i - 1));
  const next = () => (isLast ? onExit() : setIndex((i) => Math.min(total - 1, i + 1)));

  // Keyboard: ← back, → next, Esc exits. Registered once; reads live handlers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') back();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Empty/placeholder tutorial guard (should not happen — the hub only opens enabled ones).
  if (!step) {
    return (
      <div className="tutorial-player">
        <p className="tutorial-caption__body">{t('tutorials.comingNext')}</p>
        <button type="button" className="btn btn--primary tutorial-btn" onClick={onExit}>{t('tutorials.done')}</button>
      </div>
    );
  }

  const highlightIds = new Set((step.highlight ?? []).map((h) => h.targetId));
  const pulseIds = new Set((step.highlight ?? []).filter((h) => h.pulse).map((h) => h.targetId));

  return (
    <div className="tutorial-player">
      <div className="tutorial-player__head">
        <h2 className="tutorial-player__title">
          <span aria-hidden="true">{GAME_EMOJI[game]}</span> {t(`gameType.${game}`)}
        </h2>
        <span className="tutorial-player__progress" aria-live="polite">
          {t('tutorials.stepProgress').replace('{n}', String(index + 1)).replace('{total}', String(total))}
        </span>
        <button type="button" className="btn btn--ghost tutorial-x" onClick={onExit} aria-label={t('tutorials.skip')}>✕</button>
      </div>

      <TutorialBoard scene={step.scene} highlightIds={highlightIds} pulseIds={pulseIds} />

      <div className="tutorial-caption">
        <h3 className="tutorial-caption__title">{t(step.titleKey)}</h3>
        <p className="tutorial-caption__body">{t(step.bodyKey)}</p>
        {step.actionHintKey && <p className="tutorial-caption__hint">👉 {t(step.actionHintKey)}</p>}
      </div>

      <div className="tutorial-controls">
        <button type="button" className="btn btn--ghost tutorial-btn" onClick={back} disabled={index === 0}>
          {t('tutorials.back')}
        </button>
        <button type="button" className="btn btn--outline tutorial-btn tutorial-btn--skip" onClick={onExit}>
          {t('tutorials.skip')}
        </button>
        <button type="button" className="btn btn--primary tutorial-btn" onClick={next}>
          {isLast ? t('tutorials.done') : t('tutorials.next')}
        </button>
      </div>
    </div>
  );
}
