// Source guards for the Stage 14.2 Profile overview polish:
//  • a summary header (avatar + name + account line + favorite game + storage status)
//    at the top of the Profile settings form;
//  • the favorite-game chip uses <GameIcon> (graceful emoji fallback);
//  • the form is grouped into Account / Preferences / Appearance / Connection;
//  • truncation for long name/email; Advanced connection stays collapsed by default;
//  • the custom avatar stays LOCAL-only (no new WS/profile-API surface);
//  • no native <select> regression; i18n parity for the new keys.
// Pure string/source checks (node env, no jsdom) — cheap and stable.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const panel = read('src/ui/menu/ProfilePanel.tsx');
const css = read('src/styles/lobby.css');

describe('Profile summary header (Stage 14.2)', () => {
  it('renders a summary card with the local avatar via MyAvatar', () => {
    expect(panel).toContain('profile-summary');
    const summaryIdx = panel.indexOf('profile-summary__avatar');
    expect(summaryIdx).toBeGreaterThan(-1);
    // MyAvatar (local custom image → emoji) drives the preview inside the summary.
    expect(panel).toMatch(/profile-summary__avatar[\s\S]*?<MyAvatar/);
    expect(panel).toContain('profile-summary__avatar-inner');
  });

  it('shows the display name (server → local → Guest precedence)', () => {
    expect(panel).toContain('profile-summary__name');
    expect(panel).toContain('account.displayName ?? name ?? t(\'account.guestShort\')');
  });

  it('shows the signed-in email or a Guest line', () => {
    expect(panel).toMatch(/account\.signedIn && account\.email/);
    expect(panel).toContain('profile-summary__email');
    expect(panel).toContain('profile-summary__sub');
  });

  it('shows the favorite game as a chip built from <GameIcon>', () => {
    expect(panel).toContain("import GameIcon from '../components/GameIcon'");
    expect(panel).toMatch(/profile-summary__fav[\s\S]*?<GameIcon game=\{favoriteGame\}/);
    expect(panel).toContain('profile-summary__fav-label');
  });

  it('shows a storage status chip with three tiers (synced / guest / local)', () => {
    expect(panel).toContain('profile-summary__status');
    expect(panel).toContain("profile-summary__status--${status.kind}");
    // The tier is derived from the account: signed-in → guest session → local-only.
    expect(panel).toMatch(/account\.signedIn\s*\?\s*\{ kind: 'synced'/);
    expect(panel).toMatch(/account\.hasSession\s*\?\s*\{ kind: 'guest'/);
    expect(panel).toContain("kind: 'local'");
    expect(panel).toContain("t('profile.statusSynced')");
    expect(panel).toContain("t('profile.statusGuest')");
    expect(panel).toContain("t('profile.statusLocal')");
  });

  it('notes that some prefs are local-only when not signed in', () => {
    expect(panel).toMatch(/!account\.signedIn && \(/);
    expect(panel).toContain("t('profile.localPrefsNote')");
  });
});

describe('Profile form is grouped into clear sections', () => {
  it('has Account / Preferences / Appearance / Connection headers, in order', () => {
    const account = panel.indexOf("t('account.title')");
    const prefs = panel.indexOf("t('profile.preferences')");
    const appearance = panel.indexOf("t('profile.appearance')");
    const connection = panel.indexOf("t('profile.connection')");
    for (const i of [account, prefs, appearance, connection]) expect(i).toBeGreaterThan(-1);
    expect(prefs).toBeGreaterThan(account);
    expect(appearance).toBeGreaterThan(prefs);
    expect(connection).toBeGreaterThan(appearance);
  });

  it('keeps every existing control (no setting dropped in the reorg)', () => {
    for (const key of [
      'account.displayName', 'lobby.avatar', 'profile.favoriteGame', 'lang.label',
      'account.defaultTimer', 'profile.sound', 'profile.cardBack', 'profile.cardFaces',
      'profile.animation', 'menu.advancedConnection',
    ]) expect(panel, key).toContain(`t('${key}')`);
  });
});

describe('Layout resilience + boundaries', () => {
  it('truncates long name/email/favorite in CSS', () => {
    expect(css).toContain('.profile-summary__name');
    expect(css).toContain('.profile-summary__email');
    expect(css).toContain('.profile-summary__fav-label');
    // ellipsis truncation is present in the summary block.
    const block = css.slice(css.indexOf('.profile-summary {'));
    expect(block).toContain('text-overflow: ellipsis');
  });

  it('Advanced connection is still collapsed by default (no open attribute)', () => {
    expect(panel).toContain('<details className="advanced">');
    expect(panel).not.toMatch(/<details className="advanced" open/);
  });

  it('the custom avatar stays LOCAL-only — no WS/profile-API expansion', () => {
    // The summary uses the local MyAvatar; the wire protocol never learns the image.
    const messages = read('src/net/messages.ts');
    expect(/customAvatar|avatarImage|avatarDataUrl/i.test(messages)).toBe(false);
    // No new avatar-upload field slipped into the profile settings payload.
    const settings = read('src/net/userSettings.ts');
    expect(/customAvatar|avatarImage|avatarDataUrl/i.test(settings)).toBe(false);
  });

  it('has no native <select> (custom SelectMenu / segmented controls only)', () => {
    expect(panel).not.toMatch(/<select[\s>]/);
  });
});

describe('i18n parity for the new profile keys', () => {
  const KEYS = [
    'profile.preferences', 'profile.connection',
    'profile.statusSynced', 'profile.statusGuest', 'profile.statusLocal',
    'profile.localPrefsNote',
  ];
  for (const lang of ['en', 'uk', 'de', 'ar']) {
    it(`${lang} defines every new key`, () => {
      const dict = read(`src/i18n/dictionaries/${lang}.ts`);
      for (const k of KEYS) expect(dict, `${lang} → ${k}`).toContain(`'${k}'`);
    });
  }
});
