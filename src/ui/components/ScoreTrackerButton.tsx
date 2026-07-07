import { useState } from 'react';
import { useGame } from '../../hooks/useGame';
import { useI18n } from '../../i18n';
import { useEscToClose } from '../../hooks/useEscToClose';
import ScoreTracker from './ScoreTracker';

interface Props {
  /** Extra classes for the trigger button (e.g. layout helpers). */
  className?: string;
}

/**
 * Global access to the score table from any game-related screen (post-playtest
 * fix #4) — not just on your own turn. A small button opens a modal sheet that
 * shows ONLY public data (scores + roundHistory via ScoreTracker); no hands or
 * private cards are ever rendered, so it is safe in local and online play.
 */
export default function ScoreTrackerButton({ className = '' }: Props) {
  const { state } = useGame();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEscToClose(() => setOpen(false), open);
  if (!state) return null;

  return (
    <>
      <button
        className={`btn btn--ghost btn--small score-tracker-btn ${className}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        📊 {t('track.title')}
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-sheet__head">
              <h3>{t('track.title')}</h3>
              <button className="btn btn--ghost btn--small" onClick={() => setOpen(false)} aria-label={t('common.close')} autoFocus>✕</button>
            </div>
            <ScoreTracker state={state} />
          </div>
        </div>
      )}
    </>
  );
}
