// Behavioural guard (Stage 13.2): the motion store must reflect the choice on
// <html data-motion> and the RESOLVED intensity on <html data-motion-effective>,
// applying the OS `prefers-reduced-motion` override. The project's test env is
// `node` (no jsdom), so we stub a minimal `document` + `window.matchMedia` and
// re-import the module — exercising the real applyDom()/resolve wiring.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const G = globalThis as any;

/** A matchMedia stub whose reduced-motion query reports `reduce`. */
function stubMatchMedia(reduce: boolean) {
  return (query: string) => ({
    matches: query.includes('reduce') ? reduce : false,
    media: query,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
}

describe('motionPreferenceStore ⇄ <html data-motion*> (Stage 13.2)', () => {
  const realDoc = G.document;
  const realWin = G.window;
  let el: { dataset: Record<string, string> };

  beforeEach(() => {
    el = { dataset: {} };
    G.document = { documentElement: el };
    vi.resetModules();
  });
  afterEach(() => {
    G.document = realDoc;
    G.window = realWin;
    vi.resetModules();
  });

  it('stamps default (system → effective full) at import time when the OS is neutral', async () => {
    G.window = { matchMedia: stubMatchMedia(false) };
    await import('./motionPreferenceStore');
    expect(el.dataset.motion).toBe('system');          // no localStorage in node → default
    expect(el.dataset.motionEffective).toBe('full');
  });

  it('updates both attributes on change and normalises unknown → system', async () => {
    G.window = { matchMedia: stubMatchMedia(false) };
    const store = await import('./motionPreferenceStore');

    store.setMotionPreference('reduced');
    expect(el.dataset.motion).toBe('reduced');
    expect(el.dataset.motionEffective).toBe('reduced');
    expect(store.getMotionPreference()).toBe('reduced');

    store.setMotionPreference('off');
    expect(el.dataset.motionEffective).toBe('off');

    store.setMotionPreference('full');
    expect(el.dataset.motionEffective).toBe('full');

    store.setMotionPreference('holographic'); // off the whitelist → system
    expect(el.dataset.motion).toBe('system');
    expect(el.dataset.motionEffective).toBe('full');
  });

  it('is a no-op on the DOM when the resolved value does not change', async () => {
    G.window = { matchMedia: stubMatchMedia(false) };
    const store = await import('./motionPreferenceStore');
    store.setMotionPreference('reduced');
    el.dataset.motionEffective = 'sentinel'; // prove the next same-value set does NOT restamp
    store.setMotionPreference('reduced');    // same value → early return
    expect(el.dataset.motionEffective).toBe('sentinel');
  });

  it('OS prefers-reduced-motion downgrades full/system but never forces full; off stays off', async () => {
    G.window = { matchMedia: stubMatchMedia(true) }; // OS asks to reduce motion
    const store = await import('./motionPreferenceStore');
    // default system under OS-reduce → effective reduced (NOT full)
    expect(el.dataset.motion).toBe('system');
    expect(el.dataset.motionEffective).toBe('reduced');

    store.setMotionPreference('full');
    expect(el.dataset.motion).toBe('full');
    expect(el.dataset.motionEffective).toBe('reduced'); // accessibility: not 'full'
    expect(store.getEffectiveMotion()).toBe('reduced');

    store.setMotionPreference('off'); // explicit off is honoured even under OS reduce
    expect(el.dataset.motionEffective).toBe('off');
  });
});
