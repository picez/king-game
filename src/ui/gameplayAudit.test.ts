// Stage 27.6 — gameplay UX/rules final audit after the 27.0–27.5 pass.
//
// No runtime bug was found; this locks the cross-cutting invariants the audit relied on so a
// future refactor can't silently reintroduce them. The per-game engine tests already cover the
// rules themselves and the "illegal action returns the SAME state reference" contract
// (deberc/durak engine.test.ts). What is NOT stated elsewhere — and what this guards — is that
// the UI legality and the reducer share ONE source of truth (`legalPlays`), so what the table
// dims is exactly what the server accepts (no UI/authority drift), plus the "cards never render
// blank" gate. Source guards (node test env has no DOM).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legalPlays as tarneebLegal, getValidPlayableCards, canPlayCard } from '../games/tarneeb/rules';
import { legalPlays as debercLegal } from '../games/deberc/rules';
import type { Card, Suit } from '../games/types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const C = (rank: string, suit: Suit): Card => ({ rank: rank as Card['rank'], suit, value: 0 });

describe('legality has one source of truth — UI dims exactly what the reducer accepts', () => {
  it('Tarneeb: canPlayCard ⊆ getValidPlayableCards ⊆ legalPlays, and trump obligation holds', () => {
    // Void in the led suit while holding a trump ⇒ ONLY trumps are legal (§7, Stage 27.0).
    const hand = [C('A', 'hearts'), C('7', 'spades'), C('K', 'hearts')]; // no clubs; spades = trump
    const legal = tarneebLegal(hand, 'clubs', 'spades');
    expect(legal).toEqual([C('7', 'spades')]); // must trump — the two hearts are illegal discards
    // getValidPlayableCards + canPlayCard are thin wrappers over legalPlays (no re-implementation).
    const rules = read('src/games/tarneeb/rules.ts');
    expect(rules).toMatch(/getValidPlayableCards[\s\S]*?return legalPlays\(/);
    expect(rules).toMatch(/canPlayCard[\s\S]*?getValidPlayableCards\(state, seat\)/);
    // The reducer gates PLAY_CARD on canPlayCard and returns the SAME state when illegal.
    expect(read('src/games/tarneeb/engine.ts')).toMatch(/if \(!canPlayCard\(state, seat, action\.card\)\) return state;/);
    // The screen consumes the engine helper, not a private copy.
    expect(read('src/ui/tarneeb/TarneebGameScreen.tsx')).toMatch(/getValidPlayableCards\(state, humanSeat\)/);
    // (canPlayCall touched so the import is exercised, not just typed.)
    expect(typeof canPlayCard).toBe('function');
    expect(typeof getValidPlayableCards).toBe('function');
  });

  it('Deberc: currentLegalPlays and the reducer both route through legalPlays', () => {
    // Same trump-obligation shape (§4): void in led + holding trump ⇒ must trump.
    const hand = [C('A', 'hearts'), C('J', 'clubs')]; // no spades; clubs = trump
    expect(debercLegal(hand, 'spades', 'clubs')).toEqual([C('J', 'clubs')]);
    const engine = read('src/games/deberc/engine.ts');
    expect(engine).toMatch(/currentLegalPlays[\s\S]*?return legalPlays\(/);       // UI source
    expect(engine).toMatch(/if \(!isLegalPlay\(action\.card, hand, ledSuit, state\.trumpSuit\)\) return state;/); // reducer
    expect(read('src/games/deberc/rules.ts')).toMatch(/isLegalPlay[\s\S]*?legalPlays\(hand, ledSuit, trumpSuit\)/);
    // The screen imports currentLegalPlays from the engine (not a local legality helper).
    expect(read('src/ui/deberc/DebercGameScreen.tsx')).toMatch(/currentLegalPlays.*from '\.\.\/\.\.\/games\/deberc\/engine'/);
  });
});

describe('online authority + display safety are intact (audit locks)', () => {
  it('non-King/Durak actions are authorized only for the acting seat (turn-gated)', () => {
    expect(read('src/net/serverCore.ts')).toMatch(/def\.getActingPlayerId\(state\) === seatToPlayerId\(seat\)/);
  });
  it('Deberc trump exchange stays reducer-gated (illegal ⇒ same state)', () => {
    expect(read('src/games/deberc/engine.ts')).toMatch(/if \(!canExchangeTrump\(state, seat\)\) return state;/);
  });
  it('cards never render blank — art shows only once it has actually loaded', () => {
    const cv = read('src/ui/components/CardView.tsx');
    expect(cv).toMatch(/const showArt = attemptArt && artLoaded/);
    expect(cv).toMatch(/const attemptArt = !isHidden && artUrl !== null && !artFailed/);
  });
  it('Tarneeb team-tricks viewer reads only the PUBLIC completedTricks (no hand leak)', () => {
    const src = read('src/ui/tarneeb/TarneebTricksReview.tsx');
    expect(src).toMatch(/completedTricks/);
    expect(src).not.toMatch(/handsBySeat/);
  });
});
