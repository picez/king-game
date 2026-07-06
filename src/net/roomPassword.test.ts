// БЕЗ-3: strong room-password KDF (server-side scrypt) with legacy fallback.
import { describe, it, expect } from 'vitest';
import { scryptPasswordHasher } from '../../server/roomPassword';
import { DEFAULT_PASSWORD_HASHER, createRoom, verifyPassword, addMember } from './serverCore';

const SALT = 'room-salt-1234';

describe('scryptPasswordHasher', () => {
  it('produces a tagged, non-plaintext hash and verifies the right password', () => {
    const hash = scryptPasswordHasher.hash(SALT, 'hunter2');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('hunter2');
    expect(scryptPasswordHasher.verify(SALT, 'hunter2', hash)).toBe(true);
    expect(scryptPasswordHasher.verify(SALT, 'wrong', hash)).toBe(false);
  });

  it('is salt-dependent (same password, different salt → different hash)', () => {
    const a = scryptPasswordHasher.hash('salt-a', 'pw');
    const b = scryptPasswordHasher.hash('salt-b', 'pw');
    expect(a).not.toBe(b);
    expect(scryptPasswordHasher.verify('salt-b', 'pw', a)).toBe(false);
  });

  it('falls back to the legacy KDF for pre-upgrade (untagged) hashes', () => {
    const legacy = DEFAULT_PASSWORD_HASHER.hash(SALT, 'oldpass');
    expect(legacy.startsWith('scrypt$')).toBe(false);
    // A room persisted before the upgrade still verifies via scrypt.verify.
    expect(scryptPasswordHasher.verify(SALT, 'oldpass', legacy)).toBe(true);
    expect(scryptPasswordHasher.verify(SALT, 'nope', legacy)).toBe(false);
  });

  it('rejects a malformed stored hash without throwing', () => {
    expect(scryptPasswordHasher.verify(SALT, 'pw', 'scrypt$zz')).toBe(false);
  });
});

describe('serverCore createRoom/addMember with the scrypt hasher', () => {
  it('gates joining a protected room on the correct password', () => {
    const room = createRoom({
      code: 'AAAA', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'h', reconnectToken: 't', name: 'Host' },
      password: 'secret', salt: SALT, hasher: scryptPasswordHasher,
    });
    expect(room.passwordHash?.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword(room, 'secret', scryptPasswordHasher)).toBe(true);
    expect(verifyPassword(room, 'nope', scryptPasswordHasher)).toBe(false);

    const bad = addMember(room, { clientId: 'a', reconnectToken: 't2', name: 'A', password: 'nope' }, scryptPasswordHasher);
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('BAD_PASSWORD');

    const ok = addMember(room, { clientId: 'b', reconnectToken: 't3', name: 'B', password: 'secret' }, scryptPasswordHasher);
    expect(ok.ok).toBe(true);
  });
});
