import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  makePkce, signState, verifyState, statesMatch, randomToken, STATE_TTL_SEC,
  type OAuthStatePayload,
} from '../../server/oauthState';

const SECRET = 'test-secret';
const NOW = 1_700_000_000;

function payload(over: Partial<OAuthStatePayload> = {}): OAuthStatePayload {
  return { state: 'st', codeVerifier: 'cv', nonce: 'no', guestUserId: 'guest-1', iat: NOW, ...over };
}

describe('PKCE', () => {
  it('challenge is the S256 of the verifier', () => {
    const { verifier, challenge } = makePkce();
    expect(verifier.length).toBeGreaterThan(20);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
  it('randomToken is URL-safe and unique', () => {
    const a = randomToken(); const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('signState / verifyState', () => {
  it('round-trips a valid payload', () => {
    const token = signState(payload(), SECRET);
    const out = verifyState(token, SECRET, NOW + 10);
    expect(out).toMatchObject({ state: 'st', codeVerifier: 'cv', guestUserId: 'guest-1' });
  });
  it('rejects a tampered body', () => {
    const token = signState(payload(), SECRET);
    const tampered = `x${token}`;
    expect(verifyState(tampered, SECRET, NOW)).toBeNull();
  });
  it('rejects a wrong secret', () => {
    const token = signState(payload(), SECRET);
    expect(verifyState(token, 'other-secret', NOW)).toBeNull();
  });
  it('rejects an expired state', () => {
    const token = signState(payload({ iat: NOW - STATE_TTL_SEC - 5 }), SECRET);
    expect(verifyState(token, SECRET, NOW)).toBeNull();
  });
  it('rejects a future-issued state (clock skew guard)', () => {
    const token = signState(payload({ iat: NOW + 120 }), SECRET);
    expect(verifyState(token, SECRET, NOW)).toBeNull();
  });
  it('rejects empty / malformed input', () => {
    expect(verifyState(undefined, SECRET, NOW)).toBeNull();
    expect(verifyState('no-dot', SECRET, NOW)).toBeNull();
    expect(verifyState('.sig', SECRET, NOW)).toBeNull();
  });
});

describe('statesMatch', () => {
  it('is true only for identical non-empty states', () => {
    expect(statesMatch('abc', 'abc')).toBe(true);
    expect(statesMatch('abc', 'abd')).toBe(false);
    expect(statesMatch('abc', 'ab')).toBe(false);
    expect(statesMatch('', '')).toBe(false);
    expect(statesMatch(undefined, 'abc')).toBe(false);
  });
});
