import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TUTORIALS_DONE_KEY, getTutorialsDone, loadTutorialsDone, markTutorialDone, type ProgressStorage } from './progress';

// Stage 42.5 — tutorial progress ticks and the Practice hand-off.

const mem = (init: Record<string, string> = {}): ProgressStorage & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('tutorial progress store', () => {
  it('starts empty and ignores junk, unknown games and duplicates', () => {
    expect(loadTutorialsDone(mem())).toEqual([]);
    expect(loadTutorialsDone(mem({ [TUTORIALS_DONE_KEY]: '{oops' }))).toEqual([]);
    expect(loadTutorialsDone(mem({ [TUTORIALS_DONE_KEY]: '"king"' }))).toEqual([]);
    expect(loadTutorialsDone(mem({ [TUTORIALS_DONE_KEY]: '["king","chess","king",3,"durak"]' })))
      .toEqual(['king', 'durak']);
  });

  it('marking is idempotent and persists', () => {
    const s = mem();
    markTutorialDone('poker', s);
    markTutorialDone('poker', s);
    expect(getTutorialsDone().filter((g) => g === 'poker')).toHaveLength(1);
    expect(loadTutorialsDone(s)).toContain('poker');
  });
});

describe('tutorial UI wiring for progress + practice', () => {
  const player = read('src/ui/tutorials/TutorialPlayer.tsx');
  const hub = read('src/ui/tutorials/TutorialHub.tsx');

  it('finishing (Done or Practice) ticks the game; Skip does not', () => {
    expect(player).toContain('const finish = () => { markTutorialDone(game); onExit(); };');
    expect(player).toContain('const practice = () => { markTutorialDone(game); onPractice?.(); };');
    expect(player).toMatch(/tutorial-btn--skip" onClick=\{onExit\}/);
  });

  it('Practice only shows on the last step, and only when the caller wires it', () => {
    expect(player).toContain('isLast && onPractice ?');
    expect(player).toContain("t('tutorials.practice')");
  });

  it('the hub marks finished games and relabels their button', () => {
    expect(hub).toContain('useTutorialsDone()');
    expect(hub).toContain("t('tutorials.completed')");
    expect(hub).toContain("isDone ? t('tutorials.again') : t('tutorials.start')");
  });

  it('the menu routes Practice to a local game flagged as practice; King pre-fills bots', () => {
    expect(read('src/ui/StartMenu.tsx')).toContain('onPractice={(g) => onLocal(g, { practice: true })}');
    expect(read('src/App.tsx')).toContain("setMode({ kind: 'local', gameType, practice: opts?.practice })");
    const setup = read('src/ui/SetupScreen.tsx');
    expect(setup).toContain("practice && i > 0 ? 'ai' : 'human'");
    expect(setup).toContain('defaultTypes(4, practice)');
  });
});
