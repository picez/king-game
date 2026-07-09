// ---------------------------------------------------------------------------
// Client-only source of truth for the selected card-back style (Stage 13.0).
//
// A tiny external store (no context/provider needed) so ANY CardView — however
// deeply nested, in any game screen — reflects the choice via useSyncExternalStore,
// AND the CSS decks/fans pick it up through a `data-card-back` attribute on
// <html> that flips the `--card-back` variable (see src/styles/base.css).
//
// Purely visual + LOCAL: it is NEVER put into room/WS state, so two players in
// the same online room can each have their own back. Initialised from localStorage
// on module load; the server profile (when signed in) rehydrates it via setCardBack.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';
import { loadCardStyle } from '../../net/prefs';
import { normalizeCardBack, type CardBackStyle } from './cardArt';

let current: CardBackStyle = normalizeCardBack(loadCardStyle());
const listeners = new Set<() => void>();

/** Reflect the style on <html> so CSS `:root[data-card-back="red"]` can retint. */
function applyDom(style: CardBackStyle): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.cardBack = style;
  }
}
applyDom(current); // set the attribute once, at first import

export function getCardBackStyle(): CardBackStyle {
  return current;
}

/** Set the active style (accepts 'classic'/legacy inputs) + notify subscribers. */
export function setCardBackStyle(style: string | null | undefined): void {
  const next = normalizeCardBack(style);
  if (next === current) return;
  current = next;
  applyDom(next);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** React hook: re-renders the caller whenever the card-back style changes. */
export function useCardBackStyle(): CardBackStyle {
  return useSyncExternalStore(subscribe, getCardBackStyle, getCardBackStyle);
}
