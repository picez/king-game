import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Lightweight wiring guard (no jsdom in this project): assert at the source level
// that the room-social overlay is mounted at the ONLINE level for every in-room
// state and is NEVER mounted in local pass-and-play. This catches a regression
// where chat/reactions silently stop appearing during the actual game.
function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
}

describe('room-social wiring', () => {
  const online = read('./OnlineGame.tsx');
  const local = read('../LocalGame.tsx');

  it('OnlineGame imports + renders the RoomSocial overlay', () => {
    expect(online).toContain("import RoomSocial from './RoomSocial'");
    expect(online).toMatch(/renderSocial\s*=\s*\(/); // a single overlay factory
  });

  it('renders social in EVERY in-room branch (lobby, dealing, game)', () => {
    // Three render sites: lobby, the "dealing" wait, and the in-game view.
    const calls = online.match(/renderSocial\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('lifts the controls above the hand on the playing screen', () => {
    expect(online).toContain("renderSocial(status === 'playing'");
  });

  it('LocalGame does NOT render the room-social overlay (online-only)', () => {
    expect(local).not.toContain('RoomSocial');
  });
});

describe('active-game "Leave game" wiring', () => {
  const online = read('./OnlineGame.tsx');
  const social = read('./RoomSocial.tsx');

  it('uses backToMenu (keeps Resume), NOT leave (removes member)', () => {
    expect(online).toMatch(/leaveGameToMenu\s*=\s*\(\)\s*=>\s*\{\s*net\.backToMenu\(\);\s*onExit\(\);/);
  });

  it('passes Leave game to the overlay during the game + dealing, but NOT the lobby', () => {
    expect(online).toContain('renderSocial(false, leaveGameToMenu)');               // dealing
    expect(online).toContain("renderSocial(status === 'playing', leaveGameToMenu)"); // in-game
    expect(online).toMatch(/renderSocial\(false\)\}/);                               // lobby: no leave arg
  });

  it('RoomSocial shows the Leave game action only when onLeaveGame is provided', () => {
    expect(social).toContain('onLeaveGame');
    expect(social).toContain('social-leave');
    expect(social).toContain("t('online.leaveGame')");
    expect(social).toMatch(/\{onLeaveGame && \(/);  // gated on the prop (active game only)
  });
});
