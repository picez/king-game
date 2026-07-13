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

// ── wiring-boundary guard (Stage 15.2 + 15.4) ────────────────────────────────
// 15.2 added a sound preference, an external store, and a MINIMAL engine.
// 15.4 made sound ALERT-ONLY: the Stage 15.3 decorative cues (card-play /
// trick-collect / trump-reveal / finish-*) were REMOVED, leaving a single
// low-time alert hook (useSoundAlerts) used only by the turn timer. These guards
// lock the boundary: the browser audio API stays inside the engine; playSound is
// called ONLY by the alert hook + the Profile preview; the alert hook is used
// ONLY by the turn timer; the removed decorative ids are wired NOWHERE; NO
// rules/engine/server/core imports the audio layer; and nothing leaks onto WS.
//
// The non-test UI modules allowed to import the sound-alert hook. Update deliberately.
const SOUND_HOOK_CONSUMERS = [
  // Low-time alert now lives in the shared, game-agnostic TurnTimerBar (Stage 29.2);
  // King's TurnTimer + every online game screen render it, but only this one imports
  // the sound hook.
  'ui/components/TurnTimerBar.tsx',
].sort();
// Decorative sound ids removed from gameplay wiring in 15.4 — they may live in the
// manifest (as available assets) but must not be referenced by any app source.
const DECORATIVE_SOUND_IDS = ['card-play', 'trick-collect', 'trump-reveal', 'finish-win', 'finish-neutral'];
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
const rel = (p: string) => p.slice(SRC.length).replace(/\\/g, '/');
const body = (p: string) => readFileSync(p, 'utf8');

describe('sound wiring boundary (Stage 15.2 + 15.4)', () => {
  const files = walk(SRC).filter((p) => p !== THIS);
  const importersOf = (re: RegExp) => files
    .filter((p) => !isTest(p) && re.test(body(p)))
    .map(rel).sort();

  it('the browser audio API lives ONLY inside the sound engine (+ the voice module)', () => {
    const AUDIO_API = /\bnew Audio\s*\(|\bAudioContext\b|\bwebkitAudioContext\b|\bHTMLAudioElement\b/;
    const offenders = files
      .filter((p) => !isTest(p))
      .filter((p) => AUDIO_API.test(body(p)))
      .map(rel)
      .sort();
    // soundEngine plays SFX; the Stage 25.4 voice hook plays remote peers' audio streams.
    expect(offenders, `audio API outside the engine/voice: ${offenders.join(', ')}`)
      .toEqual(['audio/soundEngine.ts', 'voice/useRoomVoice.ts']);
  });

  it('the sound manifest is imported ONLY by the engine (+ audio tests)', () => {
    const IMPORTS = /from\s+['"][^'"]*soundAssets['"]/;
    const importers = files
      .filter((p) => !isTest(p) && IMPORTS.test(body(p)))
      .map(rel);
    expect(importers, `unexpected soundAssets importers: ${importers.join(', ')}`)
      .toEqual(['audio/soundEngine.ts']);
  });

  it('playSound (the engine) is imported ONLY by the alert hook + the Profile preview', () => {
    const importers = importersOf(/from\s+['"][^'"]*soundEngine['"]/);
    expect(importers, `unexpected soundEngine importers: ${importers.join(', ')}`)
      .toEqual(['audio/useSoundAlerts.ts', 'ui/menu/ProfilePanel.tsx']);
  });

  it('the sound-alert hook is imported ONLY by the turn timer', () => {
    const importers = importersOf(/from\s+['"][^'"]*useSoundAlerts['"]/);
    expect(importers, `unexpected useSoundAlerts importers: ${importers.join(', ')}`)
      .toEqual(SOUND_HOOK_CONSUMERS);
  });

  it('the removed decorative sound ids are wired NOWHERE in app source', () => {
    const MANIFEST = 'audio/soundAssets.ts'; // the ids are ALLOWED to exist in the manifest
    const offenders = files
      .filter((p) => !isTest(p) && rel(p) !== MANIFEST)
      .filter((p) => DECORATIVE_SOUND_IDS.some((id) => body(p).includes(`'${id}'`) || body(p).includes(`"${id}"`)))
      .map(rel);
    expect(offenders, `decorative sound ids referenced outside the manifest: ${offenders.join(', ')}`).toEqual([]);
  });

  it('no rules/engine/server/core module imports the audio layer (sound is UI-only)', () => {
    const AUDIO_IMPORT = /from\s+['"][^'"]*(audio\/(soundEngine|soundAssets|soundPreference|soundPreferenceStore|useSoundAlerts)|\/audio['"])/;
    const LOGIC_DIR = /^(core|server|games|net|hooks)\//;
    const offenders = files
      .filter((p) => !isTest(p) && LOGIC_DIR.test(rel(p)) && AUDIO_IMPORT.test(body(p)))
      .map(rel);
    expect(offenders, `logic modules must not import sound: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the WS message protocol carries no sound/soundPreference fields', () => {
    const messages = files.find((p) => rel(p) === 'net/messages.ts');
    expect(messages, 'src/net/messages.ts not found').toBeTruthy();
    expect(/sound/i.test(body(messages!)), 'messages.ts must not mention sound').toBe(false);
  });
});
