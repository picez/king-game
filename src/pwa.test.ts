import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = join(process.cwd(), 'public');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Parse a PNG's IHDR for its intrinsic pixel dimensions. */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(0, 8).equals(PNG_SIG), `${path} should be a real PNG`).toBe(true);
  // IHDR is the first chunk: 8 (sig) + 4 (len) + 4 ("IHDR") → width/height big-endian.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('PWA manifest', () => {
  const manifest = JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8'));

  it('has the fields required for Android installability', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();
  });

  it('declares 192px and 512px PNG icons plus a maskable icon', () => {
    const icons = manifest.icons as { src: string; sizes: string; type: string; purpose?: string }[];
    expect(icons.some((i) => i.sizes === '192x192' && i.type === 'image/png')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && i.type === 'image/png')).toBe(true);
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('references icon files that exist and are valid PNGs', () => {
    const icons = manifest.icons as { src: string; type: string }[];
    for (const icon of icons) {
      const path = join(PUBLIC, icon.src.replace(/^\//, ''));
      expect(existsSync(path), `${icon.src} should exist`).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(0);
      if (icon.type === 'image/png') {
        const head = readFileSync(path).subarray(0, 8);
        expect(head.equals(PNG_SIG), `${icon.src} should be a real PNG`).toBe(true);
      }
    }
  });

  it('every icon src is same-origin (root-relative, not an external URL)', () => {
    const icons = manifest.icons as { src: string }[];
    for (const icon of icons) {
      expect(icon.src.startsWith('/'), `${icon.src} should be root-relative`).toBe(true);
      expect(/^[a-z]+:\/\//i.test(icon.src), `${icon.src} should not be absolute`).toBe(false);
    }
  });

  it('each PNG icon\'s pixels match its declared "sizes"', () => {
    const icons = manifest.icons as { src: string; sizes: string; type: string }[];
    for (const icon of icons) {
      if (icon.type !== 'image/png') continue;
      const [w, h] = icon.sizes.split('x').map(Number);
      const { width, height } = pngSize(join(PUBLIC, icon.src.replace(/^\//, '')));
      expect(width, `${icon.src} width`).toBe(w);
      expect(height, `${icon.src} height`).toBe(h);
    }
  });

  it('carries no "King" product name (the app is Card Majlis)', () => {
    expect(manifest.name).toBe('Card Majlis');
    expect(manifest.name).not.toMatch(/King/);
    expect(manifest.short_name).not.toMatch(/King/);
  });
});

describe('Card Majlis app icons', () => {
  // Every icon the HTML links to must exist, be a valid PNG at the right size,
  // and stay within a sane byte budget (procedural, ~emerald medallion + star).
  const cases: { file: string; size: number; maxKB: number }[] = [
    { file: 'icons/icon-192.png', size: 192, maxKB: 40 },
    { file: 'icons/icon-512.png', size: 512, maxKB: 160 },
    { file: 'icons/maskable-512.png', size: 512, maxKB: 160 },
    { file: 'icons/apple-touch-icon.png', size: 180, maxKB: 40 },
    { file: 'icons/favicon-32.png', size: 32, maxKB: 6 },
  ];

  it.each(cases)('$file is a valid $size×$size PNG under $maxKB KB', ({ file, size, maxKB }) => {
    const path = join(PUBLIC, file);
    expect(existsSync(path), `${file} should exist`).toBe(true);
    const { width, height } = pngSize(path);
    expect(width).toBe(size);
    expect(height).toBe(size);
    expect(statSync(path).size).toBeLessThan(maxKB * 1024);
  });

  it('the SVG favicon exists and is well-formed vector markup', () => {
    const svg = readFileSync(join(PUBLIC, 'icons', 'icon.svg'), 'utf8');
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 512 512"/);
    expect(svg).toContain('</svg>');
  });

  it('index.html links the apple-touch-icon and PNG favicon fallback', () => {
    const idx = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(idx).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(idx).toContain('href="/icons/favicon-32.png"');
    expect(idx).toContain('href="/icons/icon.svg"');
  });
});

describe('service worker', () => {
  const sw = readFileSync(join(PUBLIC, 'sw.js'), 'utf8');

  it('has a fetch handler (offline app-shell)', () => {
    expect(sw).toMatch(/addEventListener\(\s*['"]fetch['"]/);
  });

  it('does not hardcode hashed asset names to precache (avoids staleness)', () => {
    expect(sw).not.toMatch(/assets\/index-/);
  });
});
