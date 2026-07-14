import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-level guards (no jsdom): the online 51 wiring routes through the dedicated
// adapter, stays client-only (no server/ws/db imports, no local reducer/bot loop),
// and drives the server-authoritative path (dispatch → ACTION_REQUEST) — the server
// owns bots + the round_complete advance (seeded START_NEXT_ROUND). Mirrors
// tarneebOnlineWiring.test.ts. Stage 30.5 (online); released 30.7.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('OnlineGame routes 51 to its own adapter (Stage 30.5)', () => {
  const online = read('../online/OnlineGame.tsx');
  it("renders FiftyOneOnlineGame when room.gameType === 'fifty-one' (not the King GameRouter)", () => {
    expect(online).toContain("net.room?.gameType === 'fifty-one'");
    expect(online).toContain('<FiftyOneOnlineGame');
    expect(online).toContain("import FiftyOneOnlineGame from '../fiftyOne/FiftyOneOnlineGame'");
    // Social overlay rides alongside the board WITHOUT the Leave-game pill (the board
    // ✕ exits, reconnectable); Stage 29.7 timer rides in the social cluster (3rd arg).
    expect(online).toContain('renderSocial(true, undefined, timerEl)');
  });
});

describe('FiftyOneOnlineGame is a thin, client-only, server-authoritative adapter', () => {
  const adapter = read('./FiftyOneOnlineGame.tsx');
  it('reuses FiftyOneGameScreen in online mode and dispatches over the network', () => {
    expect(adapter).toContain('FiftyOneGameScreen');
    expect(adapter).toContain('apply={dispatch}'); // actions go over the wire (ACTION_REQUEST)
    expect(adapter).toMatch(/\bonline\b/);         // read-only-when-not-my-turn flag
    // It owns the finished screen (wrapper never drives 51's finish / rematch).
    expect(adapter).toContain('FiftyOneFinished');
    expect(adapter).toContain('rematch');
  });
  it('imports nothing from the server / ws / db and owns NO reducer/bot loop', () => {
    const importLines = adapter.split('\n').filter((l) => l.trimStart().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/serverCore|wsHandlers|\/server|\/net\/transport|\bws\b|\/db\b/i);
    }
    // The server is authoritative online — the adapter must not run the pure core.
    expect(adapter).not.toContain('fiftyOneReducer');
    expect(adapter).not.toContain('fiftyOneBotAction');
  });
});

describe('FiftyOneGameScreen defers the round advance to the server when online', () => {
  const screen = read('./FiftyOneGameScreen.tsx');
  it('online mode never dispatches START_NEXT_ROUND (server auto-advances); local does', () => {
    // The round-over overlay wires onNext to the local dispatch ONLY when not online;
    // online passes undefined so the client can't spoof the seeded server redeal.
    expect(screen).toContain("online ? undefined : () => apply({ type: 'START_NEXT_ROUND' })");
    // A waiting note replaces the button when there is no onNext (online).
    expect(screen).toContain('fiftyOne.nextRoundSoon');
  });
});

describe('StartMenu + Lobby host + label a 51 room (Stage 30.5)', () => {
  it("StartMenu sends gameType 'fifty-one' on create (else it would default to King)", () => {
    const menu = read('../StartMenu.tsx');
    expect(menu).toContain("gameType === 'fifty-one' ? { gameType: 'fifty-one' as const }");
  });
  it('Lobby labels a 51 room by its Rummy meta, not a King dealer-choice/fixed-order term', () => {
    const lobby = read('../online/Lobby.tsx');
    expect(lobby).toContain("room.gameType === 'fifty-one'");
    expect(lobby).toContain("t('fiftyOne.metaShort')");
  });
});
