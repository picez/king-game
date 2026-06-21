import { describe, it, expect } from 'vitest';

// Optional integration test for the Stage 4 session repository + guest bridge.
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres (0000+0001+0002):
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// The repos (drizzle/pg driver) are imported DYNAMICALLY so normal runs never
// load the driver.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('sessions + guest bridge (integration)', () => {
  it('reuses a guest user by device handle and round-trips a revocable session', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.SESSION_SECRET = 'test-pepper';
    const users = await import('../../server/db/users');
    const sessions = await import('../../server/db/sessions');
    const { generateSessionToken, hashSessionToken } = await import('../../server/sessionTokens');

    // Guest is created once and REUSED for the same device handle.
    const guestKey = 'it-session-guest';
    const a = await users.getOrCreateGuest(guestKey);
    const b = await users.getOrCreateGuest(guestKey);
    expect(a.id).toBe(b.id);
    expect(a.isGuest).toBe(true);

    // Create a session; the presented token resolves to the user.
    const token = generateSessionToken();
    const now = new Date();
    await sessions.createSession({
      userId: a.id,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const live = await sessions.findValidSession(hashSessionToken(token), new Date());
    expect(live?.userId).toBe(a.id);

    // Revoke → the same token no longer resolves (logout/revoke works).
    await sessions.revokeSession(hashSessionToken(token), new Date());
    expect(await sessions.findValidSession(hashSessionToken(token), new Date())).toBeNull();

    // An already-expired session is never returned.
    const expiredToken = generateSessionToken();
    await sessions.createSession({
      userId: a.id,
      tokenHash: hashSessionToken(expiredToken),
      expiresAt: new Date(now.getTime() - 1000),
    });
    expect(await sessions.findValidSession(hashSessionToken(expiredToken), new Date())).toBeNull();
  });
});
