// ---------------------------------------------------------------------------
// Session token generation + hashing (Stage 4 — auth foundation).
//
// The raw session token is a high-entropy random string sent to the browser in
// an httpOnly cookie. We NEVER store it: the DB keeps only its hash, so a DB
// dump cannot be replayed to hijack a live session (ARCHITECTURE_DB_AUTH.md §5).
//
// Hash = SHA-256(token + SESSION_SECRET). SESSION_SECRET acts as a server-side
// pepper: even with the DB and a guessed token, an attacker can't precompute
// hashes without the secret. In dev the secret may be empty (still safe over a
// local connection); production MUST set SESSION_SECRET (see DEPLOYMENT.md).
//
// node:crypto lives here (server-only); the cookie/CSRF string helpers stay in
// the dependency-free src/net/cookies.ts.
// ---------------------------------------------------------------------------

import { randomBytes, createHash } from 'node:crypto';

/** Bytes of entropy in a session token (32 → 256 bits, base64url ≈ 43 chars). */
const TOKEN_BYTES = 32;

/** A fresh, URL-safe opaque session token. Never stored server-side as-is. */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Hashes a session token for storage/lookup. The optional pepper defaults to
 * SESSION_SECRET; pass it explicitly in tests. Deterministic, so a presented
 * cookie hashes to the same value used as the DB lookup key.
 */
export function hashSessionToken(token: string, pepper: string = process.env.SESSION_SECRET ?? ''): string {
  return createHash('sha256').update(token + pepper).digest('hex');
}

/**
 * Resolves the session lifetime in seconds. SESSION_TTL_DAYS overrides the
 * default (30 days); clamped to a sane [1, 365]-day range.
 */
export function sessionTtlSeconds(env: { SESSION_TTL_DAYS?: string } = process.env): number {
  const days = Number(env.SESSION_TTL_DAYS);
  const clamped = Number.isFinite(days) && days > 0 ? Math.min(365, days) : 30;
  return Math.round(clamped * 24 * 60 * 60);
}

/**
 * Coarse, non-reversible fingerprint of an IP for security review. We store a
 * hash (peppered) rather than the raw address to minimise stored personal data
 * (ARCHITECTURE_DB_AUTH.md §5). Returns null for an empty input.
 */
export function hashIp(ip: string | null | undefined, pepper: string = process.env.SESSION_SECRET ?? ''): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip + pepper).digest('hex').slice(0, 32);
}
