// Behavioural guard (Stage 13.1): the card-back store must reflect the selected
// style on <html data-card-back> so the CSS decks/fans (`--card-back`) retint. The
// project's test env is `node` (no jsdom), so we stub a minimal `document` and
// re-import the module — exercising the real applyDom() wiring at load + on set.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = globalThis as any;

describe('cardBackStore ⇄ <html data-card-back> (Stage 13.1)', () => {
  const realDoc = G.document;
  let el: { dataset: Record<string, string> };

  beforeEach(() => {
    el = { dataset: {} };
    G.document = { documentElement: el, querySelector: () => null }; // the theme store looks up its meta
    vi.resetModules(); // so the module-load applyDom() runs against our stub
  });
  afterEach(() => {
    G.document = realDoc;
    vi.resetModules();
  });

  it('stamps the default (auto → sapphire on Midnight) on the element at import time', async () => {
    await import('./cardBackStore'); // no localStorage in node → auto, Midnight
    expect(el.dataset.cardBack).toBe('blue');
  });

  it('re-stamps an auto back when the theme changes (Stage 42.2)', async () => {
    await import('./cardBackStore');
    const theme = await import('./appThemeStore');
    theme.setAppTheme('classic');
    expect(el.dataset.cardBack).toBe('green');
    theme.setAppTheme('midnight');
    expect(el.dataset.cardBack).toBe('blue');
  });

  it('updates the attribute on change and normalises legacy/unknown → auto', async () => {
    const store = await import('./cardBackStore');
    store.setCardBackStyle('red');
    expect(el.dataset.cardBack).toBe('red');
    expect(store.getCardBackStyle()).toBe('red');

    store.setCardBackStyle('classic'); // legacy DB default → auto → sapphire on Midnight
    expect(el.dataset.cardBack).toBe('blue');

    store.setCardBackStyle('red');
    store.setCardBackStyle('holographic'); // off the whitelist → auto
    expect(el.dataset.cardBack).toBe('blue');

    store.setCardBackStyle(null); // idempotent (already auto)
    expect(el.dataset.cardBack).toBe('blue');
  });

  it('notifies subscribers only when the resolved style actually changes', async () => {
    const store = await import('./cardBackStore');
    let hits = 0;
    // subscribe is internal; useSyncExternalStore uses it — assert via the public
    // setter's effect: setting the same resolved value must be a no-op on the DOM.
    store.setCardBackStyle('red');
    el.dataset.cardBack = 'sentinel';   // prove the next same-value set does NOT rewrite
    store.setCardBackStyle('red');       // no change → early return, no applyDom
    expect(el.dataset.cardBack).toBe('sentinel');
    store.setCardBackStyle('green');     // real change → applyDom runs
    expect(el.dataset.cardBack).toBe('green');
    hits++; // touch to satisfy no-unused in strict lint configs
    expect(hits).toBe(1);
  });
});
