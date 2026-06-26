import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lightweight wiring guard (no jsdom in this project): assert at the source level
// that the menu game selector only lets you select a fully-playable game. This
// catches a regression where Durak (coming_soon) becomes startable before its
// UI/online integration exists.
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('GameSelector — only available games are selectable', () => {
  const src = read('./GameSelector.tsx');

  it('gates selection on the "available" status', () => {
    expect(src).toContain("const playable = g.status === 'available'");
  });
  it('disables non-playable chips and never selects them', () => {
    expect(src).toContain('disabled={!playable}');
    expect(src).toContain('onClick={playable ? () => onSelect(g.id) : undefined}');
    expect(src).toContain('game-chip--disabled');
  });
  it('labels non-playable games as coming soon', () => {
    expect(src).toMatch(/menu\.comingSoon/);
  });
});

describe('StartMenu defaults to King and never starts a non-King game (skeleton)', () => {
  const src = read('../StartMenu.tsx');
  it('initialises the selected game to the default (King)', () => {
    expect(src).toContain('useState<GameType>(DEFAULT_GAME_TYPE)');
  });
});
