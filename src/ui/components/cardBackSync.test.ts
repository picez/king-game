// Contract guards for the card-back style (Stage 13.1). The style is a PURELY
// VISUAL, LOCAL preference: it is persisted locally + mirrored to the profile
// (HTTP) when signed in, but must NEVER enter the WS room protocol or game state,
// so two players in the same room can each pick their own back. These source-level
// guards (the project runs in a `node` env, no jsdom) lock that contract in place.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('card-back style stays OUT of the WS room protocol (online privacy)', () => {
  const messages = read('src/net/messages.ts');

  it('messages.ts declares no card-style / card-back field anywhere', () => {
    // Covers RoomSnapshot, RoomSummary, the Client/Server message unions and
    // ACTION_REQUEST — all live in this one protocol module.
    expect(/card ?style/i.test(messages)).toBe(false);
    expect(/card ?back/i.test(messages)).toBe(false);
    expect(/card[_-]style/i.test(messages)).toBe(false);
  });

  it('still declares the privacy-safe room DTOs (file not gutted)', () => {
    expect(messages).toContain('export interface RoomSnapshot');
    expect(messages).toContain('export interface RoomSummary');
  });

  it('the store module documents itself as local + never-in-room state', () => {
    const store = read('src/ui/components/cardBackStore.ts');
    expect(store).toContain('useSyncExternalStore');
    expect(store).toMatch(/NEVER put into room\/WS state|LOCAL/);
    // It reads the local pref and reflects onto <html>, but imports no net/WS code.
    expect(store).toContain("from '../../net/prefs'");
    expect(store).not.toContain('messages');
  });
});

describe('card-back style DOES sync through the profile (HTTP) when signed in', () => {
  it('useAccount carries cardStyle in saveProgress + exposes pushCardStyle', () => {
    const acc = read('src/hooks/useAccount.ts');
    expect(acc).toContain('cardStyle: input.cardStyle');       // saveProgress → updateSettings
    expect(acc).toContain('pushCardStyle');                    // single-field push when signed in
    expect(acc).toContain('updateSettings(base, { cardStyle: v })');
  });

  it('StartMenu applies the signed-in profile cardStyle on hydrate', () => {
    const menu = read('src/ui/StartMenu.tsx');
    expect(menu).toContain('setCardBackStyle(m.settings.cardStyle)');
  });

  it('ProfilePanel maps the visual style to the stored setting value', () => {
    const panel = read('src/ui/menu/ProfilePanel.tsx');
    // cardBackToSetting('green') === 'classic' keeps legacy rows intact.
    expect(panel).toContain('cardBackToSetting(cardBack)');
    expect(panel).toContain('account.pushCardStyle(cardBackToSetting(v))');
  });
});
