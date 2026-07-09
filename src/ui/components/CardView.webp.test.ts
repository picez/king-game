// Source guard (Stage 12.9.1): the hidden/redacted CardView image prefers the
// WebP card back via a <picture><source type="image/webp"> while keeping the PNG
// <img> as the universal fallback and the onError -> CSS-back escape hatch.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src', 'ui', 'components', 'CardView.tsx'), 'utf8');

describe('CardView prefers WebP card back with a PNG fallback', () => {
  it('wraps the hidden-card image in a <picture> with a WebP <source>', () => {
    expect(SRC).toContain('<picture>');
    expect(SRC).toContain('type="image/webp"');
    expect(SRC).toContain('srcSet={CARD_BACK_WEBP_URL}');
  });

  it('keeps the PNG <img src={CARD_BACK_URL}> fallback', () => {
    expect(SRC).toContain('src={CARD_BACK_URL}');
  });

  it('retains the onError escape hatch to the CSS card back', () => {
    expect(SRC).toContain('onError={() => setBackFailed(true)}');
  });
});
