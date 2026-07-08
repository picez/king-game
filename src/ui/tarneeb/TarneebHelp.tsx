import { useI18n } from '../../i18n';
import { useEscToClose } from '../../hooks/useEscToClose';

/** The short rules list — reused inline (setup) and inside the modal. */
export function TarneebRulesList() {
  const { t } = useI18n();
  return (
    <ul className="tarneeb-rules">
      <li>{t('tarneeb.rule.teams')}</li>
      <li>{t('tarneeb.rule.bidding')}</li>
      <li>{t('tarneeb.rule.trump')}</li>
      <li>{t('tarneeb.rule.play')}</li>
      <li>{t('tarneeb.rule.scoring')}</li>
      <li>{t('tarneeb.rule.allTricks')}</li>
      <li>{t('tarneeb.rule.goal')}</li>
    </ul>
  );
}

/** In-game "How to play" modal for Tarneeb. Mirrors DurakHelp. */
export default function TarneebHelp({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  useEscToClose(onClose);
  return (
    <div
      className="tarneeb-help-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('tarneeb.howToPlay')}
      onClick={onClose}
    >
      <div className="tarneeb-help" onClick={(e) => e.stopPropagation()}>
        <div className="tarneeb-help__head">
          <h2 className="tarneeb-help__title">{t('tarneeb.howToPlay')}</h2>
          <button
            type="button"
            className="btn btn--ghost tarneeb-help__x"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
        <TarneebRulesList />
        <button type="button" className="btn btn--primary tarneeb-help__ok" onClick={onClose} autoFocus>
          {t('tarneeb.gotIt')}
        </button>
      </div>
    </div>
  );
}
