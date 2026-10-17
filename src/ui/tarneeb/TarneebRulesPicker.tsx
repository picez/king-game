import { useI18n } from '../../i18n';
import RuleToggles from '../components/RuleToggles';
import type { TarneebRuleOptions } from '../../games/tarneeb/variants';

export { DEFAULT_TARNEEB_RULES, type TarneebRuleOptions } from '../../games/tarneeb/variants';

/** The Kaboot table and No-Trump (Stage 41.5) — shared by the local setup and the host flow. */
export default function TarneebRulesPicker({ value, onChange }: {
  value: TarneebRuleOptions;
  onChange: (next: TarneebRuleOptions) => void;
}) {
  const { t } = useI18n();
  return (
    <RuleToggles
      rows={[
        { key: 'kaboot', label: t('tarneeb.kaboot'), desc: t('tarneeb.ruleKabootDesc') },
        { key: 'noTrump', label: t('tarneeb.noTrump'), desc: t('tarneeb.ruleNoTrumpDesc') },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
