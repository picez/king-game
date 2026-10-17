import { useI18n } from '../../i18n';
import type { PreferansRuleOptions } from '../../games/preferans/variants';

export { DEFAULT_PREFERANS_RULES, normalizePreferansRules, type PreferansRuleOptions } from '../../games/preferans/variants';

/**
 * Two Off/On rows — misère and распасы — shared by the local setup and the online
 * host flow so both read the same.
 */
export default function PreferansRulesPicker({ value, onChange }: {
  value: PreferansRuleOptions;
  onChange: (next: PreferansRuleOptions) => void;
}) {
  const { t } = useI18n();
  const rows: { key: keyof PreferansRuleOptions; label: string; desc: string }[] = [
    { key: 'misere', label: t('preferans.misere'), desc: t('preferans.ruleMisereDesc') },
    { key: 'allPass', label: t('preferans.allPass'), desc: t('preferans.ruleAllPassDesc') },
  ];
  return (
    <div className="preferans-rules-picker">
      {rows.map((row) => (
        <div key={row.key} className="field">
          <label className="field__label">{row.label}</label>
          <div className="segmented segmented--inline" role="group" aria-label={row.label}>
            {[false, true].map((on) => (
              <button key={String(on)} type="button"
                className={`segmented__tab ${value[row.key] === on ? 'segmented__tab--active' : ''}`}
                aria-pressed={value[row.key] === on}
                onClick={() => onChange({ ...value, [row.key]: on })}>
                {on ? t('preferans.ruleOn') : t('preferans.ruleOff')}
              </button>
            ))}
          </div>
          <p className="durak-variant-desc">{row.desc}</p>
        </div>
      ))}
    </div>
  );
}
