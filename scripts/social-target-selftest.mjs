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
// Every failure prints: requested | targetId | targetUrl | innerWidth | clientWidth |
// mmThreshold | gridColumns.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { openOwnedPage, devtools, waitDevtools, applyViewport, checkViewport, VIEWPORT_PROBE } from './lib/cdp-owned-target.mjs';

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

async function main() {
  const vite = spawn(`npx vite --port ${VITE_PORT} --strictPort --host 127.0.0.1`, { shell: true, stdio: 'ignore' });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${process.env.TEMP || '/tmp'}/kg-target-selftest`, 'about:blank',
  ], { stdio: 'ignore' });

  const failures = [];
  let checks = 0;
  let decoy = null;
  let owned = null;
  try {
    await waitHttp(BASE);
    await waitDevtools(CDP_PORT);

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
  } finally {
    try { if (owned) await owned.close(); } catch { /* gone */ }
    try { if (decoy) await decoy.close(); } catch { /* gone */ }
    try { chrome.kill(); } catch { /* gone */ }
    try { vite.kill(); } catch { /* gone */ }
  }

  console.log(`\n${checks} target/viewport checks run.`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('TARGET SELF-TEST OK — the gate owns its page, and every viewport is the one it asked for.');
  }
}
main();
