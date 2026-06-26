import type { Card, Suit } from '../../models/types';
import CardView, { SUIT_SYMBOL } from '../components/CardView';

interface Props {
  /** Cards left in the draw pile (the trump card is the very last one). */
  count: number;
  trumpCard: Card;
  trumpSuit: Suit;
}

/**
 * Durak deck + trump visual (Stage 9.10): a closed stack of card backs with the
 * trump card lying face-up across the bottom, plus the remaining count. The stack
 * thins (`--low`) as cards are drawn (CSS transition, no layout jump). When the
 * pile is empty the deck disappears and only the trump suit remains as a chip —
 * the trump card itself is no longer an available card.
 */
export default function DurakDeck({ count, trumpCard, trumpSuit }: Props) {
  const red = trumpSuit === 'hearts' || trumpSuit === 'diamonds';

  if (count === 0) {
    return (
      <span className={`durak-deck durak-deck--empty ${red ? 'durak-deck--red' : ''}`} aria-label={`Trump ${trumpSuit}, deck empty`}>
        <span className="durak-deck__suit">{SUIT_SYMBOL[trumpSuit]}</span>
      </span>
    );
  }

  return (
    <span className={`durak-deck ${count <= 3 ? 'durak-deck--low' : ''}`} aria-label={`${count} cards left, trump ${trumpSuit}`}>
      <span className="durak-deck__stack">
        <span className="durak-deck__trump"><CardView card={trumpCard} size="mini" disabled /></span>
        <span className="durak-deck__back" aria-hidden="true" />
      </span>
      <span className="durak-deck__count">{count}</span>
    </span>
  );
}
