import { describe, it, expect } from 'vitest';
import { apiBaseFromWsUrl } from './profileApi';

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
