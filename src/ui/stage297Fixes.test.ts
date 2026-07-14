import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Stage 29.7 — Tarneeb table HUD redesign + timer relocated to the social cluster.
//   A) The per-turn timer rides inside the RoomSocial control cluster (next to
//      voice/emoji/chat), never as a table overlay.
//   B) Tarneeb's in-game HUD is a ranked <table> (sorted by total score) with a
//      bidder ▶+amount column, this-hand tricks, and total score — Solo lists the
//      4 players; Pairs the two teams. Logic is covered by tarneebScoreTable.test.ts.
// Source-level guards for the wiring; the ranking maths is unit-tested separately.
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Timer rides in the social cluster, not a table overlay (Scope A)', () => {
  const online = read('src/ui/online/OnlineGame.tsx');
  const social = read('src/ui/online/RoomSocial.tsx');
  const css = read('src/styles/game.css');

  it('OnlineGame threads the timer into RoomSocial via a timerSlot for all non-King games', () => {
    expect(online).toContain('timerSlot={timerSlot}');
    // durak, deberc, tarneeb, preferans + fifty-one (Stage 30.5 experimental online).
    expect((online.match(/renderSocial\([^)]*timerEl\)/g) ?? []).length).toBe(5);
    // The old fixed table overlay is gone.
    expect(online).not.toContain('turn-timer--overlay');
    expect(css).not.toContain('.turn-timer--overlay');
  });

  it('RoomSocial renders the timerSlot inside the .social-controls cluster', () => {
    expect(social).toMatch(/social-controls[\s\S]*\{timerSlot\}/);
  });

  it('the social timer pill flows (not position:fixed) and never blocks taps', () => {
    const pill = css.match(/\.turn-timer--social \{[^}]*\}/)?.[0] ?? '';
    expect(pill).toContain('pointer-events: none');
    expect(pill).not.toContain('position: fixed');
  });
});

describe('Tarneeb ranked score table (Scope B)', () => {
  const screen = read('src/ui/tarneeb/TarneebGameScreen.tsx');
  const css = read('src/styles/tarneeb.css');

  it('renders a real <table class="tarneeb-rank"> fed by the pure helper', () => {
    expect(screen).toContain('tarneebRankRows(state, humanSeat, actingSeat, blocked)');
    expect(screen).toMatch(/<table className=\{`tarneeb-rank/);
    expect(screen).toContain('<thead>');
    expect(screen).toContain('<tbody>');
  });

  it('has bid ▶+amount, tricks and score columns, and highlights me/turn/bidder/leader rows', () => {
    expect(screen).toContain('▶ {r.bidAmount}');
    expect(screen).toContain('{r.tricks}');
    expect(screen).toContain('{r.score}');
    expect(screen).toMatch(/r\.isMe \? ' is-me'/);
    expect(screen).toMatch(/r\.isTurn \? ' is-turn'/);
    expect(screen).toMatch(/r\.isBidder \? ' is-bidder'/);
    expect(screen).toMatch(/r\.isLeader \? ' is-leader'/);
    // Fixed-width columns so the table never overflows 360/390.
    expect(css).toContain('table-layout: fixed');
  });

  it('Solo rows use player names; Pairs rows keep the Us/Them team labels', () => {
    expect(screen).toContain('state.players[r.seat as number].name'); // solo
    expect(screen).toContain("t('tarneeb.teamUs')");                  // pairs
    expect(screen).toContain("t('tarneeb.teamThem')");
    // Solo never shows a "Team A/B" literal in the standings.
    expect(screen).not.toMatch(/Team [AB]/);
  });

  it('does not recompute scoring or read hidden hands in the HUD helper', () => {
    const helper = read('src/ui/tarneeb/tarneebScoreTable.ts');
    // Scores/tricks come straight from the public ledgers; no hand cards are read.
    expect(helper).toContain('state.scoresBySeat');
    expect(helper).toContain('state.scoresByTeam');
    expect(helper).not.toMatch(/handsBySeat|handHistory|completedTricks/);
  });
});
