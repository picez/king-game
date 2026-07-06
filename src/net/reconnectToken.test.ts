// БЕЗ-4: reconnect tokens are hashed at rest; plaintext never persisted.
import { describe, it, expect } from 'vitest';
import { hashReconnectToken } from '../../server/reconnectToken';
import { createRoom, addMember, reconnectMember, serializeRoom } from './serverCore';

describe('hashReconnectToken', () => {
  it('is deterministic, tagged, and hides the plaintext', () => {
    const h = hashReconnectToken('plain-token-abc');
    expect(h).toBe(hashReconnectToken('plain-token-abc'));
    expect(h.startsWith('sha256$')).toBe(true);
    expect(h).not.toContain('plain-token-abc');
    expect(hashReconnectToken('other')).not.toBe(h);
  });
});

describe('reconnect flow with hashed tokens (server wiring)', () => {
  // Mirrors wsHandlers: mint plaintext, store only its hash.
  const HOST_PLAIN = 'host-plain-token';
  const room = createRoom({
    code: 'RCON', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'h', reconnectToken: hashReconnectToken(HOST_PLAIN), name: 'Host' },
  });
  const BOB_PLAIN = 'bob-plain-token';
  addMember(room, { clientId: 'b', reconnectToken: hashReconnectToken(BOB_PLAIN), name: 'Bob' });

  it('never persists the plaintext token', () => {
    const json = JSON.stringify(serializeRoom(room));
    expect(json).not.toContain(HOST_PLAIN);
    expect(json).not.toContain(BOB_PLAIN);
    expect(json).toContain('sha256$'); // the hash is what is stored
  });

  it('resumes a seat only when the presented token hashes to the stored hash', () => {
    // The server passes hashReconnectToken(presented) to reconnectMember.
    const ok = reconnectMember(room, hashReconnectToken(BOB_PLAIN));
    expect(ok?.clientId).toBe('b');
    // Presenting the raw plaintext (unhashed) must NOT match — proves it is hashed.
    expect(reconnectMember(room, BOB_PLAIN)).toBeNull();
    // A wrong token never matches.
    expect(reconnectMember(room, hashReconnectToken('nope'))).toBeNull();
  });
});
