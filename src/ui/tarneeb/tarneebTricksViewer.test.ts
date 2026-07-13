// Tarneeb team-tricks viewer (Stage 27.3). The played-card history already lives in the PUBLIC
// `completedTricks`, so this is a UI-only feature. These tests lock in: the public data shape, that
// redaction keeps completed-trick cards while hiding opponent hands, the UI wiring, and that no
// card-level detail is persisted to stats.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../../core/rng';
import { tarneebReducer } from '../../games/tarneeb/engine';
import { tarneebBotAction } from '../../games/tarneeb/ai';
import { getActingTarneebSeat, teamOfSeat } from '../../games/tarneeb/rules';
import { tarneebRedactStateFor } from '../../games/tarneeb/redact';
import type { TarneebState } from '../../games/tarneeb/types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Drive a Tarneeb hand until at least one trick has completed. */
function stateWithCompletedTrick(seed: number): TarneebState {
  const rng = makeRng(seed);
  let s = tarneebReducer(null, {
    type: 'START_GAME', playerNames: ['S0', 'S1', 'S2', 'S3'],
    playerTypes: ['human', 'human', 'human', 'human'], dealerSeat: 0,
  }, { rng }) as TarneebState;
  let guard = 0;
  while (guard++ < 400 && s.completedTricks.length < 1) {
    const seat = getActingTarneebSeat(s);
    if (seat == null) break;
    s = tarneebReducer(s, tarneebBotAction(s, seat), { rng })!;
  }
  return s;
}

describe('completed-trick data (public, already tracked)', () => {
  it('a completed trick has the lead seat, 4 plays in order, and a winner', () => {
    const s = stateWithCompletedTrick(3);
    expect(s.completedTricks.length).toBeGreaterThanOrEqual(1);
    const trick = s.completedTricks[0];
    expect(trick.plays).toHaveLength(4);
    expect(trick.winnerSeat).not.toBeNull();
    expect(trick.plays.some((p) => p.seat === trick.leadSeat)).toBe(true); // the lead card is present
    // tricksByTeam matches the completed tricks (sums to the count).
    const total = s.tricksByTeam.A + s.tricksByTeam.B;
    expect(total).toBe(s.completedTricks.length);
    expect(teamOfSeat(trick.winnerSeat as number)).toMatch(/^(A|B)$/);
  });

  it('redaction keeps completed-trick cards but hides opponent hands', () => {
    const s = stateWithCompletedTrick(3);
    const viewer = 0;
    const view = tarneebRedactStateFor(s, viewer);
    // Completed tricks (public played cards) are untouched — real ranks, not placeholders.
    expect(view.completedTricks).toEqual(s.completedTricks);
    expect(view.completedTricks[0].plays.every((p) => (p.card.rank as string) !== '?')).toBe(true);
    // Opponents' hands are still face-down; the viewer's own hand is real.
    expect(view.handsBySeat[viewer]).toEqual(s.handsBySeat[viewer]);
    expect(view.handsBySeat[1].every((c) => (c.rank as string) === '?')).toBe(true);
  });
});

describe('viewer UI wiring (source guards)', () => {
  const screen = read('src/ui/tarneeb/TarneebGameScreen.tsx');
  const review = read('src/ui/tarneeb/TarneebTricksReview.tsx');

  it('the game screen has a tricks button with the live count (my side / my seat) + opens the modal', () => {
    expect(screen).toContain('TarneebTricksReview');
    expect(screen).toContain('setShowTricks');
    // Stage 28.3: the button shows `myTricks` (team tricks in Pairs, own tricks in Solo).
    expect(screen).toMatch(/tarneeb-tricks-btn[\s\S]*🃏 \{myTricks\}/);
    expect(screen).toContain("solo ? tricksBySeat[humanSeat] : state.tricksByTeam[myTeam]");
  });

  it('the modal shows my tricks (Pairs=team, Solo=own seat), an opponent count + empty state', () => {
    // Pairs filter keeps the team check; Solo filters to my own seat (no partner).
    expect(review).toMatch(/teamOfSeat\(winnerSeat\) === myTeam/);         // pairs: my side
    expect(review).toContain('winnerSeat === mySeat');                     // solo: my seat only
    expect(review).toContain('otherTeam');                                 // pairs opponent tally
    expect(review).toMatch(/lead=\{p\.seat === trick\.leadSeat\}/);        // lead card highlighted
    expect(review).toContain("t('tarneeb.noTricks')");                    // empty state
    // It reads only public completedTricks — never handsBySeat (no hidden-hand leak).
    expect(review).not.toContain('handsBySeat');
  });

  it('the i18n keys exist in all four languages', () => {
    for (const lang of ['en', 'uk', 'de', 'ar']) {
      const dict = read(`src/i18n/dictionaries/${lang}.ts`);
      for (const key of ['tarneeb.teamTricks', 'tarneeb.reviewTricks', 'tarneeb.opponentTricks', 'tarneeb.noTricks']) {
        expect(dict, `${lang}:${key}`).toContain(`'${key}'`);
      }
    }
  });
});

describe('privacy — stats stay score-only (no card details persisted)', () => {
  it('the Tarneeb finish signature / stats carry no card / rank / suit arrays', () => {
    const sig = read('src/net/tarneebStats.ts');
    expect(sig).not.toMatch(/completedTricks|\.plays\b|card\.rank|card\.suit|handsBySeat/);
  });
});
