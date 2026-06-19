import { describe, it, expect } from 'vitest';
import {
  saveSession, loadSession, clearSession, parseSession, serializeSession,
  SESSION_KEY, SESSION_VERSION, SESSION_TTL_MS,
  type StorageLike, type SessionInput,
} from './session';

/** In-memory Storage for deterministic tests. */
function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

const INPUT: SessionInput = {
  serverUrl: 'ws://192.168.1.20:3001',
  roomCode: 'KQJ7',
  reconnectToken: 'tok-123',
  playerName: 'Alice',
  role: 'join',
  seatIndex: 2,
};

describe('save/load roundtrip', () => {
  it('persists and restores the session fields', () => {
    const storage = memStorage();
    saveSession(INPUT, { storage, now: 1000 });
    const loaded = loadSession({ storage, now: 1000 });
    expect(loaded).toEqual({ ...INPUT, version: SESSION_VERSION, savedAt: 1000 });
  });

  it('stamps version and savedAt on save', () => {
    const storage = memStorage();
    const s = saveSession(INPUT, { storage, now: 500 });
    expect(s.version).toBe(SESSION_VERSION);
    expect(s.savedAt).toBe(500);
  });
});

describe('expired / malformed sessions are ignored', () => {
  it('returns null for an expired session', () => {
    const storage = memStorage();
    saveSession(INPUT, { storage, now: 0 });
    expect(loadSession({ storage, now: SESSION_TTL_MS + 1 })).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const storage = memStorage();
    storage.setItem(SESSION_KEY, '{not json');
    expect(loadSession({ storage, now: 0 })).toBeNull();
  });

  it('returns null for a wrong-version payload', () => {
    expect(parseSession(JSON.stringify({ ...INPUT, version: 999, savedAt: 0 }), 0)).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseSession(JSON.stringify({ version: SESSION_VERSION, savedAt: 0 }), 0)).toBeNull();
  });

  it('returns null for empty / absent storage', () => {
    expect(parseSession(null, 0)).toBeNull();
  });
});

describe('clearSession', () => {
  it('removes the stored session', () => {
    const storage = memStorage();
    saveSession(INPUT, { storage, now: 0 });
    clearSession({ storage });
    expect(loadSession({ storage, now: 0 })).toBeNull();
  });
});

describe('privacy — never stores GameState or hands', () => {
  it('serialized payload contains only the reconnect handle', () => {
    const session = saveSession(INPUT, { storage: memStorage(), now: 0 });
    const raw = serializeSession(session);
    expect(raw).not.toMatch(/hand/i);
    expect(raw).not.toMatch(/gameState/i);
    expect(raw).not.toMatch(/players/i);
    expect(raw).not.toMatch(/password/i);
    expect(Object.keys(session).sort()).toEqual(
      ['playerName', 'reconnectToken', 'role', 'roomCode', 'savedAt', 'seatIndex', 'serverUrl', 'version'],
    );
  });

  it('parse drops any injected extra fields (e.g. a stray hand)', () => {
    const tampered = JSON.stringify({ ...INPUT, version: SESSION_VERSION, savedAt: 0, hand: ['A♠', 'K♥'] });
    const parsed = parseSession(tampered, 0)!;
    expect(parsed).not.toBeNull();
    expect((parsed as Record<string, unknown>).hand).toBeUndefined();
  });
});
