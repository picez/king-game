import type { Card } from '../../models/types';
import { sortHand } from '../../core/rules';
import { cardEquals } from '../../core/rules';
import CardView from './CardView';
import HandOrderControls from './HandOrderControls';
import { useManualHandOrder, singleDeckCardId } from '../../hooks/useManualHandOrder';

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
  // Default = the usual sort; the player may switch to a manual display order
  // (client-only — the reducer hand is never reordered, Stage 30.12).
  const order = useManualHandOrder(sortHand(hand), singleDeckCardId);

  return (
    <>
      <div className="player-hand">
        {order.ordered.map((card) => {
          const isValid = validCards.some((c) => cardEquals(c, card));
          return (
            <CardView
              key={singleDeckCardId(card)}
              card={card}
              onClick={isValid && !disabled ? () => onPlay(card) : undefined}
              disabled={!isValid || disabled}
              dimmed={!isValid}
            />
          );
        })}
      </div>
      <HandOrderControls
        order={order}
        cardId={singleDeckCardId}
        renderMini={(c) => <CardView card={c} size="mini" disabled />}
      />
    </>
  );
}
