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
    // Durak's picker subtitle comes from the data-driven GAME_META_KEY map
    // (Stage 11.2), never an "Experimental" tag.
    expect(src).toContain("durak: 'durak.variantsShort'");
    expect(src).not.toMatch(/sublabel: t\('menu\.experimental'\)/);
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

describe('multi-game menu polish (Stage 11.2)', () => {
  const src = read('../StartMenu.tsx');

  it('picker subtitles are data-driven from the catalog player counts (all 4 games)', () => {
    // A single data-driven map over the four game types, not per-game literals.
    expect(src).toContain('export function playersRange');
    expect(src).toContain("(['king', 'durak', 'deberc', 'tarneeb'] as const).map");
    expect(src).toContain('sublabel: `👥 ${playersRange(id)} · ${t(GAME_META_KEY[id])}`');
  });

  it('the room browser shows a per-game icon + name (and a Tarneeb teams hint)', () => {
    expect(src).toContain('sb-game__icon');
    expect(src).toContain('GAME_ICON[gameType]');
    expect(src).toContain("gameType === 'tarneeb' ? <span className=\"sb-variant\"> · {t('tarneeb.twoTeams')}");
  });

  it('the Host sheet renders ONLY the selected game’s settings (no cross-game leak)', () => {
    // Each setting block is gated on the exact gameType.
    expect(src).toContain("gameType === 'durak' && (");
    expect(src).toContain("gameType === 'deberc' && (");
    expect(src).toContain("gameType === 'king' && (");
    // Tarneeb shows just its tagline — no King mode / Durak variant / Deberc match control.
    expect(src).toMatch(/gameType === 'tarneeb' && \([^]*tarneeb\.setupTagline/);
  });
});

describe('room browser filters + sorting (Stage 11.3)', () => {
  const src = read('../StartMenu.tsx');
  it('renders a game filter bar and a sort control', () => {
    expect(src).toContain('room-filter-bar');
    expect(src).toContain('room-filter__chip');
    expect(src).toContain("aria-label={t('join.filterGame')}");
    expect(src).toContain("ariaLabel={t('join.sortBy')}");
  });
  it('derives the rendered rooms from filter+sort helpers (client-only view)', () => {
    expect(src).toContain("from './menu/roomBrowser'");
    expect(src).toContain('sortRooms(filterRooms(roomList.rooms, gameFilter), roomSort)');
    // The browser maps the derived list, not the raw hook rooms.
    expect(src).toContain('visibleRooms.map((r) =>');
    // Friendly empty state when a filter matches nothing.
    expect(src).toContain("t('join.noRoomsForGame')");
    // Still shows the per-game icon in each row (Stage 11.2 preserved).
    expect(src).toContain('GAME_ICON[gameType]');
  });
});

describe('Lobby shows the game + start-disabled reason (Stage 11.2)', () => {
  const src = read('../online/Lobby.tsx');
  it('labels the room game and a Tarneeb partnership hint', () => {
    expect(src).toContain("room.gameType === 'tarneeb'");
    expect(src).toContain('lobby-teams-hint');
    expect(src).toContain("t('tarneeb.teamsHint')");
  });
  it('the Start button reports how many more players are needed', () => {
    expect(src).toContain('minPlayers - players.length');
    expect(src).toContain("t('lobby.waitingMore')");
  });
});
