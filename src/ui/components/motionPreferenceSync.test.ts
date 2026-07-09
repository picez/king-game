// Contract guards for the animation-intensity preference (Stage 13.2). Like the
// card-back style it is a purely VISUAL preference: persisted locally + mirrored
// to the profile (HTTP) when signed in, but NEVER in the WS room protocol or game
// state. These source-level guards (node env, no jsdom) lock the contract.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('animation preference stays OUT of the WS room protocol (online privacy)', () => {
  const messages = read('src/net/messages.ts');

  it('messages.ts declares no animation/motion field anywhere', () => {
    expect(/animation/i.test(messages)).toBe(false);
    expect(/\bmotion\b/i.test(messages)).toBe(false);
  });

  it('still declares the privacy-safe room DTOs (file not gutted)', () => {
    expect(messages).toContain('export interface RoomSnapshot');
    expect(messages).toContain('export interface RoomSummary');
  });

  it('the store is local + never imports the WS protocol', () => {
    const store = read('src/ui/components/motionPreferenceStore.ts');
    expect(store).toContain('useSyncExternalStore');
    expect(store).toMatch(/LOCAL|never put into room\/WS state/);
    expect(store).toContain("from '../../net/prefs'");
    expect(store).not.toContain('messages');
  });
});

describe('animation preference DOES sync through the profile (HTTP) when signed in', () => {
  it('useAccount carries animationPreference in saveProgress + exposes pushAnimation', () => {
    const acc = read('src/hooks/useAccount.ts');
    expect(acc).toContain('animationPreference: input.animationPreference'); // saveProgress → updateSettings
    expect(acc).toContain('pushAnimation');                                  // single-field push when signed in
    expect(acc).toContain('updateSettings(base, { animationPreference: v })');
  });

  it('StartMenu applies the signed-in profile animationPreference on hydrate', () => {
    const menu = read('src/ui/StartMenu.tsx');
    expect(menu).toContain('setMotionPreference(m.settings.animationPreference)');
  });

  it('server validation + repository + API handle animationPreference', () => {
    const settings = read('src/net/userSettings.ts');
    expect(settings).toContain('sanitizeAnimationPref');
    expect(settings).toContain('animationPreference: sanitizeAnimationPref');
    expect(read('server/db/users.ts')).toContain('animationPreference');
    expect(read('server/api.ts')).toContain("'animationPreference' in body");
  });
});

describe('ProfilePanel renders the animation setting (no native <select>)', () => {
  const panel = read('src/ui/menu/ProfilePanel.tsx');

  it('renders the Animation field + hint + change handler', () => {
    expect(panel).toContain("t('profile.animation')");
    expect(panel).toContain("t('profile.animationHint')");
    expect(panel).toContain('changeAnimation');
  });

  it('uses the segmented control, not a native select (project convention)', () => {
    expect(panel).not.toMatch(/<select[\s>]/);
  });
});
