// Contract guards for card theme customization (Stage 13.5): more card backs +
// the new card FACE theme. All are purely VISUAL, LOCAL prefs — persisted locally,
// mirrored to the profile (HTTP) when signed in, but NEVER in the WS room protocol
// or game state. Face theme is applied via a CSS data-attribute, never card state.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('card themes stay OUT of the WS room protocol (online privacy)', () => {
  const messages = read('src/net/messages.ts');

  it('messages.ts declares no cardStyle / cardBack / cardFace / cardTheme token', () => {
    expect(/card ?style/i.test(messages)).toBe(false);
    expect(/card ?back/i.test(messages)).toBe(false);
    expect(/card ?face/i.test(messages)).toBe(false);
    expect(/card ?theme/i.test(messages)).toBe(false);
    expect(/card[_-](style|face|back|theme)/i.test(messages)).toBe(false);
  });

  it('the card-face store is local + never imports the WS protocol', () => {
    const store = read('src/ui/components/cardFaceStore.ts');
    expect(store).toContain('useSyncExternalStore');
    expect(store).toMatch(/LOCAL|never put into room\/WS state/);
    expect(store).toContain("from '../../net/prefs'");
    expect(store).not.toContain('messages');
  });
});

describe('card themes DO sync through the profile (HTTP) when signed in', () => {
  it('useAccount carries cardFaceTheme in saveProgress + exposes pushCardFaceTheme', () => {
    const acc = read('src/hooks/useAccount.ts');
    expect(acc).toContain('cardFaceTheme: input.cardFaceTheme');
    expect(acc).toContain('pushCardFaceTheme');
    expect(acc).toContain('updateSettings(base, { cardFaceTheme: v })');
  });

  it('StartMenu applies the signed-in profile cardFaceTheme on hydrate', () => {
    const menu = read('src/ui/StartMenu.tsx');
    expect(menu).toContain('setCardFaceTheme(m.settings.cardFaceTheme)');
  });

  it('server validation + repository + API handle cardFaceTheme (additive col)', () => {
    const settings = read('src/net/userSettings.ts');
    expect(settings).toContain('sanitizeCardFaceTheme');
    expect(settings).toContain('cardFaceTheme: sanitizeCardFaceTheme');
    expect(read('server/db/users.ts')).toContain('cardFaceTheme');
    expect(read('server/api.ts')).toContain("'cardFaceTheme' in body");
    // Additive idempotent migration for the new column (no other schema change).
    expect(read('server/db/migrations/0007_card_face_theme.sql')).toContain('ADD COLUMN IF NOT EXISTS card_face_theme');
  });

  it('new card BACK styles reuse the existing card_style column (no migration)', () => {
    const settings = read('src/net/userSettings.ts');
    expect(settings).toContain("SUPPORTED_CARD_STYLES = ['classic', 'red', 'blue', 'dark']");
  });
});

describe('face theme is applied via a CSS data-attr, not game/card state', () => {
  it('game.css themes cards off :root[data-card-faces="clean"] (no artwork change)', () => {
    const css = read('src/styles/game.css');
    expect(css).toContain('[data-card-faces="clean"]');
    // It must not touch the artwork <img> source path — only overlay/border.
    expect(css).not.toContain('back-clean');
  });

  it('CardView still drives the HIDDEN back from the selected style (not face theme)', () => {
    const cv = read('src/ui/components/CardView.tsx');
    expect(cv).toContain('useCardBackStyle');
    expect(cv).toContain('cardBackWebpUrl(backStyle)');
    expect(cv).toContain('cardBackUrl(backStyle)');
    // CardView does NOT read the face theme (it is pure CSS via <html data-card-faces>).
    expect(cv).not.toContain('cardFaceStore');
  });

  it('ProfilePanel renders the card back + card faces pickers (no native <select>)', () => {
    const panel = read('src/ui/menu/ProfilePanel.tsx');
    expect(panel).toContain("t('profile.appearance')");
    expect(panel).toContain('cardface-picker');
    expect(panel).toContain('changeCardFace');
    expect(panel).not.toMatch(/<select[\s>]/);
  });
});
