import { useI18n } from '../../i18n';
import { useEscToClose } from '../../hooks/useEscToClose';

/** The short rules list — reused inline (setup) and in the modal. */
export function DebercRulesList() {
  const { t } = useI18n();
  return (
    <ul className="durak-rules">
      <li>{t('deberc.rule.deck')}</li>
      <li>{t('deberc.rule.bidding')}</li>
      <li>{t('deberc.rule.play')}</li>
      <li>{t('deberc.rule.points')}</li>
      <li>{t('deberc.rule.melds')}</li>
      <li>{t('deberc.rule.hv')}</li>
      <li>{t('deberc.rule.goal')}</li>
    </ul>
  );
}

/** In-game "How to play" modal. */
export default function DebercHelp({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEscToClose(onClose);
  return (
    <div className="durak-help-overlay" role="dialog" aria-modal="true" aria-label={t('deberc.howToPlay')} onClick={onClose}>
      <div className="durak-help" onClick={(e) => e.stopPropagation()}>
        <div className="durak-help__head">
          <h2 className="durak-help__title">{t('deberc.howToPlay')}</h2>
          <button type="button" className="btn btn--ghost durak-help__x" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <p className="durak-help__variant">🎴 {t('gameType.deberc')}</p>
        <DebercRulesList />
        <button type="button" className="btn btn--primary durak-help__ok" onClick={onClose} autoFocus>{t('deberc.gotIt')}</button>
      </div>
    </div>
  );
}
