import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { needsHandover, viewerFor, actingSeat, humanSeats, soloHumanSeat } from './passAndPlay';
import { pokerRedactStateFor } from '../../games/poker/redact';
import type { PlayerType, Rank, Suit } from '../../models/types';
import type { PokerCard, PokerPhase, PokerPlayer, PokerState } from '../../games/poker/types';

// Stage 38.0.2 — the owner-confirmed local handover policy. A handover is a PRIVACY
// step between two DIFFERENT humans, not a per-turn ritual:
//   • exactly 1 human + bots → NO handover ever; that human is the stable viewer;
//   • ≥2 humans → the confirmation sticks to its seat, so A → bots → A never
//     re-prompts while A → bots → B (and A → B) prompts for B, with A already hidden.
// The old "bot → human ALWAYS re-prompts" expectation is deliberately REMOVED — it is
// no longer the requirement (it made a solo player confirm before every single move).

const pc = (rank: Rank, suit: Suit): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });
const isHidden = (c: PokerCard) => c.id === 'hidden' && c.suit === null && c.rank === null;

/** A minimal state carrying only the fields the pass-and-play logic reads. */
function mk(types: PlayerType[], names: string[], over: { phase?: PokerPhase; toActSeat?: number } = {}): PokerState {
  const players: PokerPlayer[] = types.map((type, i) => ({ id: `player-${i}`, name: names[i], seatIndex: i, type }));
  return {
    players, phase: over.phase ?? 'betting', toActSeat: over.toActSeat ?? 0,
  } as unknown as PokerState;
}

/** A fuller state with real hole cards (for redaction-content assertions). */
function mkWithCards(types: PlayerType[], toActSeat: number): PokerState {
  const n = types.length;
  const players: PokerPlayer[] = types.map((type, i) => ({ id: `player-${i}`, name: `P${i}`, seatIndex: i, type }));
  return {
    gameType: 'poker', phase: 'betting', playerCount: n, players,
    holeCardsBySeat: types.map((_, i) => [pc('A', 'spades'), pc('K', 'hearts')].map((c) => ({ ...c, id: `s${i}-${c.id}` }))),
    board: [], deck: [], burned: [], revealedBySeat: types.map(() => false),
    toActSeat,
  } as unknown as PokerState;
}

const bots = (n: number): PlayerType[] => Array.from({ length: n }, () => 'ai' as const);

describe('seat/human helpers', () => {
  it('humanSeats + soloHumanSeat identify the humans by SEAT', () => {
    expect(humanSeats(mk(['human', 'ai', 'human'], ['A', 'B', 'C']))).toEqual([0, 2]);
    expect(soloHumanSeat(mk(['ai', 'human', 'ai'], ['B', 'A', 'B']))).toBe(1);
    expect(soloHumanSeat(mk(['human', 'human', 'ai'], ['A', 'B', 'C']))).toBe(null);
    expect(soloHumanSeat(mk(['ai', 'ai'], ['B', 'B']))).toBe(null);
  });
});

describe('ONE human + bots — no handover at all (Stage 38.0.2)', () => {
  it('1 human + 1..5 bots: ZERO handovers across every seat that can act', () => {
    for (let botCount = 1; botCount <= 5; botCount++) {
      const types: PlayerType[] = ['human', ...bots(botCount)];
      const names = types.map((_, i) => `P${i}`);
      for (let seat = 0; seat < types.length; seat++) {
        const s = mk(types, names, { toActSeat: seat });
        expect(needsHandover(s, null)).toBe(false);   // never, not even before the first move
        expect(needsHandover(s, 0)).toBe(false);
        // The solo human keeps seeing their OWN hand through every bot turn.
        expect(viewerFor(s, null)).toBe(0);
        expect(viewerFor(s, 0)).toBe(0);
      }
    }
  });

  it('the solo human sits at whatever seat they were given (not hardcoded to 0)', () => {
    const s = mk(['ai', 'ai', 'human'], ['B1', 'B2', 'Me'], { toActSeat: 0 });
    expect(needsHandover(s, null)).toBe(false);
    expect(viewerFor(s, null)).toBe(2);
  });

  it('a solo human keeps their view between hands too (no public blackout to re-confirm)', () => {
    const s = mk(['human', 'ai'], ['Me', 'Botty'], { phase: 'hand_complete', toActSeat: 0 });
    expect(needsHandover(s, 0)).toBe(false);
    expect(viewerFor(s, 0)).toBe(0);
  });

  it('the solo human still sees ONLY their own hand (bots stay hidden)', () => {
    const s = mkWithCards(['human', 'ai', 'ai'], 1); // a bot is acting
    const seat = viewerFor(s, null);
    expect(seat).toBe(0);
    const view = pokerRedactStateFor(s, seat);
    expect(view.holeCardsBySeat[0].every(isHidden)).toBe(false);       // own hand visible
    expect(view.holeCardsBySeat[1].every(isHidden)).toBe(true);        // bots hidden
    expect(view.holeCardsBySeat[2].every(isHidden)).toBe(true);
    expect(view.deck).toEqual([]);
    expect(view.burned).toEqual([]);
  });
});

describe('multi-human pass-and-play (§14)', () => {
  const types: PlayerType[] = ['human', 'human', 'ai']; // seats 0,1 human; seat 2 bot
  const names = ['Alice', 'Bob', 'Botty'];

  it('a human seat needs a handover until that exact human confirms', () => {
    const s = mk(types, names, { toActSeat: 0 });
    expect(needsHandover(s, null)).toBe(true);   // nobody has confirmed
    expect(viewerFor(s, null)).toBe(null);       // table hidden
    expect(needsHandover(s, 0)).toBe(false);     // Alice confirmed her own turn
    expect(viewerFor(s, 0)).toBe(0);             // table redacted for Alice
  });

  it('A → bot → A: the SAME human is NOT re-prompted (the confirmation sticks to the seat)', () => {
    const aliceTurn = mk(types, names, { toActSeat: 0 });
    expect(viewerFor(aliceTurn, 0)).toBe(0);                 // Alice acting + confirmed
    const botTurn = mk(types, names, { toActSeat: 2 });
    expect(viewerFor(botTurn, 0)).toBe(null);                // bot acts → nothing on screen
    const aliceAgain = mk(types, names, { toActSeat: 0 });
    expect(needsHandover(aliceAgain, 0)).toBe(false);        // ← no repeat modal
    expect(viewerFor(aliceAgain, 0)).toBe(0);                // her view comes straight back
  });

  it('A → bot → B: B gets the handover and A stays hidden throughout', () => {
    expect(viewerFor(mk(types, names, { toActSeat: 0 }), 0)).toBe(0);    // Alice sees her own
    expect(viewerFor(mk(types, names, { toActSeat: 2 }), 0)).toBe(null); // bot: nothing shown
    const bobTurn = mk(types, names, { toActSeat: 1 });
    expect(needsHandover(bobTurn, 0)).toBe(true);                        // Bob must confirm
    expect(viewerFor(bobTurn, 0)).toBe(null);                            // Alice never leaks to Bob
  });

  it('A → B directly (no bot between) also requires a handover', () => {
    const bobTurn = mk(types, names, { toActSeat: 1 });
    expect(needsHandover(bobTurn, 0)).toBe(true);
    expect(viewerFor(bobTurn, 0)).toBe(null);
    expect(needsHandover(bobTurn, 1)).toBe(false);   // after Bob confirms
    expect(viewerFor(bobTurn, 1)).toBe(1);
  });

  it('a BOT turn reveals nothing — viewerFor is null for ANY confirmed seat (no leak window)', () => {
    const s = mk(types, names, { toActSeat: 2 }); // Botty acts
    expect(needsHandover(s, 0)).toBe(false);      // bots act automatically (no handover)
    for (const held of [0, 1, 2, null]) expect(viewerFor(s, held)).toBe(null);
  });

  it('the bot-turn redacted view contains no real human hole card', () => {
    const s = mkWithCards(['human', 'human', 'ai'], 2); // seat 2 bot acting
    const seat = viewerFor(s, 0);                        // Alice holds the device
    expect(seat).toBe(null);
    const view = pokerRedactStateFor(s, seat);
    for (const hand of view.holeCardsBySeat) expect(hand.every(isHidden)).toBe(true);
    const json = JSON.stringify(view);
    for (let i = 0; i < 3; i++) for (const c of s.holeCardsBySeat[i]) expect(json.includes(c.id)).toBe(false);
  });

  it('SEVERAL bots in a row keep every human hand hidden while ≥2 humans play', () => {
    const mixed: PlayerType[] = ['human', 'human', 'ai', 'ai'];
    for (const seat of [2, 3]) {
      const s = mkWithCards(mixed, seat);
      for (const held of [0, 1, null]) expect(viewerFor(s, held)).toBe(null);
    }
  });

  it('duplicate human names still require a per-seat handover (resolved by seat, not name)', () => {
    const dupNames = ['Sam', 'Sam', 'Botty']; // two humans share a name
    const samSeat0 = mk(types, dupNames, { toActSeat: 0 });
    const samSeat1 = mk(types, dupNames, { toActSeat: 1 });
    expect(needsHandover(samSeat1, 0)).toBe(true);   // seat 1 "Sam" still needs a handover
    expect(needsHandover(samSeat0, 0)).toBe(false);
    expect(viewerFor(samSeat1, 0)).toBe(null);       // seat 0 "Sam" never leaks to seat 1
    expect(actingSeat(samSeat1)).toBe(1);
  });

  it('a public / between-hands screen shows no private hand and needs no handover', () => {
    const done = mk(types, names, { phase: 'hand_complete', toActSeat: 0 });
    expect(needsHandover(done, 0)).toBe(false);
    expect(viewerFor(done, 0)).toBe(null); // no leak between hands
  });
});

describe('PokerLocalGame source implements the Stage 38.0.2 policy', () => {
  const src = readFileSync(join(process.cwd(), 'src/ui/poker/PokerLocalGame.tsx'), 'utf8');
  const setup = readFileSync(join(process.cwd(), 'src/ui/poker/PokerSetup.tsx'), 'utf8');

  it('resolves the acting human via the pure seat-based helpers', () => {
    expect(src).toContain('needsHandover');
    expect(src).toContain('viewerFor');
    expect(src).not.toMatch(/\['human',\s*\.\.\./);
  });

  it('NO LONGER drops the confirmation on every acting-seat change', () => {
    // The per-turn reset (prevActor ref + setViewerSeat(null) in an effect) is what made
    // a solo player confirm before every move. It must be gone.
    expect(src).not.toContain('prevActor');
    expect(src).not.toContain('setViewerSeat');
    // The last confirmed human seat is now tracked explicitly and survives bot turns.
    expect(src).toContain('confirmedSeat');
  });

  it('clears the confirmed seat on a new game and on play-again (no stale viewer)', () => {
    const resets = src.match(/setConfirmedSeat\(null\)/g) ?? [];
    expect(resets.length).toBeGreaterThanOrEqual(2); // start() + playAgain()
  });

  it('the setup configures each seat as human or bot', () => {
    expect(setup).toContain('PokerSeatConfig');
    expect(setup).toContain('toggleType');
  });
});
