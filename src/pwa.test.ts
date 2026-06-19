import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = join(process.cwd(), 'public');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
