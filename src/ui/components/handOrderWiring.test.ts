// ---------------------------------------------------------------------------
// Manual hand-order wiring guards (Stage 30.12b). Source-level checks that every
// game screen renders its hand through the shared DRAGGABLE tray, that the
// helper/tray are CLIENT-ONLY (no net/db/server imports), and that the hand
// order is never put on the wire (no ACTION_REQUEST / dispatch carries it).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('all six games render the hand through the shared draggable tray', () => {
  const screens: Array<[string, string]> = [
    ['King (PlayerHand)', 'src/ui/components/PlayerHand.tsx'],
    ['Durak', 'src/ui/durak/DurakGameScreen.tsx'],
    ['Deberc', 'src/ui/deberc/DebercGameScreen.tsx'],
    ['Tarneeb', 'src/ui/tarneeb/TarneebGameScreen.tsx'],
    ['Preferans', 'src/ui/preferans/PreferansGameScreen.tsx'],
    ['FiftyOne', 'src/ui/fiftyOne/FiftyOneGameScreen.tsx'],
  ];
  for (const [name, path] of screens) {
    it(`${name} uses useManualHandOrder + HandReorderTray (items from the ordered hand)`, () => {
      const src = read(path);
      expect(src, `${name} imports the hook`).toContain('useManualHandOrder');
      expect(src, `${name} mounts the draggable tray`).toContain('HandReorderTray');
      expect(src, `${name} feeds the tray the ordered hand`).toMatch(/items=\{(order|handOrder)\.ordered\}/);
      // The old direct sortHand(...).map hand render must be gone.
      expect(src, `${name} no longer maps sortHand directly for the hand`).not.toMatch(/sortHand\([^)]*\)\.map\(\(c\)/);
    });
  }
});

describe('the tray implements pointer drag (touch/mouse/pen) and drives moveCard', () => {
  const src = read('src/ui/components/HandReorderTray.tsx');
  it('handles pointer events with a drag threshold and commits via moveCard', () => {
    for (const h of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel', 'setPointerCapture']) {
      expect(src, `uses ${h}`).toContain(h);
    }
    expect(src).toContain('DRAG_THRESHOLD');
    expect(src).toContain('order.moveCard');
    // A quick tap still plays/selects; only a real drag reorders.
    expect(src).toMatch(/onTap\(card\)/);
  });
});

describe('the hand-order helper + tray are client-only (never on the wire)', () => {
  const files = [
    'src/hooks/useManualHandOrder.ts',
    'src/ui/components/HandReorderTray.tsx',
  ];
  for (const f of files) {
    it(`${f} imports no net/db/server transport`, () => {
      const src = read(f);
      expect(src).not.toMatch(/from ['"][^'"]*\/(net|server|db)\//);
      expect(src).not.toMatch(/ACTION_REQUEST|dispatch\(|WebSocket|fetch\(/);
    });
  }

  it('the display order is never serialised (no localStorage / server push)', () => {
    const src = read('src/hooks/useManualHandOrder.ts');
    expect(src).not.toContain('localStorage');
    expect(src).not.toMatch(/JSON\.stringify/);
  });
});

describe('51 keeps the SELECTED meld order (joker placement) — never auto-sorted', () => {
  const src = read('src/ui/fiftyOne/FiftyOneGameScreen.tsx');
  it('resolves the meld from the tap-ordered selection (no sort of selectedCards)', () => {
    expect(src).toContain('resolveMeld(selectedCards)');
    // selectedCards is derived straight from `selected` (tap order), not sorted.
    expect(src).toMatch(/selected\.map\(\(id\)\s*=>\s*byId\.get\(id\)\)/);
    expect(src).not.toMatch(/selectedCards[^;]*\.sort\(/);
  });
  it('offers ← / → reorder for the selected meld (joker position control)', () => {
    expect(src).toContain('moveSelected');
    expect(src).toContain('fiftyone-selbuilder');
  });
});
