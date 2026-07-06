// ---------------------------------------------------------------------------
// Strong room-password KDF (БЕЗ-3). Lives server-side because src/net/serverCore
// must stay client-bundle-safe (no node:crypto — it is reachable from the browser
// via the game registry). The server injects this hasher into createRoom /
// addMember / verifyPassword; serverCore's default stays the legacy pure hash.
//
// scrypt (built into Node — no new dependency) with a per-room salt. The stored
// hash is tagged `scrypt$…` so verify() can route by algorithm and transparently
// fall back to the legacy KDF for rooms created before this upgrade (rooms are
// ephemeral, but this avoids silently locking out an in-flight protected room).
// ---------------------------------------------------------------------------

import { scryptSync, timingSafeEqual } from 'node:crypto';
import { DEFAULT_PASSWORD_HASHER, type PasswordHasher } from '../src/net/serverCore';

const SCRYPT_PREFIX = 'scrypt$';
const KEY_LEN = 32; // 256-bit derived key

function derive(salt: string, password: string): Buffer {
  // Default cost params (N=16384, r=8, p=1) — a few ms/attempt, fine for a
  // one-off create/join (further bounded by the WS rate + brute-force limits).
  return scryptSync(password, salt, KEY_LEN);
}

/** scrypt hasher with legacy-hash fallback on verify (tagged-output routing). */
export const scryptPasswordHasher: PasswordHasher = {
  hash(salt, password) {
    return SCRYPT_PREFIX + derive(salt, password).toString('hex');
  },
  verify(salt, password, storedHash) {
    if (!storedHash.startsWith(SCRYPT_PREFIX)) {
      // Room created before the KDF upgrade → verify with the legacy hasher.
      return DEFAULT_PASSWORD_HASHER.verify(salt, password, storedHash);
    }
    const expected = derive(salt, password);
    const stored = Buffer.from(storedHash.slice(SCRYPT_PREFIX.length), 'hex');
    if (stored.length !== expected.length) return false;
    return timingSafeEqual(expected, stored);
  },
};
