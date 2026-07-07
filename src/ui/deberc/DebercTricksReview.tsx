import { useI18n } from '../../i18n';
import { useEscToClose } from '../../hooks/useEscToClose';
import CardView from '../components/CardView';
import type { Card } from '../../models/types';
import type { DebercState } from '../../games/deberc/types';

/**
 * Review the tricks YOU have taken this hand (like King's collected-cards panel).
 * `wonCards[mySeat]` is pushed in trick order, n cards per trick, so we chunk it
 * by the player count to reconstruct each trick.
 */
export default function DebercTricksReview({ state, mySeat, onClose }: { state: DebercState; mySeat: number; onClose: () => void }) {
  const { t } = useI18n();
  useEscToClose(onClose);
  const n = state.players.length;
  const won = state.wonCards[mySeat] ?? [];
  const tricks: Card[][] = [];
  for (let i = 0; i < won.length; i += n) tricks.push(won.slice(i, i + n));

  return (
    <div className="durak-help-overlay" role="dialog" aria-modal="true" aria-label={t('deberc.myTricks')} onClick={onClose}>
      <div className="durak-help deberc-tricks-modal" onClick={(e) => e.stopPropagation()}>
        <div className="durak-help__head">
          <h2 className="durak-help__title">🃏 {t('deberc.myTricks')} · {tricks.length}</h2>
          <button type="button" className="btn btn--ghost durak-help__x" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        {tricks.length === 0 ? (
          <p className="durak-help__variant">{t('deberc.noTricks')}</p>
        ) : (
          <div className="deberc-tricks">
            {tricks.map((trick, i) => (
              <div className="deberc-tricks__row" key={i}>
                <span className="deberc-tricks__n">#{i + 1}</span>
                <div className="deberc-tricks__cards">
                  {trick.map((c, j) => <CardView key={j} card={c} size="mini" disabled />)}
                </div>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="btn btn--primary durak-help__ok" onClick={onClose} autoFocus>{t('deberc.gotIt')}</button>
      </div>
    </div>
  );
}
