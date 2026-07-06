// ---------------------------------------------------------------------------
// Google OAuth 2.0 (Authorization Code + PKCE) — config + token/identity logic.
//
// Split into PURE pieces (config detection, auth-URL building, id_token decode +
// claim validation) that are unit-tested WITHOUT touching the network, and ONE
// network call (`exchangeCode`) to Google's token endpoint, with the fetch
// implementation injectable so tests never reach Google.
//
// Identity model (login-only): we exchange the code for tokens server-side
// (authenticated with the client secret over TLS) and read the **id_token**.
// Because the id_token is received DIRECTLY from Google's token endpoint over a
// TLS connection we initiated, we validate its claims (iss / aud / exp / sub /
// optional nonce) rather than re-verifying the JWT signature against JWKS — the
// standard, safe shortcut for the code flow (Google's own guidance). We DO NOT
// store Google access/refresh tokens — only the stable `sub` + profile basics.
// See ARCHITECTURE_DB_AUTH.md §1.4.
// ---------------------------------------------------------------------------

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const VALID_ISS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Reads the Google OAuth config from env, or null when any piece is missing. */
export function googleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

/** Builds the Google authorization URL (PKCE S256, openid+email+profile). */
export function buildAuthUrl(
  cfg: GoogleConfig,
  params: { state: string; codeChallenge: string; nonce: string },
): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    nonce: params.nonce,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${q.toString()}`;
}

export interface GoogleIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/** Decodes a JWT payload (base64url) without verifying the signature. Pure. */
export function decodeIdToken(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Validates the id_token claims for our client and returns a normalised
 * identity, or null. Checks iss ∈ Google, aud === clientId, exp in the future
 * (60s skew), a non-empty sub, and — when provided — the expected nonce.
 */
export function validateIdClaims(
  claims: Record<string, unknown> | null,
  clientId: string,
  nowSec: number,
  expectedNonce?: string,
): GoogleIdentity | null {
  if (!claims) return null;
  const iss = claims.iss;
  if (typeof iss !== 'string' || !VALID_ISS.has(iss)) return null;
  if (claims.aud !== clientId) return null;
  const exp = claims.exp;
  if (typeof exp !== 'number' || exp < nowSec - 60) return null;
  const sub = claims.sub;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (expectedNonce != null && claims.nonce !== expectedNonce) return null;
  return {
    sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: typeof claims.name === 'string' ? claims.name : null,
    picture: typeof claims.picture === 'string' ? claims.picture : null,
  };
}

/**
 * Gate for linking/promoting/merging a Google identity (БЕЗ-5). Only accept an
 * identity Google has verified owns the email — an unverified email must never
 * become, or merge into, an account identity (we store and trust that email).
 */
export function isLinkableIdentity(identity: GoogleIdentity | null): identity is GoogleIdentity {
  return identity !== null && identity.emailVerified && typeof identity.email === 'string' && identity.email.length > 0;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * Exchanges an authorization code for tokens at Google's token endpoint (PKCE).
 * Returns the raw token response (we only need `id_token`) or null on failure.
 * `fetchImpl` is injectable so tests never hit the network.
 */
export async function exchangeCode(
  cfg: GoogleConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<{ id_token?: string } | null> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: cfg.redirectUri,
  }).toString();
  try {
    const res = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!res.ok) return null;
    return (await res.json()) as { id_token?: string };
  } catch {
    return null;
  }
}
