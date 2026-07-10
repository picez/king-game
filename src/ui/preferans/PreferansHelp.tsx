import { useI18n } from '../../i18n';
import { useEscToClose } from '../../hooks/useEscToClose';

/** The short rules list — reused inline (setup) and inside the modal. */
export function PreferansRulesList() {
  const { t } = useI18n();
  return (
    <ul className="preferans-rules">
      <li>{t('preferans.rule.players')}</li>
      <li>{t('preferans.rule.deal')}</li>
      <li>{t('preferans.rule.bidding')}</li>
      <li>{t('preferans.rule.talon')}</li>
      <li>{t('preferans.rule.play')}</li>
      <li>{t('preferans.rule.scoring')}</li>
      <li>{t('preferans.rule.goal')}</li>
    </ul>
  );
}

/** In-game "How to play" modal for Preferans. Mirrors TarneebHelp. */
export default function PreferansHelp({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEscToClose(onClose);
  return (
    <div
      className="preferans-help-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('preferans.howToPlay')}
      onClick={onClose}
    >
      <div className="preferans-help" onClick={(e) => e.stopPropagation()}>
        <div className="preferans-help__head">
          <h2 className="preferans-help__title">{t('preferans.howToPlay')}</h2>
          <button
            type="button"
            className="btn btn--ghost preferans-help__x"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
        <PreferansRulesList />
        <button type="button" className="btn btn--primary preferans-help__ok" onClick={onClose} autoFocus>
          {t('preferans.gotIt')}
        </button>
      </div>
    </div>
  );
}
