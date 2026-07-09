import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_FACE_FILES,
  ART_RANKS,
  ART_SUITS,
  cardFaceFile,
  cardFaceUrl,
  cardBackUrl,
  CARD_BACK_URL,
  cardBackWebpUrl,
  CARD_BACK_WEBP_URL,
  CARD_BACK_STYLES,
  normalizeCardBack,
  cardBackToSetting,
} from './cardArt';
import type { Rank, Suit } from '../../models/types';

const FACES = join(process.cwd(), 'public', 'cards', 'faces');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('card face assets', () => {
  it('expects exactly 52 unique face files (4 suits × 13 ranks)', () => {
    expect(ART_SUITS).toHaveLength(4);
    expect(ART_RANKS).toHaveLength(13);
    expect(ALL_FACE_FILES).toHaveLength(52);
    expect(new Set(ALL_FACE_FILES).size).toBe(52);
  });

  it('has all 52 face PNGs present in public/cards/faces', () => {
    for (const file of ALL_FACE_FILES) {
      const path = join(FACES, file);
      expect(existsSync(path), `${file} should exist`).toBe(true);
      expect(statSync(path).size, `${file} should be non-empty`).toBeGreaterThan(0);
      const head = readFileSync(path).subarray(0, 8);
      expect(head.equals(PNG_SIG), `${file} should be a real PNG`).toBe(true);
    }
  });

  it('does NOT ship the contact sheet into the runtime faces folder', () => {
    expect(existsSync(join(FACES, 'contact-sheet.png'))).toBe(false);
  });
});

describe('cardFaceUrl mapping', () => {
  it('resolves every suit/rank to an existing file', () => {
    for (const suit of ART_SUITS) {
      for (const rank of ART_RANKS) {
        const url = cardFaceUrl(suit, rank);
        expect(url, `${suit} ${rank}`).not.toBeNull();
        expect(url!).toContain(`cards/faces/${suit}-${rank.toLowerCase()}.png`);
        const file = url!.split('/').pop()!;
        expect(existsSync(join(FACES, file)), `${url} target exists`).toBe(true);
      }
    }
  });

  it('lower-cases J/Q/K/A and keeps numeric ranks (incl. 10)', () => {
    expect(cardFaceFile('spades', 'J')).toBe('spades-j.png');
    expect(cardFaceFile('hearts', 'Q')).toBe('hearts-q.png');
    expect(cardFaceFile('diamonds', 'K')).toBe('diamonds-k.png');
    expect(cardFaceFile('clubs', 'A')).toBe('clubs-a.png');
    expect(cardFaceFile('spades', '10')).toBe('spades-10.png');
    expect(cardFaceFile('hearts', '2')).toBe('hearts-2.png');
  });

  it('returns null for hidden "?" / missing cards (no artwork)', () => {
    expect(cardFaceUrl('spades', '?' as Rank)).toBeNull();
    expect(cardFaceUrl(undefined, 'A')).toBeNull();
    expect(cardFaceUrl('spades', undefined)).toBeNull();
    expect(cardFaceUrl('joker' as Suit, 'A')).toBeNull();
  });
});

describe('card back asset (Stage 12.2)', () => {
  const BACK = join(process.cwd(), 'public', 'cards', 'back', 'back-green.png');
  it('cardBackUrl / CARD_BACK_URL resolve to /cards/back/back-green.png', () => {
    expect(cardBackUrl()).toContain('cards/back/back-green.png');
    expect(CARD_BACK_URL).toContain('cards/back/back-green.png');
  });
  it('the back PNG exists in public/cards/back and is a real, non-empty PNG', () => {
    expect(existsSync(BACK), 'back-green.png should exist').toBe(true);
    expect(statSync(BACK).size).toBeGreaterThan(0);
    expect(readFileSync(BACK).subarray(0, 8).equals(PNG_SIG)).toBe(true);
  });
});

describe('card back WebP variant (Stage 12.9.1)', () => {
  const BACK_PNG = join(process.cwd(), 'public', 'cards', 'back', 'back-green.png');
  const BACK_WEBP = join(process.cwd(), 'public', 'cards', 'back', 'back-green.webp');
  const RIFF = Buffer.from('RIFF', 'ascii');

  it('cardBackWebpUrl / CARD_BACK_WEBP_URL resolve to the .webp back', () => {
    expect(cardBackWebpUrl()).toContain('cards/back/back-green.webp');
    expect(CARD_BACK_WEBP_URL).toContain('cards/back/back-green.webp');
  });

  it('is a real, non-empty RIFF/WEBP and smaller than the PNG fallback', () => {
    expect(existsSync(BACK_WEBP), 'back-green.webp should exist').toBe(true);
    const buf = readFileSync(BACK_WEBP);
    expect(buf.subarray(0, 4).equals(RIFF) && buf.subarray(8, 12).toString('ascii') === 'WEBP').toBe(true);
    expect(statSync(BACK_WEBP).size).toBeGreaterThan(0);
    expect(statSync(BACK_WEBP).size).toBeLessThanOrEqual(statSync(BACK_PNG).size);
  });

  it('keeps the PNG fallback URL alongside the WebP (both exported)', () => {
    expect(CARD_BACK_URL).toContain('cards/back/back-green.png');
    expect(CARD_BACK_WEBP_URL).toContain('cards/back/back-green.webp');
  });
});

describe('card back style selection (Stage 13.0)', () => {
  const BACK_DIR = join(process.cwd(), 'public', 'cards', 'back');
  const RIFF = Buffer.from('RIFF', 'ascii');

  it('exposes green + red + blue + dark styles (Stage 13.5)', () => {
    expect([...CARD_BACK_STYLES]).toEqual(['green', 'red', 'blue', 'dark']);
  });

  it('normalizes known styles through, and classic/unknown/null → green', () => {
    for (const s of ['red', 'green', 'blue', 'dark']) expect(normalizeCardBack(s)).toBe(s);
    expect(normalizeCardBack('classic')).toBe('green'); // legacy DB value
    expect(normalizeCardBack('holographic')).toBe('green');
    expect(normalizeCardBack(null)).toBe('green');
    expect(normalizeCardBack(undefined)).toBe('green');
  });

  it('maps a visual style back to the server setting value (green = classic; rest as-is)', () => {
    expect(cardBackToSetting('green')).toBe('classic');
    expect(cardBackToSetting('red')).toBe('red');
    expect(cardBackToSetting('blue')).toBe('blue');
    expect(cardBackToSetting('dark')).toBe('dark');
  });

  it('cardBackUrl / cardBackWebpUrl resolve per style; default stays green', () => {
    expect(cardBackUrl()).toContain('cards/back/back-green.png');
    expect(cardBackUrl('green')).toContain('cards/back/back-green.png');
    expect(cardBackUrl('red')).toContain('cards/back/back-red.png');
    expect(cardBackWebpUrl('red')).toContain('cards/back/back-red.webp');
    // Backward-compatible constants still point at the classic green back.
    expect(CARD_BACK_URL).toContain('back-green.png');
    expect(CARD_BACK_WEBP_URL).toContain('back-green.webp');
  });

  it('each style has a real, non-empty PNG + a smaller WebP on disk', () => {
    for (const style of CARD_BACK_STYLES) {
      const png = join(BACK_DIR, `back-${style}.png`);
      const webp = join(BACK_DIR, `back-${style}.webp`);
      expect(existsSync(png), `back-${style}.png exists`).toBe(true);
      expect(readFileSync(png).subarray(0, 8).equals(PNG_SIG), `back-${style}.png is PNG`).toBe(true);
      expect(existsSync(webp), `back-${style}.webp exists`).toBe(true);
      const buf = readFileSync(webp);
      expect(buf.subarray(0, 4).equals(RIFF) && buf.subarray(8, 12).toString('ascii') === 'WEBP').toBe(true);
      expect(statSync(webp).size).toBeLessThanOrEqual(statSync(png).size);
    }
  });

  it('every back style is a DISTINCT image (different bytes from each other)', () => {
    const bytes = [...CARD_BACK_STYLES].map((s) => readFileSync(join(BACK_DIR, `back-${s}.png`)));
    for (let i = 0; i < bytes.length; i++) {
      for (let j = i + 1; j < bytes.length; j++) {
        expect(bytes[i].equals(bytes[j]), `${CARD_BACK_STYLES[i]} vs ${CARD_BACK_STYLES[j]}`).toBe(false);
      }
    }
  });

  it('cardBackUrl / cardBackWebpUrl are same-origin, traversal-free .png/.webp', () => {
    for (const s of CARD_BACK_STYLES) {
      const png = cardBackUrl(s), webp = cardBackWebpUrl(s);
      for (const u of [png, webp]) {
        expect(u.includes('..'), u).toBe(false);
        expect(/^https?:|^\/\//.test(u), `${u} is not an external URL`).toBe(false);
      }
      expect(png.endsWith(`back-${s}.png`)).toBe(true);
      expect(webp.endsWith(`back-${s}.webp`)).toBe(true);
    }
  });
});

describe('source-swap does not break spades/clubs mapping', () => {
  // The original card-sources/ had spades.png/clubs.png swapped; the slice step
  // already corrected the OUTPUT names. So in-game suit -> file must be direct,
  // and the two suits must point at DISTINCT artwork (not the same/swapped image).
  it('maps spades->spades-*.png and clubs->clubs-*.png directly', () => {
    expect(cardFaceFile('spades', 'A')).toBe('spades-a.png');
    expect(cardFaceFile('clubs', 'A')).toBe('clubs-a.png');
  });

  it('spades and clubs artwork are different files (distinct bytes)', () => {
    for (const rank of ['A', 'K', '10', '2'] as Rank[]) {
      const spade = readFileSync(join(FACES, cardFaceFile('spades', rank)));
      const club = readFileSync(join(FACES, cardFaceFile('clubs', rank)));
      expect(spade.equals(club), `spades-${rank} must differ from clubs-${rank}`).toBe(false);
    }
  });
});
