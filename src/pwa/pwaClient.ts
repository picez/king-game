// ---------------------------------------------------------------------------
// PWA client helpers (Stage 21.0) — install / update / offline glue for the
// service worker (public/sw.js). Split into PURE helpers (unit-tested, no DOM)
// and a thin DOM/SW layer used by the usePwa hook. No gameplay/network coupling.
// ---------------------------------------------------------------------------

/** localStorage key: the user dismissed the install banner (don't nag again). */
export const INSTALL_DISMISS_KEY = 'cardMajlis.pwaInstallDismissed.v1';

/** The `beforeinstallprompt` event (not in lib.dom yet). Chrome/Android only. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// ── pure helpers (no DOM; unit-tested) ──────────────────────────────────────

/** Running as an installed app? `displayStandalone` = matchMedia standalone;
 *  `iosStandalone` = navigator.standalone (iOS Safari home-screen apps). */
export function isStandaloneDisplay(displayStandalone: boolean, iosStandalone: boolean): boolean {
  return displayStandalone || iosStandalone;
}

/** Whether to offer the install banner. Only when Chrome fired the prompt event,
 *  the user hasn't dismissed it, the app isn't already installed, and we're not in
 *  an active game (so it never blocks play). Pure — the caller supplies state. */
export function shouldOfferInstall(s: {
  hasPrompt: boolean;
  dismissed: boolean;
  standalone: boolean;
  inGame: boolean;
}): boolean {
  return s.hasPrompt && !s.dismissed && !s.standalone && !s.inGame;
}

/** Minimal Storage shape so the dismiss helpers are testable without a browser. */
export interface KVStore {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
}

export function loadInstallDismissed(store: KVStore | null | undefined): boolean {
  try { return store?.getItem(INSTALL_DISMISS_KEY) === '1'; } catch { return false; }
}
export function saveInstallDismissed(store: KVStore | null | undefined): void {
  try { store?.setItem(INSTALL_DISMISS_KEY, '1'); } catch { /* private mode / no storage */ }
}

// ── DOM / service-worker layer (not unit-tested; guarded at the source level) ─

/** True display-mode standalone check (browser). Safe if APIs are missing. */
export function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  const ios = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return isStandaloneDisplay(!!mm, ios);
}

/**
 * Register the app-shell SW (production only) and detect a WAITING update. Calls
 * `onUpdateReady(reg)` when a new worker is installed and waiting (see sw.js —
 * install does NOT skipWaiting). Also wires a ONE-TIME reload on `controllerchange`
 * — but only when a controller already existed, so a first-ever install never
 * reloads. A refresh is only ever triggered by the user tapping "Refresh"
 * (applyWaitingUpdate → SKIP_WAITING → controllerchange). Never throws.
 */
export function registerServiceWorker(onUpdateReady: (reg: ServiceWorkerRegistration) => void): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // Reload exactly once when the new worker takes control — but ONLY for an update
  // (a controller already exists). First install (controller === null) must not reload.
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }

  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // Already have a waiting worker from a previous load?
    if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady(reg);
    // A new worker started installing → notify once it finishes and is waiting.
    reg.addEventListener('updatefound', () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          onUpdateReady(reg);
        }
      });
    });
  }).catch(() => { /* SW is a progressive enhancement — ignore failures */ });
}

/** Ask the waiting worker to activate (the user tapped Refresh). Triggers the
 *  controllerchange reload wired in registerServiceWorker. */
export function applyWaitingUpdate(reg: ServiceWorkerRegistration | null): void {
  reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}
