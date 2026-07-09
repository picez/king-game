// Source guards (Stage 13.6): bot seats get a centralized identity, never a
// faceless "Bot N" generated inline; the AI badge stays visible.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('bot naming goes through the centralized identity module', () => {
  it('online addBot uses nextBotIdentity, not an inline "Bot N"', () => {
    const core = read('src/net/serverCore.ts');
    expect(core).toContain('nextBotIdentity');
    expect(core).toContain("from '../games/botIdentities'");
    expect(core).not.toMatch(/`Bot \$\{/);   // no template "Bot ${n}"
    expect(core).not.toContain("'Bot '");
  });

  it('every local game builds bot names via localBotNames (no inline "Bot N")', () => {
    for (const f of [
      'src/ui/durak/DurakLocalGame.tsx',
      'src/ui/deberc/DebercLocalGame.tsx',
      'src/ui/tarneeb/TarneebLocalGame.tsx',
    ]) {
      const src = read(f);
      expect(src, f).toContain('localBotNames');
      expect(src, f).not.toMatch(/`Bot \$\{/);
      expect(src, f).not.toMatch(/'Bot [0-9]'/);
    }
  });
});

describe('bots stay explicitly AI in the UI', () => {
  it('the lobby still renders the AI/bot badge for ai members', () => {
    const lobby = read('src/ui/online/Lobby.tsx');
    expect(lobby).toContain("m.type === 'ai'");
    expect(lobby).toContain('tag--bot');
    expect(lobby).toContain("t('lobby.bot')");
  });
});
