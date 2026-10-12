import { useEffect, useRef, useState } from 'react';
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
  /** Marks the LEAD card of the current trick/bout (Stage 27.0) — a distinct corner badge. */
  lead?: boolean;
}

export default function CardView({
  card,
  onClick,
  disabled = false,
  selected = false,
  dimmed = false,
  size = 'hand',
  highlight = false,
  lead = false,
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
  // Load state is KEYED BY THE URL it belongs to, so there is nothing to reset when the
  // card changes (list reuse): a new URL simply has no entry yet.
  //
  // (Stage 39.4 — owner bug: "cards overlap".) This used to be two booleans reset by a
  // `useEffect([artUrl])`. Effects run AFTER the commit, and an image served from cache can
  // fire `load` first — the mount effect then set "loaded" back to false for an image that
  // was already painted. The <img> stayed visible while `.card--art` came off, so the text
  // fallback (big centre suit + corner indices) drew ON TOP of the artwork: one card that
  // looked like two. Any remount triggered it — a hand card moving between fan rows, a new
  // discard top, a meld re-rendered.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const artLoaded = artUrl !== null && loadedUrl === artUrl;
  const artFailed = artUrl !== null && failedUrl === artUrl;
  const [backFailed, setBackFailed] = useState(false);
  // A cached image may be complete before React attaches `onLoad`, in which case the event
  // is never delivered. Ask the element itself once per URL.
  const artRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = artRef.current;
    if (artUrl !== null && img && img.complete && img.naturalWidth > 0) setLoadedUrl(artUrl);
  }, [artUrl]);
  const attemptArt = !isHidden && artUrl !== null && !artFailed; // render the <img> to load it
  // Only HIDE the text fallback once the image has actually painted (onLoad). A stalled or
  // broken-but-not-errored request (e.g. a bad service-worker cache entry) then shows the
  // rank/suit text instead of a blank card.
  const showArt = attemptArt && artLoaded;
  const showBack = isHidden && !backFailed; // the ornamental back image (else CSS back)

  return (
    <button
      className={
        `card card--${size} ${colorClass} ${stateClass}` +
        ` card--rank-${card.rank.toLowerCase()}` +
        (isFace ? ' card--face' : '') +
        (highlight ? ' card--highlight' : '') +
        (lead ? ' card--lead' : '') +
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
      {attemptArt && (
        <img
          ref={artRef}
          className="card__art"
          src={artUrl}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setLoadedUrl(artUrl)}
          onError={() => setFailedUrl(artUrl)}
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
