import type { Card, Suit } from '../../models/types';
import CardView, { SUIT_SYMBOL } from '../components/CardView';

interface Props {
  /** Undealt stock cards on the table (5 for 3 players, 0 for 4). */
  count: number;
  /**
   * The face-up trump card to render on the table, or null once it has been
   * taken into a hand (4p, after the прикуп) — then only the suit is shown so the
   * same card never appears both on the table and in a player's hand.
   */
  trumpCard: Card | null;
  /** Chosen trump suit; null until bidding commits (then equals trumpCard.suit). */
  trumpSuit: Suit | null;
}

/**
 * Deberc talon + trump visual: the face-up trump card (while it is genuinely on
 * the table) with a thin stock stack behind it (the undealt cards in a 3-player
 * game). Once the trump card is taken into a hand, only its suit is shown.
 * Mirrors DurakDeck's look.
 */
export default function DebercDeck({ count, trumpCard, trumpSuit }: Props) {
  const suit = trumpSuit ?? trumpCard?.suit ?? 'spades';
  const red = suit === 'hearts' || suit === 'diamonds';
  return (
    <span className={`durak-deck ${count > 0 && count <= 3 ? 'durak-deck--low' : ''} ${red ? 'durak-deck--red' : ''}`} aria-label={`trump ${suit}`}>
      <span className="durak-deck__stack">
        {trumpCard
          ? <span className="durak-deck__trump"><CardView card={trumpCard} size="table" disabled /></span>
          : <span className="durak-deck__trump-suit" aria-hidden="true">{SUIT_SYMBOL[suit]}</span>}
        {count > 0 && <span className="durak-deck__back" aria-hidden="true" />}
        {count > 0 && <span className="durak-deck__count">{count}</span>}
      </span>
    </span>
  );
}
