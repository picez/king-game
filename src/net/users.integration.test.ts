import { describe, it, expect } from 'vitest';

// Optional integration test for the user profile/settings repository (Stage 3).
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// The repository (and drizzle/pg driver) is imported DYNAMICALLY so normal runs
// never load the driver.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('users repository (integration)', () => {
  it('creates a guest lazily, idempotently, and round-trips settings', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const repo = await import('../../server/db/users');

    const guestKey = `it-guest-${'x'}`; // stable key so re-runs reuse the row
    const a = await repo.getOrCreateGuest(guestKey);
    const b = await repo.getOrCreateGuest(guestKey);
    expect(a.id).toBe(b.id);          // idempotent: same row, no duplicate
    expect(a.isGuest).toBe(true);
    expect(a.guestKey).toBe(guestKey);

    // Display name is sanitised (trim + cap).
    const name = await repo.updateDisplayName(a.id, '  Tester McTest the very long name here  ');
    expect(name).toHaveLength(20);

    // Global settings round-trip with validation (bad values dropped).
    const saved = await repo.upsertGlobalSettings(a.id, { lang: 'uk', avatar: '🦊', cardStyle: 'classic' });
    expect(saved).toEqual({ lang: 'uk', avatar: '🦊', cardStyle: 'classic', animationPreference: 'system' });
    await repo.upsertGlobalSettings(a.id, { lang: 'zz' as never }); // invalid → default
    const profile = await repo.getProfile(a.id);
    expect(profile?.settings.lang).toBe('en');
    expect(profile?.settings.avatar).toBe('🦊'); // patch merge kept the avatar

    // Per-game (King) settings round-trip.
    const game = await repo.upsertGameSettings(a.id, 'king', { defaultTimer: 60 });
    expect(game).toEqual({ defaultTimer: 60 });
    expect(await repo.getGameSettings(a.id, 'king')).toEqual({ defaultTimer: 60 });
  });
});
