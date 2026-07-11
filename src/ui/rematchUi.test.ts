// Source guards for the Stage 25.9 online rematch wiring: every online finish screen offers a
// real "Play again" (rematch), NOT a silent leave; the payload carries no secrets; and the
// server gates it on a finished game + a seated member.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('rematch wiring — every online finish screen uses RematchControls', () => {
  const finals: Record<string, string> = {
    durak: read('src/ui/durak/DurakFinished.tsx'),
    deberc: read('src/ui/deberc/DebercFinished.tsx'),
    tarneeb: read('src/ui/tarneeb/TarneebFinished.tsx'),
    preferans: read('src/ui/preferans/PreferansFinished.tsx'),
    king: read('src/ui/GameFinishedScreen.tsx'),
  };
  for (const [game, src] of Object.entries(finals)) {
    it(`${game} finish renders RematchControls when a rematch context is present`, () => {
      expect(src).toContain('RematchControls');
      expect(src).toMatch(/rematch\s*(?:&&|\?)/); // conditional on the rematch prop
    });
  }

  it('OnlineGame passes the rematch context to every online game + the King context', () => {
    const online = read('src/ui/online/OnlineGame.tsx');
    expect((online.match(/rematch=\{rematchUi\}/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(online).toContain('rematch: rematchUi'); // King via GameContext
    expect(online).toMatch(/onReady: net\.sendRematchReady/);
  });
});

describe('rematch — server gates + no secrets', () => {
  const index = read('server/index.ts');
  const core = read('src/net/serverCore.ts');
  const messages = read('src/net/messages.ts');

  it('only a finished game + a seated human may rematch; restart preserves the room', () => {
    expect(index).toContain('handleRematch');
    expect(index).toMatch(/isRoomFinished\(room\)/);
    expect(core).toContain('export function restartGame');
    // restart must NOT create a new room / change gameType — it reuses startGame on the same room.
    const restart = core.slice(core.indexOf('export function restartGame'), core.indexOf('export function restartGame') + 400);
    expect(restart).toContain('startGame(room');
    expect(restart).not.toMatch(/createRoom|gameType\s*=/);
  });

  it('REMATCH messages carry no token/session/email — public routing only', () => {
    // The server broadcast is only ready clientIds + a needed count.
    expect(messages).toMatch(/REMATCH_STATE'; ready: string\[\]; needed: number/);
    const readyMsg = messages.slice(messages.indexOf("REMATCH_READY"), messages.indexOf("REMATCH_READY") + 120);
    expect(readyMsg).not.toMatch(/\bemail\b|\btoken\b|session|reconnect/i);
  });

  it('rematch state is in-memory only (never persisted / snapshotted)', () => {
    // rematchReady lives on the room but is excluded from serialize + snapshot.
    const serialize = core.slice(core.indexOf('export function serializeRoom'), core.indexOf('export function serializeRoom') + 900);
    expect(serialize).not.toContain('rematchReady');
    const snap = core.slice(core.indexOf('export function snapshot'), core.indexOf('export function snapshot') + 900);
    expect(snap).not.toContain('rematchReady');
  });
});
