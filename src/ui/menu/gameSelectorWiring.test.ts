import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lightweight wiring guard (no jsdom in this project): assert at the source level
// that the menu only lets you START what is actually playable — King online +
// Durak local-only — and never starts an online Durak game (Stage 9.3).
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('GameSelector — selectable vs disabled games', () => {
  const src = read('./GameSelector.tsx');

  it('lets you select available OR experimental (local) games', () => {
    expect(src).toContain("g.status === 'available' || g.status === 'experimental'");
  });
  it('disables non-selectable (coming_soon) chips and never selects them', () => {
    expect(src).toContain('disabled={!selectable}');
    expect(src).toContain('onClick={selectable ? () => onSelect(g.id) : undefined}');
    expect(src).toContain('game-chip--disabled');
  });
  it('labels experimental games as Experimental', () => {
    expect(src).toMatch(/menu\.experimental/);
  });
});

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
  it('exposes a compact King/Durak GamePicker used by Host + Local', () => {
    expect(src).toContain('function GamePicker(');
    expect(src).toContain('<GamePicker gameType={gameType} onPick={setGameType}');
  });
  it('hosts the selected game online, passing gameType + variant for Durak', () => {
    expect(src).toContain("gameType === 'durak' ? { gameType: 'durak' as const, variant: durakVariant }");
    expect(src).toContain('setDurakVariant');
  });
  it('marks online Durak as experimental', () => {
    expect(src).toMatch(/menu\.experimental/);
    expect(src).toMatch(/durak\.onlineExperimentalNote/);
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
