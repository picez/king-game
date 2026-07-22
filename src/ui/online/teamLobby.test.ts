import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../i18n/dictionaries/en';

// Stage 18.0 — team lobby UX for Deberc + Tarneeb. Source-level contract (no
// testing-library): the team layout is presentational only — seat order, the start
// gate, add-bot, kick, and King/Durak behaviour are unchanged.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const lb = read('src/ui/online/Lobby.tsx');

describe('team lobby applies to Deberc + Tarneeb only', () => {
  it('treats tarneeb AND deberc as the 2×2 team games', () => {
    expect(lb).toContain("const isTeamGame = gameType === 'tarneeb' || gameType === 'deberc'");
  });
  it('does NOT change actual seat assignment/order (parity link only)', () => {
    // Team membership is derived from seat parity; there is no re-sort/reassignment.
    expect(lb).toContain('s % 2 === myTeam');
    expect(lb).not.toMatch(/\.sort\(/);
    expect(lb).not.toMatch(/seatIndex\s*=\s*[^=]/); // never assigns a seat (allows ===)
  });
});

describe('team seats: A = 0&2, B = 1&3, with empty + partner/you markers', () => {
  it('lays out the two teams from fixed seat pairs', () => {
    expect(lb).toContain('team === 0 ? [0, 2] : [1, 3]');
    expect(lb).toContain("'lobby.teamA'");
    expect(lb).toContain("'lobby.teamB'");
    expect(lb).toContain('lobby-team--mine');       // viewer's team highlighted
  });
  it('renders empty seats + you/partner role chips', () => {
    expect(lb).toContain('lobby-seat--empty');
    expect(lb).toContain("t('lobby.emptySeat')");
    expect(lb).toContain("s === mySeat ? t('lobby.you')");
    expect(lb).toContain("t('lobby.partner')");
  });
  it('shows the partnership hint + the Deberc 3-vs-4 note', () => {
    expect(lb).toContain("t('lobby.partnerHint')");
    expect(lb).toContain("gameType === 'deberc' && <p");
    expect(lb).toContain("t('lobby.debercTeams')");
  });
});

describe('avatars: seats reuse SeatAvatar (uploaded image + emoji fallback)', () => {
  it('team seats + flat list both use SeatAvatar with the same props', () => {
    const uses = lb.match(/<SeatAvatar emoji=\{m\.avatar\} imageUrl=\{m\.avatarImageUrl\}/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2); // team layout + flat list
  });
});

describe('start readiness adapts, but the gate + add-bot are unchanged', () => {
  it('Tarneeb strictly needs 4; Deberc keeps its min (3 = each for self)', () => {
    expect(lb).toContain("const strictTeams = gameType === 'tarneeb'");
    expect(lb).toContain("teamsFull ? t('lobby.teamsReady')");
    expect(lb).toContain("t('lobby.needTeams')");           // Tarneeb waiting label
    // The server-min gate is unchanged; a frozen Poker recovery room ALSO disables Start (37.7.5).
    expect(lb).toContain("disabled={!enough || room.pokerRecovery === 'frozen'}");
  });
  it('add-bot + kick + timer are all still wired', () => {
    expect(lb).toContain('onAddBot');
    expect(lb).toContain('handleKick');
    expect(lb).toContain('onSetTimer');
  });
});

describe('King / Durak are NOT team games (flat member list, no team labels)', () => {
  it('the team branch is gated so King/Durak render the flat list', () => {
    expect(lb).toContain('showTeamGrid ? (');
    expect(lb).toContain('<ul className="lobby-members">'); // the non-team fallback list
    // King/Durak must never hit a team label.
    expect(lb).not.toContain("gameType === 'king' ? t('lobby.teamA')");
  });
});

describe('Deberc Solo (3p) renders individual seats, NOT the team grid (Stage 28.2)', () => {
  it('the team grid is disabled for a 3-seat Deberc room', () => {
    expect(lb).toContain("const debercSolo = gameType === 'deberc' && maxPlayers === 3");
    expect(lb).toContain('const showTeamGrid = isTeamGame && !soloSeating');
  });
  it('a 3p Deberc room shows the every-player-for-self hint (not the partner hint)', () => {
    expect(lb).toContain("soloSeating && <p");
    expect(lb).toContain("t('lobby.debercSoloHint')");
  });
  it('the seat cap + start-gate come from the room player count (3 Solo / 4 Pairs)', () => {
    expect(lb).toContain('const maxPlayers = room.playerCount');
    expect(lb).toContain("const needed = gameType === 'deberc' ? maxPlayers : minPlayers");
  });
  it('Pairs (4p) still uses the Team A/B grid + partner hint', () => {
    // The 2×2 grid and partner labels are untouched for the 4-seat game.
    expect(lb).toContain('team === 0 ? [0, 2] : [1, 3]');
    expect(lb).toContain("t('lobby.partnerHint')");
  });
});

describe('i18n parity for the new team-lobby keys', () => {
  const KEYS = [
    'lobby.teamA', 'lobby.teamB', 'lobby.yourTeam', 'lobby.partner', 'lobby.emptySeat',
    'lobby.partnerHint', 'lobby.needTeams', 'lobby.teamsReady', 'lobby.debercTeams',
    'lobby.debercSolo', 'lobby.debercPairs', 'lobby.debercSoloHint',
  ];
  const dicts = ['en', 'uk', 'de', 'ar'].map((l) => read(join('src/i18n/dictionaries', `${l}.ts`)));
  for (const key of KEYS) {
    it(`${key} present + non-blank in every language`, () => {
      expect(EN[key as keyof typeof EN], `EN missing ${key}`).toBeTruthy();
      for (const d of dicts) expect(d, `dict missing ${key}`).toContain(`'${key}'`);
    });
  }
});
