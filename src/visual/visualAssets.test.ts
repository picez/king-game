// Guard that every declared P0 visual asset actually exists under public/, is the
// right format, and stays within its size budget — so the redesign stages (12.2+)
// and the production build can rely on them, and a bloated re-export is caught.
import { describe, it, expect } from 'vitest';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VISUAL_ASSETS, VISUAL_TOTAL_MAX_BYTES, visualAsset } from './visualAssets';

/** Resolve a public URL path ('/visual/x.png') to its file on disk. */
const publicFile = (src: string) => fileURLToPath(new URL(`../../public${src}`, import.meta.url));

describe('visual asset manifest', () => {
  it('has unique ids and same-origin, traversal-free src paths', () => {
    const ids = VISUAL_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of VISUAL_ASSETS) {
      expect(a.src.startsWith('/'), a.src).toBe(true);
      expect(a.src.includes('..'), a.src).toBe(false);
      expect(a.src.toLowerCase().endsWith(`.${a.format}`), `${a.src} vs ${a.format}`).toBe(true);
    }
  });

  it('every present asset exists on disk and is within its size budget', () => {
    for (const a of VISUAL_ASSETS.filter((x) => x.present)) {
      const size = statSync(publicFile(a.src)).size; // throws if the file is missing
      expect(size, `${a.src} is empty`).toBeGreaterThan(0);
      expect(size, `${a.src} = ${size}B exceeds ${a.maxBytes}B`).toBeLessThanOrEqual(a.maxBytes);
    }
  });

  it('all 8 P0 assets are present (felt, 2 heroes, card back, 4 game icons)', () => {
    const p0 = VISUAL_ASSETS.filter((a) => a.priority === 'P0');
    expect(p0).toHaveLength(8);
    expect(p0.every((a) => a.present)).toBe(true);
    for (const id of ['felt-tile', 'menu-hero-portrait', 'menu-hero-wide', 'card-back-green',
      'icon-king', 'icon-durak', 'icon-deberc', 'icon-tarneeb']) {
      expect(visualAsset(id)?.present, id).toBe(true);
    }
  });

  it('the real total P0 footprint stays under the documented ceiling', () => {
    const total = VISUAL_ASSETS.filter((a) => a.present)
      .reduce((sum, a) => sum + statSync(publicFile(a.src)).size, 0);
    expect(total, `total ${total}B over ${VISUAL_TOTAL_MAX_BYTES}B`).toBeLessThanOrEqual(VISUAL_TOTAL_MAX_BYTES);
  });
});
