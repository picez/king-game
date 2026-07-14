// ---------------------------------------------------------------------------
// HandArrangeSheet (Stage 30.12) — a shared, mobile-safe "arrange your hand"
// sheet used by every game. It is purely a DISPLAY-ORDER editor: the player taps
// a card to pick it, then nudges it left/right; "Auto-sort" drops back to the
// game's default order. It edits ONLY the local viewer's display order (via the
// useManualHandOrder hook the caller passes in) — no reducer/server/net touch.
//
// Generic over the card type: the caller supplies a stable `cardId` and a
// `renderMini` (each game draws its own cards — 51 has jokers, others CardView).
// The card strip is forced LTR so the sequence stays intentional under Arabic RTL.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useEscToClose } from '../../hooks/useEscToClose';
import type { ReactNode } from 'react';

interface Props<T> {
  /** Cards in the CURRENT display order (from useManualHandOrder.ordered). */
  cards: T[];
  cardId: (c: T) => string;
  /** Draw one card as a small, non-interactive tile. */
  renderMini: (c: T) => ReactNode;
  onMoveLeft: (id: string) => void;
  onMoveRight: (id: string) => void;
  onReset: () => void;
  onClose: () => void;
}

export default function HandArrangeSheet<T>({
  cards, cardId, renderMini, onMoveLeft, onMoveRight, onReset, onClose,
}: Props<T>) {
  const { t } = useI18n();
  useEscToClose(onClose);
  const [picked, setPicked] = useState<string | null>(null);

  const ids = cards.map(cardId);
  const pickedIdx = picked ? ids.indexOf(picked) : -1;
  const canLeft = pickedIdx > 0;
  const canRight = pickedIdx >= 0 && pickedIdx < ids.length - 1;

  return (
    <div className="arrange-overlay" role="dialog" aria-modal="true"
      aria-label={t('hand.arrangeTitle')} onClick={onClose}>
      <div className="arrange-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="arrange-sheet__head">
          <h2 className="arrange-sheet__title">↔ {t('hand.arrangeTitle')}</h2>
          <button type="button" className="btn btn--ghost arrange-sheet__x" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <p className="arrange-sheet__hint">{t('hand.arrangeHint')}</p>

        {/* LTR card strip so the order stays intentional even under RTL. */}
        <div className="arrange-strip" dir="ltr">
          {cards.map((c) => {
            const id = cardId(c);
            return (
              <button
                key={id}
                type="button"
                className={`arrange-strip__card ${picked === id ? 'arrange-strip__card--picked' : ''}`}
                aria-pressed={picked === id}
                onClick={() => setPicked((p) => (p === id ? null : id))}
              >
                {renderMini(c)}
              </button>
            );
          })}
        </div>

        <div className="arrange-sheet__controls">
          <button type="button" className="btn btn--outline arrange-move" disabled={!canLeft}
            onClick={() => picked && onMoveLeft(picked)} aria-label={t('hand.moveLeft')}>←</button>
          <button type="button" className="btn btn--ghost btn--small arrange-reset"
            onClick={() => { onReset(); setPicked(null); }}>{t('hand.autoSort')}</button>
          <button type="button" className="btn btn--outline arrange-move" disabled={!canRight}
            onClick={() => picked && onMoveRight(picked)} aria-label={t('hand.moveRight')}>→</button>
        </div>

        <button type="button" className="btn btn--primary arrange-sheet__done" onClick={onClose} autoFocus>
          {t('hand.arrangeDone')}
        </button>
      </div>
    </div>
  );
}
