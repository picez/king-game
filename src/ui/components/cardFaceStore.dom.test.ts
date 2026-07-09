// Behavioural guard (Stage 13.5): the card-face store must reflect the selected
// theme on <html data-card-faces> so the CSS theme (game.css) applies. The project
// test env is `node` (no jsdom), so we stub a minimal `document` and re-import the
// module — exercising the real applyDom() wiring at load + on set.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = globalThis as any;

describe('cardFaceStore ⇄ <html data-card-faces> (Stage 13.5)', () => {
  const realDoc = G.document;
  let el: { dataset: Record<string, string> };

  beforeEach(() => {
    el = { dataset: {} };
    G.document = { documentElement: el };
    vi.resetModules(); // so the module-load applyDom() runs against our stub
  });
  afterEach(() => {
    G.document = realDoc;
    vi.resetModules();
  });

  it('stamps the default theme (classic) on the element at import time', async () => {
    await import('./cardFaceStore'); // no localStorage in node → default classic
    expect(el.dataset.cardFaces).toBe('classic');
  });

  it('updates the attribute on change and normalises unknown → classic', async () => {
    const store = await import('./cardFaceStore');
    store.setCardFaceTheme('clean');
    expect(el.dataset.cardFaces).toBe('clean');
    expect(store.getCardFaceTheme()).toBe('clean');

    store.setCardFaceTheme('holographic'); // off the whitelist → classic
    expect(el.dataset.cardFaces).toBe('classic');
    expect(store.getCardFaceTheme()).toBe('classic');
  });

  it('is idempotent on the DOM when the theme does not change', async () => {
    const store = await import('./cardFaceStore');
    store.setCardFaceTheme('clean');
    el.dataset.cardFaces = 'sentinel';    // prove a same-value set does NOT rewrite
    store.setCardFaceTheme('clean');      // no change → early return
    expect(el.dataset.cardFaces).toBe('sentinel');
    store.setCardFaceTheme('classic');    // real change → applyDom runs
    expect(el.dataset.cardFaces).toBe('classic');
  });
});
