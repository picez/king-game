import { Component, type ReactNode } from 'react';
import { useI18n } from '../../i18n';

import { RELOAD_FLAG } from '../../gameScreens';

/** A failed dynamic import (new deploy removed the old chunk, or offline). */
export function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Failed to fetch|error loading dynamically/i.test(msg);
}

function Fallback() {
  const { t } = useI18n();
  return (
    <div className="screen-loading" role="alert">
      <p>{t('pwa.updateTitle')}</p>
      <button type="button" className="btn" onClick={() => window.location.reload()}>{t('pwa.refresh')}</button>
    </div>
  );
}

/**
 * Stage 44.2: wraps the lazy game screens. When a chunk cannot load right after a
 * deploy, the page reloads once (the new index.html names the new chunks); a second
 * failure shows a "Refresh" card instead of a blank screen. Other errors rethrow.
 */
export default class ScreenLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(e: unknown) {
    if (!isChunkLoadError(e)) throw e;
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    if (!isChunkLoadError(e)) return;
    try {
      if (!sessionStorage.getItem(RELOAD_FLAG)) {
        sessionStorage.setItem(RELOAD_FLAG, '1');
        window.location.reload();
      }
    } catch { /* storage blocked: the fallback card stays */ }
  }
  render() { return this.state.failed ? <Fallback /> : this.props.children; }
}
