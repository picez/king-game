// ---------------------------------------------------------------------------
// Remove debug-only assets from the production build.
//
//   node scripts/strip-preview.mjs   (runs automatically after `vite build`)
//
// Vite copies the whole public/ dir into dist/. The card contact sheet under
// public/cards/preview/ is for human visual review only and must NOT ship in
// the app bundle, so we delete dist/cards/preview/ after the build. The runtime
// only ever references public/cards/faces/.
// ---------------------------------------------------------------------------

import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(ROOT, 'dist', 'cards', 'preview');

if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
  console.log('[strip-preview] removed dist/cards/preview (debug-only assets)');
} else {
  console.log('[strip-preview] nothing to remove (dist/cards/preview absent)');
}
