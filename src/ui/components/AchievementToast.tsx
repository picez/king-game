import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { Achievement } from '../../stats/achievements';

interface Props {
  /** The freshly-unlocked badges to announce, in catalog order (non-empty). */
  achievements: readonly Achievement[];
  /** Called once the user has stepped through / closed the queue. */
  onDismiss: () => void;
}

/**
 * Achievement unlock toast (Stage 16.1) — a compact, non-blocking announcement
 * shown ONLY after stats resolve on the Profile screen (never during gameplay,
 * never over cards/hands). It walks the queue one badge at a time; when several
 * unlocked at once a "+N more" chip signals the rest and "Next" advances. Motion
 * is CSS-only (`.ach-toast` slide/fade) and stilled by `data-motion-effective`
 * reduced/off — this component holds no animation logic. No sound is played.
 */
export default function AchievementToast({ achievements, onDismiss }: Props) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);

  if (achievements.length === 0) return null;
  const current = achievements[Math.min(index, achievements.length - 1)];
  const remaining = achievements.length - index - 1;
  const hasMore = remaining > 0;

  const advance = () => {
    if (hasMore) setIndex((i) => i + 1);
    else onDismiss();
  };

  return (
    <div className="ach-toast-wrap" role="status" aria-live="polite">
      <div className={`ach-toast ach-toast--${current.rarity}`} data-ach-toast={current.id}>
        <span className="ach-toast__icon" aria-hidden="true">{current.icon}</span>
        <div className="ach-toast__body">
          <span className="ach-toast__eyebrow">{t('ach.unlocked')}</span>
          <span className="ach-toast__title">{t(current.titleKey)}</span>
          <span className={`ach-toast__rarity ach-toast__rarity--${current.rarity}`}>
            {t(`ach.rarity.${current.rarity}`)}
          </span>
        </div>
        <div className="ach-toast__actions">
          {hasMore && <span className="ach-toast__more">+{remaining} {t('ach.more')}</span>}
          <button type="button" className="ach-toast__btn" onClick={advance}>
            {hasMore ? t('ach.next') : t('common.close')}
          </button>
        </div>
        <button
          type="button" className="ach-toast__close"
          aria-label={t('common.close')} onClick={onDismiss}
        >✕</button>
      </div>
    </div>
  );
}
