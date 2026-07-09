// Guards for the Stage 12.9 WebP optimization: every asset that declares a `webp`
// variant has BOTH files on disk (PNG fallback kept), the WebP is smaller, the
// heroes are dramatically smaller, and the CSS prefers WebP via image-set while
// still carrying the PNG fallback.
import { describe, it, expect } from 'vitest';
import { statSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { VISUAL_ASSETS } from './visualAssets';

const publicFile = (src: string) => fileURLToPath(new URL(`../../public${src}`, import.meta.url));
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const withWebp = VISUAL_ASSETS.filter((a) => a.webp);
const RIFF = Buffer.from('RIFF', 'ascii');

describe('WebP variants (Stage 12.9)', () => {
  it('optimizes exactly the four big opaque assets (heroes + felt + back)', () => {
    expect(withWebp.map((a) => a.id).sort()).toEqual(
      ['card-back-green', 'felt-tile', 'menu-hero-portrait', 'menu-hero-wide'],
    );
  });

  it('each declares a same-origin, traversal-free .webp path', () => {
    for (const a of withWebp) {
      expect(a.webp!.startsWith('/'), a.webp).toBe(true);
      expect(a.webp!.includes('..'), a.webp).toBe(false);
      expect(a.webp!.endsWith('.webp'), a.webp).toBe(true);
    }
  });

  it('both the WebP and its PNG fallback exist; WebP is a real, smaller RIFF/WEBP', () => {
    for (const a of withWebp) {
      const png = publicFile(a.src), webp = publicFile(a.webp!);
      expect(existsSync(png), a.src).toBe(true);
      expect(existsSync(webp), a.webp).toBe(true);
      const buf = readFileSync(webp);
      expect(buf.subarray(0, 4).equals(RIFF) && buf.subarray(8, 12).toString('ascii') === 'WEBP', `${a.webp} is WEBP`).toBe(true);
      expect(statSync(webp).size, `${a.webp} smaller than PNG`).toBeLessThanOrEqual(statSync(png).size);
    }
  });

  it('the menu heroes shrink dramatically (>60%) in WebP', () => {
    for (const id of ['menu-hero-portrait', 'menu-hero-wide']) {
      const a = VISUAL_ASSETS.find((x) => x.id === id)!;
      const png = statSync(publicFile(a.src)).size, webp = statSync(publicFile(a.webp!)).size;
      expect(webp, `${id}: ${webp} vs ${png}`).toBeLessThan(png * 0.4);
    }
  });
});

describe('CSS prefers WebP with a PNG fallback', () => {
  const base = read('src/styles/base.css');
  const lobby = read('src/styles/lobby.css');
  it('base.css guards felt/back WebP behind @supports image-set, PNG kept', () => {
    expect(base).toContain('@supports (background-image: image-set(');
    expect(base).toContain("image-set(url('/visual/felt-tile.webp') type('image/webp')");
    expect(base).toContain("url('/visual/felt-tile.png')");           // fallback retained
    expect(base).toContain("url('/cards/back/back-green.webp')");
  });
  it('lobby.css upgrades both menu heroes to WebP with the PNG fallback', () => {
    expect(lobby).toContain("image-set(url('/visual/menu-hero-portrait.webp') type('image/webp')");
    expect(lobby).toContain("image-set(url('/visual/menu-hero-wide.webp') type('image/webp')");
    expect(lobby).toContain("url('/visual/menu-hero-wide.png')");     // fallback retained
  });
});
