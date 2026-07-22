import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Stage 29.8 — compact/centered Tarneeb score table + a host-choosable match
// target. Source/CSS guards; the target-score data flow is unit-tested in
// src/net/tarneebTargetScore.test.ts.
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Compact + centered Tarneeb rank table (Scope A)', () => {
  const css = read('src/styles/tarneeb.css');

  it('the table is width-capped and centered (no longer full-width)', () => {
    const block = css.match(/\.tarneeb-rank \{[^}]*\}/)?.[0] ?? '';
    expect(block).toMatch(/max-inline-size|max-width/);
    expect(block).toContain('margin-inline: auto');
    // It no longer stretches to the full board width.
    expect(block).not.toContain('width: 100%');
  });
});

describe('Tarneeb match-target selector (Scope B — UI)', () => {
  const menu = read('src/ui/StartMenu.tsx');
  const setup = read('src/ui/tarneeb/TarneebSetup.tsx');
  const lobby = read('src/ui/online/Lobby.tsx');

  it('the online Host sheet renders a target-score picker and threads it into CREATE_ROOM', () => {
    expect(menu).toContain('TARGET_SCORE_PRESETS');
    expect(menu).toContain('setTarneebTargetScore');
    expect(menu).toContain('tarneebTargetScore'); // threaded into the shared create-intent builder (Stage 37.6)
    expect(menu).toContain("t('tarneeb.targetScore')");
  });

  it('the local Tarneeb setup renders a target-score picker and passes it to onStart', () => {
    expect(setup).toContain('TARGET_SCORE_PRESETS');
    expect(setup).toContain('onStart(variant, targetScore)');
  });

  it('the lobby shows the match target next to the Pairs/Solo label', () => {
    expect(lobby).toContain('room.tarneebTargetScore ?? 41');
  });
});

describe('Target-score plumbing is present at each layer (Scope B — wiring)', () => {
  it('the wire message, room, snapshot/summary and persistence all carry tarneebTargetScore', () => {
    expect(read('src/net/messages.ts')).toMatch(/CREATE_ROOM[\s\S]*tarneebTargetScore\?: number/);
    const core = read('src/net/serverCore.ts');
    expect(core).toContain('tarneebTargetScore: opts.tarneebTargetScore');   // room construction
    expect(core).toContain('tarneebTargetScore: room.tarneebTargetScore');   // snapshot + serialize
    expect(core).toContain('normalizeTargetScore(o.tarneebTargetScore)');    // deserialize (re-clamp)
    // The server validates/clamps at CREATE_ROOM ingest.
    expect(read('server/wsHandlers.ts')).toContain('normalizeTargetScore(msg.tarneebTargetScore)');
    // buildStartAction reads the room field (default 41 via normalize).
    expect(read('src/games/tarneeb/definition.ts')).toContain('normalizeTargetScore(room.tarneebTargetScore)');
  });
});
