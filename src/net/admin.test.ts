import { describe, expect, it } from 'vitest';
import {
  ADMIN_ACTION_KINDS, ADMIN_ACTION_LABEL, buildLogCsv, dayRange, errorFingerprint, isAdminPath,
  kindsForGroups, maskErrorText, parseAdminEmails, parseFeedbackBody, safeUrl,
} from './admin';

describe('admin contract (Stage 44.0)', () => {
  it('parses ADMIN_EMAILS: trims, lower-cases, drops junk; empty means no admins', () => {
    expect([...parseAdminEmails(' A@x.com, b@Y.org ,, nope ')]).toEqual(['a@x.com', 'b@y.org']);
    expect(parseAdminEmails(undefined).size).toBe(0);
    expect(parseAdminEmails('').size).toBe(0);
  });

  it('recognises the admin path only at /admin', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/')).toBe(true);
    expect(isAdminPath('/administrator')).toBe(false);
    expect(isAdminPath('/')).toBe(false);
  });

  it('validates feedback: kind, text length, room code shape, control chars stripped', () => {
    expect(parseFeedbackBody({ kind: 'spam', text: 'hello' })).toEqual({ error: 'invalid_kind' });
    expect(parseFeedbackBody({ kind: 'bug', text: '  a ' })).toEqual({ error: 'empty_text' });
    const ok = parseFeedbackBody({
      kind: 'complaint', text: 'He\u0007 swears in chat', aboutPlayer: 'Vasya', roomCode: 'ab12', context: { lang: 'uk', screen: 'menu', evil: 'x' },
    });
    expect(ok).toMatchObject({ kind: 'complaint', text: 'He swears in chat', aboutPlayer: 'Vasya', roomCode: 'AB12', context: { lang: 'uk', screen: 'menu' } });
    expect('evil' in (ok as { context: object }).context).toBe(false);
    expect(parseFeedbackBody({ kind: 'bug', text: 'x'.repeat(5000), roomCode: 'bad code!' })).toMatchObject({ roomCode: null });
    expect((parseFeedbackBody({ kind: 'bug', text: 'x'.repeat(5000) }) as { text: string }).text).toHaveLength(1000);
  });

  it('keeps only http(s) announcement links', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
  });

  it('every log kind has a Ukrainian label; groups expand to their kinds', () => {
    for (const k of ADMIN_ACTION_KINDS) expect(ADMIN_ACTION_LABEL[k]).toBeTruthy();
    expect(kindsForGroups(['games'])).toEqual(['room_close', 'solitaire_delete']);
    expect(kindsForGroups(['nope'])).toEqual([]);
    expect(kindsForGroups([])).toEqual([]);
  });

  it('CSV: BOM, quoting, and formula-injection guard', () => {
    const csv = buildLogCsv([{
      id: '1', at: '2026-11-26T10:00:00Z', adminLabel: 'Адмін', kind: 'user_ban',
      targetUserId: 'u', targetLabel: '=HYPERLINK("x")', details: { reason: 'a, b' },
    }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Бан');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"{""reason"":""a, b""}"');
  });

  it('masks personal data and fingerprints errors stably across ids/numbers', () => {
    const m = maskErrorText('user bob@mail.com 1.2.3.4 id 123e4567-e89b-12d3-a456-426614174000');
    expect(m).toBe('user <email> <ip> id <id>');
    expect(errorFingerprint('api', 'timeout after 3000ms')).toBe(errorFingerprint('api', 'timeout after 5000ms'));
    expect(errorFingerprint('api', 'x')).not.toBe(errorFingerprint('ws', 'x'));
  });

  it('dayRange fills every day inclusive', () => {
    expect(dayRange('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });
});
