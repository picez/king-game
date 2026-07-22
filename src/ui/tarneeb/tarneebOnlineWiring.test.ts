import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-level guards (no jsdom): the online Tarneeb wiring routes through the
// dedicated adapter, stays client-only (no server/ws/db imports), and drives the
// server-authoritative path (dispatch → ACTION_REQUEST) — the server owns bots +
// the hand_complete advance.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('OnlineGame routes Tarneeb to its own adapter (Stage 10.5)', () => {
  const online = read('../online/OnlineGame.tsx');
  it("renders TarneebOnlineGame when room.gameType === 'tarneeb' (not the King GameRouter)", () => {
    expect(online).toContain("net.room?.gameType === 'tarneeb'");
    expect(online).toContain('<TarneebOnlineGame');
    expect(online).toContain("import TarneebOnlineGame from '../tarneeb/TarneebOnlineGame'");
    // Social overlay is rendered alongside the board — but WITHOUT the Leave-game
    // pill (Tarneeb's full-width action bars would collide with it; the ✕ exits).
    // Stage 29.7: the per-turn timer rides in the social cluster (3rd arg), no Leave pill (2nd = undefined).
    expect(online).toContain('renderSocial(true, undefined, timerEl)');
  });
});

describe('TarneebOnlineGame is a thin, client-only, server-authoritative adapter', () => {
  const adapter = read('./TarneebOnlineGame.tsx');
  it('reuses TarneebGameScreen in online mode and dispatches over the network', () => {
    expect(adapter).toContain('TarneebGameScreen');
    expect(adapter).toContain('apply={dispatch}'); // actions go over the wire
    expect(adapter).toContain('online');           // read-only-when-not-my-turn flag
    expect(adapter).toContain('disconnectedSeats');
    // It owns the finished screen (wrapper never drives Tarneeb's finish).
    expect(adapter).toContain('TarneebFinished');
  });
  it('imports nothing from the server / ws / db (client bundle stays clean)', () => {
    const importLines = adapter.split('\n').filter((l) => l.trimStart().startsWith('import'));
    for (const line of importLines) {
      expect(line).not.toMatch(/serverCore|wsHandlers|\/server|\/net\/transport|\bws\b|\/db\b/i);
    }
    // Must NOT own any reducer/bot loop — the server is authoritative online.
    expect(adapter).not.toContain('tarneebReducer');
    expect(adapter).not.toContain('tarneebBotAction');
  });
});

describe('Lobby labels a Tarneeb room by its partnership, not a King mode (Stage 10.7/10.8)', () => {
  const lobby = read('../online/Lobby.tsx');
  it("shows the Tarneeb mode label (Pairs/Solo) instead of dealer's-choice/fixed-order", () => {
    // A dedicated Tarneeb branch — Tarneeb has no King-style mode selection, so it
    // must NOT fall through to the dealerChoice/fixedOrder label. Stage 28.4: the
    // label now reflects the room's Pairs/Solo variant.
    expect(lobby).toContain("room.gameType === 'tarneeb'");
    expect(lobby).toContain("room.tarneebVariant === 'solo' ? 'tarneeb.modeSolo' : 'tarneeb.modePairs'");
    // The King mode label stays the final fallback (King behaviour unchanged).
    expect(lobby).toContain("room.modeSelectionType === 'dealer_choice' ? t('form.dealerChoice') : t('form.fixedOrder')");
  });
});

describe('StartMenu can host Tarneeb online (released, Stage 10.8)', () => {
  const menu = read('../StartMenu.tsx');
  it("sends gameType 'tarneeb' on create with a plain (non-experimental) picker entry", () => {
    // Stage 28.4: host also threads the Tarneeb Pairs/Solo variant.
    expect(menu).toContain("buildCreateIntent(");
    expect(menu).toContain("tarneebVariant, tarneebTargetScore"); // Tarneeb options ride along in the shared builder (Stage 37.6)
    // The picker subtitle for Tarneeb comes from the data-driven GAME_META_KEY map;
    // Stage 28.5 makes it mode-neutral (Pairs / Solo) now that both modes ship.
    expect(menu).toContain("tarneeb: 'tarneeb.modesShort'");
    // No Experimental tag or beta note remains for Tarneeb.
    expect(menu).not.toContain("sublabel: t('menu.experimental')");
    expect(menu).not.toContain("t('tarneeb.onlineBeta')");
  });
});
