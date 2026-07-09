// Source guards for the Stage 12.4 lobby + room-browser polish. Pure string
// checks: assert the visual polish is wired AND — crucially — that no lobby
// behaviour (leave / kick / add-bot / timer / start, the disabled reason, the
// Tarneeb partnership hint) was dropped while restyling.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Lobby — behaviour preserved through the polish', () => {
  const lb = read('src/ui/online/Lobby.tsx');
  it('keeps Leave / Start(+disabled reason) / Add bot / Timer / Kick', () => {
    expect(lb).toContain('lobby-leave');
    expect(lb).toContain('onLeave');
    expect(lb).toContain('disabled={!enough}');
    expect(lb).toContain("t('wait.waitingFor')");            // start disabled reason
    expect(lb).toContain('onAddBot');
    expect(lb).toContain('onSetTimer');
    expect(lb).toContain('handleKick');                       // kick still wired
  });
  it('keeps the Tarneeb partnership hint', () => {
    expect(lb).toContain('lobby-teams-hint');
    expect(lb).toContain("t('tarneeb.teamsHint')");
  });
});

describe('Lobby — Tarneeb team-rail polish (cosmetic, seat order unchanged)', () => {
  const lb = read('src/ui/online/Lobby.tsx');
  it('tints partner vs opponent seats for Tarneeb by seat parity', () => {
    expect(lb).toContain("gameType === 'tarneeb'");
    expect(lb).toContain('lobby-member--partner');
    expect(lb).toContain('lobby-member--opponent');
    expect(lb).toMatch(/seatIndex % 2/);                      // parity, not reordering
  });
  it('the team rails are defined in CSS and yield to the offline rail', () => {
    const css = read('src/styles/lobby.css');
    expect(css).toContain('.lobby-member--partner:not(.lobby-member--offline)');
    expect(css).toContain('.lobby-member--opponent:not(.lobby-member--offline)');
  });
});

describe('Room browser — still renders identity/status/players + status rail', () => {
  const st = read('src/ui/StartMenu.tsx');
  it('renders the game emblem, name, players and status per row', () => {
    expect(st).toContain('<GameIcon game={gameType} size="sm" className="sb-game__icon" />');
    expect(st).toContain('sb-game__name');
    expect(st).toContain('{r.occupiedSeats}/{r.playerCount}');
    expect(st).toContain('room-list__status--');
  });
  it('adds a per-status class so the row can show its status rail', () => {
    expect(st).toContain('server-browser__row--${r.status}');
  });
  it('CSS defines the status rails', () => {
    const css = read('src/styles/table.css');
    for (const s of ['lobby', 'full', 'in_game']) {
      expect(css).toContain(`.server-browser__row--${s}`);
    }
  });
});
