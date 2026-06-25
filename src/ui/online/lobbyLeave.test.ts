import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Hard guard for the explicit "Leave lobby" action (no jsdom in this project).
// This fails LOUDLY if the button is removed, mislabelled, unwired, or — the
// critical regression — accidentally gated behind `isHost` so non-hosts can't
// see it. Pairs with the e2e check that actually clicks it in a live lobby.
const src = readFileSync(fileURLToPath(new URL('./Lobby.tsx', import.meta.url)), 'utf8');

describe('lobby: explicit Leave lobby button', () => {
  it('renders a button wired to the leave label + handler', () => {
    expect(src).toMatch(/className=["'`][^"'`]*\blobby-leave\b[^"'`]*["'`]/);
    expect(src).toContain("t('lobby.leave')");
    expect(src).toMatch(/onClick=\{handleLeave\}/);
  });

  it('handleLeave calls onLeave()', () => {
    expect(src).toMatch(/function handleLeave\s*\([\s\S]*?onLeave\(\)/);
  });

  it('is NOT gated behind isHost — visible to every lobby member', () => {
    // The button's own line must not be conditional on isHost…
    const leaveLine = src.split('\n').find((l) => l.includes('lobby-leave'));
    expect(leaveLine, 'leave button line').toBeTruthy();
    expect(leaveLine).not.toMatch(/isHost/);

    // …and it must sit OUTSIDE the `{isHost ? (Start) : (waiting)}` block,
    // after it in source order (i.e. an unconditional sibling action).
    const startTernary = src.match(/\{isHost \? \([\s\S]*?\) : \([\s\S]*?\)\}/);
    expect(startTernary, 'isHost start/waiting ternary').toBeTruthy();
    expect(startTernary[0]).not.toContain('lobby-leave');
    expect(src.indexOf('lobby-leave')).toBeGreaterThan(src.indexOf('{isHost ?'));
  });
});
