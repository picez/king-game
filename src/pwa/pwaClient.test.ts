import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INSTALL_DISMISS_KEY, isStandaloneDisplay, shouldOfferInstall, applyStandaloneAttr,
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

  it('applyStandaloneAttr stamps data-standalone true/false on the given element', () => {
    const el = { dataset: {} as DOMStringMap };
    applyStandaloneAttr(true, el);
    expect(el.dataset.standalone).toBe('true');   // installed → CSS installed-only tweaks apply
    applyStandaloneAttr(false, el);
    expect(el.dataset.standalone).toBe('false');  // browser tab → tweaks off
    expect(() => applyStandaloneAttr(true, null)).not.toThrow(); // no DOM → no-op
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

  it('is NETWORK-ONLY for /api and /auth (never caches dynamic responses), skips non-GET', () => {
    // Dynamic endpoints must bypass the SW so they are never served stale offline.
    expect(sw).toMatch(/pathname\.startsWith\('\/api\/'\)[^\n]*pathname\.startsWith\('\/auth\/'\)/);
    // Mutating requests are never handled at all.
    expect(sw).toMatch(/req\.method !== 'GET'\)\s*return/);
    // Only .ok responses are cached (no error/opaque caching), and only for our origin.
    expect(sw).toContain('res.ok');
    expect(sw).toContain('url.origin !== self.location.origin');
  });

  it('offline navigations fall back to the cached app shell (index.html / root)', () => {
    expect(sw).toContain("req.mode === 'navigate'");
    expect(sw).toMatch(/caches\.match\('\/index\.html'\)/);
  });

  it('treats BOTH /api/ and /auth/ as network-only and EARLY-RETURNS (no cache, no stale auth)', () => {
    // Each prefix is checked explicitly and the handler returns before respondWith,
    // so a stale cached /api/me or /auth/* can never hide the live auth state.
    expect(sw).toContain("url.pathname.startsWith('/api/')");
    expect(sw).toContain("url.pathname.startsWith('/auth/')");
    expect(sw).toMatch(/startsWith\('\/auth\/'\)\)\s*return/);
  });

  it('is NETWORK-FIRST so a stale client gets fresh code online (cache is only a fallback)', () => {
    // fetch(req) is the primary path; caches.match runs ONLY inside the .catch() —
    // this is what lets a new deploy (incl. the new auth UI) reach an old client the
    // moment it is back online, before/independent of the "Update available" prompt.
    expect(sw).toMatch(/respondWith\(\s*fetch\(req\)\s*\.then/);
    const netIdx = sw.indexOf('fetch(req)');
    const matchIdx = sw.indexOf('caches.match');
    expect(netIdx).toBeGreaterThan(-1);
    expect(matchIdx).toBeGreaterThan(netIdx);       // cache lookup only after the network try
    expect(sw.indexOf('.catch(')).toBeGreaterThan(netIdx);
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
  it('has exactly ONE controllerchange listener and no reload outside the update path', () => {
    // A single controllerchange registration (inside the controller-exists guard) →
    // no way to reload on a first install or to loop.
    const occurrences = client.match(/addEventListener\('controllerchange'/g) ?? [];
    expect(occurrences).toHaveLength(1);
    const reloads = client.match(/window\.location\.reload\(\)/g) ?? [];
    expect(reloads).toHaveLength(1); // one guarded reload, nothing else
  });
  it('main.tsx no longer registers the SW itself (single source = usePwa)', () => {
    expect(main).not.toContain("serviceWorker.register('/sw.js')");
  });
});

describe('usePwa — event wiring + cleanup', () => {
  const hook = readFileSync(join(process.cwd(), 'src/pwa/usePwa.ts'), 'utf8');
  it('captures beforeinstallprompt (preventDefault) + appinstalled, and tracks online/offline', () => {
    expect(hook).toContain("addEventListener('beforeinstallprompt'");
    expect(hook).toContain('e.preventDefault()');           // suppress Chrome mini-infobar
    expect(hook).toContain("addEventListener('appinstalled'");
    expect(hook).toContain("addEventListener('online'");
    expect(hook).toContain("addEventListener('offline'");
  });
  it('removes every listener on unmount (no leaks / stale handlers)', () => {
    for (const ev of ['beforeinstallprompt', 'appinstalled', 'online', 'offline']) {
      expect(hook).toContain(`removeEventListener('${ev}'`);
    }
  });
  it('registers the SW once (prod only) and drives updateReady from a waiting worker', () => {
    expect(hook).toContain('import.meta.env.PROD');
    expect(hook).toContain('registered.current');            // idempotent register guard
    expect(hook).toContain('registerServiceWorker((reg) => setWaitingReg(reg))');
    expect(hook).toContain('updateReady: waitingReg != null');
  });
  it('the install prompt is one-shot (cleared after userChoice)', () => {
    expect(hook).toContain('ev.userChoice.finally(() => setInstallEvent(null))');
  });
  it('stamps <html data-standalone> from the resolved standalone state', () => {
    expect(hook).toContain('applyStandaloneAttr(standalone)');
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
