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

describe('Account auth controls + recovery (no dead-end)', () => {
  const bar = read('src/ui/menu/AccountBar.tsx');
  const account = read('src/hooks/useAccount.ts');

  it('the Profile form renders a dedicated auth control block', () => {
    expect(panel).toContain('profile-account');
    expect(panel).toContain('profile-account__row');
  });

  it('a guest on a sign-in-capable server sees a real "Sign in with Google" action', () => {
    // Gated on authAvailable (a 200 from /api/me), NOT on the coarse old apiReachable.
    expect(panel).toMatch(/account\.authAvailable\s*\?[\s\S]*?href=\{account\.googleUrl\}/);
    expect(panel).toContain("t('account.google')");
  });

  it('a signed-in user sees the account line + a Sign out button wired to logout', () => {
    expect(panel).toMatch(/account\.signedIn[\s\S]*?account\.logout\(\)/);
    expect(panel).toContain("t('account.signedInGoogle')");
    expect(panel).toContain("t('account.logout')");
  });

  it('the unavailable state is NOT a dead-end — it has Retry (+ reset when custom)', () => {
    // Distinguish sign-in-off (reachable) from unreachable, and always offer recovery.
    expect(panel).toContain('profile-account__recovery');
    expect(panel).toMatch(/account\.serverReachable\s*\?\s*t\('account\.signInUnavailable'\)\s*:\s*t\('account\.serverUnreachable'\)/);
    expect(panel).toContain("t('account.retry')");
    expect(panel).toMatch(/account\.retry\(\)/);
    // A one-tap reset to the default server when a custom one is set (no Advanced scroll).
    expect(panel).toMatch(/customServer && \([\s\S]*?resetToDefaultServer/);
    expect(panel).toContain("t('account.useDefaultServer')");
    expect(panel).toContain("t('account.checking')");   // first /api/me pending → neutral
  });

  it('useAccount splits the state (loading / serverReachable / authAvailable) + a retry', () => {
    expect(account).toMatch(/loading:\s*boolean/);
    expect(account).toContain('loading: !loaded');
    expect(account).toMatch(/serverReachable:\s*boolean/);
    expect(account).toMatch(/authAvailable:\s*boolean/);
    expect(account).toMatch(/retry:\s*\(\)\s*=>\s*void/);
    // apiReachable is kept as a back-compat alias of authAvailable (a 200 response).
    expect(account).toContain('apiReachable = authAvailable');
  });

  it('AccountBar keeps sign-in + sign-out AND adds a compact Retry when unreachable', () => {
    expect(bar).toContain('account.googleUrl');      // guest → sign in
    expect(bar).toMatch(/account\.logout\(\)/);      // signed-in → sign out
    expect(bar).toMatch(/account\.retry\(\)/);       // unreachable → retry (not null)
    expect(bar).toContain("t('account.signIn')");
    expect(bar).toContain("t('account.logout')");
    expect(bar).toContain("t('account.retry')");
    // Order of gates: signed-in → auth-available → (not loading & unreachable) → retry.
    expect(bar).toMatch(/account\.signedIn\s*\?[\s\S]*?account\.authAvailable\s*\?[\s\S]*?!account\.serverReachable\s*\?/);
  });

  it('the unavailable block shows debug-safe diagnostics + a Copy action', () => {
    expect(panel).toContain('profile-account__diag');
    expect(panel).toContain('formatAccountDiagnostics(account.diagnostics)');
    expect(panel).toContain("t('account.copyDiagnostics')");
    expect(panel).toMatch(/copyDiagnostics\(\)/);
    // useAccount exposes the diagnostics object.
    expect(account).toMatch(/diagnostics:\s*AccountDiagnostics/);
    expect(account).toContain('connectionMode: customServer ? ');
    expect(account).toContain('sameOrigin:');
  });

  it('distinguishes a transient db_error (busy, retry) from unreachable / sign-in-off', () => {
    // db_error → serverReachable is true, so a plain serverReachable check would wrongly
    // say "no sign-in here"; the panel must branch on the code to show a "busy" message.
    expect(panel).toMatch(/account\.diagnostics\.code === 'db_error'[\s\S]*?t\('account\.serverBusy'\)/);
    expect(read('src/net/profileApi.ts')).toMatch(/code === 'db_disabled' \|\| code === 'db_error'/);
  });

  it('/api/me degrades to a guest on a DB error (never a hard 503 that traps the UI)', () => {
    const api = read('server/api.ts');
    // handleMe wraps its body and, on any DB throw, answers 200 { authenticated:false }.
    const me = api.slice(api.indexOf('async function handleMe'), api.indexOf('async function handleMe') + 1600);
    expect(me).toMatch(/try \{[\s\S]*\} catch \(err\) \{[\s\S]*authenticated: false[\s\S]*\}/);
    expect(me).toContain('logDbBrief');
  });

  it('offers a same-origin "Try sign in" only when the API is same-origin AND unreachable', () => {
    // Safe: /auth/google/start is a top-level nav to THIS origin (not a CORS fetch).
    expect(panel).toMatch(/account\.diagnostics\.sameOrigin && !account\.serverReachable[\s\S]*?href=\{account\.googleUrl\}/);
    expect(panel).toContain("t('account.trySignIn')");
  });

  it('StartMenu passes the custom-server flag so diagnostics can report the mode', () => {
    expect(read('src/ui/StartMenu.tsx')).toContain('useAccount(url, customServer)');
  });

  it('the sign-in control is a real link/button, no native <select> introduced', () => {
    expect(panel).not.toMatch(/<select[\s>]/);
  });

  it('no cookie/token/email logging in the auth flow (debug-safe)', () => {
    for (const src of [account, read('src/net/profileApi.ts'), read('src/net/accountDiagnostics.ts')]) {
      expect(src).not.toMatch(/console\.\w+\([^)]*(cookie|token|email|password|session)/i);
    }
  });

  it('server DB-error logging is truncated + param-safe (no raw error / driver params line)', () => {
    const api = read('server/api.ts');
    const fn = api.slice(api.indexOf('function logDbBrief'), api.indexOf('function logDbBrief') + 400);
    expect(fn).toContain("split('\\n')[0]"); // first line only — drops the driver's `params:` line
    expect(fn).toContain('slice(0, 200)');    // and truncated, so no long payload leaks
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
    // 17.3 adds a same-origin avatarImageUrl (a URL); the LOCAL custom image / data
    // URL still never reach the wire.
    expect(/customAvatar|data:image|avatarDataUrl|base64/i.test(messages)).toBe(false);
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
    'account.checking', 'account.signInUnavailable',
    'account.serverUnreachable', 'account.serverBusy', 'account.retry', 'account.useDefaultServer',
    'account.diagnostics', 'account.copyDiagnostics', 'account.copied', 'account.trySignIn',
  ];
  for (const lang of ['en', 'uk', 'de', 'ar']) {
    it(`${lang} defines every new key`, () => {
      const dict = read(`src/i18n/dictionaries/${lang}.ts`);
      for (const k of KEYS) expect(dict, `${lang} → ${k}`).toContain(`'${k}'`);
    });
  }
});
