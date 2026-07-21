import type { Rank, Suit } from '../../models/types';
import { SUIT_SYMBOL } from '../components/CardView';
import type { PokerCard } from '../../games/poker/types';

const IS_RED: Record<Suit, boolean> = { spades: false, hearts: true, diamonds: true, clubs: false };

/** A compact poker card: real face when suit/rank present, else a face-down back. */
export default function PokerCardView({ card, size = 'md' }: { card: PokerCard; size?: 'md' | 'sm' }) {
  const hidden = card.suit === null || card.rank === null;
  const cls = `poker-card poker-card--${size}`;
  if (hidden) return <div className={`${cls} poker-card--back`} aria-hidden="true" />;
  const suit = card.suit as Suit;
  const rank = card.rank as Rank;
  return (
    <div className={`${cls} ${IS_RED[suit] ? 'poker-card--red' : ''}`} aria-label={`${rank} ${suit}`}>
      <span className="poker-card__rank">{rank}</span>
      <span className="poker-card__suit">{SUIT_SYMBOL[suit]}</span>
    </div>
  );
}
