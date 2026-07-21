import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { needsHandover, viewerFor, actingSeat } from './passAndPlay';
import { pokerRedactStateFor } from '../../games/poker/redact';
import type { PlayerType, Rank, Suit } from '../../models/types';
import type { PokerCard, PokerPhase, PokerPlayer, PokerState } from '../../games/poker/types';

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

describe('local pass-and-play view logic (§14)', () => {
  const types: PlayerType[] = ['human', 'human', 'ai']; // seats 0,1 human; seat 2 bot
  const names = ['Alice', 'Bob', 'Botty'];

  it('a human seat needs a handover until that exact human confirms', () => {
    const s = mk(types, names, { toActSeat: 0 });
    expect(needsHandover(s, null)).toBe(true);   // nobody has confirmed
    expect(viewerFor(s, null)).toBe(null);       // table hidden
    expect(needsHandover(s, 0)).toBe(false);     // Alice confirmed her own turn
    expect(viewerFor(s, 0)).toBe(0);             // table redacted for Alice
  });

  it('a BOT turn reveals nothing — viewerFor is null for ANY stale viewerSeat (no leak window)', () => {
    const s = mk(types, names, { toActSeat: 2 }); // Botty acts
    expect(needsHandover(s, 0)).toBe(false);      // bots act automatically (no handover)
    // Whatever human last held the device, the bot turn shows NO private hand.
    for (const stale of [0, 1, 2, null]) expect(viewerFor(s, stale)).toBe(null);
  });

  it('the bot-turn redacted view contains no real human hole card', () => {
    const s = mkWithCards(['human', 'human', 'ai'], 2); // seat 2 bot acting
    const seat = viewerFor(s, 0);                         // stale = Alice
    expect(seat).toBe(null);
    const view = pokerRedactStateFor(s, seat);
    for (const hand of view.holeCardsBySeat) expect(hand.every(isHidden)).toBe(true);
    const json = JSON.stringify(view);
    for (let i = 0; i < 3; i++) for (const c of s.holeCardsBySeat[i]) expect(json.includes(c.id)).toBe(false);
  });

  it('Alice confirms → acts → bot turn: the table hides Alice immediately', () => {
    const aliceTurn = mk(types, names, { toActSeat: 0 });
    expect(viewerFor(aliceTurn, 0)).toBe(0);       // Alice acting + confirmed → visible
    const botTurn = mk(types, names, { toActSeat: 2 });
    // Even if the confirmation (0) has not yet been cleared, the bot turn shows nothing.
    expect(viewerFor(botTurn, 0)).toBe(null);
  });

  it('bot → human ALWAYS re-prompts a handover (even the same human as before the bot)', () => {
    // After a bot turn the confirmation is dropped (viewer null) → Alice must confirm again.
    const aliceAfterBot = mk(types, names, { toActSeat: 0 });
    expect(needsHandover(aliceAfterBot, null)).toBe(true);
    expect(viewerFor(aliceAfterBot, null)).toBe(null);
  });

  it('Alice → bot → Bob: Bob gets a handover and Alice stays hidden throughout', () => {
    // Alice's turn (confirmed) — then a bot — then Bob.
    expect(viewerFor(mk(types, names, { toActSeat: 0 }), 0)).toBe(0);       // Alice sees her own
    expect(viewerFor(mk(types, names, { toActSeat: 2 }), 0)).toBe(null);    // bot: nothing shown
    const bobTurn = mk(types, names, { toActSeat: 1 });
    expect(needsHandover(bobTurn, null)).toBe(true);                        // Bob must confirm
    expect(viewerFor(bobTurn, 0)).toBe(null);                              // Alice never leaks to Bob
  });

  it('several bots in a row keep every private hand hidden', () => {
    const bots: PlayerType[] = ['human', 'ai', 'ai', 'ai'];
    for (const seat of [1, 2, 3]) {
      const s = mkWithCards(bots, seat);
      expect(viewerFor(s, 0)).toBe(null); // seat 0 (Alice) never shown during any bot turn
    }
  });

  it('duplicate human names still require a per-seat handover (resolved by seat, not name)', () => {
    const dupNames = ['Sam', 'Sam', 'Botty']; // two humans share a name
    const aliceSeat0 = mk(types, dupNames, { toActSeat: 0 });
    const samSeat1 = mk(types, dupNames, { toActSeat: 1 });
    expect(needsHandover(samSeat1, 0)).toBe(true);   // seat 1 "Sam" still needs a handover
    expect(needsHandover(aliceSeat0, 0)).toBe(false);
    expect(actingSeat(samSeat1)).toBe(1);
  });

  it('a public / between-hands screen shows no private hand and needs no handover', () => {
    const done = mk(types, names, { phase: 'hand_complete', toActSeat: 0 });
    expect(needsHandover(done, 0)).toBe(false);
    expect(viewerFor(done, 0)).toBe(null); // no leak between hands
  });
});

describe('PokerLocalGame source uses seat-based pass-and-play (not one-human-vs-bots)', () => {
  const src = readFileSync(join(process.cwd(), 'src/ui/poker/PokerLocalGame.tsx'), 'utf8');
  const setup = readFileSync(join(process.cwd(), 'src/ui/poker/PokerSetup.tsx'), 'utf8');

  it('resolves the acting human via the pure seat-based helpers', () => {
    expect(src).toContain('needsHandover');
    expect(src).toContain('viewerFor');
    // The old one-human-at-seat-0 hardcode is gone.
    expect(src).not.toMatch(/\['human',\s*\.\.\./);
  });

  it('drops the confirmation whenever the acting seat changes (bot → human re-prompt)', () => {
    expect(src).toContain('prevActor');
    expect(src).toContain('setViewerSeat(null)');
  });

  it('the setup configures each seat as human or bot', () => {
    expect(setup).toContain('PokerSeatConfig');
    expect(setup).toContain('toggleType');
  });
});
