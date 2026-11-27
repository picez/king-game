// Stage 44.2 — lazy game screens. The loaders live here (not inline in App) so
// the prefetch and React.lazy share the exact same dynamic imports → one chunk each.

/** sessionStorage flag of ScreenLoadBoundary: one automatic reload per tab. */
export const RELOAD_FLAG = 'cm-chunk-reload';

export const screenLoaders = {
  king: () => import('./ui/LocalGame'),
  durak: () => import('./ui/durak/DurakLocalGame'),
  deberc: () => import('./ui/deberc/DebercLocalGame'),
  tarneeb: () => import('./ui/tarneeb/TarneebLocalGame'),
  preferans: () => import('./ui/preferans/PreferansLocalGame'),
  fiftyOne: () => import('./ui/fiftyOne/FiftyOneLocalGame'),
  poker: () => import('./ui/poker/PokerLocalGame'),
  online: () => import('./ui/online/OnlineGame'),
  solitaire: () => import('./ui/solitaire/SolitaireApp'),
} as const;

/** Delay after the menu mounts before warming the chunks (first paint stays light). */
export const PREFETCH_DELAY_MS = 2500;

/**
 * Downloads every game chunk once the browser is idle, one after another, so the
 * service worker caches them (offline play keeps working) without competing with
 * the menu's first load. Skipped on Save-Data / 2G. Returns a cleanup.
 */
export function prefetchGameScreens(win: Window | undefined = typeof window === 'undefined' ? undefined : window): () => void {
  if (!win) return () => {};
  const conn = (win.navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (conn?.saveData || conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return () => {};
  let cancelled = false;
  const run = async () => {
    let all = true;
    for (const load of Object.values(screenLoaders)) {
      if (cancelled) return;
      try { await load(); } catch { all = false; /* offline / deploy swap: the screen loads on demand later */ }
    }
    // Every chunk of THIS build loaded: re-arm ScreenLoadBoundary's one-shot reload.
    if (all) { try { win.sessionStorage.removeItem(RELOAD_FLAG); } catch { /* storage blocked */ } }
  };
  const idle = (win as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  const t = win.setTimeout(() => { if (idle) idle(() => void run()); else void run(); }, PREFETCH_DELAY_MS);
  return () => { cancelled = true; win.clearTimeout(t); };
}
