import type { Card } from '../../models/types';
import { sortHand } from '../../core/rules';
import { cardEquals } from '../../core/rules';
import CardView from './CardView';
import HandReorderTray from './HandReorderTray';
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
  // Default = the usual sort; a drag switches to a manual display order (client-only
  // — the reducer hand is never reordered, Stage 30.12).
  const order = useManualHandOrder(sortHand(hand), singleDeckCardId);
  const isValid = (card: Card) => validCards.some((c) => cardEquals(c, card));

  return (
    <HandReorderTray
      items={order.ordered}
      cardId={singleDeckCardId}
      order={order}
      onTap={(card) => onPlay(card)}
      canTap={(card) => !disabled && isValid(card)}
      renderCard={(card) => (
        <CardView card={card} disabled={!isValid(card) || disabled} dimmed={!isValid(card)} />
      )}
    />
  );
}
