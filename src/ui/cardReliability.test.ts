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
    expect(card).toContain('onLoad={() => setLoadedUrl(artUrl)}');
    expect(card).toContain('onError={() => setFailedUrl(artUrl)}');
  });

  it('load state is keyed by URL, so list reuse never inherits a stale blank', () => {
    expect(card).toContain('const artLoaded = artUrl !== null && loadedUrl === artUrl;');
    expect(card).toContain('const artFailed = artUrl !== null && failedUrl === artUrl;');
  });

  it('(Stage 39.4) NOTHING resets "loaded" after the fact — the text layer cannot reappear over painted art', () => {
    // The owner's "cards overlap" bug: a `useEffect([artUrl])` reset ran AFTER a cached
    // image had already fired `load`, taking `.card--art` off a card whose artwork was on
    // screen — so the fallback glyphs drew on top of it.
    expect(card).not.toContain('setLoadedUrl(null)');
    expect(card).not.toContain('setArtLoaded');
    // Every write to the loaded URL is a positive "this URL has painted".
    const writes = card.match(/setLoadedUrl\([^)]*\)/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w).toBe('setLoadedUrl(artUrl)');
  });

  it('(Stage 39.4) an image that was complete before onLoad attached is still noticed', () => {
    expect(card).toContain('img.complete && img.naturalWidth > 0) setLoadedUrl(artUrl)');
    expect(card).toContain('ref={artRef}');
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
