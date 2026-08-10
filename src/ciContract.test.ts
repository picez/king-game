// ---------------------------------------------------------------------------
// (Stage 38.0.18) What CI is REQUIRED to do — asserted, not assumed.
//
// Before this suite existed, nothing in the repo failed if `.github/workflows/ci.yml`
// silently lost a step, and the audit that prompted this stage found two genuine holes that
// had gone unnoticed exactly that way: the SERVER was never typechecked in CI (both `tsc`
// runs used `tsconfig.json`, whose `include` is `["src"]`), and the online E2E never ran.
//
// The lockfile `libc` policy lives here for a second reason: it must be machine-enforced and
// it must work on Windows. The previous "enforcement" was a `grep -c` one-liner a human was
// expected to type. Node reads JSON on every platform, so the check runs identically in CI
// and on a developer's machine, through the same `npm test`.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const workflow = read('.github/workflows/ci.yml');
const pkg = JSON.parse(read('package.json')) as {
  version: string;
  scripts: Record<string, string>;
};

/** The `run:` lines of the workflow, trimmed — what CI actually executes. */
function runSteps(): string[] {
  return workflow
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('run:'))
    .map((l) => l.slice('run:'.length).trim());
}

describe('CI contract — the workflow file is structurally sound', () => {
  it('is a single valid-looking workflow with the expected triggers', () => {
    expect(workflow).toMatch(/^name: CI$/m);
    expect(workflow).toMatch(/^on:$/m);
    expect(workflow).toMatch(/branches: \[main\]/);
    expect(workflow).toMatch(/pull_request:/);
    expect(workflow).toMatch(/runs-on: ubuntu-latest/);
  });

  it('uses no tabs — YAML forbids them for indentation, and one would break the whole run', () => {
    expect(workflow).not.toContain('\t');
  });

  it('every step in the list starts at the same indentation, and its keys sit deeper', () => {
    // No YAML parser is installed and none may be added, so this checks the one structural
    // mistake that actually happens by hand: a step or a key indented to the wrong column.
    // GitHub would reject the file outright; this fails locally instead, in a second.
    const lines = workflow.split(/\r?\n/);
    const stepsAt = lines.findIndex((l) => /^\s*steps:\s*$/.test(l));
    expect(stepsAt, 'the job must declare a steps: list').toBeGreaterThan(0);

    const body = lines.slice(stepsAt + 1).filter((l) => l.trim() && !l.trim().startsWith('#'));
    const indent = (l: string) => l.length - l.trimStart().length;
    const stepStarts = body.filter((l) => l.trimStart().startsWith('- '));
    expect(stepStarts.length).toBeGreaterThanOrEqual(3);

    const stepIndent = indent(stepStarts[0]);
    for (const l of stepStarts) expect(indent(l), `misaligned step: "${l}"`).toBe(stepIndent);
    // A step's own keys (`name:`, `run:`, `env:`, `with:`) must be nested under the dash.
    for (const l of body) {
      if (l.trimStart().startsWith('- ')) continue;
      expect(indent(l), `key not nested inside a step: "${l}"`).toBeGreaterThan(stepIndent);
    }
  });

  it('pins Node 22 and installs with npm ci, never npm install', () => {
    expect(workflow).toMatch(/node-version: '22'/);
    expect(runSteps()).toContain('npm ci');
    for (const step of runSteps()) expect(step).not.toMatch(/\bnpm install\b/);
  });
});

describe('CI contract — the gaps found in the Stage 38.0.18 audit stay closed', () => {
  const steps = runSteps();
  const covered = (needle: string) => steps.some((s) => s.includes(needle));

  it('runs `npm run verify`, which is what carries the server typecheck and the E2E', () => {
    expect(covered('npm run verify'), `CI steps were: ${JSON.stringify(steps)}`).toBe(true);
  });

  it('applies the DB migrations before the suite, so the integration tests do not self-skip', () => {
    expect(covered('npm run db:migrate')).toBe(true);
    expect(workflow).toContain('TEST_DATABASE_URL');
    // Ordering matters: migrating after the tests would leave them skipped and green.
    // Compared over the STEP list, not the raw text — the header comment names both
    // commands long before either step appears, which made a naive indexOf compare a
    // comment against a step.
    const order = runSteps();
    expect(order.findIndex((s) => s.includes('npm run db:migrate')))
      .toBeLessThan(order.findIndex((s) => s.includes('npm run verify')));
  });

  // These four are the actual requirement. CI satisfies them THROUGH `verify`, so the
  // assertion is on the verify chain rather than on four separate workflow steps —
  // otherwise the two could drift apart again, which is the failure this stage fixed.
  it('the verify chain contains the server typecheck', () => {
    expect(pkg.scripts.verify).toContain('typecheck:server');
    expect(pkg.scripts['typecheck:server']).toContain('tsconfig.server.json');
  });

  it('the verify chain contains the tests', () => {
    expect(pkg.scripts.verify).toMatch(/\bnpm (run )?test\b/);
    expect(pkg.scripts.test).toContain('vitest');
  });

  it('the verify chain contains the production build, which is where the CLIENT typecheck lives', () => {
    expect(pkg.scripts.verify).toContain('npm run build');
    expect(pkg.scripts.build).toMatch(/^tsc\b/);
    expect(pkg.scripts.build).toContain('vite build');
  });

  it('the verify chain contains the online E2E', () => {
    expect(pkg.scripts.verify).toContain('npm run e2e');
    expect(pkg.scripts.e2e).toContain('scripts/e2e-online.mjs');
  });

  it('does not re-run the tests or the build outside verify (no duplicated pipeline)', () => {
    const outside = runSteps().filter((s) => !s.includes('npm run verify'));
    for (const step of outside) {
      expect(step, `"${step}" duplicates work verify already does`).not.toMatch(/^npm test$/);
      expect(step).not.toMatch(/^npm run build$/);
      expect(step).not.toMatch(/^npx tsc\b/);
    }
  });

  it('does not run the browser/layout gates — this runner installs no Chrome', () => {
    for (const step of runSteps()) expect(step).not.toMatch(/layout:/);
  });
});

describe('CI contract — lockfile policy, enforced in Node so it works on every platform', () => {
  // Read as text, not as parsed JSON: the policy is about the KEY existing anywhere in the
  // file, and a parse-and-walk would have to know every shape npm might nest it in.
  const lock = read('package-lock.json');

  it('package-lock.json contains zero "libc" fields', () => {
    const count = (lock.match(/"libc"\s*:/g) ?? []).length;
    expect(
      count,
      'npm 11 re-adds `libc` optional-dep fields that npm 10 cannot reconcile, which is what '
      + 'broke `npm ci`. Regenerate the lockfile with npm 10, or revert the churn.',
    ).toBe(0);
  });

  it('the package name "detect-libc" is not mistaken for the policy violation', () => {
    // Guards the guard: `detect-libc` is a legitimate dependency whose NAME contains the
    // string. A looser check (grep for `libc`) would fail on it forever.
    expect(lock).toContain('detect-libc');
    expect((lock.match(/"libc"\s*:/g) ?? []).length).toBe(0);
  });

  it('the lockfile and package.json agree on the version', () => {
    const parsed = JSON.parse(lock) as { version: string; packages: Record<string, { version?: string }> };
    expect(parsed.version).toBe(pkg.version);
    expect(parsed.packages['']?.version).toBe(pkg.version);
  });
});
