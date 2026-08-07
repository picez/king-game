import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';

interface Props {
  /** Confirm an UNRANKED paid table. The caller re-sends START with the acknowledgement. */
  onConfirm: () => void;
  /** Dismiss without starting anything. Nothing was ever debited. */
  onCancel: () => void;
  /** True while the confirmed START is in flight — makes the confirm double-click safe. */
  pending?: boolean;
}

/**
 * The ONE pre-debit handshake for an UNRANKED bankroll table (Stage 38.0.8).
 *
 * The server has ALREADY decided — from durable evidence, under its own lock — that a table
 * with this line-up would not count towards Poker stats, and it refused the START without
 * debiting anything. This dialog is how the host acknowledges that; re-sending START with
 * the acknowledgement makes the server recompute the same decision immediately before the
 * debit, so nothing here is a request and nothing here can ask for "ranked".
 *
 * It deliberately says only WHAT is true. It never names an opponent, a pair, a count or a
 * threshold, and it never uses the language of cheating or punishment.
 *
 * Safety properties the tests pin:
 *  - opaque `--panel` background (never the translucent `--surface`);
 *  - both buttons ≥44×44, stacked and fully reachable at 360/390;
 *  - focus moves into the dialog on open and returns to the opener on close;
 *  - Tab/Shift+Tab are trapped inside while it is open;
 *  - Escape and the backdrop cancel — and they can only ever cancel BEFORE a debit;
 *  - the confirm button disables itself while the START is in flight (one debit, never two).
 */
export default function PokerUnrankedDialog({ onConfirm, onCancel, pending = false }: Props) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    confirmRef.current?.focus();
    const opener = openerRef.current;
    return () => { (opener as HTMLElement | null)?.focus?.(); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Cancelling is always safe: nothing has been debited at this point.
        if (!pending) onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, pending]);

  return (
    <div
      className="poker-policy-backdrop"
      role="presentation"
      onClick={() => { if (!pending) onCancel(); }}
    >
      <div
        ref={dialogRef}
        className="poker-policy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="poker-unranked-title"
        aria-describedby="poker-unranked-body"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="poker-policy-dialog__title" id="poker-unranked-title">{t('poker.unrankedTitle')}</h3>
        <p className="poker-policy-dialog__body" id="poker-unranked-body">{t('poker.unrankedBody')}</p>
        <div className="poker-policy-dialog__actions">
          <button
            ref={confirmRef}
            type="button"
            className="btn btn--primary poker-policy-confirm"
            onClick={onConfirm}
            disabled={pending}
          >
            {t('poker.unrankedConfirm')}
          </button>
          <button
            type="button"
            className="btn btn--ghost poker-policy-cancel"
            onClick={onCancel}
            disabled={pending}
          >
            {t('poker.unrankedCancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
