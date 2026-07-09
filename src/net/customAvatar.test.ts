import { describe, it, expect } from 'vitest';
import type { StorageLike } from './session';
import {
  ACCEPTED_AVATAR_MIME, AVATAR_ACCEPT_ATTR, MAX_AVATAR_INPUT_BYTES, MAX_AVATAR_DATAURL_CHARS,
  isAcceptedAvatarType, isAvatarInputTooLarge, isValidCustomAvatar,
  loadCustomAvatar, saveCustomAvatar, clearCustomAvatar, CUSTOM_AVATAR_KEY,
} from './customAvatar';

function mem(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCA',
  WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4',
  JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';

describe('customAvatar — MIME whitelist (Stage 14.1)', () => {
  it('accepts ONLY png/jpeg/webp', () => {
    expect([...ACCEPTED_AVATAR_MIME]).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    for (const t of ['image/png', 'image/jpeg', 'image/webp']) expect(isAcceptedAvatarType(t)).toBe(true);
    for (const t of ['image/gif', 'image/svg+xml', 'image/bmp', 'text/html', 'application/octet-stream', '']) {
      expect(isAcceptedAvatarType(t), t).toBe(false);
    }
    expect(isAcceptedAvatarType(undefined)).toBe(false);
  });

  it('the file-input accept attribute lists only the whitelist', () => {
    expect(AVATAR_ACCEPT_ATTR).toBe('image/png,image/jpeg,image/webp');
    expect(AVATAR_ACCEPT_ATTR).not.toMatch(/svg|gif/);
  });

  it('enforces the max input size', () => {
    expect(isAvatarInputTooLarge(MAX_AVATAR_INPUT_BYTES)).toBe(false);
    expect(isAvatarInputTooLarge(MAX_AVATAR_INPUT_BYTES + 1)).toBe(true);
    expect(MAX_AVATAR_INPUT_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('customAvatar — stored-value validation', () => {
  it('accepts a well-formed png/jpeg/webp base64 data URL', () => {
    for (const v of [PNG, WEBP, JPEG]) expect(isValidCustomAvatar(v)).toBe(true);
  });

  it('rejects SVG, remote URLs, other schemes, and junk', () => {
    expect(isValidCustomAvatar('data:image/svg+xml;base64,PHN2Zy8+')).toBe(false); // SVG
    expect(isValidCustomAvatar('data:image/gif;base64,R0lGOD')).toBe(false);       // gif
    expect(isValidCustomAvatar('https://example.com/a.png')).toBe(false);          // remote URL
    expect(isValidCustomAvatar('http://x/y.jpg')).toBe(false);
    expect(isValidCustomAvatar('javascript:alert(1)')).toBe(false);
    expect(isValidCustomAvatar('data:image/png;base64,<script>')).toBe(false);     // bad base64
    expect(isValidCustomAvatar('🦊')).toBe(false);
    expect(isValidCustomAvatar(null)).toBe(false);
    expect(isValidCustomAvatar(123)).toBe(false);
  });

  it('rejects an over-cap payload', () => {
    const huge = `data:image/webp;base64,${'A'.repeat(MAX_AVATAR_DATAURL_CHARS + 1)}`;
    expect(isValidCustomAvatar(huge)).toBe(false);
  });
});

describe('customAvatar — local store round-trip', () => {
  it('saves + loads a valid data URL under the Card Majlis key', () => {
    const s = mem();
    expect(CUSTOM_AVATAR_KEY).toBe('cardMajlis.customAvatar.v1');
    expect(loadCustomAvatar(s)).toBeNull();
    expect(saveCustomAvatar(WEBP, s)).toBe(true);
    expect(loadCustomAvatar(s)).toBe(WEBP);
  });

  it('refuses to store an invalid value (returns false, nothing stored)', () => {
    const s = mem();
    expect(saveCustomAvatar('data:image/svg+xml;base64,PHN2Zy8+', s)).toBe(false);
    expect(loadCustomAvatar(s)).toBeNull();
  });

  it('clear removes the stored image (reset to emoji)', () => {
    const s = mem();
    saveCustomAvatar(PNG, s);
    clearCustomAvatar(s);
    expect(loadCustomAvatar(s)).toBeNull();
  });

  it('load returns null when the stored value is somehow invalid (tamper-safe)', () => {
    const s = mem();
    s.setItem(CUSTOM_AVATAR_KEY, 'https://evil/x.png');
    expect(loadCustomAvatar(s)).toBeNull();
  });
});
