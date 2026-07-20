// ---------------------------------------------------------------------------
// TutorialHub (Stage 31.1) — lists all 6 games; 51 + Durak open a full scripted
// TutorialPlayer, the other four show a "Coming next" placeholder. Owns the
// hub ↔ player navigation. Client-only: no network/account/stats. Mirrors the
// menu-sheet style already used by Profile/Host.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { GameType } from '../../games/catalog';
import { TUTORIAL_ORDER, getTutorial, isTutorialEnabled, tutorialTotalSeconds } from '../../tutorials/catalog';
import GameIcon from '../components/GameIcon';
import TutorialPlayer from './TutorialPlayer';

interface Props {
  /** Back to the main menu. */
  onExit: () => void;
}

export default function TutorialHub({ onExit }: Props) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<GameType | null>(null);

  if (selected) {
    return <TutorialPlayer game={selected} onExit={() => setSelected(null)} />;
  }

  return (
    <div className="sheet tutorial-hub">
      <div className="sheet__head">
        <h2 className="sheet__title">🎓 {t('tutorials.title')}</h2>
        <button type="button" className="btn btn--ghost btn--small" onClick={onExit}>{t('btn.backToMenu')}</button>
      </div>
      <p className="tutorial-hub__sub">{t('tutorials.subtitle')}</p>

      <ul className="tutorial-hub__list">
        {TUTORIAL_ORDER.map((game) => {
          const enabled = isTutorialEnabled(game);
          const secs = tutorialTotalSeconds(game);
          return (
            <li key={game} className={`tutorial-row${enabled ? '' : ' tutorial-row--soon'}`}>
              <GameIcon game={game} size="md" className="tutorial-row__icon" />
              <span className="tutorial-row__text">
                <span className="tutorial-row__name">{t(`gameType.${game}`)}</span>
                <span className="tutorial-row__learn">{t(getTutorial(game).learnKey)}</span>
                {enabled && (
                  <span className="tutorial-row__dur">⏱ {t('tutorials.duration').replace('{n}', String(secs))}</span>
                )}
              </span>
              {enabled ? (
                <button type="button" className="btn btn--primary tutorial-row__cta" onClick={() => setSelected(game)}>
                  {t('tutorials.start')}
                </button>
              ) : (
                <span className="tutorial-row__soon" aria-disabled="true">{t('tutorials.comingNext')}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
