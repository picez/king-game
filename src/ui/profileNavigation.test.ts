// Source guards for the Stage 13.3 profile/settings navigation cleanup:
//  • Profile opens as its OWN menu-screen (a `pane`), not the old growing drawer.
//  • Favorite game is a local + profile-synced preference — never WS/game state.
//  • The custom server address is an ADVANCED, optional override — not a primary
//    step on the connect flow.
//  • "Save progress" is demoted to a secondary "Sync profile" opt-in.
// Pure string/source checks (node env, no jsdom) — cheap and stable.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Profile is a dedicated menu-screen, not a drawer (Stage 13.3)', () => {
  const menu = read('src/ui/StartMenu.tsx');
  const profileMenu = read('src/ui/ProfileMenu.tsx');

  it('StartMenu has a profile pane opened from a tile', () => {
    expect(menu).toContain("'profile'");            // Pane union includes 'profile'
    expect(menu).toContain("setPane('profile')");   // a tile navigates to it
    expect(menu).toContain("pane === 'profile'");    // dedicated screen block
  });

  it('the old collapsible drawer is gone (no toggle / open state)', () => {
    expect(profileMenu).not.toContain('drawer__toggle');
    expect(profileMenu).not.toContain('setOpen');
    expect(profileMenu).toContain('profile-screen');
  });

  it('ProfileMenu is rendered once — inside the profile screen, not the main menu', () => {
    const occurrences = (menu.match(/<ProfileMenu/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe('Favorite game: local + profile sync, never in the WS protocol', () => {
  it('does NOT appear in the room/WS protocol', () => {
    const messages = read('src/net/messages.ts');
    expect(/favou?rite/i.test(messages)).toBe(false);
  });

  it('has a normalize/fallback-to-King helper', () => {
    const catalog = read('src/games/catalog.ts');
    expect(catalog).toContain('export function normalizeFavoriteGame');
    const prefs = read('src/net/prefs.ts');
    expect(prefs).toContain('king.favoriteGame.v1');
    expect(prefs).toContain('loadFavoriteGame');
  });

  it('syncs through the profile (useAccount + server chain)', () => {
    const acc = read('src/hooks/useAccount.ts');
    expect(acc).toContain('favoriteGame: input.favoriteGame');
    expect(acc).toContain('pushFavoriteGame');
    expect(acc).toContain('updateSettings(base, { favoriteGame: v })');
    expect(read('src/ui/StartMenu.tsx')).toContain('normalizeFavoriteGame(m.settings.favoriteGame)');
    expect(read('src/net/userSettings.ts')).toContain('sanitizeFavoriteGame');
    expect(read('server/db/users.ts')).toContain('favoriteGame');
    expect(read('server/api.ts')).toContain("'favoriteGame' in body");
  });

  it('is picked with SelectMenu (no native <select>)', () => {
    const panel = read('src/ui/menu/ProfilePanel.tsx');
    expect(panel).toContain("t('profile.favoriteGame')");
    expect(panel).toContain('changeFavorite');
    expect(panel).not.toMatch(/<select[\s>]/);
  });
});

describe('Server address is an advanced, optional override', () => {
  const menu = read('src/ui/StartMenu.tsx');

  it('lives in a collapsed Advanced connection section with a hint', () => {
    expect(menu).toContain('advanced__summary');
    expect(menu).toContain("t('menu.advancedConnection')");
    expect(menu).toContain("t('menu.serverHint')");
    // The server input is nested inside the <details>, not a top-level field.
    const advIdx = menu.indexOf('<details className="advanced">');
    const srvIdx = menu.indexOf("t('form.server')");
    expect(advIdx).toBeGreaterThan(-1);
    expect(srvIdx).toBeGreaterThan(advIdx);
  });
});

describe('"Save progress" demoted to a secondary "Sync profile" opt-in', () => {
  const panel = read('src/ui/menu/ProfilePanel.tsx');

  it('uses the Sync-profile label in a secondary zone, gated on a reachable API', () => {
    expect(panel).toContain("t('account.syncProfile')");
    expect(panel).toContain('profile-form__sync');
    expect(panel).toContain('account.apiReachable && !account.hasSession');
    // The sync button must NOT be a primary action.
    expect(panel).not.toContain("btn btn--primary' disabled={account.syncing}");
  });
});
