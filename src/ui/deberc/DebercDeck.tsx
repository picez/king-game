import type { Card, Suit } from '../../models/types';
import CardView from '../components/CardView';

interface Props {
  /** Undealt stock cards on the table (9 for 3 players, 0 for 4). */
  count: number;
  /** The face-up trump card (the об'яз's talon top). Always shown. */
  trumpCard: Card;
  /** Chosen trump suit; null until bidding commits (then equals trumpCard.suit). */
  trumpSuit: Suit | null;
}

/**
 * Deberc talon + trump visual: the face-up trump card with a thin stock stack
 * behind it (the undealt cards in a 3-player game). Mirrors DurakDeck's look.
 */
export default function DebercDeck({ count, trumpCard, trumpSuit }: Props) {
  const suit = trumpSuit ?? trumpCard.suit;
  const red = suit === 'hearts' || suit === 'diamonds';
  return (
    <span className={`durak-deck ${count > 0 && count <= 3 ? 'durak-deck--low' : ''} ${red ? 'durak-deck--red' : ''}`} aria-label={`trump ${suit}`}>
      <span className="durak-deck__stack">
        <span className="durak-deck__trump"><CardView card={trumpCard} size="table" disabled /></span>
        {count > 0 && <span className="durak-deck__back" aria-hidden="true" />}
        {count > 0 && <span className="durak-deck__count">{count}</span>}
      </span>
    </span>
  );
}
