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

  it('initialises the selected game to the favorite (King fallback, Stage 13.3)', () => {
    expect(src).toContain('useState<GameType>(() => loadFavoriteGame())');
  });
  it('does NOT render the big GameSelector on the main menu', () => {
    expect(src).not.toContain('<GameSelector');
    expect(src).not.toContain("from './menu/GameSelector'");
  });
  it('main "Play locally" opens the local sheet, seeding the picker from the favorite', () => {
    expect(src).toContain('onClick={openLocal}');
    expect(src).toContain("function openLocal() { setGameType(favoriteGame); setPane('local'); }");
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
  it('shows Preferans as a DISABLED coming-soon option (not startable), data-driven from the catalog', () => {
    // The picker iterates GAME_TYPES and disables any non-`available` game (Stage 19.2:
    // Preferans is coming_soon), so King/Durak/Deberc/Tarneeb stay selectable but
    // Preferans is shown disabled and cannot be picked/started.
    expect(src).toContain('const soon = GAME_CATALOG[id].status !== \'available\'');
    expect(src).toContain('disabled: soon');
    expect(src).toContain("t('menu.comingSoon')");
    // It is not hardcoded to the old 4-game list anymore.
    expect(src).not.toContain("(['king', 'durak', 'deberc', 'tarneeb'] as const).map((id) => ({");
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

  it('picker subtitles are data-driven from the catalog player counts (over GAME_TYPES)', () => {
    // A single data-driven map over ALL game types (Stage 19.2), not per-game literals.
    expect(src).toContain('export function playersRange');
    expect(src).toContain('const options = GAME_TYPES.map((id) => {');
    expect(src).toContain('t(GAME_META_KEY[id])'); // available games keep their meta subtitle
  });

  it('the room browser shows a per-game icon + name (and a Tarneeb teams hint)', () => {
    // Stage 12.3: the per-game emblem is now an image (GameIcon) in the .sb-game__icon
    // slot, with an emoji fallback — replacing the bare GAME_ICON[gameType] glyph.
    expect(src).toContain('sb-game__icon');
    expect(src).toContain('<GameIcon game={gameType} size="sm" className="sb-game__icon" />');
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
    // Still shows the per-game icon in each row (Stage 11.2 preserved; the glyph
    // became a GameIcon image with an emoji fallback in Stage 12.3).
    expect(src).toContain('<GameIcon game={gameType}');
  });
});

describe('room browser auto-refresh + stale UX (Stage 11.4)', () => {
  const src = read('../StartMenu.tsx');
  it('auto-refreshes on an interval while the Join pane is open, with cleanup', () => {
    expect(src).toContain("if (pane !== 'join') return;");
    expect(src).toContain('setInterval(() => roomList.refresh(url), ROOM_AUTO_REFRESH_MS)');
    expect(src).toContain('return () => clearInterval(id);');
  });
  it('shows a relative "last updated" label driven by a local tick (no server hit)', () => {
    expect(src).toContain('roomListAgo(roomList.lastUpdatedAt, nowTick)');
    expect(src).toContain('setNowTick(Date.now())');
    expect(src).toContain('className="room-updated"');
  });
  it('keeps the last list + soft-warns on a failed refresh (no hard clear)', () => {
    expect(src).toContain('room-stale');
    expect(src).toContain("t('join.staleWarning')");
    // Hard error only when there is nothing to show.
    expect(src).toContain('roomList.rooms.length > 0');
  });
  it('does NOT reset the filter/sort on an auto-refresh tick', () => {
    // The auto-refresh effect only calls refresh — it must not touch the view state.
    const effect = src.slice(src.indexOf('const id = setInterval(() => roomList.refresh(url)'));
    const firstReturn = effect.slice(0, effect.indexOf('}, [pane, url, roomList.refresh]'));
    expect(firstReturn).not.toContain('setGameFilter');
    expect(firstReturn).not.toContain('setRoomSort');
  });
});

describe('Lobby shows the game + start-disabled reason (Stage 11.2)', () => {
  const src = read('../online/Lobby.tsx');
  it('labels the room game and a team partnership hint (Stage 18.0)', () => {
    expect(src).toContain("room.gameType === 'tarneeb'");
    expect(src).toContain('lobby-teams-hint');
    expect(src).toContain("t('lobby.partnerHint')");        // team layout hint (was tarneeb.teamsHint)
  });
  it('the Start button reports how many more players are needed', () => {
    expect(src).toContain('minPlayers - players.length');
    expect(src).toContain("t('lobby.waitingMore')");
  });
});
