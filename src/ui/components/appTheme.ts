// ---------------------------------------------------------------------------
// App colour theme — pure helpers (Stage 42.0).
//
// A purely VISUAL, local preference: 'midnight' (default — deep navy, glassy panels,
// blue accent) or 'classic' (the original green felt). It only flips the CSS tokens
// via `<html data-app-theme="...">` (src/styles/base.css). Never game state, never
// synced to the server.
// ---------------------------------------------------------------------------

export const APP_THEMES = ['midnight', 'classic'] as const;
export type AppTheme = (typeof APP_THEMES)[number];
export const DEFAULT_APP_THEME: AppTheme = 'midnight';

/** The browser chrome colour (<meta name="theme-color">) for each theme. */
export const APP_THEME_COLOR: Record<AppTheme, string> = { midnight: '#0b0e15', classic: '#0d4f28' };

/** Any input → a valid AppTheme; unknown/legacy → the default. */
export function normalizeAppTheme(v: string | null | undefined): AppTheme {
  return (APP_THEMES as readonly string[]).includes(v as string) ? (v as AppTheme) : DEFAULT_APP_THEME;
}
