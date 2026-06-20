import { describe, it, expect } from 'vitest';
import { AVATARS, isValidAvatar, defaultAvatar, sanitizeAvatar, seatMarker, seatColor, SEAT_COLORS, BOT_AVATAR } from './avatars';

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

  it('seat colours are stable, distinct, and defined per seat', () => {
    expect(SEAT_COLORS).toHaveLength(4);
    expect(new Set(SEAT_COLORS).size).toBe(4); // all distinct
    expect([0, 1, 2, 3].map(seatColor)).toEqual(SEAT_COLORS);
    SEAT_COLORS.forEach((c) => expect(c).toMatch(/^#[0-9a-f]{6}$/i));
    // out-of-range seat falls back to a neutral colour (never undefined)
    expect(typeof seatColor(9)).toBe('string');
  });
});
