// ---------------------------------------------------------------------------
// (Stage 38.0.16.2d) The shared QA process runtime, tested without a browser.
//
// These use REAL listeners and REAL child processes — but never Chrome, never vite, never a
// fixed port — so `npm test` runs them on CI in a second. What they guard is everything the
// leak audit found: a port check that only looked at one loopback stack, an ownership query
// that matched itself, a "the child exited so we are done" shortcut that left the real
// browser running, and a cleanup that had to be safe to call twice.
//
// The browser-driven halves (a gate refusing a hijacked port, a gate leaving nothing behind)
// are phases 7-9 of `npm run layout:selftest`.
// ---------------------------------------------------------------------------
import { describe, it, expect, afterEach } from 'vitest';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canBind, portOwners, assertPortsFree, waitPortsFree, processAlive, childGone,
  pidsMatchingMarker, killByMarker, killTreeAndWait, cleanupLine, cleanupFailures,
  resolveViteCli,
} from './qa-processes.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listeners = [];
const kids = [];
const dirs = [];

/** A real listener on an ephemeral port, on one stack only. */
function occupy(host) {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, host, () => { listeners.push(s); res({ server: s, port: s.address().port }); });
  });
}
/**
 * A real process whose command line carries `--user-data-dir=<dir>` — the same ownership
 * shape Chrome and its children have, with none of the cost of a browser.
 */
function dummy(dir) {
  // `--` first: without it node parses `--user-data-dir` as one of ITS options and exits 9.
  const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', '--', `--user-data-dir=${dir}`],
    { shell: false, stdio: 'ignore', windowsHide: true });
  kids.push(c);
  return c;
}
function tempProfile(prefix = 'kg-test-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  for (const s of listeners.splice(0)) { try { s.close(); } catch { /* closed */ } }
  for (const c of kids.splice(0)) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  for (const d of dirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
  await sleep(50);
});

describe('port preflight covers BOTH loopback stacks', () => {
  it('reports a port free when nothing holds it', async () => {
    const { server, port } = await occupy('127.0.0.1');
    await new Promise((r) => server.close(r));
    expect(await canBind(port)).toBe(true);
  });

  it('catches an IPv4-only squatter', async () => {
    const { port } = await occupy('127.0.0.1');
    expect(await canBind(port)).toBe(false);
  });

  it('catches an IPv6-only squatter — the case a 127.0.0.1 check waved through', async () => {
    // A leaked vite bound to [::1]:5199 while 127.0.0.1:5199 still accepted a bind, so the
    // old guard let the run start and `waitHttp` was then served by the STALE server.
    const { port } = await occupy('::1');
    expect(await canBind(port)).toBe(false);
  });

  it('assertPortsFree names the port, the role and the PID holding it', async () => {
    const { port } = await occupy('::1');
    const err = await assertPortsFree([{ port, what: 'vite' }]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('refusing to start');
    expect(err.message).toContain(`vite port ${port}`);
    expect(err.message).toContain(String(process.pid));
    expect(err.message).toContain("somebody else's browser");
  });

  it('assertPortsFree passes silently when every port is free', async () => {
    const { server, port } = await occupy('127.0.0.1');
    await new Promise((r) => server.close(r));
    await expect(assertPortsFree([{ port, what: 'vite' }])).resolves.toBeUndefined();
  });

  it('portOwners finds the pid of a real listener', async () => {
    const { port } = await occupy('127.0.0.1');
    expect(portOwners(port)).toContain(String(process.pid));
  });

  it('waitPortsFree reports who still holds a port instead of hanging', async () => {
    const { port } = await occupy('::1');
    const r = await waitPortsFree([{ port, what: 'vite' }], 600);
    expect(r.free).toBe(false);
    expect(r.heldBy.join(' ')).toContain(`vite:${port}`);
  });
});

describe('ownership by profile marker', () => {
  it('finds a process carrying the marker as --user-data-dir', async () => {
    const dir = tempProfile();
    const c = dummy(dir);
    await sleep(700);
    expect(pidsMatchingMarker(dir)).toContain(c.pid);
  });

  it('does NOT match the query process itself', async () => {
    // The first version put the marker on the PowerShell query's own command line, so every
    // clean run reported one "surviving" process that was the query.
    const dir = tempProfile();
    const pids = pidsMatchingMarker(dir);
    expect(pids).toEqual([]);
  });

  it('ignores a process that merely MENTIONS the path without the flag', async () => {
    // A shell command, a log tail or an editor holding the path must never be killed.
    const dir = tempProfile();
    const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', '--', `mentions ${dir}`],
      { shell: false, stdio: 'ignore', windowsHide: true });
    kids.push(c);
    await sleep(700);
    expect(pidsMatchingMarker(dir)).not.toContain(c.pid);
  });

  it('does not match a DIFFERENT run\'s marker', async () => {
    const mine = tempProfile();
    const theirs = tempProfile();
    const c = dummy(theirs);
    await sleep(700);
    expect(pidsMatchingMarker(mine)).not.toContain(c.pid);
  });
});

describe('cleanup finds what the direct child left behind', () => {
  it('a bootstrap that EXITED does not mean the real process is gone', async () => {
    // Chrome's launcher pid re-execs itself and exits; the real browser keeps the port. This
    // is the composition `stop()` uses: the child is gone AND no marked process survives.
    const dir = tempProfile();
    const real = dummy(dir);
    await sleep(700);
    const bootstrap = { pid: 999999, exitCode: 0, signalCode: null };
    expect(childGone(bootstrap)).toBe(true);           // the child really did exit…
    expect(pidsMatchingMarker(dir)).toContain(real.pid); // …and the real one is still running
    expect(childGone(bootstrap) && pidsMatchingMarker(dir).length === 0).toBe(false);
  });

  it('killByMarker kills the re-parented process', async () => {
    const dir = tempProfile();
    const real = dummy(dir);
    await sleep(700);
    const killed = await killByMarker(dir);
    expect(killed).toContain(real.pid);
    await sleep(300);
    expect(pidsMatchingMarker(dir)).toEqual([]);
    expect(processAlive(real.pid)).toBe(false);
  });

  it('killByMarker leaves a foreign marker alone', async () => {
    const mine = tempProfile();
    const theirs = tempProfile();
    const stranger = dummy(theirs);
    await sleep(700);
    const killed = await killByMarker(mine);
    expect(killed).toEqual([]);
    await sleep(200);
    expect(processAlive(stranger.pid)).toBe(true);
  });

  it('killByMarker is idempotent — a second pass is a no-op', async () => {
    const dir = tempProfile();
    dummy(dir);
    await sleep(700);
    expect((await killByMarker(dir)).length).toBeGreaterThan(0);
    expect(await killByMarker(dir)).toEqual([]);
    expect(await killByMarker(dir)).toEqual([]);
  });

  it('the profile is only removable once nothing holds it', async () => {
    const dir = tempProfile();
    const c = dummy(dir);
    writeFileSync(join(dir, 'lock'), 'x');
    await sleep(500);
    await killByMarker(dir);
    await sleep(300);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    expect(existsSync(dir)).toBe(false);
    expect(processAlive(c.pid)).toBe(false);
  });
});

describe('process liveness', () => {
  it('processAlive is true for a running child and false once it is gone', async () => {
    const dir = tempProfile();
    const c = dummy(dir);
    await sleep(400);
    expect(processAlive(c.pid)).toBe(true);
    expect(await killTreeAndWait(c, 8000)).toBe(true);
    expect(processAlive(c.pid)).toBe(false);
  });

  it('processAlive says false for a pid that cannot exist', () => {
    expect(processAlive(999999)).toBe(false);
    expect(processAlive(0)).toBe(false);
    expect(processAlive(undefined)).toBe(false);
  });

  it('killTreeAndWait on an already-dead child is a no-op that still reports success', async () => {
    const dir = tempProfile();
    const c = dummy(dir);
    await killTreeAndWait(c, 8000);
    expect(await killTreeAndWait(c, 2000)).toBe(true);
  });
});

describe('the cleanup verdict', () => {
  const ok = {
    chromeDead: true, chromeChildGone: true, survivors: [], viteDead: true, dirRemoved: true,
    portsFree: true, heldBy: [], orphans: [1, 2], vitePid: 10, chromePid: 20, userDataDir: 'D',
  };
  it('a clean report is no failure at all', () => {
    expect(cleanupFailures(ok)).toEqual([]);
    expect(cleanupLine(ok)).toContain('ports free');
    expect(cleanupLine(ok)).toContain('+2 re-parented');
  });
  it('names each leak separately, so the cause is readable', () => {
    expect(cleanupFailures({ ...ok, chromeChildGone: false })[0]).toContain('pid 20');
    expect(cleanupFailures({ ...ok, survivors: [77, 78] })[0]).toContain('77, 78');
    expect(cleanupFailures({ ...ok, viteDead: false })[0]).toContain('vite pid 10');
    expect(cleanupFailures({ ...ok, dirRemoved: false })[0]).toContain('profile D');
    expect(cleanupFailures({ ...ok, portsFree: false, heldBy: ['vite:1 held by 9'] })[0]).toContain('vite:1 held by 9');
  });
  it('a run that never cleaned up is a failure, not a silent pass', () => {
    expect(cleanupFailures(null)).toEqual(['cleanup never ran']);
    expect(cleanupLine(null)).toBe('cleanup: NOT RUN');
  });
});

describe('vite is resolved from the installed package, never through a shell', () => {
  it('points at a real bin/vite.js in this workspace', () => {
    const cli = resolveViteCli();
    expect(cli.replace(/\\/g, '/')).toMatch(/node_modules\/vite\/bin\/vite\.js$/);
    expect(existsSync(cli)).toBe(true);
  });
});
