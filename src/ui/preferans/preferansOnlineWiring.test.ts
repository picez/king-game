import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-level guards (no jsdom): the online Preferans wiring routes through the
// dedicated adapter, stays client-only (no server/ws/db imports), and drives the
// server-authoritative path (dispatch → ACTION_REQUEST) — the server owns bots +
// the hand_complete advance. Mirrors tarneebOnlineWiring.test.ts.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('OnlineGame routes Preferans to its own adapter (Stage 19.5)', () => {
  const online = read('../online/OnlineGame.tsx');
  it("renders PreferansOnlineGame when room.gameType === 'preferans' (not the King GameRouter)", () => {
    expect(online).toContain("net.room?.gameType === 'preferans'");
    expect(online).toContain('<PreferansOnlineGame');
    expect(online).toContain("import PreferansOnlineGame from '../preferans/PreferansOnlineGame'");
    // Social overlay is rendered alongside the board (compact corner, no Leave pill).
    expect(online).toContain('renderSocial(true)');
  });
});

describe('PreferansOnlineGame is a thin, client-only, server-authoritative adapter', () => {
  const adapter = read('./PreferansOnlineGame.tsx');
  it('reuses PreferansGameScreen in online mode and dispatches over the network', () => {
    expect(adapter).toContain('PreferansGameScreen');
    expect(adapter).toContain('apply={dispatch}'); // actions go over the wire
    expect(adapter).toContain('online');           // read-only-when-not-my-turn flag
    expect(adapter).toContain('disconnectedSeats');
    // It owns the finished screen (wrapper never drives Preferans's finish).
    expect(adapter).toContain('PreferansFinished');
  });
  it('imports nothing from the server / ws / db and owns no reducer/bot loop', () => {
    const importLines = adapter.split('\n').filter((l) => l.trimStart().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/serverCore|wsHandlers|\/server|\/net\/transport|\bws\b|\/db\b/i);
    }
    // The server is authoritative online — no local reducer/bot.
    expect(adapter).not.toContain('preferansReducer');
    expect(adapter).not.toContain('preferansBotAction');
  });
});

describe('PreferansGameScreen supports online (read-only) mode (Stage 19.5)', () => {
  const screen = read('./PreferansGameScreen.tsx');
  it('accepts online + disconnectedSeats, hides "Next hand" online, shows offline hints', () => {
    expect(screen).toContain('online = false');
    expect(screen).toContain('disconnectedSeats');
    expect(screen).toContain('preferans-screen--online');
    // Online: the server auto-advances the hand, so the Next-hand button is a note.
    expect(screen).toContain("t('preferans.nextHandSoon')");
    // Offline opponent hints (a human dropped → AI may substitute).
    expect(screen).toContain("t('preferans.offlineAI')");
  });
});

describe('StartMenu hosts Preferans online as experimental (Stage 19.5)', () => {
  const menu = read('../StartMenu.tsx');
  it("host() sends gameType 'preferans' and the Host sheet flags it experimental", () => {
    expect(menu).toContain("gameType === 'preferans' ? { gameType: 'preferans' as const }");
    expect(menu).toContain("t('preferans.onlineExperimental')");
    // The generic supportsOnline guard stays (now passes for Preferans).
    expect(menu).toContain('if (!GAME_CATALOG[gameType].supportsOnline) return;');
  });
});
