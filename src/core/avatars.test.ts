import { describe, it, expect } from 'vitest';
import { AVATARS, isValidAvatar, defaultAvatar, sanitizeAvatar, seatMarker, BOT_AVATAR } from './avatars';

describe('avatars', () => {
  it('validates only whitelisted ids (no XSS / free text)', () => {
    expect(isValidAvatar(AVATARS[0])).toBe(true);
    expect(isValidAvatar('<img src=x onerror=alert(1)>')).toBe(false);
    expect(isValidAvatar('🍕')).toBe(false); // not in the set
    expect(isValidAvatar(undefined)).toBe(false);
    expect(isValidAvatar(123)).toBe(false);
  });

  it('defaultAvatar is deterministic and always whitelisted', () => {
    expect(defaultAvatar('Alice')).toBe(defaultAvatar('Alice'));
    expect(AVATARS).toContain(defaultAvatar('Alice'));
    expect(AVATARS).toContain(defaultAvatar(''));
  });

  it('sanitizeAvatar keeps valid ids and falls back for invalid', () => {
    expect(sanitizeAvatar(AVATARS[3], 'x')).toBe(AVATARS[3]);
    expect(AVATARS).toContain(sanitizeAvatar('<script>', 'seed'));
    expect(sanitizeAvatar(undefined, 'seed')).toBe(defaultAvatar('seed'));
  });

  it('seat markers are ①②③④', () => {
    expect([0, 1, 2, 3].map(seatMarker)).toEqual(['①', '②', '③', '④']);
  });

  it('bot avatar is the robot', () => {
    expect(BOT_AVATAR).toBe('🤖');
  });
});
