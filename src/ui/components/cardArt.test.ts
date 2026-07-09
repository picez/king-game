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
