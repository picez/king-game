import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type BeforeInstallPromptEvent,
  detectStandalone, applyStandaloneAttr, registerServiceWorker, applyWaitingUpdate,
  loadInstallDismissed, saveInstallDismissed,
} from './pwaClient';

export interface PwaState {
  /** Chrome fired `beforeinstallprompt`, the app isn't installed, and the user
   *  hasn't dismissed the banner. The UI still ANDs this with "not in a game". */
  installReady: boolean;
  /** Show the native install chooser (no-op if unavailable). */
  promptInstall: () => void;
  /** Hide the install banner for good (persisted). */
  dismissInstall: () => void;
  /** A new service worker is installed + waiting to take over. */
  updateReady: boolean;
  /** Activate the waiting worker and reload (user-initiated). */
  applyUpdate: () => void;
  /** The browser is offline (navigator.onLine === false). */
  offline: boolean;
  /** Running as an installed/standalone app. */
  standalone: boolean;
}

/**
 * PWA install / update / offline state (Stage 21.0). Captures `beforeinstallprompt`,
 * registers the SW and surfaces a waiting update, and tracks online/offline — all
 * as a progressive enhancement (every branch degrades to "nothing shown"). No
 * gameplay/network coupling; the SW never sees WebSocket traffic.
 */
export function usePwa(): PwaState {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() =>
    loadInstallDismissed(typeof localStorage !== 'undefined' ? localStorage : null));
  const [standalone] = useState(() => detectStandalone());
  const [waitingReg, setWaitingReg] = useState<ServiceWorkerRegistration | null>(null);
  const [offline, setOffline] = useState(() =>
    typeof navigator !== 'undefined' && navigator.onLine === false);
  const registered = useRef(false);

  // Stamp <html data-standalone> once so installed-only CSS tweaks can apply.
  useEffect(() => { applyStandaloneAttr(standalone); }, [standalone]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();                       // suppress Chrome's mini-infobar
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null); // hide the banner once installed
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Register the SW once (prod only inside registerServiceWorker's guards).
    if (!registered.current && import.meta.env.PROD) {
      registered.current = true;
      registerServiceWorker((reg) => setWaitingReg(reg));
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const promptInstall = useCallback(() => {
    const ev = installEvent;
    if (!ev) return;
    void ev.prompt();
    void ev.userChoice.finally(() => setInstallEvent(null)); // one-shot event
  }, [installEvent]);

  const dismissInstall = useCallback(() => {
    setDismissed(true);
    saveInstallDismissed(typeof localStorage !== 'undefined' ? localStorage : null);
  }, []);

  const applyUpdate = useCallback(() => {
    applyWaitingUpdate(waitingReg);
  }, [waitingReg]);

  return {
    installReady: !!installEvent && !dismissed && !standalone,
    promptInstall,
    dismissInstall,
    updateReady: waitingReg != null,
    applyUpdate,
    offline,
    standalone,
  };
}
