// ---------------------------------------------------------------------------
// (Stage 38.0.18) `withProcessGuard` — the four exits that must all clean up.
//
// The audit that prompted this stage measured, in `scripts/e2e-online.mjs`, a lifecycle that
// cleaned up on exactly two of them: it tore the server down when the run returned and when
// it threw, and did nothing at all on a timeout (there was no watchdog) or on Ctrl-C (there
// was no signal handler). So this suite drives all four — returned, threw, timed out and
// SIGINT — against REAL child processes, and asserts the process table agrees they are gone.
//
// The SIGINT case is the one worth explaining. The production handler ends in
// `process.exit(130)`, which in a test would take the runner with it, so `withProcessGuard`
// takes an injectable `exit`. Everything else on that path — the listener registration, the
// cleanup, the report — is the real code; only the final syscall is captured.
// ---------------------------------------------------------------------------
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'node:net';
import {
  withProcessGuard, spawnManaged, stopManaged, managedCount, processAlive,
  processGuardLine, resolveTsxCli, resolveLocalCli,
} from './qa-processes.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strays = [];

/** A real, long-lived child that will never exit on its own. */
function sleeper() {
  const child = spawnManaged(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], { stdio: 'ignore' });
  strays.push(child);
  return child;
}

afterEach(async () => {
  while (strays.length) await stopManaged(strays.pop()).catch(() => {});
});

/** Wait for the OS to reap the pid — a kill is asynchronous even when the API is not. */
async function goneWithin(pid, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (!processAlive(pid)) return true;
    await sleep(100);
  }
  return !processAlive(pid);
}

describe('withProcessGuard — exit 1 of 4: the body returned', () => {
  it('kills everything the run spawned and stops tracking it', async () => {
    let pid;
    const result = await withProcessGuard({ name: 'guard-success' }, async () => {
      pid = sleeper().pid;
      expect(processAlive(pid)).toBe(true);
      return 'done';
    });
    expect(result).toBe('done');
    expect(await goneWithin(pid)).toBe(true);
    expect(managedCount()).toBe(0);
  });

  it('a child the body already stopped is not double-counted or resurrected', async () => {
    const result = await withProcessGuard({ name: 'guard-selfstop' }, async () => {
      const child = sleeper();
      expect(await stopManaged(child)).toBe(true);
      expect(managedCount()).toBe(0);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(managedCount()).toBe(0);
  });

  it('supports a restart mid-run — the second process is owned just like the first', async () => {
    let firstPid; let secondPid;
    await withProcessGuard({ name: 'guard-restart' }, async () => {
      const a = sleeper();
      firstPid = a.pid;
      await stopManaged(a);
      const b = sleeper();
      secondPid = b.pid;
    });
    expect(await goneWithin(firstPid)).toBe(true);
    expect(await goneWithin(secondPid)).toBe(true);
    expect(managedCount()).toBe(0);
  });
});

describe('withProcessGuard — exit 2 of 4: the body threw', () => {
  it('propagates the error AND still kills the children', async () => {
    let pid;
    await expect(withProcessGuard({ name: 'guard-throw' }, async () => {
      pid = sleeper().pid;
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(await goneWithin(pid)).toBe(true);
    expect(managedCount()).toBe(0);
  });
});

describe('withProcessGuard — exit 3 of 4: the run hung', () => {
  it('the watchdog fires, the wait ends, and nothing is left running', async () => {
    let pid;
    const started = Date.now();
    await expect(withProcessGuard({ name: 'guard-timeout', timeoutMs: 400 }, async () => {
      pid = sleeper().pid;
      // The exact shape of the old bug: a promise that never settles.
      await new Promise(() => {});
    })).rejects.toThrow(/timed out after 400ms/);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(await goneWithin(pid)).toBe(true);
    expect(managedCount()).toBe(0);
  });

  it('a run that finishes inside the budget is not touched by the watchdog', async () => {
    const out = await withProcessGuard({ name: 'guard-in-time', timeoutMs: 5000 }, async () => {
      await sleep(50);
      return 'fast';
    });
    expect(out).toBe('fast');
  });
});

describe('withProcessGuard — exit 4 of 4: Ctrl-C', () => {
  it('registers SIGINT/SIGTERM/SIGHUP handlers only for the duration of the run', async () => {
    const before = process.listenerCount('SIGINT');
    await withProcessGuard({ name: 'guard-handlers' }, async () => {
      expect(process.listenerCount('SIGINT')).toBe(before + 1);
      expect(process.listenerCount('SIGTERM')).toBeGreaterThan(0);
      expect(process.listenerCount('SIGHUP')).toBeGreaterThan(0);
    });
    // Leaving a handler behind would make every later run accumulate one.
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('SIGINT during the run kills the children and exits 130', async () => {
    const exits = [];
    let pid;
    let deadBeforeBodyReturned = null;
    await withProcessGuard({ name: 'guard-sigint', exit: (c) => exits.push(c) }, async () => {
      pid = sleeper().pid;
      // The real production listener, invoked the way the terminal invokes it.
      process.emit('SIGINT');
      // Look BEFORE the `finally` block runs. Without this the assertion would be satisfied
      // by the ordinary end-of-run cleanup and would pass just as happily with no signal
      // handler at all — which is precisely the bug being guarded.
      deadBeforeBodyReturned = await goneWithin(pid, 6000);
      // NOT asserted here: `managedCount() === 0`. The process is dead well before
      // `killTreeAndWait` returns (it polls, and only consults the process table after a
      // second), so the bookkeeping entry can still be present at this instant. That is a
      // timing detail of the killer, not the contract — the contract is "the child is gone
      // and we are on our way out", and both halves of that are asserted.
    });
    expect(exits).toContain(130);
    expect(deadBeforeBodyReturned, 'the SIGINT handler must kill the child, not the finally block').toBe(true);
    expect(managedCount()).toBe(0);
  });

  // (Stage 38.0.19) The regression for the defect that turned CI red at 82b7904.
  //
  // The handler was `async` and fire-and-forget: nothing awaited it. Two symptoms came out
  // of that single omission, and which one appeared was pure timing —
  //   Linux/CI : the guard returned before the handler reached `exit()`, so the assertion
  //              above read an EMPTY array ("expected [] to include 130");
  //   Windows  : `finally` started a SECOND cleanup while the handler's was still running,
  //              so one run walked the same MANAGED set twice and printed two reports.
  // The test above can only ever catch the first. This one catches the CAUSE, on every
  // platform, by counting the teardowns: exactly one run, exactly one cleanup.
  it('a signalled run tears down exactly ONCE, and has finished doing so before it returns', async () => {
    // Spied on `console`, NOT on `process.stdout.write`: vitest replaces the console inside
    // a worker, so a stream-level patch sees nothing and the count would be a silent zero.
    const reports = [];
    const record = (...args) => {
      const s = args.map(String).join(' ');
      if (s.includes('processes: ')) reports.push(s.trim());
    };
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(record),
      vi.spyOn(console, 'error').mockImplementation(record),
    ];

    const exits = [];
    try {
      await withProcessGuard({ name: 'guard-once', exit: (c) => exits.push(c) }, async () => {
        sleeper();
        // Body returns immediately after the signal — the exact ordering CI hit, and the
        // one that leaves the handler in flight if nothing holds its promise.
        process.emit('SIGINT');
      });
    } finally {
      for (const s of spies) s.mockRestore();
    }

    expect(reports.length, `one run must produce one teardown, got:\n${reports.join('\n')}`).toBe(1);
    // Read at the instant the guard resolved — no polling, no grace period. If the handler
    // were still in flight this is empty, which is precisely the CI failure.
    expect(exits, 'the guard returned before its own signal handler finished').toEqual([130]);
    expect(managedCount()).toBe(0);
  });
});

describe('withProcessGuard — the port preflight', () => {
  it('refuses to start on top of a port somebody else holds, and names the pid', async () => {
    const srv = createServer();
    const port = await new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
    try {
      await expect(withProcessGuard(
        { name: 'guard-ports', ports: [{ port, what: 'test server' }] },
        async () => 'never reached',
      )).rejects.toThrow(/refusing to start/);
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it('reports cleanly when the ports came back', async () => {
    const out = await withProcessGuard(
      { name: 'guard-freeport', ports: [{ port: 45_099, what: 'unused' }] },
      async () => 'ok',
    );
    expect(out).toBe('ok');
  });
});

describe('processGuardLine — the report is a measurement, not a hope', () => {
  it('says NOT RUN when there is no report at all', () => {
    expect(processGuardLine(null)).toContain('NOT RUN');
  });
  it('names survivors and held ports rather than claiming success', () => {
    const line = processGuardLine({ killed: 2, survivors: [111], portsFree: false, heldBy: ['x:1 held by 9'] });
    expect(line).toContain('SURVIVORS 111');
    expect(line).toContain('HELD');
  });
  it('reads clean only when nothing survived', () => {
    const line = processGuardLine({ killed: 1, survivors: [], portsFree: true, heldBy: [] });
    expect(line).toContain('all gone');
    expect(line).toContain('ports free');
  });
});

describe('the CLI resolvers keep the shell out of the spawn', () => {
  it('resolves the installed tsx CLI to a real file', () => {
    const cli = resolveTsxCli();
    expect(cli).toMatch(/tsx[\\/]dist[\\/]cli\.mjs$/);
  });

  it('fails loudly for a package that is not installed, instead of falling back to npx', () => {
    expect(() => resolveLocalCli('definitely-not-installed-xyz', ['bin', 'x.js']))
      .toThrow(/not found|run npm ci/);
  });
});
