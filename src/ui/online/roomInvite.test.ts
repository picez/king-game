import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../i18n/dictionaries/en';

// Stage 18.1 — room invite link / share. Source-level contract (no testing-library):
// the lobby exposes copy/share controls, the link is same-origin + secret-free, and
// opening `?room=CODE` only PREFILLS the Join sheet (never auto-joins, never disrupts).

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const lobby = read('src/ui/online/Lobby.tsx');
const menu = read('src/ui/StartMenu.tsx');

describe('Lobby — invite copy / share controls', () => {
  it('renders Copy code, Copy link, and a gated Share button', () => {
    expect(lobby).toContain("t('invite.copyCode')");
    expect(lobby).toContain("t('invite.copyLink')");
    expect(lobby).toContain("t('invite.share')");
    // Share is gated behind navigator.share support.
    expect(lobby).toContain('typeof navigator.share === \'function\'');
    expect(lobby).toContain('{canShare && (');
  });

  it('copies via the Clipboard API and shows "Copied" feedback', () => {
    expect(lobby).toContain('navigator.clipboard?.writeText');
    expect(lobby).toContain("copied === 'code'");
    expect(lobby).toContain("copied === 'link'");
    expect(lobby).toContain("t('invite.copied')");
    // A clipboard failure falls back to a manual, selectable field (no crash).
    expect(lobby).toContain('copyFailed');
    expect(lobby).toContain('lobby-invite__field');
  });

  it('a cancelled share is silent (no scary error surfaced)', () => {
    expect(lobby).toContain('navigator.share({ title: t(\'app.title\')');
    expect(lobby).toContain('catch { /* silent */ }');
  });
});

describe('Lobby — invite link is same-origin + secret-free', () => {
  it('builds the link from the browser ORIGIN via buildInviteLink (not the ws URL)', () => {
    expect(lobby).toContain('buildInviteLink(window.location.origin, room.code)');
    // Never derive the invite from the ws/custom-server connection URL.
    expect(lobby).not.toMatch(/buildInviteLink\([^)]*\b(url|wsUrl|serverUrl|customServer)\b/);
  });
  it('the invite carries no token/session/userId', () => {
    // The only shared value is the room code / the built link — assert no leak tokens.
    expect(lobby).not.toMatch(/reconnectToken|sessionToken|king_session/);
  });
});

describe('StartMenu — ?room=CODE prefills Join, never auto-joins', () => {
  it('reads the code from the query and opens the Join pane with it prefilled', () => {
    expect(menu).toContain('const search = window.location.search');
    expect(menu).toContain('roomCodeFromQuery(search)');
    expect(menu).toContain('setCode(invited)');
    expect(menu).toContain("setPane('join')");
  });
  it('consumes the ?room param (replaceState) so it does not re-trigger', () => {
    expect(menu).toContain('params.delete(INVITE_ROOM_PARAM)');
    expect(menu).toContain('window.history.replaceState');
  });
  it('does NOT auto-join from the invite effect (no onOnline / join call there)', () => {
    const start = menu.indexOf('const invited = roomCodeFromQuery');
    const end = menu.indexOf('}, []);', start);
    const effect = menu.slice(start, end);
    expect(effect).not.toContain('onOnline');
    expect(effect).not.toMatch(/\bjoin\(\)/);
  });
});

describe('i18n parity for the invite keys', () => {
  const KEYS = [
    'invite.title', 'invite.copyCode', 'invite.copyLink', 'invite.share',
    'invite.copied', 'invite.shareText', 'invite.roomLink', 'invite.copyManual',
  ];
  const dicts = ['en', 'uk', 'de', 'ar'].map((l) => read(join('src/i18n/dictionaries', `${l}.ts`)));
  for (const key of KEYS) {
    it(`${key} present + non-blank in every language`, () => {
      expect(EN[key as keyof typeof EN], `EN missing ${key}`).toBeTruthy();
      for (const d of dicts) expect(d, `dict missing ${key}`).toContain(`'${key}'`);
    });
  }
});
