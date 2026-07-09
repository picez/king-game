import type { Card } from '../../models/types';
import { sortHand } from '../../core/rules';
import { cardEquals } from '../../core/rules';
import CardView from './CardView';

interface PlayerHandProps {
  hand: Card[];
  validCards: Card[];
  onPlay: (card: Card) => void;
  disabled?: boolean;
}

export default function PlayerHand({
  hand,
  validCards,
  onPlay,
  disabled = false,
}: PlayerHandProps) {
  const sorted = sortHand(hand);

  return (
    <div className="player-hand">
      {sorted.map((card) => {
        const isValid = validCards.some((c) => cardEquals(c, card));
        return (
          <CardView
            key={`${card.suit}-${card.rank}`}
            card={card}
            onClick={isValid && !disabled ? () => onPlay(card) : undefined}
            disabled={!isValid || disabled}
            dimmed={!isValid}
          />
        );
      })}
    </div>
  );
}
