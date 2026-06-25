// ---------------------------------------------------------------------------
// OAuth CSRF state + PKCE helpers (Stage 6 — Google sign-in).
//
// Pure node:crypto utilities, no I/O — so the security-critical bits (PKCE,
// the signed/TTL'd state token) are unit-tested without a network or a DB.
//
// The `state` we send to Google is the random anti-CSRF nonce; alongside it we
// must remember the PKCE `codeVerifier`, an id-token `nonce`, and the current
// guest user id (to merge after login). We can't keep server-side state across
// the redirect, so we pack all of that into a SHORT-LIVED, HMAC-SIGNED cookie
// (signed with SESSION_SECRET). The callback verifies the signature, the TTL,
// and that the `state` echoed by Google matches the one in the cookie — so a
// forged or stale callback is rejected.
// ---------------------------------------------------------------------------

import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** How long a login attempt stays valid (seconds). */
export const STATE_TTL_SEC = 600;

export interface OAuthStatePayload {
  /** Random anti-CSRF value echoed by Google in the callback `state` param. */
  state: string;
  /** PKCE code_verifier (proves this client started the flow). */
  codeVerifier: string;
  /** id_token nonce (replay protection). */
  nonce: string;
  /** The guest user id to merge into the account, or null. */
  guestUserId: string | null;
  /** Issued-at (epoch seconds) for TTL enforcement. */
  iat: number;
}

/** A URL-safe high-entropy token (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** PKCE pair: a random `verifier` and its S256 `challenge`. */
export function makePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url'); // ~43 chars (RFC 7636 ok)
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Signs a state payload into a `<body>.<sig>` cookie value (HMAC-SHA256). */
export function signState(payload: OAuthStatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verifies a signed state cookie: signature (timing-safe), structure, and TTL
 * (with a small clock-skew tolerance). Returns the payload or null. NEVER throws.
 */
export function verifyState(token: string | undefined | null, secret: string, nowSec: number): OAuthStatePayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.state !== 'string' || typeof payload.codeVerifier !== 'string'
    || typeof payload.iat !== 'number') return null;
  // TTL window: not older than STATE_TTL_SEC, not issued in the future (skew 60s).
  if (nowSec - payload.iat > STATE_TTL_SEC || payload.iat - nowSec > 60) return null;
  return payload;
}

/**
 * Constant-time compare of the cookie `state` and the callback `state` param.
 * (Both are base64url tokens of equal length when legitimate.)
 */
export function statesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
