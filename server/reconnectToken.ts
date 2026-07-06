// ---------------------------------------------------------------------------
// Reconnect-token hashing at rest (БЕЗ-4). A reconnect token is a bearer
// credential: whoever presents it resumes that seat (and its stats identity).
// Previously the plaintext token was persisted (rooms.json AND the pg `data`
// JSONB), so anyone who could read the store could hijack a seat.
//
// The token is a 122-bit random UUID, so a single fast one-way hash (SHA-256, no
// salt needed for high-entropy secrets) is sufficient at rest. Hashing lives here
// (server, node:crypto) — NOT in src/net/serverCore, which must stay client-
// bundle-safe. The flow: wsHandlers generates the plaintext, sends it to the
// client via WELCOME, and stores only hashReconnectToken(plaintext). On reconnect
// it hashes the presented token and lets serverCore compare opaque strings.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';

const PREFIX = 'sha256$';

/** One-way hash of a reconnect token for storage/comparison. Tagged for clarity. */
export function hashReconnectToken(token: string): string {
  return PREFIX + createHash('sha256').update(token).digest('hex');
}
