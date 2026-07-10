import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INSTALL_DISMISS_KEY, isStandaloneDisplay, shouldOfferInstall,
  loadInstallDismissed, saveInstallDismissed, type KVStore,
} from './pwaClient';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** A tiny in-memory KVStore so the dismiss helpers are testable without a browser. */
function memStore(init: Record<string, string> = {}): KVStore & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

describe('pwaClient — pure helpers', () => {
  it('isStandaloneDisplay is true for display-mode standalone OR iOS standalone', () => {
    expect(isStandaloneDisplay(false, false)).toBe(false);
    expect(isStandaloneDisplay(true, false)).toBe(true);   // Android/desktop installed
    expect(isStandaloneDisplay(false, true)).toBe(true);   // iOS home-screen app
  });

  it('shouldOfferInstall only when prompt fired, not dismissed, not installed, not in a game', () => {
    const base = { hasPrompt: true, dismissed: false, standalone: false, inGame: false };
    expect(shouldOfferInstall(base)).toBe(true);
    expect(shouldOfferInstall({ ...base, hasPrompt: false })).toBe(false); // no beforeinstallprompt yet
    expect(shouldOfferInstall({ ...base, dismissed: true })).toBe(false);  // user dismissed
    expect(shouldOfferInstall({ ...base, standalone: true })).toBe(false); // already installed
    expect(shouldOfferInstall({ ...base, inGame: true })).toBe(false);     // never during play
  });

  it('dismiss suppression round-trips via the KV store (persisted flag)', () => {
    const store = memStore();
    expect(loadInstallDismissed(store)).toBe(false);
    saveInstallDismissed(store);
    expect(store.data[INSTALL_DISMISS_KEY]).toBe('1');
    expect(loadInstallDismissed(store)).toBe(true);
    // Null/missing storage (private mode) never throws → treated as "not dismissed".
    expect(loadInstallDismissed(null)).toBe(false);
    expect(() => saveInstallDismissed(null)).not.toThrow();
  });
});

describe('service worker — controlled updates (no mid-game auto-refresh)', () => {
  const sw = read('public/sw.js');
  it('install does NOT skipWaiting (a new SW waits for the user), and handles SKIP_WAITING', () => {
    // The install handler must not force-activate; skipWaiting only via a message.
    expect(sw).toMatch(/addEventListener\(\s*['"]install['"]/);
    expect(sw).not.toMatch(/install['"][^)]*\)\s*=>\s*self\.skipWaiting/);
    expect(sw).toMatch(/addEventListener\(\s*['"]message['"]/);
    expect(sw).toContain("event.data.type === 'SKIP_WAITING'");
    expect(sw).toContain('self.skipWaiting()');
  });
  it('bumps the cache version so a new shell purges the old offline copy', () => {
    expect(sw).toMatch(/const CACHE = 'card-majlis-shell-v\d+'/);
  });
});

describe('registration + reload are user-controlled', () => {
  const client = read('src/pwa/pwaClient.ts');
  const main = read('src/main.tsx');
  it('only reloads on controllerchange when a controller already exists (no first-install reload)', () => {
    expect(client).toContain("if (navigator.serviceWorker.controller)");
    expect(client).toContain("addEventListener('controllerchange'");
    expect(client).toContain('window.location.reload()');
    // The reload guard is inside the controller-exists branch (an UPDATE, not first install).
    const idx = client.indexOf('if (navigator.serviceWorker.controller)');
    const reloadIdx = client.indexOf('window.location.reload()');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(reloadIdx).toBeGreaterThan(idx);
  });
  it('applyWaitingUpdate posts SKIP_WAITING to the waiting worker (user-initiated only)', () => {
    expect(client).toContain("postMessage({ type: 'SKIP_WAITING' })");
  });
  it('main.tsx no longer registers the SW itself (single source = usePwa)', () => {
    expect(main).not.toContain("serviceWorker.register('/sw.js')");
  });
});

describe('PwaBanners + App wiring', () => {
  const banners = read('src/ui/components/PwaBanners.tsx');
  const app = read('src/App.tsx');
  it('suppresses the install card during an active game; keeps update/offline strips', () => {
    expect(banners).toContain('pwa.installReady && !inGame'); // install only outside a game
    expect(banners).toContain("t('pwa.offline')");
    expect(banners).toContain("t('pwa.updateTitle')");
    expect(banners).toContain('pwa.applyUpdate');             // Refresh → user-initiated update
  });
  it('App renders PwaBanners with the inGame flag (menu vs local/online)', () => {
    expect(app).toContain('const pwa = usePwa()');
    expect(app).toContain("inGame={mode.kind !== 'menu'}");
    expect(app).toContain('<PwaBanners');
  });
  it('the banner strips are non-blocking (pointer-events pass-through container)', () => {
    const css = read('src/styles/pwa.css');
    expect(css).toContain('pointer-events: none');  // container is click-through
    expect(css).toContain('pointer-events: auto');  // only the pill is interactive
  });
});
