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
    expect(online).toContain("renderSocial(status === 'playing')");
  });

  it('LocalGame does NOT render the room-social overlay (online-only)', () => {
    expect(local).not.toContain('RoomSocial');
  });
});
