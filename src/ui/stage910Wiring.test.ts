import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-level guards for Stage 9.10 (no jsdom in this project): name editing only
// in Profile, no player-count picker, server-enforced capacity, and play-order
// seating for both games.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('display-name editing lives ONLY in the Profile', () => {
  const profile = read('./menu/ProfilePanel.tsx');
  const startMenu = read('./StartMenu.tsx');
  const lobby = read('./online/Lobby.tsx');

  it('ProfilePanel has the editable name input', () => {
    expect(profile).toContain('changeName(e.target.value)');
  });
  it('the Host/Join sheet shows the name read-only (no edit control)', () => {
    expect(startMenu).toContain('name-readonly');
    expect(startMenu).not.toContain('setName(e.target.value)');
    expect(startMenu).toContain("t('menu.nameInProfile')");
  });
  it('the Lobby has no name input at all', () => {
    expect(lobby).not.toContain('<input');
  });
});

describe('lobby player-count UX (Stage 9.10)', () => {
  const startMenu = read('./StartMenu.tsx');
  const lobby = read('./online/Lobby.tsx');
  const serverCore = read('../net/serverCore.ts');

  it('the Host sheet has NO player-count picker', () => {
    expect(startMenu).not.toContain('setPlayerCount');
    expect(startMenu).not.toContain("t('form.players')");
  });
  it('the Lobby starts at >= the needed count and caps at the room seat count', () => {
    expect(lobby).toContain('getGameCatalogEntry');
    // Stage 28.2: the start gate is `needed` (Deberc Solo/Pairs = full room; other
    // games = catalog minimum), and the seat cap is the room's own playerCount.
    expect(lobby).toContain('const enough = players.length >= needed');
    expect(lobby).toContain('players.length < maxPlayers');
    expect(lobby).toContain('const maxPlayers = room.playerCount');
  });
  it('the server enforces capacity + the start range from the catalog', () => {
    expect(serverCore).toContain('function roomCapacity');
    expect(serverCore).toContain('roomCapacity(room)');
    expect(serverCore).toContain('count < entry.minPlayers || count > entry.maxPlayers');
  });
});

describe('seating order follows play order (not mirrored for RTL)', () => {
  it('King seats are clockwise relative to the viewer at the bottom', () => {
    const tp = read('./components/TablePlayers.tsx');
    expect(tp).toContain('(seatIndex - viewerSeat + count) % count');
    expect(tp).toContain("['bottom', 'left', 'top', 'right']");
  });
  it('Durak opponents are ordered clockwise from the seat after me', () => {
    const durak = read('./durak/DurakGameScreen.tsx');
    expect(durak).toContain('(meSeat + 1 + k) % state.players.length');
  });
});
