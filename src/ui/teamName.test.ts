import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { teamDisplayName, pairTeamSeats } from './teamName';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// A tiny `t` stub: `team.named` → "Team {name}"; fallbacks echo the key's tail.
const t = (key: string) => (key === 'team.named' ? 'Team {name}' : key === 'lobby.teamA' ? 'Team A' : 'Team B');

describe('pairTeamSeats', () => {
  it('maps team 0 → seats 0 & 2 and team 1 → seats 1 & 3', () => {
    expect(pairTeamSeats(0)).toEqual([0, 2]);
    expect(pairTeamSeats(1)).toEqual([1, 3]);
  });
});

describe('teamDisplayName', () => {
  const names: Record<number, string | null> = { 0: 'Alex', 1: 'Niko', 2: 'Dina', 3: 'Yara' };
  const nameOf = (s: number) => names[s];

  it('joins both partners by name for a full pair', () => {
    expect(teamDisplayName([0, 2], nameOf, t, 'lobby.teamA')).toBe('Alex & Dina');
    expect(teamDisplayName([1, 3], nameOf, t, 'lobby.teamB')).toBe('Niko & Yara');
  });

  it('falls back to "Team <name>" when only one partner is known (empty/bot seat)', () => {
    expect(teamDisplayName([0, 2], (s) => (s === 0 ? 'Alex' : null), t, 'lobby.teamA')).toBe('Team Alex');
  });

  it('falls back to the localized Team A/B when no name is known yet', () => {
    expect(teamDisplayName([0, 2], () => null, t, 'lobby.teamA')).toBe('Team A');
    expect(teamDisplayName([1, 3], () => '', t, 'lobby.teamB')).toBe('Team B');
  });

  it('skips blank names and trims', () => {
    expect(teamDisplayName([0, 2], (s) => (s === 0 ? '  Alex ' : '   '), t, 'lobby.teamA')).toBe('Team Alex');
  });
});

describe('team names are wired into the pairs UIs (and NOT solo)', () => {
  it('the lobby team grid names each pair (only shown for pairs — solo → flat seats)', () => {
    const src = read('src/ui/online/Lobby.tsx');
    expect(src).toContain('teamDisplayName(seats');
    expect(src).toContain('showTeamGrid'); // solo seating skips the team grid entirely
  });

  it('Tarneeb pairs finished + HUD use named teams; solo keeps individual names', () => {
    const fin = read('src/ui/tarneeb/TarneebFinished.tsx');
    expect(fin).toContain('teamDisplayName(pairTeamSeats');   // pairs branch
    expect(fin).toContain('state.players[seat]?.name');        // named from players
    // Solo end screen shows individual player names, never a team label.
    expect(fin).toMatch(/SoloFinished[\s\S]*state\.players\[seat\]\?\.name/);
    const hud = read('src/ui/tarneeb/TarneebGameScreen.tsx');
    expect(hud).toContain('teamDisplayName(');
    // Solo HUD rows still use the seat's player name, not a team.
    expect(hud).toContain('state.players[r.seat as number].name');
  });

  it('Deberc already names its pairs by players (no abstract Team A/B in-game)', () => {
    const src = read('src/ui/deberc/DebercGameScreen.tsx');
    expect(src).toMatch(/teamOf\[p\.seatIndex\] === team[\s\S]*\.name\)\.join\(' & '\)/);
  });
});
