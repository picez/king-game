// Stage 15.1 guards. Two jobs:
//  (1) manifest ↔ disk: every declared SFX exists under public/sounds as BOTH a
//      .webm and a .mp3, is a real (non-empty) file within its per-file budget, ids
//      are unique + same-origin, and the total footprint stays under the ceiling.
//  (2) runtime-not-wired: Stage 15.1 ships assets ONLY — no playback engine yet.
//      Assert no app source uses the browser audio APIs and nothing imports the
//      manifest except this test (wiring is Stage 15.3+).
import { describe, it, expect } from 'vitest';
import { statSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  SOUND_ASSETS,
  SOUND_TOTAL_MAX_BYTES,
  getSoundAsset,
} from './soundAssets';

const REQUIRED_IDS = [
  'ui-click', 'ui-open', 'ui-error',
  'card-deal', 'card-play', 'trick-collect', 'trump-reveal',
  'bid-tick', 'chat-pop', 'reaction-pop',
  'finish-win', 'finish-neutral',
] as const;

/** Resolve a public URL path ('/sounds/x.webm') to its file on disk. */
const publicFile = (src: string) => fileURLToPath(new URL(`../../public${src}`, import.meta.url));
const sources = (a: (typeof SOUND_ASSETS)[number]) => [a.srcWebm, a.srcMp3];

describe('sound asset manifest', () => {
  it('declares every required P0/MVP id, uniquely', () => {
    const ids = SOUND_ASSETS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of REQUIRED_IDS) expect(getSoundAsset(id), id).not.toBeNull();
    expect(ids.sort()).toEqual([...REQUIRED_IDS].sort());
  });

  it('has same-origin, traversal-free /sounds/ src paths with supported extensions', () => {
    for (const a of SOUND_ASSETS) {
      for (const src of sources(a)) {
        expect(src.startsWith('/sounds/'), src).toBe(true);
        expect(src.includes('..'), src).toBe(false);
      }
      expect(a.srcWebm.endsWith('.webm'), a.srcWebm).toBe(true);
      expect(a.srcMp3.endsWith('.mp3'), a.srcMp3).toBe(true);
      // No unsupported/legacy container slipped in.
      for (const src of sources(a)) {
        expect(/\.(webm|mp3)$/.test(src), `unsupported ext: ${src}`).toBe(true);
      }
    }
  });

  it('every declared file exists on disk and is within its per-file budget', () => {
    for (const a of SOUND_ASSETS) {
      for (const src of sources(a)) {
        const size = statSync(publicFile(src)).size; // throws if missing
        expect(size, `${src} is empty`).toBeGreaterThan(0);
        expect(size, `${src} = ${size}B exceeds ${a.maxBytes}B`).toBeLessThanOrEqual(a.maxBytes);
      }
    }
  });

  it('the real total footprint stays under the documented ceiling', () => {
    const total = SOUND_ASSETS
      .flatMap(sources)
      .reduce((sum, src) => sum + statSync(publicFile(src)).size, 0);
    expect(total, `total ${total}B over ${SOUND_TOTAL_MAX_BYTES}B`).toBeLessThanOrEqual(SOUND_TOTAL_MAX_BYTES);
  });

  it('getSoundAsset returns null for an unknown id', () => {
    expect(getSoundAsset('does-not-exist')).toBeNull();
    expect(getSoundAsset('')).toBeNull();
  });
});

// ── runtime-not-wired guard (Stage 15.1 = assets only) ────────────────────────
const SRC = fileURLToPath(new URL('..', import.meta.url)); // src/
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const isTest = (p: string) => /\.test\.tsx?$/.test(p);
const THIS = fileURLToPath(import.meta.url);

describe('sound runtime is not wired yet (Stage 15.1)', () => {
  const files = walk(SRC).filter((p) => p !== THIS);

  it('no app source uses the browser audio APIs yet', () => {
    const AUDIO_API = /\bnew Audio\s*\(|\bAudioContext\b|\bwebkitAudioContext\b|\bHTMLAudioElement\b/;
    const offenders = files
      .filter((p) => !isTest(p))
      .filter((p) => AUDIO_API.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(SRC.length));
    expect(offenders, `audio API used before Stage 15.3: ${offenders.join(', ')}`).toEqual([]);
  });

  it('nothing imports the sound manifest except this guard', () => {
    const IMPORTS = /from\s+['"][^'"]*soundAssets['"]/;
    const importers = files
      .filter((p) => IMPORTS.test(readFileSync(p, 'utf8')))
      .map((p) => p.slice(SRC.length));
    // Only this test file is allowed to reference the manifest in Stage 15.1.
    expect(importers, `unexpected soundAssets importers: ${importers.join(', ')}`).toEqual([]);
  });
});
