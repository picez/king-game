import { describe, it, expect } from 'vitest';
import {
  CARD_FACE_THEMES, DEFAULT_CARD_FACE_THEME, normalizeCardFaceTheme,
} from './cardFaceTheme';

describe('cardFaceTheme (Stage 13.5)', () => {
  it('exposes exactly classic + clean, default classic', () => {
    expect([...CARD_FACE_THEMES]).toEqual(['classic', 'clean']);
    expect(DEFAULT_CARD_FACE_THEME).toBe('classic');
  });

  it('normalizes known themes through and unknown/empty/null → classic', () => {
    expect(normalizeCardFaceTheme('classic')).toBe('classic');
    expect(normalizeCardFaceTheme('clean')).toBe('clean');
    expect(normalizeCardFaceTheme('holographic')).toBe('classic');
    expect(normalizeCardFaceTheme('')).toBe('classic');
    expect(normalizeCardFaceTheme(null)).toBe('classic');
    expect(normalizeCardFaceTheme(undefined)).toBe('classic');
  });
});
