import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../i18n/dictionaries/en';

// Stage 18.2 — invite link edge cases. Source-level contract (no testing-library):
// a saved room is preserved with a Resume-vs-Join choice, an invalid ?room is ignored
// (but consumed), and there is still no auto-join and no name editing in the sheet.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const menu = read('src/ui/StartMenu.tsx');

// The `?room` mount effect body.
const effect = (() => {
  const start = menu.indexOf('const search = window.location.search;');
  const end = menu.indexOf('}, []);', start);
  return menu.slice(start, end);
})();

describe('invite effect — valid prefills, invalid is ignored, param always consumed', () => {
  it('tracks the invited code in its own state', () => {
    expect(menu).toContain('const [invitedCode, setInvitedCode] = useState<string | null>(null)');
  });
  it('opens Join only for a VALID code (gated on roomCodeFromQuery)', () => {
    expect(effect).toContain('const invited = roomCodeFromQuery(search)');
    expect(effect).toContain('if (invited) {');
    expect(effect).toContain('setInvitedCode(invited)');
    expect(effect).toContain("setPane('join')");
  });
  it('consumes the ?room param EVEN when invalid (outside the if-valid block)', () => {
    expect(effect).toContain('params.has(INVITE_ROOM_PARAM)');       // detect presence
    expect(effect).toContain('params.delete(INVITE_ROOM_PARAM)');    // always strip
    expect(effect).toContain('window.history.replaceState');
    // The delete happens after the (optional) setInvitedCode → invalid codes still strip.
    expect(effect.indexOf('params.delete')).toBeGreaterThan(effect.indexOf('setInvitedCode'));
  });
  it('never auto-joins from the effect', () => {
    expect(effect).not.toContain('onOnline');
    expect(effect).not.toMatch(/\bjoin\(\)/);
  });
});

describe('Join sheet — invite banner + resume-vs-invited choice', () => {
  it('shows the banner only while the invited code is still selected', () => {
    expect(menu).toContain("invitedCode && code.trim().toUpperCase() === invitedCode");
    expect(menu).toContain("t('invite.invitedRoom')");
  });
  it('offers Resume current / Join invited when a DIFFERENT room is saved', () => {
    expect(menu).toContain('resumable && resumable.roomCode !== invitedCode');
    expect(menu).toContain("t('invite.resumeConflict')");
    expect(menu).toContain("t('invite.resumeCurrent')");
    expect(menu).toContain("t('invite.joinInvited')");
    // Resume calls resume(); Join invited calls the normal join() — no new join path.
    expect(menu).toMatch(/onClick=\{resume\}[^]*t\('invite\.resumeCurrent'\)/);
    expect(menu).toMatch(/onClick=\{join\}[^]*t\('invite\.joinInvited'\)/);
  });
  it('same saved code → no conflict warning, just a name nudge', () => {
    // The conflict uses !==, so an equal saved code falls through to checkName.
    expect(menu).toContain("t('invite.checkName')");
  });
  it('does NOT add a name input to the Join sheet (name stays read-only)', () => {
    // The name is still the read-only chip; editing lives in Profile only.
    expect(menu).toContain('name-readonly');
    expect(menu).toContain("t('menu.nameInProfile')");
  });
});

describe('privacy unchanged — no token/session in the invite path', () => {
  it('the effect + banner reference only the room code', () => {
    expect(effect).not.toMatch(/token|session|userId/i);
  });
});

describe('i18n parity for the edge-case keys', () => {
  const KEYS = ['invite.invitedRoom', 'invite.checkName', 'invite.resumeConflict', 'invite.resumeCurrent', 'invite.joinInvited'];
  const dicts = ['en', 'uk', 'de', 'ar'].map((l) => read(join('src/i18n/dictionaries', `${l}.ts`)));
  for (const key of KEYS) {
    it(`${key} present + non-blank in every language`, () => {
      expect(EN[key as keyof typeof EN], `EN missing ${key}`).toBeTruthy();
      for (const d of dicts) expect(d, `dict missing ${key}`).toContain(`'${key}'`);
    });
  }
});
