import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import type { Announcement } from '../../net/admin';
import { dismissAnnouncement, fetchAnnouncement, isAnnouncementDismissed } from '../../net/feedbackApi';

/** The admin's site banner (Stage 44.0) — menu only, never over a game table. */
export default function AnnouncementBanner({ base }: { base: string }) {
  const { t } = useI18n();
  const [ann, setAnn] = useState<Announcement | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchAnnouncement(base).then((a) => { if (alive) setAnn(a && !isAnnouncementDismissed(a.id) ? a : null); });
    return () => { alive = false; };
  }, [base]);
  if (!ann) return null;
  return (
    <div className="announcement-banner" role="status">
      <span className="announcement-banner__icon" aria-hidden="true">📣</span>
      <span className="announcement-banner__text">
        {ann.text}
        {ann.url && <> <a href={ann.url} target="_blank" rel="noopener noreferrer">{t('announcement.more')}</a></>}
      </span>
      <button type="button" className="announcement-banner__close" aria-label={t('announcement.close')}
        onClick={() => { dismissAnnouncement(ann.id); setAnn(null); }}>×</button>
    </div>
  );
}
