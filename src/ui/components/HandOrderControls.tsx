// ---------------------------------------------------------------------------
// HandOrderControls (Stage 30.12) — the single per-game integration point for
// manual hand ordering. Renders a small "↔ Arrange" button near the hand and,
// when tapped, the shared HandArrangeSheet. Purely display-order — it drives the
// caller's useManualHandOrder state and never touches the reducer/server/net.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import HandArrangeSheet from './HandArrangeSheet';
import type { ManualHandOrder } from '../../hooks/useManualHandOrder';

interface Props<T> {
  /** The hand-order state from useManualHandOrder(sortedHand, cardId). */
  order: ManualHandOrder<T>;
  cardId: (c: T) => string;
  renderMini: (c: T) => ReactNode;
  /** Optional extra class on the button (placement). */
  className?: string;
}

export default function HandOrderControls<T>({ order, cardId, renderMini, className = '' }: Props<T>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // Nothing to arrange with 0–1 cards.
  if (order.ordered.length < 2) return null;

  return (
    <>
      <button
        type="button"
        className={`btn btn--ghost btn--small hand-arrange-btn ${order.manual ? 'hand-arrange-btn--on' : ''} ${className}`.trim()}
        onClick={() => setOpen(true)}
        aria-label={t('hand.arrangeTitle')}
      >
        ↔ {t('hand.arrange')}
      </button>
      {open && (
        <HandArrangeSheet
          cards={order.ordered}
          cardId={cardId}
          renderMini={renderMini}
          onMoveLeft={order.moveLeft}
          onMoveRight={order.moveRight}
          onReset={order.reset}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
