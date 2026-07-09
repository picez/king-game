// ---------------------------------------------------------------------------
// Optimize the large OPAQUE visual assets to WebP with a PNG fallback (Stage
// 12.9). Uses the system `ffmpeg` (libwebp) — NO new npm dependency; the
// dep-free procedural generator (gen-visual-assets.mjs) still owns the PNGs.
//
//   npm run visuals:webp        (requires ffmpeg on PATH)
//
// The two menu heroes + card back are smooth/photographic → high-quality LOSSY.
// The felt tile is a SEAMLESS repeat → LOSSLESS, so tiling edges never band.
// Transparent badges/icons are left as PNG (small; alpha WebP not worth it).
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// [relative png path, ffmpeg libwebp args]
const JOBS = [
  ['visual/menu-hero-portrait.png', ['-quality', '86', '-compression_level', '6']],
  ['visual/menu-hero-wide.png',     ['-quality', '86', '-compression_level', '6']],
  ['cards/back/back-green.png',     ['-quality', '90', '-compression_level', '6']],
  ['cards/back/back-red.png',       ['-quality', '90', '-compression_level', '6']],
  ['visual/felt-tile.png',          ['-lossless', '1', '-compression_level', '6']], // seamless → lossless
];

function have(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return r.status === 0;
}

if (!have('ffmpeg')) {
  console.error('ffmpeg not found on PATH — cannot encode WebP. Keeping PNG only.');
  process.exit(2);
}

let pngTotal = 0, webpTotal = 0, ok = 0;
for (const [rel, args] of JOBS) {
  const png = join(ROOT, 'public', rel);
  const webp = png.replace(/\.png$/, '.webp');
  if (!existsSync(png)) { console.error(`  MISSING ${rel} — run "npm run visuals" first`); continue; }
  const r = spawnSync('ffmpeg', ['-y', '-i', png, '-c:v', 'libwebp', ...args, webp], { encoding: 'utf8' });
  if (r.status !== 0 || !existsSync(webp)) { console.error(`  FAILED ${rel}\n${r.stderr?.split('\n').slice(-4).join('\n')}`); continue; }
  const p = statSync(png).size, w = statSync(webp).size;
  pngTotal += p; webpTotal += w; ok++;
  console.log(`  ${rel.replace(/\.png$/, '.webp')}  ${kb(w)}  (png ${kb(p)}, −${(100 * (1 - w / p)).toFixed(0)}%)`);
}
console.log(`\n${ok}/${JOBS.length} converted. PNG ${kb(pngTotal)} → WebP ${kb(webpTotal)}  (saved ${kb(pngTotal - webpTotal)}, −${(100 * (1 - webpTotal / pngTotal)).toFixed(0)}%).`);
process.exit(ok === JOBS.length ? 0 : 1);
