// ---------------------------------------------------------------------------
// (Stage 38.0.16.2c) CDP TARGET-IDENTITY + VIEWPORT-CONSISTENCY self-test.
//
//   node scripts/social-target-selftest.mjs         (npm run layout:selftest)
//
// The layout gates measure geometry in a real browser, so a measurement is only worth
// anything if we can say WHICH document produced it. The old acquisition rule could not:
//
//     const page = (await fetchJson('/json')).find((t) => t.type === 'page');
//
// It creates nothing, asserts nothing, and returns whichever page target happens to be
// listed first. This script proves that concretely instead of asserting it in prose:
//
//   PHASE 1 — identity. A DECOY page is created and emulated at 2560, then an OWNED page
//     at 390. The old rule is run against the live browser and its pick is compared with
//     the owned target id; the new rule is pinned to the owned id. The owned page must
//     report innerWidth 390 and `matchMedia('(min-width: 1620px)') === false` — whatever
//     the decoy is doing next to it.
//   PHASE 2 — no stale emulation. The owned page is driven 390 → 2560 → 390, re-probed
//     after every override, so an override that failed to apply (or applied to the wrong
//     document) cannot hide behind a previous width.
//   PHASE 3 — viewport/media consistency on the REAL harness, at every width the layout
//     gate uses: requested == innerWidth, matchMedia agrees with innerWidth, the page has
//     a <meta name="viewport">, and `clientWidth` is reported beside `innerWidth` because
//     `scrollbar-gutter: stable` makes them differ — a media query answers on innerWidth
//     while the layout only ever gets clientWidth.
//
//   PHASE 4-5 — (38.0.16.2c.1) the MAIN gate's navigation path restores a drifted viewport,
//     retry included, with the RED demonstrated in the same run.
//   PHASE 6 — (38.0.16.2c.2) the post-navigation proof is ATOMIC: one round-trip returning a
//     RESOLVED object. The `JSON.stringify(Promise)` shape is shown still producing `{}`, and
//     a malformed probe produces one NAMED harness failure that keeps geometry locked.
//   PHASE 7 — a CDP command that never answers is a typed `CdpTimeoutError` carrying method,
//     context, targetId, budget and pending count; nothing is left in the pending map; an
//     unknown method answers with an error rather than a timeout; and a socket closed with a
//     command in flight rejects it as `CdpClosedError` instead of leaking the promise.
//   PHASE 8 — the REAL layout gate, run as a child with `--fault cdp-timeout`, exits
//     non-zero in bounded time, names the method, and gives its ports back.
//
// Every failure prints: requested | targetId | targetUrl | innerWidth | clientWidth |
// mmThreshold | gridColumns.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import {
  openOwnedPage, devtools, applyViewport, checkViewport, resetScroll, VIEWPORT_PROBE,
  PROOF_PROBE, validateProof, CdpTimeoutError, CdpClosedError,
} from './lib/cdp-owned-target.mjs';
import { startQaRuntime, cleanupLine, cleanupFailures, canBind, portOwners } from './lib/qa-processes.mjs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9268;
const VITE_PORT = 5218;
const BASE = `http://127.0.0.1:${VITE_PORT}/scripts/layout-harness/social-games.html`;
const THRESHOLDS = [1440, 1620];
const WIDTHS = [360, 390, 768, 1366, 1440, 1620, 1920, 2560];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, timeout = 120000) {
  const start = Date.now();
  for (;;) {
    try { await new Promise((res, rej) => get(url, (r) => { r.resume(); res(r.statusCode); }).on('error', rej)); return; }
    catch { if (Date.now() - start > timeout) throw new Error(`not up: ${url}`); await sleep(200); }
  }
}

/** The OLD rule, kept here only so the difference can be demonstrated, never used to measure. */
async function legacyPick(port) {
  const targets = await devtools(port, '/json');
  return (Array.isArray(targets) ? targets : []).find((t) => t.type === 'page') ?? null;
}

async function ready(cdp, marker, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (await cdp.evaluate(`!!document.querySelector('${marker}')`)) return true;
    await sleep(100);
  }
  return false;
}

/**
 * The MAIN gate's navigation lifecycle, reproduced here so the self-test exercises the same
 * order the gate uses: apply metrics → navigate → wait for the marker → prove the viewport →
 * reset the scroll → only then measure. It returns the proof so the caller can assert on it.
 */
async function gateLoad(owned, vp, url, label, failures, marker = '#root > *') {
  for (let attempt = 0; attempt < 2; attempt++) {
    await applyViewport(owned, vp);
    await owned.cdp.send('Page.navigate', { url });
    if (await ready(owned.cdp, marker)) {
      const probe = await checkViewport(owned, vp, THRESHOLDS, label, failures);
      await resetScroll(owned);
      return probe ? { ...probe, scrollY: await owned.cdp.json('Math.round(window.scrollY)') } : null;
    }
  }
  failures.push(`${label}: never rendered`);
  return null;
}

/** The layout gate's own ports — phase 8 proves the child run gives them back. */
const GATE_PORTS = [{ port: 5201, what: 'gate vite' }, { port: 9254, what: 'gate devtools' }];

/**
 * (38.0.16.2c.2) PHASE 8 runs the REAL gate as a child process with one CDP command
 * deliberately never answered. A gate that hangs cannot be caught by asserting on functions;
 * it has to be run and timed. `--viewport 390 --game durak --dir ltr --act typing-caret` is
 * the smallest honest selection that reaches the behaviour phase at all.
 */
function runGateWithFault() {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [
      'scripts/social-layout-qa.mjs',
      '--viewport', '390', '--game', 'durak', '--dir', 'ltr', '--act', 'typing-caret',
      '--fault', 'cdp-timeout', '--progress',
    ], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    // A generous ceiling: the point is that the gate dies far inside it, not at it.
    const guard = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, 300000);
    child.on('close', async (code) => {
      clearTimeout(guard);
      const seconds = Math.round((Date.now() - started) / 1000);
      // Give the child's own cleanup a moment, then check the ports it owned.
      await sleep(1500);
      const portsHeld = [];
      for (const p of GATE_PORTS) {
        if (!(await canBind(p.port))) portsHeld.push({ port: p.port, pids: portOwners(p.port) });
      }
      const firstFailureLine = (output.split(/\r?\n/).find((l) => l.includes('CdpTimeoutError')) || '').trim();
      resolve({ code, seconds, output, portsHeld, firstFailureLine });
    });
  });
}

async function main() {
  const runtime = await startQaRuntime({
    name: 'kg-target-selftest', vitePort: VITE_PORT, cdpPort: CDP_PORT, chromePath: CHROME,
    host: '127.0.0.1',
  });
  console.log(`  vite pid ${runtime.vite.pid} :${VITE_PORT} | chrome pid ${runtime.chrome.pid} :${CDP_PORT}`);

  const failures = [];
  let checks = 0;
  let decoy = null;
  let owned = null;
  let cleanup = null;
  try {
    await waitHttp(BASE);

    // ---- PHASE 1: identity, against a deliberately misleading decoy --------------------
    decoy = await openOwnedPage(CDP_PORT);
    await applyViewport(decoy, { w: 2560, h: 1440, mobile: false });
    await decoy.cdp.send('Page.navigate', { url: `${BASE}?game=king&seats=4&chat=6&panel=chat` });
    await ready(decoy.cdp, '#root > *');

    owned = await openOwnedPage(CDP_PORT);
    await applyViewport(owned, { w: 390, h: 844, mobile: true });
    await owned.cdp.send('Page.navigate', { url: `${BASE}?game=king&seats=4&chat=6&panel=chat` });
    if (!await ready(owned.cdp, '#root > *')) failures.push('owned page never rendered');

    const legacy = await legacyPick(CDP_PORT);
    const legacyId = legacy?.id ?? null;
    console.log(`  decoy target   ${decoy.targetId} @2560`);
    console.log(`  owned target   ${owned.targetId} @390`);
    console.log(`  legacy pick    ${legacyId ?? 'none'} ${legacyId === owned.targetId ? '(happened to be the owned one)' : '(NOT the owned one)'}`);
    checks++;
    // The point is not that the legacy rule always picks wrong — it is that it CANNOT say.
    // With more than one page target alive it has no identity to check, and here it is
    // demonstrably free to return a target we never emulated.
    const targets = await devtools(CDP_PORT, '/json');
    const pageCount = (Array.isArray(targets) ? targets : []).filter((t) => t.type === 'page').length;
    if (pageCount < 2) failures.push(`expected at least 2 page targets for the identity proof, saw ${pageCount}`);
    if (legacyId && legacyId !== owned.targetId) {
      console.log('  → the legacy rule attached to a page this run never emulated.');
    } else {
      console.log('  → the legacy rule happened to match this time; it still verifies nothing.');
    }

    const p1 = await checkViewport(owned, { w: 390, h: 844 }, THRESHOLDS, 'phase1 owned', failures);
    checks++;
    if (p1 && p1.mm[1620] !== false) failures.push(`phase1: matchMedia(1620) is ${p1.mm[1620]} on a 390 page`);
    if (p1 && Math.abs(p1.innerWidth - 390) > 1) failures.push(`phase1: owned innerWidth ${p1.innerWidth}`);
    // …and the decoy really is wide, so the two documents cannot be confused.
    const dp = await decoy.cdp.json(VIEWPORT_PROBE(THRESHOLDS));
    checks++;
    if (!dp || dp.innerWidth < 2000) failures.push(`phase1: the decoy is not wide (${dp?.innerWidth})`);

    // ---- PHASE 2: 390 → 2560 → 390, no stale emulation ---------------------------------
    for (const vp of [{ w: 390, h: 844, mobile: true }, { w: 2560, h: 1440, mobile: false }, { w: 390, h: 844, mobile: true }]) {
      await applyViewport(owned, vp);
      await owned.cdp.send('Page.navigate', { url: `${BASE}?game=king&seats=4&chat=6&panel=chat` });
      if (!await ready(owned.cdp, '#root > *')) failures.push(`phase2 ${vp.w}: page never rendered`);
      const p = await checkViewport(owned, vp, THRESHOLDS, `phase2 ${vp.w}`, failures);
      checks++;
      console.log(`  phase2 ${String(vp.w).padEnd(5)} inner ${p?.innerWidth} client ${p?.clientWidth} mm1620 ${p?.mm[1620]} target ${owned.targetId}`);
    }

    // ---- PHASE 3: consistency at every width the layout gate uses ----------------------
    console.log('  req    inner  client dpr  mm1440 mm1620 meta cols');
    for (const w of WIDTHS) {
      const vp = { w, h: 900, mobile: w < 700 };
      await applyViewport(owned, vp);
      await owned.cdp.send('Page.navigate', { url: `${BASE}?game=king&seats=4&chat=6&panel=chat` });
      if (!await ready(owned.cdp, '#root > *')) { failures.push(`phase3 ${w}: page never rendered`); continue; }
      const p = await checkViewport(owned, vp, THRESHOLDS, `phase3 ${w}`, failures);
      checks++;
      if (!p) continue;
      console.log(`  ${String(w).padEnd(6)} ${String(p.innerWidth).padEnd(6)} ${String(p.clientWidth).padEnd(6)} ${String(p.dpr).padEnd(4)} `
        + `${String(p.mm[1440]).padEnd(6)} ${String(p.mm[1620]).padEnd(6)} ${String(p.meta).padEnd(4)} ${p.gridColumns}`);
      // The gutter is a fact the thresholds must respect, not a surprise: report it.
      if (p.innerWidth - p.clientWidth > 0 && p.innerWidth - p.clientWidth !== 15) {
        console.log(`         (scrollbar gutter ${p.innerWidth - p.clientWidth}px)`);
      }
    }
    // ---- PHASE 4: the MAIN gate's navigation path restores the viewport ---------------
    // (38.0.16.2c.1) The regression that matters. 38.0.16.2c proved the HELPER in isolation
    // while `social-layout-qa.mjs` still navigated many times per override, so a metrics
    // drift between scenarios would ride into real geometry assertions. Here the override is
    // deliberately corrupted between navigations, in both directions, and a load must put it
    // back — the retry path included.
    for (const [want, drift] of [[{ w: 390, h: 844, mobile: true }, { w: 2560, h: 1440, mobile: false }],
      [{ w: 2560, h: 1440, mobile: false }, { w: 390, h: 844, mobile: true }]]) {
      // 1. establish the wanted viewport through the gate's own lifecycle
      const first = await gateLoad(owned, want, `${BASE}?game=king&seats=4&chat=6&panel=chat`, `phase4 ${want.w} first`, failures);
      checks++;
      if (first?.innerWidth !== want.w) failures.push(`phase4: first load reported ${first?.innerWidth}, wanted ${want.w}`);
      // 2. corrupt it behind the gate's back, exactly as a stale override would
      await owned.cdp.send('Emulation.setDeviceMetricsOverride', {
        width: drift.w, height: drift.h, deviceScaleFactor: 1, mobile: drift.mobile });
      const drifted = await owned.cdp.json(VIEWPORT_PROBE(THRESHOLDS));
      checks++;
      if (drifted?.innerWidth !== drift.w) failures.push(`phase4: the drift did not take (${drifted?.innerWidth})`);
      console.log(`  phase4 wanted ${want.w}, drifted to ${drifted?.innerWidth}`);
      // 2b. RED, measured in the same run: the 81d8fed navigation path (navigate + wait, no
      // re-applied metrics) carries the drifted viewport straight into a measurement. This
      // is what the gate used to do before every single geometry assertion.
      await owned.cdp.send('Page.navigate', { url: `${BASE}?game=king&seats=4&chat=6&panel=chat` });
      await ready(owned.cdp, '#root > *');
      const blind = await owned.cdp.json(VIEWPORT_PROBE(THRESHOLDS));
      checks++;
      console.log(`  phase4 RED  legacy navigate (no re-apply) measured ${blind?.innerWidth} while asking for ${want.w}`);
      if (blind?.innerWidth !== drift.w) {
        failures.push(`phase4 RED: the legacy path reported ${blind?.innerWidth}, expected the drifted ${drift.w}`
          + ` — the RED demonstration no longer reproduces, so the GREEN below proves nothing`);
      }
      // 3. the next load must restore it — this is what 81d8fed did NOT do
      const after = await gateLoad(owned, want, `${BASE}?game=king&seats=4&chat=6&panel=chat`, `phase4 ${want.w} after drift`, failures);
      checks++;
      if (after?.innerWidth !== want.w) {
        failures.push(`phase4: after the drift the load measured ${after?.innerWidth}, wanted ${want.w}`
          + ` | target ${owned.targetId} | ${after?.url} | client ${after?.clientWidth} | mm ${JSON.stringify(after?.mm ?? {})}`);
      }
      if (after && after.scrollY !== 0) failures.push(`phase4: scrollY ${after.scrollY} before measurement`);
      if (after && after.mm[1620] !== (want.w >= 1620)) failures.push(`phase4: mm1620 ${after.mm[1620]} at ${want.w}`);
      console.log(`  phase4 restored ${after?.innerWidth} client ${after?.clientWidth} scrollY ${after?.scrollY} target ${owned.targetId}`);
    }

    // ---- PHASE 5: a RETRY is a navigation and must re-prove ----------------------------
    // The first attempt is aimed at a marker that never appears, so `load()` retries; the
    // retry must re-apply the metrics rather than inherit whatever was left behind.
    await owned.cdp.send('Emulation.setDeviceMetricsOverride', { width: 2560, height: 1440, deviceScaleFactor: 1, mobile: false });
    const retried = await gateLoad(owned, { w: 390, h: 844, mobile: true },
      `${BASE}?game=king&seats=4&chat=6&panel=chat`, 'phase5 retry', failures, '#root > *');
    checks++;
    if (retried?.innerWidth !== 390) failures.push(`phase5: the retry path measured ${retried?.innerWidth}, wanted 390`);
    console.log(`  phase5 retry restored ${retried?.innerWidth} target ${owned.targetId}`);

    // ---- PHASE 6: the post-navigation proof is ATOMIC and really resolves --------------
    // The regression guarded here: `PROOF_PROBE` is an async IIFE. Wrapping it in
    // `JSON.stringify(...)` stringifies the PROMISE, so the probe comes back as `{}` and
    // every invariant it carries silently evaporates. One round-trip, one resolved object.
    const proof = await owned.cdp.evaluate(PROOF_PROBE(THRESHOLDS));
    checks++;
    if (!proof || typeof proof !== 'object') failures.push(`phase6: the proof probe returned ${JSON.stringify(proof)}`);
    if (!proof?.mm) failures.push('phase6: the resolved proof has no mm — it did not await');
    if (proof?.scrollY !== 0) failures.push(`phase6: scrollY ${proof?.scrollY} after the atomic proof`);
    if (Math.abs((proof?.innerWidth ?? 0) - 390) > 1) failures.push(`phase6: innerWidth ${proof?.innerWidth}, wanted 390`);
    if (!String(proof?.url ?? '').includes('social-games.html')) failures.push(`phase6: url ${proof?.url}`);
    console.log(`  phase6 atomic proof inner ${proof?.innerWidth} mm ${JSON.stringify(proof?.mm)} scrollY ${proof?.scrollY}`);

    // RED, measured in the same run: the JSON.stringify(Promise) shape really does yield {}.
    const stringified = JSON.parse(await owned.cdp.evaluate(`JSON.stringify(${PROOF_PROBE(THRESHOLDS)})`));
    checks++;
    if (stringified && Object.keys(stringified).length !== 0) {
      failures.push(`phase6 RED: JSON.stringify(Promise) produced ${JSON.stringify(stringified)} — the RED no longer reproduces`);
    }
    console.log(`  phase6 RED  JSON.stringify(Promise) = ${JSON.stringify(stringified)} (empty, as it must be)`);

    // …and a malformed result must produce a NAMED harness failure, never a layout one.
    for (const [what, bad] of [['{}', {}], ['undefined', undefined], ['no mm', { innerWidth: 390 }]]) {
      const lines = validateProof(bad, { w: 390, h: 844 }, THRESHOLDS, 'phase6 malformed', owned, BASE);
      checks++;
      if (lines.length !== 1 || !lines[0].includes('the proof probe returned')) {
        failures.push(`phase6: a ${what} probe produced ${JSON.stringify(lines)}, expected one clear harness failure`);
      }
      // The gate keys `proved` off exactly this array, so a non-empty result IS the
      // guarantee that no geometry runs after a failed proof.
      if (!lines.length) failures.push(`phase6: a ${what} probe would have UNLOCKED geometry`);
    }
    console.log('  phase6 malformed proofs → one named harness failure each, geometry stays locked');

    // ---- PHASE 7: a CDP timeout ENDS things, and leaves nothing pending -----------------
    // The behaviour hang this stage chased was not a deadlock: `send()` resolved
    // `{ __timeout: true }`, callers ignored it, and `load()`'s 200-step marker poll turned
    // one dead command into 200 × 20s of silent waiting. A timeout is now a typed error.
    // The promise is held by a timer on purpose: `new Promise(() => {})` has no reachable
    // resolver, so Chrome can collect it and answer immediately. A held one is genuinely
    // outstanding, which is what the budget is meant to bound.
    const NEVER = 'new Promise((r) => setTimeout(r, 600000))';
    owned.cdp.setContext('phase7 never-answering command');
    const t0 = Date.now();
    let timeoutErr = null;
    try {
      await owned.cdp.send('Runtime.evaluate',
        { expression: NEVER, returnByValue: true, awaitPromise: true }, 1500);
    } catch (e) { timeoutErr = e; }
    const elapsed = Date.now() - t0;
    checks++;
    if (!(timeoutErr instanceof CdpTimeoutError)) failures.push(`phase7: a never-answering command gave ${timeoutErr?.name ?? 'no error'}`);
    for (const [what, present] of [
      ['method', timeoutErr?.message.includes('Runtime.evaluate')],
      ['context', timeoutErr?.message.includes('phase7 never-answering command')],
      ['targetId', timeoutErr?.message.includes(String(owned.targetId))],
      ['timeout duration', timeoutErr?.message.includes('1500ms')],
      ['pending count', /\d+ command\(s\) pending/.test(timeoutErr?.message ?? '')],
    ]) if (!present) failures.push(`phase7: the timeout error does not name the ${what} — "${timeoutErr?.message}"`);
    if (elapsed > 4000) failures.push(`phase7: the timeout took ${elapsed}ms, budget was 1500ms`);
    if (owned.cdp.pending.size !== 0) failures.push(`phase7: ${owned.cdp.pending.size} command(s) left pending after the timeout`);
    console.log(`  phase7 timeout after ${elapsed}ms, pending ${owned.cdp.pending.size}, ${timeoutErr?.name}`);
    console.log(`         ${timeoutErr?.message}`);

    // A method that does not exist answers immediately with an error — it must NOT be
    // mistaken for a timeout, and it must not hang either.
    const bogus = await owned.cdp.send('Nonexistent.method', {}, 5000);
    checks++;
    if (!bogus?.error) failures.push(`phase7: an unknown CDP method returned ${JSON.stringify(bogus).slice(0, 120)}`);
    if (owned.cdp.pending.size !== 0) failures.push(`phase7: pending left behind after an error reply`);
    console.log(`  phase7 unknown method answered: ${bogus?.error?.message}`);

    // A socket that dies with commands in flight must reject every one of them.
    const doomed = await openOwnedPage(CDP_PORT);
    doomed.cdp.setContext('phase7 close-with-pending');
    const inFlight = doomed.cdp.send('Runtime.evaluate',
      { expression: NEVER, returnByValue: true, awaitPromise: true }, 30000);
    let closedErr = null;
    const settled = inFlight.then(() => 'resolved', (e) => { closedErr = e; return 'rejected'; });
    doomed.cdp.close();
    const outcome = await Promise.race([settled, sleep(5000).then(() => 'STILL PENDING')]);
    checks++;
    if (outcome !== 'rejected') failures.push(`phase7: closing the socket left the command ${outcome}`);
    if (!(closedErr instanceof CdpClosedError)) failures.push(`phase7: close produced ${closedErr?.name ?? 'nothing'}`);
    if (doomed.cdp.pending.size !== 0) failures.push(`phase7: ${doomed.cdp.pending.size} pending after close`);
    console.log(`  phase7 close-with-pending → ${closedErr?.name}, pending ${doomed.cdp.pending.size}`);
    try { await doomed.close(); } catch { /* the socket is already gone */ }

    // ---- PHASE 8: the REAL gate dies fast, and leaves nothing behind --------------------
    // Everything above proves the pieces. This proves the product: the layout gate itself,
    // with one command deliberately never answered, exits non-zero in bounded time, names
    // the method, and frees its ports.
    const gate = await runGateWithFault();
    checks++;
    if (gate.code === 0) failures.push(`phase8: the gate exited 0 with an injected CDP timeout`);
    if (gate.seconds > 240) failures.push(`phase8: the gate took ${gate.seconds}s to fail — that is not fail-fast`);
    for (const needle of ['CdpTimeoutError', 'Runtime.evaluate', 'context ', 'target ']) {
      if (!gate.output.includes(needle)) failures.push(`phase8: the gate's failure never mentioned "${needle}"`);
    }
    if (gate.output.includes('SOCIAL LAYOUT OK')) failures.push('phase8: the gate reported success while failing');
    for (const p of gate.portsHeld) failures.push(`phase8: the gate left port ${p.port} held by ${p.pids.join(',')}`);
    console.log(`  phase8 gate exit ${gate.code} in ${gate.seconds}s, ports released: ${gate.portsHeld.length === 0}`);
    console.log(`         ${gate.firstFailureLine}`);
  } finally {
    try { if (owned) await owned.close(); } catch { /* gone */ }
    try { if (decoy) await decoy.close(); } catch { /* gone */ }
    cleanup = await runtime.stop();
    console.log(`  ${cleanupLine(cleanup)}`);
  }

  for (const bad of cleanupFailures(cleanup)) failures.push(`cleanup: ${bad}`);
  console.log(`\n${checks} target/viewport checks run.`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('TARGET SELF-TEST OK — the gate owns its page, and every viewport is the one it asked for.');
  }
}
main().catch((e) => {
  console.error(`\nSELF-TEST HARNESS FAILURE: ${e?.name ?? 'Error'}`);
  console.error(e?.stack ?? String(e));
  process.exit(1);
});
