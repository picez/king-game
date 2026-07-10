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
  it('keeps the team partnership hint (Stage 18.0 — game-neutral)', () => {
    expect(lb).toContain('lobby-teams-hint');
    expect(lb).toContain("t('lobby.partnerHint')");
  });
});

describe('Lobby — team layout (Stage 18.0, cosmetic, seat order unchanged)', () => {
  const lb = read('src/ui/online/Lobby.tsx');
  it('groups Deberc + Tarneeb seats into Team A (0,2) / Team B (1,3) by seat parity', () => {
    expect(lb).toContain("gameType === 'tarneeb' || gameType === 'deberc'"); // both team games
    expect(lb).toContain('lobby-team--mine');                // viewer's team block
    expect(lb).toContain("'lobby.teamA'");
    expect(lb).toContain("'lobby.teamB'");
    expect(lb).toMatch(/\[0, 2\]/);                          // Team A seats
    expect(lb).toMatch(/\[1, 3\]/);                          // Team B seats
    expect(lb).toContain('s % 2 === myTeam');                // parity link, not reordering
  });
  it('shows empty seats + you/partner markers, and the team CSS exists', () => {
    expect(lb).toContain("t('lobby.emptySeat')");
    expect(lb).toContain("t('lobby.partner')");
    const css = read('src/styles/lobby.css');
    expect(css).toContain('.lobby-team--a');
    expect(css).toContain('.lobby-team--b');
    expect(css).toContain('.lobby-seat--empty');
  });
  it('adapts start readiness for teams without changing the gate', () => {
    expect(lb).toContain("t('lobby.needTeams')");            // Tarneeb waiting label
    expect(lb).toContain("t('lobby.teamsReady')");           // 4/4 label
    expect(lb).toContain("strictTeams = gameType === 'tarneeb'"); // Deberc keeps min=3
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
