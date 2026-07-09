// Source guard (Stage 13.0): the Profile panel renders a card-back style picker
// built from custom swatches (a radiogroup), NOT a native <select>, with a live
// mini-preview of each back, and wires changes through the store + prefs + server.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src', 'ui', 'menu', 'ProfilePanel.tsx'), 'utf8');

describe('ProfilePanel card-back selector', () => {
  it('renders a labelled radiogroup of swatches (custom UI, not a native select)', () => {
    expect(SRC).toContain("t('profile.cardBack')");
    expect(SRC).toContain('cardback-picker');
    expect(SRC).toContain('role="radiogroup"');
    expect(SRC).toContain('cardback-swatch');
    expect(SRC).not.toContain('<select');
  });

  it('shows a mini preview per style (picture + WebP source + PNG img)', () => {
    expect(SRC).toContain('CARD_BACK_STYLES.map');
    expect(SRC).toContain('cardBackWebpUrl(s)');
    expect(SRC).toContain('cardBackUrl(s)');
  });

  it('applies immediately (store), persists locally, and syncs to the server', () => {
    expect(SRC).toContain('setCardBackStyle(v)');
    expect(SRC).toContain('saveCardStyle(v)');
    expect(SRC).toContain('account.pushCardStyle(cardBackToSetting(v))');
  });
});
