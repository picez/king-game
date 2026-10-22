// ---------------------------------------------------------------------------
// Client-only source of truth for the selected card-back style (Stage 13.0).
//
// A tiny external store (no context/provider needed) so ANY CardView — however
// deeply nested, in any game screen — reflects the choice via useSyncExternalStore,
// AND the CSS decks/fans pick it up through a `data-card-back` attribute on
// <html> that flips the `--card-back` variable (see src/styles/base.css).
//
// Stage 42.2: the store holds the player's CHOICE, which may be 'auto' (follow the
// app theme: sapphire on Midnight, green on Classic). Everything that DRAWS a back
// reads the resolved style, which also changes when the theme does.
//
// Purely visual + LOCAL: it is NEVER put into room/WS state, so two players in
// the same online room can each have their own back. Initialised from localStorage
// on module load; the server profile (when signed in) rehydrates it via setCardBackStyle.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';
import { loadCardStyle } from '../../net/prefs';
import { normalizeCardBackChoice, resolveCardBack, type CardBackChoice, type CardBackStyle } from './cardArt';
import { getAppTheme, subscribeAppTheme } from './appThemeStore';

let choice: CardBackChoice = normalizeCardBackChoice(loadCardStyle());
let resolved: CardBackStyle = resolveCardBack(choice, getAppTheme());
const listeners = new Set<() => void>();

/** Reflect the drawn style on <html> so CSS `:root[data-card-back="red"]` can retint. */
function applyDom(style: CardBackStyle): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.cardBack = style;
  }
}
applyDom(resolved); // set the attribute once, at first import

/** Re-resolve after the choice or the theme moved; notify only on a real change. */
function refresh(force = false): void {
  const next = resolveCardBack(choice, getAppTheme());
  if (next === resolved && !force) return;
  resolved = next;
  applyDom(next);
  listeners.forEach((l) => l());
}
subscribeAppTheme(() => refresh());

/** The back actually drawn (an 'auto' choice already resolved against the theme). */
export function getCardBackStyle(): CardBackStyle {
  return resolved;
}

/** What the player picked — 'auto' or a pinned style (the Profile picker). */
export function getCardBackChoice(): CardBackChoice {
  return choice;
}

/** Set the choice (accepts the legacy DB 'classic' → auto) + notify subscribers. */
export function setCardBackStyle(style: string | null | undefined): void {
  const next = normalizeCardBackChoice(style);
  if (next === choice) return;
  choice = next;
  refresh(true); // the picker's highlight moves even when the drawn back does not
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** React hook: re-renders the caller whenever the drawn back changes. */
export function useCardBackStyle(): CardBackStyle {
  return useSyncExternalStore(subscribe, getCardBackStyle, getCardBackStyle);
}

/** React hook: the player's choice, for the Profile picker. */
export function useCardBackChoice(): CardBackChoice {
  return useSyncExternalStore(subscribe, getCardBackChoice, getCardBackChoice);
}
