import { useI18n } from '../../i18n';

export interface RuleToggleRow<K extends string> {
  key: K;
  label: string;
  desc: string;
}

/**
 * Off/On rows for a game's host-optional rules (Stage 41.4/41.5) — the same segmented
 * control the setup screens use elsewhere, so the local setup and the online host flow
 * read the same in every game that has optional rules.
 */
export default function RuleToggles<K extends string>({ rows, value, onChange }: {
  rows: RuleToggleRow<K>[];
  value: Record<K, boolean>;
  onChange: (next: Record<K, boolean>) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="rule-toggles">
      {rows.map((row) => (
        <div key={row.key} className="field">
          <label className="field__label">{row.label}</label>
          <div className="segmented segmented--inline" role="group" aria-label={row.label}>
            {[false, true].map((on) => (
              <button key={String(on)} type="button"
                className={`segmented__tab ${value[row.key] === on ? 'segmented__tab--active' : ''}`}
                aria-pressed={value[row.key] === on}
                onClick={() => onChange({ ...value, [row.key]: on })}>
                {on ? t('rules.on') : t('rules.off')}
              </button>
            ))}
          </div>
          <p className="durak-variant-desc">{row.desc}</p>
        </div>
      ))}
    </div>
  );
}
