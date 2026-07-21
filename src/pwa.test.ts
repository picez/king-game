import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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

  it('description names all SIX current games (no stale four/five-game copy)', () => {
    const d: string = manifest.description;
    for (const game of ['King', 'Durak', 'Deberc', 'Tarneeb', 'Preferans', '51']) {
      expect(d, `description should mention ${game}`).toContain(game);
    }
    // The old stale copy ended "…Deberc & Tarneeb." with the two newest games missing.
    expect(d).not.toMatch(/Deberc & Tarneeb\./);
  });

  it('scope is root ("/") so a TWA owns all in-scope URLs (incl. /?room=CODE)', () => {
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/');
  });

  it('index.html <meta description> matches the manifest (all six games)', () => {
    const idx = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    for (const game of ['King', 'Durak', 'Deberc', 'Tarneeb', 'Preferans', '51']) {
      expect(idx, `index.html description should mention ${game}`).toMatch(new RegExp(`content="[^"]*${game}`));
    }
    expect(idx).not.toMatch(/Deberc &amp; Tarneeb\.|Deberc & Tarneeb\./);
  });
});

describe('Android TWA readiness (Stage 33.1) — Digital Asset Links', () => {
  const WELL_KNOWN = join(PUBLIC, '.well-known');
  const EXAMPLE = join(WELL_KNOWN, 'assetlinks.example.json');

  it('ships an EXAMPLE assetlinks (not a real one) so 33.2 has a template', () => {
    expect(existsSync(EXAMPLE), 'assetlinks.example.json should exist').toBe(true);
    // Never ship a real /.well-known/assetlinks.json — TWA verification must use the
    // owner's real Play App Signing cert, added only at store-setup time (not in git).
    expect(existsSync(join(WELL_KNOWN, 'assetlinks.json')), 'no real assetlinks.json in repo').toBe(false);
  });

  it('the example is valid Digital-Asset-Links JSON with the proposed package + a PLACEHOLDER cert', () => {
    const dal = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as Array<{
      relation: string[]; target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    }>;
    expect(Array.isArray(dal)).toBe(true);
    const t = dal[0].target;
    expect(dal[0].relation).toContain('delegate_permission/common.handle_all_urls');
    expect(t.namespace).toBe('android_app');
    expect(t.package_name).toBe('com.cardmajlis.app');
    // The fingerprint MUST stay an obvious placeholder — never a real-looking colon-hex cert.
    const fp = t.sha256_cert_fingerprints[0];
    expect(fp).toMatch(/REPLACE|PLACEHOLDER/i);
    expect(fp, 'placeholder must not look like a real SHA-256 fingerprint').not.toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/i);
  });
});

describe('Android TWA scaffold (Stage 33.2/33.3/33.8) — twa-manifest + repo hygiene', () => {
  const TWA_DIR = join(process.cwd(), 'android-twa');
  const twa = JSON.parse(readFileSync(join(TWA_DIR, 'twa-manifest.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public', 'manifest.webmanifest'), 'utf8'));

  it('keeps the proposed package id (matches assetlinks.example)', () => {
    expect(twa.packageId).toBe('com.cardmajlis.app');
    const dal = JSON.parse(
      readFileSync(join(process.cwd(), 'public', '.well-known', 'assetlinks.example.json'), 'utf8'),
    ) as Array<{ target: { package_name: string } }>;
    expect(dal[0].target.package_name).toBe(twa.packageId);
  });

  it('targets the current production host until the custom-domain stage', () => {
    // If a custom domain is provisioned, update this guard + twa-manifest together.
    expect(twa.host).toBe('king-game-cqgd.onrender.com');
    expect(twa.startUrl).toBe('/');
    expect(twa.fullScopeUrl).toBe(`https://${twa.host}/`);
  });

  it('display / orientation / colors mirror the web manifest', () => {
    expect(twa.display).toBe(manifest.display); // standalone
    expect(twa.orientation).toBe('portrait'); // manifest is portrait-primary
    expect(twa.themeColor.toLowerCase()).toBe(manifest.theme_color.toLowerCase());
    expect(twa.backgroundColor.toLowerCase()).toBe(manifest.background_color.toLowerCase());
  });

  it('webManifestUrl points at the same host\'s manifest.webmanifest (init reads this)', () => {
    // `bubblewrap init --manifest <URL>` consumes the WEB manifest; keep this in sync with host.
    expect(twa.webManifestUrl).toBe(`https://${twa.host}/manifest.webmanifest`);
  });

  it('points icons at same-origin manifest assets that exist', () => {
    for (const url of [twa.iconUrl, twa.maskableIconUrl]) {
      expect(url.startsWith(`https://${twa.host}/`)).toBe(true);
      const rel = url.replace(`https://${twa.host}/`, '');
      expect(existsSync(join(process.cwd(), 'public', rel)), `${rel} should exist`).toBe(true);
    }
  });

  it('commits NO build artifacts or secrets under android-twa/ (git-tracked only)', () => {
    let tracked: string[];
    try {
      tracked = execFileSync('git', ['ls-files', 'android-twa'], { encoding: 'utf8' })
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      // No git available (e.g. a source tarball) — the .gitignore rules still apply; skip.
      return;
    }
    // Whatever IS committed must be exactly the safe scaffold, never a keystore/APK/AAB/Gradle project.
    const forbidden = tracked.filter((f) => /\.(apk|aab|keystore|jks|p12|idsig)$/i.test(f));
    expect(forbidden, `android-twa must not commit build artifacts/keystores: ${forbidden.join(', ')}`).toEqual([]);
    expect(tracked.some((f) => /(^|\/)gradlew(\.bat)?$/.test(f)), 'generated gradlew must not be committed').toBe(false);
    expect(tracked.some((f) => /\.gradle$/.test(f)), 'generated *.gradle must not be committed').toBe(false);
    for (const expected of [
      'android-twa/twa-manifest.json',
      'android-twa/check-env.ps1',
      'android-twa/.gitignore',
      'android-twa/README.md',
      'android-twa/BUILD_LOG_TEMPLATE.md',
    ]) {
      expect(tracked, `${expected} should be committed`).toContain(expected);
    }
  });

  it('README documents the CORRECT bubblewrap init (web-manifest URL via @bubblewrap/cli)', () => {
    const readme = readFileSync(join(TWA_DIR, 'README.md'), 'utf8');
    expect(readme).toContain('@bubblewrap/cli');
    expect(readme).toMatch(/init --manifest https:\/\/king-game-cqgd\.onrender\.com\/manifest\.webmanifest/);
    // The bare `npx bubblewrap init` resolves an unrelated package — must never be an instruction.
    expect(readme).not.toMatch(/npx bubblewrap init/);
  });

  it('README never tells the owner to commit an APK/AAB/keystore', () => {
    const readme = readFileSync(join(TWA_DIR, 'README.md'), 'utf8');
    expect(readme).not.toMatch(/git add[^\n]*\.(apk|aab|keystore|jks)/i);
    expect(readme).toMatch(/never\b[^\n]*commit|not committed|git-ignored/i);
  });

  it('ships the owner build-log template (Stage 33.8) for pasting real logs back', () => {
    const tpl = join(TWA_DIR, 'BUILD_LOG_TEMPLATE.md');
    expect(existsSync(tpl), 'BUILD_LOG_TEMPLATE.md should exist').toBe(true);
    const body = readFileSync(tpl, 'utf8');
    // It must ask for the key artefacts to triage, but never for a committed binary.
    expect(body).toMatch(/check-env/);
    expect(body).toMatch(/assembleDebug/);
    expect(body).toMatch(/Custom Tab/);
  });
});

describe('iOS PWA meta (Stage 33.5 — iOS stays PWA-only)', () => {
  const idx = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

  it('ships the Add-to-Home-Screen meta so the installed iOS PWA launches standalone', () => {
    expect(idx).toMatch(/rel="apple-touch-icon"\s+href="\/icons\/apple-touch-icon\.png"/);
    expect(idx).toMatch(/name="apple-mobile-web-app-capable"\s+content="yes"/);
    expect(idx).toMatch(/name="apple-mobile-web-app-status-bar-style"/);
    expect(idx).toMatch(/name="apple-mobile-web-app-title"\s+content="Card Majlis"/);
    // viewport-fit=cover is required for iOS safe-area (notch/home-bar) insets.
    expect(idx).toMatch(/viewport-fit=cover/);
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
