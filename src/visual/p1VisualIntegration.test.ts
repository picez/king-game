// Guards for the Stage 12.8 P1 assets (ornamental finish frame + unified seat
// badges): the manifest + helper resolve them, the PNGs exist, and every finish
// screen / lobby tag / table turn-marker is wired to the frame/badge — while the
// lobby keeps its accessible host/bot/offline text labels.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VISUAL_ASSETS, seatBadgeSrc, type SeatBadge } from './visualAssets';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BADGES: SeatBadge[] = ['host', 'bot', 'offline', 'active'];

describe('P1 manifest + assets on disk', () => {
  it('registers the finish frame + 4 badges as present P1 entries', () => {
    for (const id of ['finish-frame', 'badge-host', 'badge-bot', 'badge-offline', 'badge-active']) {
      const a = VISUAL_ASSETS.find((x) => x.id === id);
      expect(a, id).toBeTruthy();
      expect(a!.priority).toBe('P1');
      expect(a!.present).toBe(true);
    }
  });
  it('seatBadgeSrc resolves each kind to /visual/badges', () => {
    for (const k of BADGES) expect(seatBadgeSrc(k)).toBe(`/visual/badges/badge-${k}.png`);
  });
  it('the frame + badge PNGs exist, are non-empty real PNGs', () => {
    const files = ['public/visual/finish-frame.png', ...BADGES.map((k) => `public/visual/badges/badge-${k}.png`)];
    for (const f of files) {
      const p = join(process.cwd(), f);
      expect(existsSync(p), f).toBe(true);
      expect(statSync(p).size, f).toBeGreaterThan(0);
      expect(readFileSync(p).subarray(0, 8).equals(PNG_SIG), f).toBe(true);
    }
  });
});

describe('P1 CSS single-source vars', () => {
  const base = read('src/styles/base.css');
  it('base.css defines --finish-frame and the four --badge-* vars', () => {
    expect(base).toContain("--finish-frame:  url('/visual/finish-frame.png')");
    for (const k of BADGES) expect(base).toContain(`--badge-${k}:`);
  });
});

describe('Finish screens wear the frame (all 4 games, graceful)', () => {
  it('each finish component adds the finish-frame class', () => {
    expect(read('src/ui/GameFinishedScreen.tsx')).toContain('finish-frame');
    expect(read('src/ui/durak/DurakFinished.tsx')).toContain('finish-frame');
    expect(read('src/ui/deberc/DebercFinished.tsx')).toContain('finish-frame');
    expect(read('src/ui/tarneeb/TarneebFinished.tsx')).toContain('finish-frame');
  });
  it('screens.css layers the frame behind content via var(--finish-frame)', () => {
    const css = read('src/styles/screens.css');
    expect(css).toContain('.finish-frame::before');
    expect(css).toContain('var(--finish-frame)');
    expect(css).toContain('z-index: -1'); // behind our own content
  });
});

describe('Seat badges wired (lobby tags + table turn) without losing labels', () => {
  const lobbyCss = read('src/styles/lobby.css');
  const tableCss = read('src/styles/table.css');
  const lobbyTsx = read('src/ui/online/Lobby.tsx');
  it('lobby host/bot/offline tags show the badge coin', () => {
    expect(lobbyCss).toContain('.tag--host::before { background-image: var(--badge-host); }');
    expect(lobbyCss).toContain('.tag--bot::before  { background-image: var(--badge-bot); }');
    expect(lobbyCss).toContain('.tag--off::before  { background-image: var(--badge-offline); }');
  });
  it('lobby keeps the accessible text labels (icons augment, never replace them)', () => {
    expect(lobbyTsx).toContain("t('lobby.host')");
    expect(lobbyTsx).toContain("t('lobby.bot')");
    expect(lobbyTsx).toContain("t('lobby.offline')");
    expect(lobbyTsx).toContain("title={t('lobby.aiPlayer')}"); // bot tag keeps its title
  });
  it('the King active-turn marker uses the active badge', () => {
    expect(tableCss).toContain('.tseat__turn');
    expect(tableCss).toContain('var(--badge-active)');
  });
});
