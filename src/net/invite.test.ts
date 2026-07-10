import { describe, it, expect } from 'vitest';
import { INVITE_ROOM_PARAM, normalizeRoomCode, buildInviteLink, roomCodeFromQuery } from './invite';

describe('normalizeRoomCode', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normalizeRoomCode('ab1d')).toBe('AB1D');
    expect(normalizeRoomCode('  a b-1 d ')).toBe('AB1D');
    expect(normalizeRoomCode('a!@#b')).toBe('AB');
  });
  it('caps length and tolerates null', () => {
    expect(normalizeRoomCode('ABCDEFGHIJ')).toHaveLength(8);
    expect(normalizeRoomCode(null)).toBe('');
    expect(normalizeRoomCode(undefined)).toBe('');
  });
});

describe('buildInviteLink — same-origin, no secrets', () => {
  it('builds <origin>/?room=<CODE>', () => {
    expect(buildInviteLink('https://cardmajlis.app', 'abcd')).toBe('https://cardmajlis.app/?room=ABCD');
    expect(buildInviteLink('https://h', 'WXYZ')).toBe('https://h/?room=WXYZ');
  });
  it('trims a trailing slash on the origin', () => {
    expect(buildInviteLink('https://h/', 'abcd')).toBe('https://h/?room=ABCD');
  });
  it('returns "" for a blank origin or too-short code (control hidden)', () => {
    expect(buildInviteLink('', 'abcd')).toBe('');
    expect(buildInviteLink('https://h', 'ab')).toBe('');
    expect(buildInviteLink('https://h', '')).toBe('');
  });
  it('never embeds a token/session/userId — only the room code', () => {
    const link = buildInviteLink('https://h', 'abcd');
    expect(link).not.toMatch(/token|session|userId|reconnect|ws:|wss:/i);
    expect(link).toBe('https://h/?room=ABCD');
  });
});

describe('roomCodeFromQuery', () => {
  it('reads ?room=CODE (with or without leading ?)', () => {
    expect(roomCodeFromQuery('?room=abcd')).toBe('ABCD');
    expect(roomCodeFromQuery('room=abcd')).toBe('ABCD');
    expect(roomCodeFromQuery('?foo=1&room=wxyz&bar=2')).toBe('WXYZ');
  });
  it('returns null when absent, blank, or too short', () => {
    expect(roomCodeFromQuery('')).toBeNull();
    expect(roomCodeFromQuery('?foo=1')).toBeNull();
    expect(roomCodeFromQuery('?room=ab')).toBeNull();
    expect(roomCodeFromQuery(null)).toBeNull();
  });
  it('ignores every other param', () => {
    expect(roomCodeFromQuery('?room=abcd&token=SECRET')).toBe('ABCD');
  });
  it('round-trips with buildInviteLink', () => {
    const link = buildInviteLink('https://h', 'q7z2');
    const search = link.slice(link.indexOf('?'));
    expect(roomCodeFromQuery(search)).toBe('Q7Z2');
    expect(search).toContain(`${INVITE_ROOM_PARAM}=Q7Z2`);
  });
});
