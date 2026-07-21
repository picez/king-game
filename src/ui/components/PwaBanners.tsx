import { useI18n } from '../../i18n';
import type { PwaState } from '../../pwa/usePwa';

interface Props {
  pwa: PwaState;
  /** True during an active local/online game — suppresses the (bottom) install
   *  card so it never blocks the hand/actions. The thin top strips (update /
   *  offline) stay: they are non-blocking and never auto-refresh. */
  inGame: boolean;
}

/**
 * PWA install / update / offline surfaces (Stage 21.0). Thin, fixed, dismissible,
 * mobile-first and RTL-safe — never covers the hand/actions/social controls:
 *  • offline strip (top): shown while navigator is offline; auto-hides when back.
 *  • update strip (top): a new SW is waiting → "Update available" + Refresh (the
 *    only thing that reloads; user-initiated, so never mid-game auto-refresh).
 *  • install card (bottom-centre): only when Chrome offered it, not installed, not
 *    dismissed, and NOT in a game. iOS Safari never fires the event → no card there
 *    (no fake/intrusive prompt).
 *  • iOS hint (bottom-centre): iOS only, not installed, not dismissed, menu only —
 *    a one-line Share → Add to Home Screen tip (no fake install button).
 */
export default function PwaBanners({ pwa, inGame }: Props) {
  const { t } = useI18n();
  const showInstall = pwa.installReady && !inGame;
  const showIosHint = pwa.iosHintReady && !inGame;

  if (!pwa.offline && !pwa.updateReady && !showInstall && !showIosHint) return null;

  return (
    <>
      {(pwa.offline || pwa.updateReady) && (
        <div className="pwa-strips" role="status" aria-live="polite">
          {pwa.offline && (
            <div className="pwa-banner pwa-banner--offline">
              <span aria-hidden="true">📴</span> {t('pwa.offline')}
            </div>
          )}
          {pwa.updateReady && (
            <div className="pwa-banner pwa-banner--update">
              <span className="pwa-banner__text"><span aria-hidden="true">🔄</span> {t('pwa.updateTitle')}</span>
              <button type="button" className="btn btn--small pwa-banner__action" onClick={pwa.applyUpdate}>
                {t('pwa.refresh')}
              </button>
            </div>
          )}
        </div>
      )}

      {showInstall && (
        <div className="pwa-install" role="dialog" aria-label={t('pwa.installTitle')}>
          <span className="pwa-install__icon" aria-hidden="true">📲</span>
          <span className="pwa-install__text">
            <span className="pwa-install__title">{t('pwa.installTitle')}</span>
            <span className="pwa-install__body">{t('pwa.installBody')}</span>
          </span>
          <button type="button" className="btn btn--primary btn--small pwa-install__cta" onClick={pwa.promptInstall}>
            {t('pwa.install')}
          </button>
          <button type="button" className="pwa-install__x" aria-label={t('pwa.dismiss')} onClick={pwa.dismissInstall}>
            ✕
          </button>
        </div>
      )}

      {showIosHint && (
        <div className="pwa-install pwa-install--ios" role="dialog" aria-label={t('pwa.installTitle')}>
          <span className="pwa-install__icon" aria-hidden="true">📲</span>
          <span className="pwa-install__text">
            <span className="pwa-install__title">{t('pwa.installTitle')}</span>
            <span className="pwa-install__body">{t('pwa.iosInstallHint')}</span>
          </span>
          <button type="button" className="pwa-install__x" aria-label={t('pwa.dismiss')} onClick={pwa.dismissIosHint}>
            ✕
          </button>
        </div>
      )}
    </>
  );
}
