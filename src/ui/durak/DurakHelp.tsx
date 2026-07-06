import { useI18n } from '../../i18n';
import type { DurakVariant } from '../../games/durak/types';

/** The short rules list for a variant — reused inline (setup) and in the modal. */
export function DurakRulesList({ variant }: { variant: DurakVariant }) {
  const { t } = useI18n();
  return (
    <ul className="durak-rules">
      <li>{t('durak.rule.attack')}</li>
      <li>{t('durak.rule.defend')}</li>
      <li>{t('durak.rule.take')}</li>
      <li>{t('durak.rule.throwAfterTake')}</li>
      <li>{t('durak.rule.discard')}</li>
      {variant === 'transfer' && <li className="durak-rules__transfer">{t('durak.rule.transfer')}</li>}
      <li>{t('durak.rule.fool')}</li>
    </ul>
  );
}

/** In-game "How to play" modal: variant name + the rules reminders. */
export default function DurakHelp({ variant, onClose }: { variant: DurakVariant; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="durak-help-overlay" role="dialog" aria-modal="true" aria-label={t('durak.howToPlay')} onClick={onClose}>
      <div className="durak-help" onClick={(e) => e.stopPropagation()}>
        <div className="durak-help__head">
          <h2 className="durak-help__title">{t('durak.howToPlay')}</h2>
          <button type="button" className="btn btn--ghost durak-help__x" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <p className="durak-help__variant">
          🃏 {variant === 'transfer' ? t('durak.variantTransfer') : t('durak.variantSimple')}
        </p>
        <DurakRulesList variant={variant} />
        <button type="button" className="btn btn--primary durak-help__ok" onClick={onClose}>{t('durak.gotIt')}</button>
      </div>
    </div>
  );
}
