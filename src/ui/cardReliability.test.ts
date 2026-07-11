// Source guards for the Stage 25.8 card-reliability fix: a card face NEVER stays blank when its
// artwork is slow / stalled / broken — the rank+suit text fallback shows until the image actually
// paints (onLoad), and a load error drops back to text. (Component render tests aren't possible in
// the node test env, so these assert the structural guarantees in the source.)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const card = read('src/ui/components/CardView.tsx');

describe('CardView — no blank face on a slow/broken image', () => {
  it('hides the text fallback ONLY once the art has actually loaded (not merely intended)', () => {
    // showArt (which applies .card--art → hides the text layer via CSS) requires artLoaded.
    expect(card).toMatch(/showArt\s*=\s*attemptArt\s*&&\s*artLoaded/);
  });

  it('the <img> reports load AND error, so a real failure reverts to text', () => {
    expect(card).toContain('onLoad={() => setArtLoaded(true)}');
    expect(card).toContain('onError={() => setArtFailed(true)}');
  });

  it('resets load state when the card art changes (list reuse never inherits a stale blank)', () => {
    expect(card).toMatch(/setArtFailed\(false\);\s*setArtLoaded\(false\);\s*\},\s*\[artUrl\]/);
  });

  it('always renders the rank/suit text layer (the a11y + fallback layer)', () => {
    expect(card).toContain('card__corner');
    expect(card).toContain('card__center');
    // It is NOT conditional on the image — it is always in the tree, hidden by CSS only when art shows.
    expect(card).not.toMatch(/showArt\s*&&\s*\(\s*<span className="card__corner/);
  });

  it('does not lazy-load the face art (visible cards must paint promptly)', () => {
    const imgBlock = card.slice(card.indexOf('className="card__art"'), card.indexOf('className="card__art"') + 260);
    expect(imgBlock).not.toContain("loading=\"lazy\"");
  });
});
