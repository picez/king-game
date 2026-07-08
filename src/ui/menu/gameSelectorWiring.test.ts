import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lightweight wiring guard (no jsdom in this project): assert at the source level
// that the menu only lets you START what is actually playable, via the StartMenu's
// own GamePicker (the old standalone GameSelector component was removed in the
// Stage 10.9 cleanup — StartMenu never rendered it).
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('StartMenu — game chosen in the Host/Local sheets (Stage 9.9)', () => {
  const src = read('../StartMenu.tsx');

  it('initialises the selected game to the default (King)', () => {
    expect(src).toContain('useState<GameType>(DEFAULT_GAME_TYPE)');
  });
  it('does NOT render the big GameSelector on the main menu', () => {
    expect(src).not.toContain('<GameSelector');
    expect(src).not.toContain("from './menu/GameSelector'");
  });
  it('main "Play locally" opens the local sheet (game picked there)', () => {
    expect(src).toContain("onClick={() => setPane('local')}");
    expect(src).toContain('onClick={() => onLocal(gameType)}'); // local sheet start
    expect(src).toContain("t('menu.startLocal')");
  });
  it('exposes a compact King/Durak GamePicker (custom dropdown) used by Host + Local', () => {
    expect(src).toContain('function GamePicker(');
    expect(src).toContain('<GamePicker gameType={gameType} onPick={setGameType}');
    // The picker is a SelectMenu dropdown, not big segmented buttons.
    expect(src).toContain('<SelectMenu');
    expect(src).not.toMatch(/game-picker[^]*segmented__tab/); // no segmented inside the picker
  });
  it('hosts the selected game online, passing gameType + variant for Durak', () => {
    expect(src).toContain("gameType === 'durak' ? { gameType: 'durak' as const, variant: durakVariant }");
    expect(src).toContain('setDurakVariant');
  });
  it('shows the Durak variants subtitle and no Durak Experimental note (released, Stage 9.13)', () => {
    expect(src).toMatch(/durak\.variantsShort/);     // Simple · Transfer subtitle kept
    expect(src).not.toMatch(/durak\.onlineExperimentalNote/); // Durak Experimental note removed
    // Durak's own option is subtitled with its variants, never "Experimental".
    expect(src).toContain("t('gameType.durak'), sublabel: t('durak.variantsShort')");
    // (Tarneeb is released as of Stage 10.8 — no Experimental tag in the picker;
    // menu.experimental is now only the generic GameSelector fallback for any
    // future experimental game.)
  });
});

describe('App routing — local Durak goes to its own screen', () => {
  const src = read('../../App.tsx');
  it("routes gameType==='durak' to DurakLocalGame and keeps King on LocalGame", () => {
    expect(src).toContain("mode.gameType === 'durak'");
    expect(src).toContain('<DurakLocalGame');
    expect(src).toContain('<LocalGame />');
  });
});
