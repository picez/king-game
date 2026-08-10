// ---------------------------------------------------------------------------
// (Stage 38.0.16.2c.2) ONE owner for every process a browser gate creates.
//
// WHY THIS EXISTS — measured, not assumed. Before a single line of this stage ran, the
// machine held 56 orphaned QA processes: four whole headless Chrome trees
// (`kg-vp-probe` :9266, `kg-f51-qa` :9252, `kg-layout-qa` :9251, `kg-raf-probe` :9271) and
// six vite servers (:5199, :5207, :5208, :5211, :5212, :5214), none of them with a live
// parent. The gates start their helpers like this:
//
//     spawn(`npx vite --port ${PORT} --strictPort`, { shell: true })
//
// On Windows that is `cmd.exe -c npx …`, so `child.pid` is the SHELL. `npx` then spawns
// node, which spawns the real vite: the thing we want to kill is a great-grandchild.
// `child.kill()` kills the shell and orphans the rest — which is exactly what the listing
// above shows (`node vite.js --port 5199` with a dead parent).
//
// A leaked vite makes the NEXT run's `--strictPort` bind fail, and a leaked Chrome holds
// the debugging port, so the next Chrome silently fails to open it and the gate's
// `waitDevtools` connects to the PREVIOUS run's browser instead. Two gates then drive the
// same pages. So the fix is not a bigger hammer after the fact — it is to never create the
// wrapper:
//
//   * vite is launched as `process.execPath node_modules/vite/bin/vite.js`, `shell: false`,
//     so `child.pid` IS vite;
//   * Chrome is launched directly (it already was) with a user-data-dir created by
//     `mkdtemp` for THIS run alone, so cleanup can delete it without touching a browser
//     profile that belongs to somebody else;
//   * the ports are proved free BEFORE anything starts — a busy port fails the run with the
//     PID that holds it, rather than quietly attaching to a stranger's browser;
//   * `stop()` kills each tree, waits for the pids to really be gone, removes only the
//     directory this run made, and proves the ports came back.
//
// Nothing here searches for "chrome.exe" or "vite" by name: only pids this module spawned
// are ever signalled.
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The vite CLI already installed in this workspace. Never `npx`, never a shell. */
export function resolveViteCli(cwd = process.cwd()) {
  let root = join(cwd, 'node_modules', 'vite');
  try {
    const require_ = createRequire(join(cwd, 'package.json'));
    root = join(require_.resolve('vite/package.json'), '..');
  } catch { /* package exports may hide package.json — the path above is the fallback */ }
  const cli = join(root, 'bin', 'vite.js');
  if (!existsSync(cli)) throw new Error(`vite CLI not found at ${cli} — run npm ci first`);
  return cli;
}

/**
 * True when nothing is listening on the port — on EITHER loopback stack.
 *
 * Checking only `127.0.0.1` is not enough and it was measured: a leaked vite from an earlier
 * run held `[::1]:5201` while `127.0.0.1:5201` still accepted a bind. The guard would have
 * waved the run through, the new vite's `--strictPort` would have failed against the IPv6
 * listener, and `waitHttp` would then have been served by the STALE server — the same class
 * of silent hijack as attaching to somebody else's browser.
 */
const LOOPBACKS = ['127.0.0.1', '::1'];
function bindable(port, host) {
  return new Promise((res) => {
    const s = createServer();
    // A host this machine cannot bind at all (no IPv6 stack) is not evidence of a squatter.
    s.once('error', (e) => res(e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT'));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(port, host);
  });
}
export async function canBind(port) {
  for (const host of LOOPBACKS) if (!(await bindable(port, host))) return false;
  return true;
}

/** The pids listening on a port — the evidence a "port is busy" failure has to carry. */
export function portOwners(port) {
  const win = process.platform === 'win32';
  const r = win
    ? spawnSync('netstat', ['-ano'], { encoding: 'utf8' })
    : spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  const out = r.stdout || '';
  if (!win) return [...new Set(out.split(/\s+/).filter(Boolean))];
  const rx = new RegExp(`[:.]${port}\\s`);
  return [...new Set(out.split(/\r?\n/)
    .filter((l) => rx.test(l) && /LISTENING/i.test(l))
    .map((l) => l.trim().split(/\s+/).pop())
    .filter(Boolean))];
}

/**
 * Is this pid still alive?
 *
 * NOT `process.kill(pid, 0)` on Windows: while node still holds a handle to a child it
 * spawned, `OpenProcess` keeps succeeding after that child has exited, so the check answers
 * "alive" for a process that is already gone. Measured on exactly that: Chrome's launcher
 * pid was reported alive by `signal 0` after it had exited and been reaped. `tasklist` reads
 * the real process table and does not have that blind spot.
 */
export function processAlive(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
    return (r.stdout || '').trim().startsWith('"');
  }
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** A child we spawned is gone when node saw it exit, or the process table agrees. */
export function childGone(child) {
  if (!child?.pid) return true;
  return child.exitCode !== null || child.signalCode !== null || !processAlive(child.pid);
}

/**
 * Kill a spawned helper AND its children.
 *
 * NOTE the missing `if (child.exitCode !== null) return`. That guard is what kept the leak
 * alive after the shell wrapper was removed, and it was measured: launched directly with
 * `shell: false`, `chrome.exe` pid 15680 re-executed itself as pid 48480 — the real BROWSER,
 * with six children of its own — and then EXITED. By cleanup time the direct child had an
 * exit code, the guard returned early, `taskkill` never ran, and the orphaned browser kept
 * port 9254 and a lock on the profile directory. "The process we spawned has exited" is
 * simply not the same fact as "the process we started is gone".
 */
export function killTree(child) {
  const pid = child?.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    // Harmless if the pid is already gone; the point is the /T tree walk.
    try { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); return; }
    catch { /* fall through to the plain kill */ }
  }
  try { child.kill(); } catch { /* already gone */ }
}

/**
 * Every process launched with THIS run's profile directory as its `--user-data-dir`.
 *
 * Ownership is proved by two facts together, never by a process name: the directory is one
 * `mkdtemp` made for this run alone, and the command line carries it as the `--user-data-dir`
 * flag. Chrome repeats that flag on every child it forks, so the whole tree matches, while a
 * process that merely mentions the path — a shell command someone typed, a log tail — does
 * not. The marker travels in the ENVIRONMENT, not on the query's own command line: putting it
 * in the command made the query match itself, which is how a clean run first reported one
 * "surviving" process that was the query.
 */
const OWNER_FLAG = '--user-data-dir';
export function pidsMatchingMarker(marker) {
  if (process.platform !== 'win32') {
    const r = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    return (r.stdout || '').split(/\r?\n/)
      .filter((l) => l.includes(marker) && l.includes(OWNER_FLAG))
      .map((l) => Number(l.trim().split(/\s+/)[0]))
      .filter((p) => Number.isInteger(p) && p !== process.pid && p !== process.ppid);
  }
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '$m = $env:KG_QA_MARKER; $f = $env:KG_QA_FLAG;'
    + ' Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($m)'
    + ' -and $_.CommandLine.Contains($f) } | Select-Object -ExpandProperty ProcessId'],
  { encoding: 'utf8', env: { ...process.env, KG_QA_MARKER: marker, KG_QA_FLAG: OWNER_FLAG } });
  return (r.stdout || '').split(/\r?\n/)
    .map((l) => Number(l.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p !== process.pid && p !== process.ppid);
}

/** Kill everything carrying this run's marker, twice, so a re-parented child cannot survive. */
export async function killByMarker(marker) {
  const killed = new Set();
  for (let pass = 0; pass < 2; pass++) {
    const pids = pidsMatchingMarker(marker);
    if (!pids.length) break;
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL'); killed.add(pid); } catch { /* already gone */ }
    }
    await sleep(250);
  }
  return [...killed];
}

/** Kill it and WAIT: "we sent a signal" is not the same fact as "the process is gone". */
export async function killTreeAndWait(child, timeoutMs = 10000) {
  if (!child?.pid) return true;
  killTree(child);
  const start = Date.now();
  // The cheap check first — node's own exit bookkeeping — and only fall back to reading the
  // process table, which costs a spawn, when that has not settled.
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    await sleep(150);
    if (Date.now() - start > 1000 && !processAlive(child.pid)) return true;
  }
  return childGone(child);
}

/** Refuse to start on top of somebody else's run, and say whose it is. */
export async function assertPortsFree(ports) {
  const busy = [];
  for (const { port, what } of ports) {
    if (await canBind(port)) continue;
    busy.push(`${what} port ${port} is held by PID(s) ${portOwners(port).join(', ') || 'unknown'}`);
  }
  if (busy.length) {
    throw new Error(
      `refusing to start: a previous run is still alive.\n  ${busy.join('\n  ')}\n`
      + '  Attaching to it would drive somebody else\'s browser. Kill those pids and retry.');
  }
}

/** Wait for the ports to come back, and report who still holds them if they do not. */
export async function waitPortsFree(ports, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const busy = [];
    for (const p of ports) if (!(await canBind(p.port))) busy.push(p);
    if (!busy.length) return { free: true, heldBy: [] };
    if (Date.now() - start > timeoutMs) {
      return { free: false, heldBy: busy.map((b) => `${b.what}:${b.port} held by ${portOwners(b.port).join(',') || '?'}`) };
    }
    await sleep(200);
  }
}

/**
 * Start vite + Chrome for one gate run and hand back a handle that can prove it cleaned up.
 * `name` only seeds the temp profile directory; nothing is ever matched by name.
 */
export async function startQaRuntime({ name, vitePort, cdpPort, chromePath, host = null, chromeArgs = [] }) {
  const ports = [{ port: vitePort, what: 'vite' }, { port: cdpPort, what: 'chrome devtools' }];
  await assertPortsFree(ports);

  const viteCli = resolveViteCli();
  const vite = spawn(process.execPath, [
    viteCli, '--port', String(vitePort), '--strictPort', ...(host ? ['--host', host] : []),
  ], { shell: false, stdio: 'ignore', windowsHide: true });

  // A profile of our own, so cleanup deletes only what this run created.
  const userDataDir = mkdtempSync(join(tmpdir(), `${name}-`));
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${cdpPort}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${userDataDir}`, ...chromeArgs, 'about:blank',
  ], { shell: false, stdio: 'ignore', windowsHide: true });

  // A run that is INTERRUPTED never reaches its `finally`, so it leaks the browser and the
  // server and the next run then finds its ports taken. Measured while building this: piping
  // a gate into `head` closed stdout, killed the run, and left Chrome holding 9254. Ctrl-C,
  // a broken pipe and an uncaught throw now all clean up on the way out.
  const onSignal = async (signal) => {
    try { await runtime.stop(); } catch { /* nothing left to do on the way out */ }
    process.exit(signal === 'EPIPE' ? 1 : 130);
  };
  const handlers = [
    ['SIGINT', () => onSignal('SIGINT')], ['SIGTERM', () => onSignal('SIGTERM')],
    ['SIGHUP', () => onSignal('SIGHUP')],
  ];
  for (const [sig, fn] of handlers) process.on(sig, fn);
  process.on('uncaughtException', (e) => {
    if (e?.code === 'EPIPE') return onSignal('EPIPE');
    throw e;
  });

  const runtime = {
    vite, chrome, userDataDir, vitePort, cdpPort, report: null,
    async stop() {
      if (runtime.report) return runtime.report;
      for (const [sig, fn] of handlers) process.off(sig, fn);
      // 1. the pid we hold, plus its tree;
      await killTreeAndWait(chrome);
      // 2. …and whatever Chrome re-parented away from it, identified by THIS run's profile
      //    directory. Without this the browser survives its own launcher's exit.
      const orphans = await killByMarker(userDataDir);
      // Reported as two separate facts, because they fail for different reasons: the pid we
      // spawned, and anything Chrome re-parented away from it.
      const chromeChildGone = childGone(chrome);
      const survivors = pidsMatchingMarker(userDataDir);
      const chromeDead = chromeChildGone && survivors.length === 0;
      const viteDead = await killTreeAndWait(vite);
      // The profile can only be removed once nothing is holding a lock on it.
      try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }); }
      catch { /* reported through existsSync below */ }
      const dirRemoved = !existsSync(userDataDir);
      const p = await waitPortsFree(ports);
      runtime.report = {
        chromeDead, chromeChildGone, survivors, viteDead, dirRemoved,
        portsFree: p.free, heldBy: p.heldBy, orphans,
        vitePid: vite.pid, chromePid: chrome.pid, userDataDir,
      };
      return runtime.report;
    },
  };
  return runtime;
}

/** One line a gate prints at the end so "we cleaned up" is a measurement, not a hope. */
export function cleanupLine(report) {
  if (!report) return 'cleanup: NOT RUN';
  return `cleanup: chrome(${report.chromePid}) ${report.chromeDead ? 'gone' : 'STILL ALIVE'}`
    + ` +${report.orphans?.length ?? 0} re-parented`
    + ` | vite(${report.vitePid}) ${report.viteDead ? 'gone' : 'STILL ALIVE'}`
    + ` | profile ${report.dirRemoved ? 'removed' : 'LEFT BEHIND'}`
    + ` | ports ${report.portsFree ? 'free' : `HELD (${report.heldBy.join('; ')})`}`;
}

/** Anything in the report that means the run leaked. Empty array = a clean exit. */
export function cleanupFailures(report) {
  if (!report) return ['cleanup never ran'];
  const bad = [];
  if (!report.chromeChildGone) bad.push(`the chrome process we spawned (pid ${report.chromePid}) survived the run`);
  if (report.survivors?.length) bad.push(`chrome processes carrying this run's profile survived: ${report.survivors.join(', ')}`);
  if (!report.viteDead) bad.push(`vite pid ${report.vitePid} survived the run`);
  if (!report.dirRemoved) bad.push(`the run's profile ${report.userDataDir} was left behind`);
  if (!report.portsFree) bad.push(`ports still held: ${report.heldBy.join('; ')}`);
  return bad;
}
