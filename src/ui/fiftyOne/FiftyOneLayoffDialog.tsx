import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n';
import { SUIT_SYMBOL } from '../components/CardView';
import type { LayoffOption } from '../../games/fiftyOne/melds';

interface Props {
  /** The two legal sides, already resolved by the shared helper. */
  options: LayoffOption[];
  onPick: (option: LayoffOption) => void;
  onCancel: () => void;
}

/**
 * The side chooser for an AMBIGUOUS lay-off (Stage 38.0.9, §9).
 *
 * A run can legally grow at either end, and for a JOKER both ends are often legal with
 * DIFFERENT represented cards — `Joker + 4♠ 5♠ 6♠` is 3♠ at the start or 7♠ at the end.
 * Only the player knows which they meant, so this asks, and it only ever appears when the
 * shared `legalLayoffPlacements` really returned two options: one legal side acts
 * immediately and none hides the control entirely.
 *
 * It shows what each choice PRODUCES (the joker's card, or the new value), never a rule
 * lecture. Cancel dispatches nothing, and the confirm is single-flight so a double tap can
 * only ever send one action.
 */
export default function FiftyOneLayoffDialog({ options, onPick, onCancel }: Props) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  const picked = useRef(false);

  useEffect(() => {
    openerRef.current = typeof document !== 'undefined' ? document.activeElement : null;
    firstRef.current?.focus();
    const opener = openerRef.current;
    return () => { (opener as HTMLElement | null)?.focus?.(); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /** What this side produces: the joker's card when one is involved, else the new value. */
  const preview = (o: LayoffOption): string => {
    const jokerSlot = o.placement === 'start' ? 0 : o.resolved.cards.length - 1;
    const rep = o.resolved.jokerRepresents[jokerSlot];
    if (rep && o.resolved.cards[jokerSlot]?.joker) return `🃏 = ${rep.rank}${SUIT_SYMBOL[rep.suit]}`;
    return t('fiftyOne.meldTotal').replace('{n}', String(o.resolved.value));
  };

  return (
    <div className="fiftyone-layoff-backdrop" role="presentation" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="fiftyone-layoff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="f51-layoff-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="fiftyone-layoff-dialog__title" id="f51-layoff-title">{t('fiftyOne.layoffTitle')}</h3>
        <div className="fiftyone-layoff-dialog__options">
          {options.map((o, i) => (
            <button
              key={o.placement}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="btn btn--primary fiftyone-layoff-option"
              onClick={() => {
                if (picked.current) return;      // double tap → exactly ONE action
                picked.current = true;
                onPick(o);
              }}
            >
              <span className="fiftyone-layoff-option__side">
                {o.placement === 'start' ? t('fiftyOne.layoffStart') : t('fiftyOne.layoffEnd')}
              </span>
              <span className="fiftyone-layoff-option__preview">{preview(o)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost fiftyone-layoff-cancel" onClick={onCancel}>
          {t('fiftyOne.layoffCancel')}
        </button>
      </div>
    </div>
  );
}
