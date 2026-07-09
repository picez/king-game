// ---------------------------------------------------------------------------
// Client-only source of truth for the selected card FACE theme (Stage 13.5).
//
// A tiny external store (no context/provider, like cardBackStore) that reflects
// the choice on `<html data-card-faces="classic|clean">` so the CSS theme (see
// src/styles/game.css) applies to every CardView with NO per-component wiring and
// NO game state. Purely visual + LOCAL: never put into room/WS state. Initialised
// from localStorage on module load; the server profile rehydrates it via
// setCardFaceTheme when signed in.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';
import { loadCardFaceTheme } from '../../net/prefs';
import { normalizeCardFaceTheme, type CardFaceTheme } from './cardFaceTheme';

let current: CardFaceTheme = normalizeCardFaceTheme(loadCardFaceTheme());
const listeners = new Set<() => void>();

/** Reflect the theme on <html> so CSS `:root[data-card-faces="clean"]` can apply. */
function applyDom(theme: CardFaceTheme): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.cardFaces = theme;
  }
}
applyDom(current); // stamp the attribute once, at first import

export function getCardFaceTheme(): CardFaceTheme {
  return current;
}

/** Set the active theme (accepts unknown/legacy inputs) + notify subscribers. */
export function setCardFaceTheme(theme: string | null | undefined): void {
  const next = normalizeCardFaceTheme(theme);
  if (next === current) return;
  current = next;
  applyDom(next);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** React hook: re-renders the caller whenever the card face theme changes. */
export function useCardFaceTheme(): CardFaceTheme {
  return useSyncExternalStore(subscribe, getCardFaceTheme, getCardFaceTheme);
}
