import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { needsHandover, viewerFor, actingSeat } from './passAndPlay';
import type { PlayerType } from '../../models/types';
import type { PokerPhase, PokerPlayer, PokerState } from '../../games/poker/types';

/** A minimal state carrying only the fields the pass-and-play logic reads. */
function mk(types: PlayerType[], names: string[], over: { phase?: PokerPhase; toActSeat?: number } = {}): PokerState {
  const players: PokerPlayer[] = types.map((type, i) => ({ id: `player-${i}`, name: names[i], seatIndex: i, type }));
  return {
    players, phase: over.phase ?? 'betting', toActSeat: over.toActSeat ?? 0,
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

  it('a bot turn needs no handover and keeps the last human viewing their own cards', () => {
    const s = mk(types, names, { toActSeat: 2 }); // Botty acts
    expect(needsHandover(s, 0)).toBe(false);      // bots act automatically
    expect(viewerFor(s, 0)).toBe(0);              // Alice keeps watching her own cards
  });

  it('Human A → Human B → Human A each triggers a fresh handover (resolved by seat)', () => {
    // Alice (seat 0) confirmed → viewer 0.
    let viewer: number | null = 0;
    // Action moves to Bob (seat 1): a different human ⇒ handover, table hidden.
    const bobTurn = mk(types, names, { toActSeat: 1 });
    expect(needsHandover(bobTurn, viewer)).toBe(true);
    expect(viewerFor(bobTurn, viewer)).toBe(null);
    // Bob confirms → viewer 1.
    viewer = 1;
    expect(needsHandover(bobTurn, viewer)).toBe(false);
    expect(viewerFor(bobTurn, viewer)).toBe(1);
    // Action returns to Alice (seat 0): viewer is still Bob ⇒ handover again.
    const aliceAgain = mk(types, names, { toActSeat: 0 });
    expect(needsHandover(aliceAgain, viewer)).toBe(true);
    expect(viewerFor(aliceAgain, viewer)).toBe(null);
  });

  it('duplicate human names still require a per-seat handover (resolved by seat, not name)', () => {
    const dupNames = ['Sam', 'Sam', 'Botty']; // two humans share a name
    const aliceSeat0 = mk(types, dupNames, { toActSeat: 0 });
    const samSeat1 = mk(types, dupNames, { toActSeat: 1 });
    // Seat 0 "Sam" confirmed (viewer 0); seat 1 "Sam" still needs a handover.
    expect(needsHandover(samSeat1, 0)).toBe(true);
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

  it('the setup configures each seat as human or bot', () => {
    expect(setup).toContain('PokerSeatConfig');
    expect(setup).toContain('toggleType');
  });
});
