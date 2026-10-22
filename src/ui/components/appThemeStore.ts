// ---------------------------------------------------------------------------
// Client-only source of truth for the app colour theme (Stage 42.0).
//
// Same tiny external-store pattern as cardFaceStore: it stamps
// `<html data-app-theme>` (and the theme-color meta) so the CSS tokens switch with
// no per-component wiring. index.html stamps the same attribute from localStorage
// before first paint, so a classic-theme player never sees a midnight flash.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';
import { loadAppTheme } from '../../net/prefs';
import { APP_THEME_COLOR, normalizeAppTheme, type AppTheme } from './appTheme';

let current: AppTheme = loadAppTheme();
const listeners = new Set<() => void>();

function applyDom(theme: AppTheme): void {
  if (typeof document === 'undefined' || !document.documentElement) return;
  document.documentElement.dataset.appTheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', APP_THEME_COLOR[theme]);
}
applyDom(current);

export function getAppTheme(): AppTheme {
  return current;
}

export function setAppTheme(theme: string | null | undefined): void {
  const next = normalizeAppTheme(theme);
  if (next === current) return;
  current = next;
  applyDom(next);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Non-React subscription (the card-back store re-resolves its 'auto' back). */
export const subscribeAppTheme = subscribe;

export function useAppTheme(): AppTheme {
  return useSyncExternalStore(subscribe, getAppTheme, getAppTheme);
}
