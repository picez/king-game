import { describe, it, expect } from 'vitest';
import { apiBaseFromWsUrl, googleStartUrl } from './profileApi';

describe('googleStartUrl', () => {
  it('points at the API /auth/google/start on the same origin', () => {
    expect(googleStartUrl('https://king.example.com')).toBe('https://king.example.com/auth/google/start');
    expect(googleStartUrl(apiBaseFromWsUrl('wss://king.example.com/ws'))).toBe('https://king.example.com/auth/google/start');
  });
});

describe('apiBaseFromWsUrl', () => {
  it('maps a wss WebSocket URL to an https API origin', () => {
    expect(apiBaseFromWsUrl('wss://king.example.com/ws')).toBe('https://king.example.com');
  });
  it('maps a ws LAN URL (with port + /ws path) to http origin keeping the port', () => {
    expect(apiBaseFromWsUrl('ws://192.168.1.20:3001/ws')).toBe('http://192.168.1.20:3001');
  });
  it('falls back to empty string for an unparseable URL with no window', () => {
    expect(apiBaseFromWsUrl('not a url')).toBe('');
  });
});
