import { useState } from 'react';
import type { Card, Suit } from '../../models/types';
import { cardFaceUrl, cardBackUrl, cardBackWebpUrl } from './cardArt';
import { useCardBackStyle } from './cardBackStore';
import { useI18n } from '../../i18n';

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

/**
 * Card size variants (post-playtest fix #1 — bigger, readable cards):
 *  - `hand`    the player's interactive hand (largest, the default);
 *  - `table`   a card laid in the current trick on the table;
 *  - `preview` the dealer's read-only hand on the mode/trump screens;
 *  - `mini`    dense, non-interactive lists (My-tricks / discard review).
 * Each maps to its own width/height CSS variables (see App.css :root) so all
 * sizes scale together per breakpoint.
 */
export type CardSize = 'hand' | 'table' | 'preview' | 'mini';

interface CardViewProps {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  /** Visual size variant (default `hand`). */
  size?: CardSize;
  /** Static highlight ring (no hover lift) — e.g. the player's winning card. */
  highlight?: boolean;
}

export default function CardView({
  card,
  onClick,
  disabled = false,
  selected = false,
  dimmed = false,
  size = 'hand',
  highlight = false,
}: CardViewProps) {
  const { t } = useI18n();
  // The player's selected card-back style (Stage 13.0) — a local, visual pref.
  const backStyle = useCardBackStyle();
  const colorClass = IS_RED[card.suit] ? 'card--red' : 'card--black';
  const stateClass = selected
    ? 'card--selected'
    : dimmed
    ? 'card--dimmed'
    : '';

  const isFace = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K' || card.rank === 'A';
  // A redacted/hidden card (the server replaces opponents' cards with rank '?',
  // cast into the Card shape — so compare as a string, not a Rank literal).
  const isHidden = (card.rank as string) === '?';

  // Real card artwork (already includes its own corner indices + centre motif).
  const artUrl = cardFaceUrl(card.suit, card.rank);
  const [artFailed, setArtFailed] = useState(false);
  const [backFailed, setBackFailed] = useState(false);
  const showArt = !isHidden && artUrl !== null && !artFailed;
  const showBack = isHidden && !backFailed; // the ornamental back image (else CSS back)

  return (
    <button
      className={
        `card card--${size} ${colorClass} ${stateClass}` +
        ` card--rank-${card.rank.toLowerCase()}` +
        (isFace ? ' card--face' : '') +
        (highlight ? ' card--highlight' : '') +
        (isHidden ? ' card--back' : '') +
        (showArt ? ' card--art' : '')
      }
      onClick={disabled ? undefined : onClick}
      disabled={disabled && !onClick}
      aria-label={isHidden ? t('card.hidden') : t('card.label').replace('{rank}', card.rank).replace('{suit}', t(`suit.${card.suit}`))}
    >
      {showBack && (
        // Prefer the smaller WebP back (Stage 12.9.1); the PNG <img> stays as the
        // universal fallback, and if BOTH fail onError drops to the CSS card back.
        <picture>
          <source srcSet={cardBackWebpUrl(backStyle)} type="image/webp" />
          <img
            className="card__back"
            src={cardBackUrl(backStyle)}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            onError={() => setBackFailed(true)}
          />
        </picture>
      )}
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
