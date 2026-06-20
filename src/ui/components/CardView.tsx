import { useState } from 'react';
import type { Card, Suit } from '../../models/types';
import { cardFaceUrl } from './cardArt';

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

/** A simple centre motif used only in the text fallback (if artwork fails). */
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
  /** Compact, non-interactive size for dense lists (e.g. the My-tricks panel). */
  small?: boolean;
  /** Static highlight ring (no hover lift) — e.g. the player's winning card. */
  highlight?: boolean;
}

export default function CardView({
  card,
  onClick,
  disabled = false,
  selected = false,
  dimmed = false,
  preview = false,
  small = false,
  highlight = false,
}: CardViewProps) {
  const colorClass = IS_RED[card.suit] ? 'card--red' : 'card--black';
  const stateClass = selected
    ? 'card--selected'
    : dimmed
    ? 'card--dimmed'
    : '';

  const isFace = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K' || card.rank === 'A';

  // Real card artwork (already includes its own corner indices + centre motif).
  const artUrl = cardFaceUrl(card.suit, card.rank);
  const [artFailed, setArtFailed] = useState(false);
  const showArt = artUrl !== null && !artFailed;

  return (
    <button
      className={
        `card ${colorClass} ${stateClass}` +
        ` card--rank-${card.rank.toLowerCase()}` +
        (isFace ? ' card--face' : '') +
        (preview ? ' card--preview' : '') +
        (small ? ' card--small' : '') +
        (highlight ? ' card--highlight' : '') +
        (showArt ? ' card--art' : '')
      }
      onClick={disabled ? undefined : onClick}
      disabled={disabled && !onClick}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      {showArt && (
        <img
          className="card__art"
          src={artUrl}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setArtFailed(true)}
        />
      )}
      {/* Text fallback (also the a11y/print layer); hidden by CSS when art shows. */}
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
