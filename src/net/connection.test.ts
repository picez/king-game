import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StorageLike } from './session';
import {
  CUSTOM_SERVER_KEY, normalizeServerUrl, loadCustomServer, saveCustomServer,
  clearCustomServer, connectionMode, resolveServerUrl,
} from './connection';

function mem(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

describe('normalizeServerUrl (Stage 14.2)', () => {
  it('accepts + normalizes ws/wss/http/https, trimming whitespace', () => {
    expect(normalizeServerUrl('  ws://host:3001/ws  ')).toBe('ws://host:3001/ws');
    expect(normalizeServerUrl('wss://play.example.com/ws')).toBe('wss://play.example.com/ws');
    expect(normalizeServerUrl('http://localhost:3001')).toBe('http://localhost:3001/');
    expect(normalizeServerUrl('https://example.com')).toBe('https://example.com/');
  });

  it('drops a trailing slash on a non-root path', () => {
    expect(normalizeServerUrl('ws://host:3001/ws/')).toBe('ws://host:3001/ws');
  });

  it('rejects empty, malformed, and dangerous protocols', () => {
    for (const bad of ['', '   ', 'not a url', 'host:3001', 'ws://', // no host
      'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'mailto:a@b.c', 'ftp://host/x']) {
      expect(normalizeServerUrl(bad), bad).toBeNull();
    }
    expect(normalizeServerUrl(null)).toBeNull();
    expect(normalizeServerUrl(undefined)).toBeNull();
  });
});

describe('custom server persistence', () => {
  it('saves + loads a normalized custom URL under the Card Majlis key', () => {
    const s = mem();
    expect(CUSTOM_SERVER_KEY).toBe('cardMajlis.customServer.v1');
    expect(loadCustomServer(s)).toBeNull();
    expect(saveCustomServer('  ws://lan:3001/ws/ ', s)).toBe('ws://lan:3001/ws');
    expect(loadCustomServer(s)).toBe('ws://lan:3001/ws');
  });

  it('refuses an invalid URL (nothing stored)', () => {
    const s = mem();
    expect(saveCustomServer('javascript:alert(1)', s)).toBeNull();
    expect(loadCustomServer(s)).toBeNull();
  });

  it('clear removes the custom URL (back to default)', () => {
    const s = mem();
    saveCustomServer('wss://h/ws', s);
    clearCustomServer(s);
    expect(loadCustomServer(s)).toBeNull();
  });

  it('a legacy/tampered stored value is validated on load (→ null = default)', () => {
    const s = mem();
    s.setItem(CUSTOM_SERVER_KEY, 'file:///evil');
    expect(loadCustomServer(s)).toBeNull();
  });

  it('any valid saved URL maps to CUSTOM mode; none → DEFAULT', () => {
    expect(connectionMode(null)).toBe('default');
    expect(connectionMode('ws://lan:3001/ws')).toBe('custom');
  });
});

describe('resolveServerUrl', () => {
  it('DEFAULT mode uses defaultServerUrl (env/loc), custom wins when set', () => {
    // No custom → the default (env URL beats loc).
    expect(resolveServerUrl(null, 'wss://prod.example.com/ws', null)).toBe('wss://prod.example.com/ws');
    expect(resolveServerUrl(null, undefined, null)).toBe('ws://localhost:3001/ws');
    // Custom wins even over an env default.
    expect(resolveServerUrl('ws://lan:3001/ws', 'wss://prod/ws', null)).toBe('ws://lan:3001/ws');
  });
});

describe('connection is a device-local setting, never the profile/wire', () => {
  const src = readFileSync(join(process.cwd(), 'src/net/connection.ts'), 'utf8');
  it('does not import the WS protocol or the profile API (no sync)', () => {
    expect(src).not.toContain('messages');
    expect(src).not.toContain('profileApi');
    expect(src).toContain("from './online'"); // only the pure default-URL derivation
  });
});
