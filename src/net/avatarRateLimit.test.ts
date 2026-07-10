import { describe, it, expect, beforeEach } from 'vitest';
import { allowAvatarUpload, resetAvatarRateLimit, AVATAR_RATE_LIMIT } from '../../server/avatarRateLimit';

describe('avatar upload rate limit (per-user, in-memory)', () => {
  beforeEach(() => resetAvatarRateLimit());

  it('allows up to MAX_PER_WINDOW then blocks', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AVATAR_RATE_LIMIT.MAX_PER_WINDOW; i++) {
      expect(allowAvatarUpload('user-a', t0 + i)).toBe(true);
    }
    expect(allowAvatarUpload('user-a', t0 + 100)).toBe(false);
  });

  it('is per-user (one user hitting the cap does not block another)', () => {
    const t0 = 2_000_000;
    for (let i = 0; i < AVATAR_RATE_LIMIT.MAX_PER_WINDOW; i++) allowAvatarUpload('user-a', t0 + i);
    expect(allowAvatarUpload('user-a', t0)).toBe(false);
    expect(allowAvatarUpload('user-b', t0)).toBe(true);
  });

  it('slides: attempts older than the window expire', () => {
    const t0 = 3_000_000;
    for (let i = 0; i < AVATAR_RATE_LIMIT.MAX_PER_WINDOW; i++) allowAvatarUpload('user-c', t0 + i);
    expect(allowAvatarUpload('user-c', t0)).toBe(false);
    // Past the window, the old hits drop off → allowed again.
    expect(allowAvatarUpload('user-c', t0 + AVATAR_RATE_LIMIT.WINDOW_MS + 1)).toBe(true);
  });
});
