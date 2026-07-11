import { describe, it, expect } from 'vitest';

// Optional integration test for the Stage 25.1 friends repository.
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres (through 0009):
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// Repos are imported DYNAMICALLY so normal runs never load the pg driver.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('friends repository (integration)', () => {
  it('request → accept → list → remove, with self/duplicate/cascade guards', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const friends = await import('../../server/db/friends');
    const { getDb } = await import('../../server/db/client');

    // Two fresh accounts (created directly; friends need non-guest, but the repo does
    // not gate on is_guest for the graph itself — the API does).
    const A = await users.createAccountUser({ email: null, name: 'A', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'B', emailVerified: false });

    // Stable friend code, and lookup round-trips.
    const codeA = await friends.getOrCreateFriendCode(A);
    expect(await friends.getOrCreateFriendCode(A)).toBe(codeA); // stable
    expect((await friends.findUserByFriendCode(codeA))?.id).toBe(A);
    const codeB = await friends.getOrCreateFriendCode(B);

    // Self-request rejected; bad code rejected.
    expect((await friends.sendFriendRequest(A, codeA)).result).toBe('self');
    expect((await friends.sendFriendRequest(A, 'CM-ZZZZ-ZZZZ')).result).toBe('invalid_code');

    // A → B request; duplicate is graceful; B sees it incoming.
    expect((await friends.sendFriendRequest(A, codeB)).result).toBe('created');
    expect((await friends.sendFriendRequest(A, codeB)).result).toBe('pending_exists');
    expect((await friends.listFriends(B)).incoming.map((f) => f.userId)).toContain(A);
    expect(await friends.areFriends(A, B)).toBe(false);

    // Only the addressee accepts; then both list each other as friends.
    expect(await friends.acceptFriendRequest(A, B)).toBe(false); // A is not the addressee
    expect(await friends.acceptFriendRequest(B, A)).toBe(true);
    expect(await friends.areFriends(A, B)).toBe(true);
    expect((await friends.listFriends(A)).friends.map((f) => f.userId)).toContain(B);

    // A reverse pending request AUTO-ACCEPTS (no reciprocal duplicate).
    const C = await users.createAccountUser({ email: null, name: 'C', emailVerified: false });
    const codeC = await friends.getOrCreateFriendCode(C);
    await friends.sendFriendRequest(C, codeA);                     // C → A
    expect((await friends.sendFriendRequest(A, codeC)).result).toBe('auto_accepted'); // A → C flips it
    expect(await friends.areFriends(A, C)).toBe(true);

    // Remove is symmetric; areFriends false after.
    expect(await friends.removeFriend(A, B)).toBe(true);
    expect(await friends.areFriends(A, B)).toBe(false);

    // No email is ever emitted in a friend summary.
    const listA = await friends.listFriends(A);
    expect(JSON.stringify(listA)).not.toMatch(/@|email/);

    // ON DELETE CASCADE: deleting a user drops their friendship rows.
    const conn = await getDb();
    await conn!.sql`DELETE FROM users WHERE id = ${C}`;
    expect(await friends.areFriends(A, C)).toBe(false);
    // Cleanup.
    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });
});
