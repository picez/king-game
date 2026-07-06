import { describe, it, expect } from 'vitest';
import {
  googleConfig, buildAuthUrl, decodeIdToken, validateIdClaims, exchangeCode, isLinkableIdentity,
  type GoogleConfig,
} from '../../server/googleOAuth';

const CFG: GoogleConfig = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'secret', redirectUri: 'https://app/auth/google/callback' };
const NOW = 1_700_000_000;

/** Builds a fake id_token (header.payload.sig) with a base64url JSON payload. */
function idToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
}
const goodClaims = (over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com', aud: CFG.clientId, exp: NOW + 3600, sub: '12345',
  email: 'a@b.com', email_verified: true, name: 'Alice', picture: 'https://pic', ...over,
});

describe('googleConfig', () => {
  it('returns null when any env piece is missing', () => {
    expect(googleConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(googleConfig({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y' } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it('returns the config when all three are set', () => {
    const cfg = googleConfig({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', GOOGLE_REDIRECT_URI: 'z' } as unknown as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ clientId: 'x', clientSecret: 'y', redirectUri: 'z' });
  });
});

describe('buildAuthUrl', () => {
  it('includes PKCE S256, scope, state and nonce', () => {
    const url = buildAuthUrl(CFG, { state: 'STATE', codeChallenge: 'CHAL', nonce: 'NONCE' });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe(CFG.clientId);
    expect(u.searchParams.get('redirect_uri')).toBe(CFG.redirectUri);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('code_challenge')).toBe('CHAL');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe('STATE');
    expect(u.searchParams.get('nonce')).toBe('NONCE');
  });
});

describe('decodeIdToken', () => {
  it('decodes the JWT payload', () => {
    expect(decodeIdToken(idToken({ sub: 'x' }))?.sub).toBe('x');
  });
  it('returns null for non-JWT input', () => {
    expect(decodeIdToken('not-a-jwt')).toBeNull();
    expect(decodeIdToken(123)).toBeNull();
  });
});

describe('validateIdClaims', () => {
  it('accepts valid Google claims', () => {
    const id = validateIdClaims(goodClaims(), CFG.clientId, NOW, undefined);
    expect(id).toMatchObject({ sub: '12345', email: 'a@b.com', emailVerified: true, name: 'Alice' });
  });
  it('accepts the bare-domain issuer too', () => {
    expect(validateIdClaims(goodClaims({ iss: 'accounts.google.com' }), CFG.clientId, NOW)).not.toBeNull();
  });
  it('rejects a wrong issuer', () => {
    expect(validateIdClaims(goodClaims({ iss: 'evil.com' }), CFG.clientId, NOW)).toBeNull();
  });
  it('rejects a wrong audience', () => {
    expect(validateIdClaims(goodClaims({ aud: 'other' }), CFG.clientId, NOW)).toBeNull();
  });
  it('rejects an expired token', () => {
    expect(validateIdClaims(goodClaims({ exp: NOW - 3600 }), CFG.clientId, NOW)).toBeNull();
  });
  it('rejects a missing sub', () => {
    expect(validateIdClaims(goodClaims({ sub: '' }), CFG.clientId, NOW)).toBeNull();
  });
  it('enforces the nonce when provided', () => {
    expect(validateIdClaims(goodClaims({ nonce: 'A' }), CFG.clientId, NOW, 'B')).toBeNull();
    expect(validateIdClaims(goodClaims({ nonce: 'A' }), CFG.clientId, NOW, 'A')).not.toBeNull();
  });
});

describe('exchangeCode (injected fetch — no network)', () => {
  const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ id_token: idToken(goodClaims()) }) });
  it('returns the token response on 200', async () => {
    const r = await exchangeCode(CFG, 'code', 'verifier', okFetch);
    expect(typeof r?.id_token).toBe('string');
  });
  it('returns null on a non-200 response', async () => {
    const r = await exchangeCode(CFG, 'code', 'verifier', async () => ({ ok: false, status: 400, json: async () => ({}) }));
    expect(r).toBeNull();
  });
  it('returns null when fetch throws', async () => {
    const r = await exchangeCode(CFG, 'code', 'verifier', async () => { throw new Error('net'); });
    expect(r).toBeNull();
  });
});

describe('isLinkableIdentity (БЕЗ-5: require verified email)', () => {
  it('accepts a verified, emailed identity', () => {
    const id = validateIdClaims(decodeIdToken(idToken(goodClaims())) , CFG.clientId, NOW);
    expect(isLinkableIdentity(id)).toBe(true);
  });

  it('rejects an unverified email', () => {
    const id = validateIdClaims(decodeIdToken(idToken(goodClaims({ email_verified: false }))), CFG.clientId, NOW);
    expect(id).not.toBeNull();          // claims otherwise valid…
    expect(id!.emailVerified).toBe(false);
    expect(isLinkableIdentity(id)).toBe(false); // …but not linkable
  });

  it('rejects a missing email and a null identity', () => {
    const noEmail = validateIdClaims(decodeIdToken(idToken(goodClaims({ email: undefined }))), CFG.clientId, NOW);
    expect(isLinkableIdentity(noEmail)).toBe(false);
    expect(isLinkableIdentity(null)).toBe(false);
  });
});
