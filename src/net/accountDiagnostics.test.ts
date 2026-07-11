// Tests for the debug-safe account/connection diagnostics (Stage 24.2). The formatter
// must describe the connection precisely AND leak no secrets (no cookie/token/session/
// email/identity) — it's shown on screen and copyable into a bug report.
import { describe, it, expect } from 'vitest';
import { authState, formatAccountDiagnostics, type AccountDiagnostics } from './accountDiagnostics';

const base: AccountDiagnostics = {
  connectionMode: 'default',
  apiBase: 'https://king-game.example.com',
  pageOrigin: 'https://king-game.example.com',
  sameOrigin: true,
  endpoint: '/api/me',
  status: 200,
  networkError: false,
  code: null,
  serverReachable: true,
  authAvailable: true,
};

describe('authState', () => {
  it('available (200) / unavailable (reachable, no auth) / unknown (unreachable)', () => {
    expect(authState(base)).toBe('available');
    expect(authState({ ...base, authAvailable: false, serverReachable: true })).toBe('unavailable');
    expect(authState({ ...base, authAvailable: false, serverReachable: false })).toBe('unknown');
  });
});

describe('formatAccountDiagnostics — precise + copyable', () => {
  it('shows default/same-origin, endpoint + status, and auth availability', () => {
    const s = formatAccountDiagnostics(base);
    expect(s).toContain('Server: Default');
    expect(s).toContain('Origin: https://king-game.example.com (same-origin)');
    expect(s).toContain('API: /api/me -> 200');
    expect(s).toContain('Auth: available');
  });

  it('surfaces a custom, cross-origin server + a db_disabled code', () => {
    const s = formatAccountDiagnostics({
      ...base, connectionMode: 'custom', apiBase: 'http://192.168.1.9:3001', sameOrigin: false,
      status: 503, code: 'db_disabled', authAvailable: false, serverReachable: true,
    });
    expect(s).toContain('Server: Custom');
    expect(s).toContain('(cross-origin)');
    expect(s).toContain('API: /api/me -> 503 (db_disabled)');
    expect(s).toContain('Auth: unavailable');
  });

  it('reports a network error (fetch threw) as network_error, auth unknown', () => {
    const s = formatAccountDiagnostics({
      ...base, status: 0, networkError: true, code: null,
      authAvailable: false, serverReachable: false, sameOrigin: false,
    });
    expect(s).toContain('API: /api/me -> network_error');
    expect(s).toContain('Auth: unknown');
  });

  it('shows "pending" before the first probe (status null)', () => {
    expect(formatAccountDiagnostics({ ...base, status: null })).toContain('-> pending');
  });
});

describe('PRIVACY — diagnostics text carries no secrets', () => {
  // Even if identity-like values were somehow present on the object, the formatter
  // reads ONLY connection metadata, so its output must never contain them.
  const poisoned = {
    ...base,
    // @ts-expect-error — extra fields must be ignored by the formatter
    email: 'alex@example.com', token: 'secret-token-abc', sessionId: 'sess_123', cookie: 'k=v',
  } as AccountDiagnostics;

  it('never includes email / token / session / cookie substrings', () => {
    const s = formatAccountDiagnostics(poisoned);
    for (const forbidden of ['alex@example.com', 'secret-token', 'sess_123', 'cookie', 'token', 'email', 'session']) {
      expect(s.toLowerCase().includes(forbidden.toLowerCase()), forbidden).toBe(false);
    }
    expect(s).not.toMatch(/@/); // no emails / userinfo
  });
});
