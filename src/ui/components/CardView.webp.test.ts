// Source guard (Stage 12.9.1; styled in 13.0): the hidden/redacted CardView image
// prefers the WebP card back via a <picture><source type="image/webp"> while
// keeping the PNG <img> as the universal fallback and the onError -> CSS-back
// escape hatch. The back URLs are now derived from the SELECTED style.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src', 'ui', 'components', 'CardView.tsx'), 'utf8');

describe('CardView prefers WebP card back with a PNG fallback', () => {
  it('wraps the hidden-card image in a <picture> with a WebP <source>', () => {
    expect(SRC).toContain('<picture>');
    expect(SRC).toContain('type="image/webp"');
    expect(SRC).toContain('srcSet={cardBackWebpUrl(backStyle)}');
  });

  it('keeps the PNG <img> fallback derived from the selected style', () => {
    expect(SRC).toContain('src={cardBackUrl(backStyle)}');
  });

  it('reads the selected card-back style from the store', () => {
    expect(SRC).toContain('useCardBackStyle');
  });

  it('retains the onError escape hatch to the CSS card back', () => {
    expect(SRC).toContain('onError={() => setBackFailed(true)}');
  });
});
