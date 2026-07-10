import { describe, it, expect } from 'vitest';

// Optional integration test for the avatar repository (Stage 17.1). SKIPPED unless
// TEST_DATABASE_URL points at a MIGRATED Postgres (same gate as the other db/*
// integration tests). Exercises the storage round-trip directly — upsert / read /
// serve-by-id / delete / replace-bumps-version + the settings mirror + FK cascade.
// The processing pipeline (ffmpeg) is covered separately; here we store raw bytes.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// A tiny stand-in "processed webp" blob (a valid RIFF/WEBP/VP8 header). The repo only
// stores/returns bytes — it never decodes — so this is enough to prove the round-trip.
function fakeWebp(tag = 0xaa): Buffer {
  const b = Buffer.alloc(32);
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8 ', 12, 'latin1');
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a; b[26] = 0xc0; b[28] = 0xc0; b[31] = tag;
  return b;
}

describe.skipIf(!TEST_DATABASE_URL)('user avatar repository (integration)', () => {
  it('upsert → read → serve-by-id → replace(bumps version) → delete, with settings mirror', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const repo = await import('../../server/db/userAvatars');
    const { getDb } = await import('../../server/db/client');

    const user = await users.getOrCreateGuest('it-avatar-guest');
    await repo.deleteAvatar(user.id); // clean slate for re-runs

    expect(await repo.getAvatarForUser(user.id)).toBeNull();

    // First upload.
    const first = await repo.upsertAvatar(user.id, {
      mimeType: 'image/webp', bytes: fakeWebp(0x11), byteSize: 32, width: 192, height: 192,
    });
    expect(first.version).toBe(1);
    const ref = await repo.getAvatarForUser(user.id);
    expect(ref).toEqual({ id: first.id, version: 1 });

    // Serve-by-id returns the stored bytes + type.
    const served = await repo.getAvatarByPublicId(first.id);
    expect(served?.mimeType).toBe('image/webp');
    expect(served?.version).toBe(1);
    expect(Buffer.compare(served!.bytes, fakeWebp(0x11))).toBe(0);

    // Stage 17.3: the WS-identity resolver builds the same-origin room URL.
    const { resolveAvatarImageUrl } = await import('../../server/api');
    expect(await resolveAvatarImageUrl(user.id)).toBe(`/api/avatar/${first.id}.webp?v=1`);

    // Settings mirror reflects the version.
    const conn = await getDb();
    const sql = conn!.sql as unknown as (s: TemplateStringsArray, ...a: unknown[]) => Promise<Array<{ avatar_image_version: number }>>;
    const before = await sql`SELECT avatar_image_version FROM user_settings WHERE user_id = ${user.id}`;
    expect(Number(before[0].avatar_image_version)).toBe(1);

    // Replace keeps the SAME opaque id but bumps the version (cache-bust).
    const second = await repo.upsertAvatar(user.id, {
      mimeType: 'image/webp', bytes: fakeWebp(0x22), byteSize: 32, width: 192, height: 192,
    });
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(Buffer.compare((await repo.getAvatarByPublicId(first.id))!.bytes, fakeWebp(0x22))).toBe(0);

    // Delete removes the row and clears the mirror.
    await repo.deleteAvatar(user.id);
    expect(await repo.getAvatarForUser(user.id)).toBeNull();
    expect(await repo.getAvatarByPublicId(first.id)).toBeNull();
    expect(await (await import('../../server/api')).resolveAvatarImageUrl(user.id)).toBeNull();
    const after = await sql`SELECT avatar_image_version FROM user_settings WHERE user_id = ${user.id}`;
    expect(Number(after[0].avatar_image_version)).toBe(0);
  });
});
