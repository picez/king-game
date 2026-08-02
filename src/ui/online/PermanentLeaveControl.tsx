import { useState } from 'react';
import { useI18n } from '../../i18n';
import type { PermanentLeaveUi } from '../../hooks/useNetworkGame';

interface Props {
  /** This client's permanent-leave lifecycle from `useNetworkGame`. */
  state: PermanentLeaveUi;
  /** Send the (payload-free) permanent-leave intent. */
  onConfirm: () => void;
}

/**
 * The destructive "Quit for good" control for an ACTIVE online non-Poker game
 * (Stage 38.0.5).
 *
 * It is deliberately NOT another way to say "Back to menu": the ✕ / Back exit keeps the
 * seat RECONNECTABLE and the lobby "Leave lobby" costs nothing. This one is irreversible,
 * so it is guarded by an explicit confirmation that spells out ALL four consequences
 * before anything is sent, and the intent only leaves the browser after the player
 * confirms.
 *
 * Safety properties the tests pin:
 *  - the trigger and both dialog buttons are ≥44×44 (`.permleave-*` CSS);
 *  - the confirm button is DISABLED while a request is in flight → double-click safe;
 *  - a refusal is reported inside the dialog via `aria-live`, and the dialog stays open
 *    so the player can retry or cancel — the table keeps playing meanwhile;
 *  - it renders as a normal in-flow child of the RoomSocial control row, so it can never
 *    cover the table, the hand, the melds or a game's action bar. The confirmation is a
 *    modal overlay ON PURPOSE (it must be read before an irreversible action).
 */
export default function PermanentLeaveControl({ state, onConfirm }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pending = state.status === 'pending';

  return (
    <>
      <button
        type="button"
        className="social-fab permleave-trigger"
        onClick={() => setOpen(true)}
        aria-label={t('permanentLeave.button')}
        title={t('permanentLeave.button')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        🏳️
      </button>

      {open && (
        <div className="permleave-backdrop" role="presentation">
          <div className="permleave-dialog" role="dialog" aria-modal="true" aria-labelledby="permleave-title">
            <h3 className="permleave-dialog__title" id="permleave-title">{t('permanentLeave.title')}</h3>
            <ul className="permleave-dialog__points">
              <li>{t('permanentLeave.irreversible')}</li>
              <li>{t('permanentLeave.loss')}</li>
              <li>{t('permanentLeave.bot')}</li>
              <li>{t('permanentLeave.roomCloses')}</li>
            </ul>
            {/* A refusal never changed anything server-side — say so and stay open. */}
            <p className="permleave-dialog__status" role="status" aria-live="polite">
              {state.status === 'error' ? t('permanentLeave.error') : pending ? t('permanentLeave.pending') : ''}
            </p>
            <div className="permleave-dialog__actions">
              <button
                type="button"
                className="btn btn--danger permleave-confirm"
                onClick={onConfirm}
                disabled={pending}
              >
                {t('permanentLeave.confirm')}
              </button>
              <button
                type="button"
                className="btn btn--ghost permleave-cancel"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                {t('permanentLeave.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
