// Stage 40.1 — production deploys wait for CI. A string-level pin on the Blueprint: the
// behaviour itself is Render's, and a hand-made service needs the dashboard toggle
// (RENDER_DEPLOY.md → "Deploy only after CI").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
/** YAML with its comments removed, so a commented-out example cannot satisfy a check. */
const yaml = read('render.yaml').split(/\r?\n/).map((l) => l.replace(/\s+#.*$/, '').replace(/^\s*#.*$/, '')).join('\n');

describe('render.yaml — deploy only after CI passes', () => {
  it('asks Render to wait for the commit checks', () => {
    expect(yaml).toMatch(/^\s*autoDeployTrigger:\s*checksPass\s*$/m);
  });

  it('does not also carry the deprecated switch that deployed every push', () => {
    expect(yaml).not.toMatch(/^\s*autoDeploy:/m);
  });

  it('the check Render waits for is the one that runs the whole gate on main', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(ci).toContain('run: npm run verify');
  });

  it('secrets stay out of the Blueprint: the voice relay entries are commented examples', () => {
    expect(yaml).not.toContain('VOICE_TURN_SECRET');
    expect(yaml).not.toContain('ROOM_STORAGE');
    expect(read('RENDER_DEPLOY.md')).toContain('After CI Checks Pass');
  });
});
