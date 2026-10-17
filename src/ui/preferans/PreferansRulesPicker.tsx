import { useI18n } from '../../i18n';
import RuleToggles from '../components/RuleToggles';
import type { PreferansRuleOptions } from '../../games/preferans/variants';

export { DEFAULT_PREFERANS_RULES, normalizePreferansRules, type PreferansRuleOptions } from '../../games/preferans/variants';

/** Misère and распасы (Stage 41.4) — shared by the local setup and the online host flow. */
export default function PreferansRulesPicker({ value, onChange }: {
  value: PreferansRuleOptions;
  onChange: (next: PreferansRuleOptions) => void;
}) {
  const { t } = useI18n();
  return (
    <RuleToggles
      rows={[
        { key: 'misere', label: t('preferans.misere'), desc: t('preferans.ruleMisereDesc') },
        { key: 'allPass', label: t('preferans.allPass'), desc: t('preferans.ruleAllPassDesc') },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
