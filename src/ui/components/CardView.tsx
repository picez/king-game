import type { Card, Suit } from '../../models/types';

export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const IS_RED: Record<Suit, boolean> = {
  spades: false,
  hearts: true,
  diamonds: true,
  clubs: false,
};

/** A simple centre motif for face cards / aces (unicode, no assets). */
const FACE_GLYPH: Record<string, string> = { J: '♞', Q: '♛', K: '♚' };
function centerGlyph(card: Card): string {
  return FACE_GLYPH[card.rank] ?? SUIT_SYMBOL[card.suit];
}

interface CardViewProps {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  /**
   * Read-only, larger non-interactive presentation (e.g. the dealer's hand on
   * the mode-choice screen). Bigger than a mini-card and readable on a phone,
   * without affecting the interactive card size used in play.
   */
  preview?: boolean;
}

export default function CardView({
  card,
  onClick,
  disabled = false,
  selected = false,
  dimmed = false,
  preview = false,
}: CardViewProps) {
  const colorClass = IS_RED[card.suit] ? 'card--red' : 'card--black';
  const stateClass = selected
    ? 'card--selected'
    : dimmed
    ? 'card--dimmed'
    : '';

  const isFace = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K' || card.rank === 'A';

  return (
    <button
      className={`card ${colorClass} ${stateClass} ${isFace ? 'card--face' : ''} ${preview ? 'card--preview' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled && !onClick}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className="card__corner card__corner--tl">
        <span className="card__rank">{card.rank}</span>
        <span className="card__suit">{SUIT_SYMBOL[card.suit]}</span>
      </span>
      <span className="card__center">{centerGlyph(card)}</span>
      <span className="card__corner card__corner--br">
        <span className="card__rank">{card.rank}</span>
        <span className="card__suit">{SUIT_SYMBOL[card.suit]}</span>
      </span>
    </button>
  );
}
