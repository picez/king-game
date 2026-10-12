// ---------------------------------------------------------------------------
// FOLD AUDIT (table redesign, stage 2) — a read-only measurement, not a gate.
//
//   node scripts/fold-audit.mjs [--game <tag>] [--shots <dir>]
//
// For every game it mounts the REAL online branch (scripts/layout-harness/social-games)
// and reports, per viewport: how many screens tall the stage is, and where the player's
// hand and action row sit relative to the bottom of the screen. This is the number the
// redesign exists to drive to 1.00 — Fifty-One was 1.94 at 360×640 before Stage 39.0.
//
// Plain, it asserts nothing and exits 0: use it to decide what to move, and to prove it
// moved. With `--assert` (`npm run layout:fold`) it is a GATE for the games already on the
// table shell: one screen tall, and the hand + action row inside it, at every viewport.
// ---------------------------------------------------------------------------
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openOwnedPage, applyViewport, CdpSession } from './lib/cdp-owned-target.mjs';
import { runWithQaRuntime } from './lib/qa-processes.mjs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9264;
const VITE_PORT = 5211;
const BASE = `http://localhost:${VITE_PORT}/scripts/layout-harness/social-games.html`;

const args = process.argv.slice(2);
const ONLY = args.includes('--game') ? args[args.indexOf('--game') + 1] : null;
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const ASSERT = args.includes('--assert');

/**
 * Games on the table shell, and the viewports where each is KNOWN not to fit yet. An entry
 * here is a debt with a reason, not a pass: deleting one must be earned by a green run.
 *   preferans, phone landscape — the harness scene is the viewer's own auction turn, and the
 *   five-row bid ladder is taller than a 375px screen leaves beside the hand; the stage
 *   scrolls (the shell's safety valve) instead of clipping. Portrait fits.
 * King and Poker are not on the shell yet and are measured but never asserted.
 */
const ON_SHELL = {
  fiftyone: [], tarneeb: [], deberc: [], durak: [],
  preferans: ['667x375', '844x390'],
};
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `hand` / `actions` = what a player must reach to move; `board` = the table itself. */
const GAMES = [
  { tag: 'king', q: 'game=king&seats=4', hand: '.game-footer', actions: null, board: '.game-body' },
  { tag: 'durak', q: 'game=durak&seats=4', hand: '.hand-reorder-wrap', actions: '.durak-controls', board: '.durak-board' },
  { tag: 'deberc', q: 'game=deberc&seats=4', hand: '.hand-reorder-wrap', actions: null, board: '.durak-board' },
  { tag: 'tarneeb', q: 'game=tarneeb&seats=4', hand: '.hand-reorder-wrap', actions: null, board: '.tarneeb-board' },
  { tag: 'preferans', q: 'game=preferans&seats=3', hand: '.hand-reorder-wrap', actions: null, board: '.preferans-board' },
  { tag: 'fiftyone', q: 'game=fiftyone&seats=4', hand: '.hand-reorder-wrap', actions: '.fiftyone-actions', board: '.fiftyone-table' },
  { tag: 'poker', q: 'game=poker&seats=6', hand: '.poker-hero__cards', actions: '.poker-actions', board: '.poker-table' },
];

const VIEWPORTS = [
  { tag: '360x640', w: 360, h: 640, mobile: true },
  { tag: '360x800', w: 360, h: 800, mobile: true },
  { tag: '390x844', w: 390, h: 844, mobile: true },
  { tag: '667x375', w: 667, h: 375, mobile: true },
  { tag: '844x390', w: 844, h: 390, mobile: true },
  { tag: '768x1024', w: 768, h: 1024, mobile: true },
  { tag: '1366x768', w: 1366, h: 768, mobile: false },
];

const probe = (g) => `JSON.stringify((() => {
  const box = (sel) => {
    if (!sel) return null;
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { t: Math.round(r.top + scrollY), b: Math.round(r.bottom + scrollY), h: Math.round(r.height) };
  };
  const stage = box('.game-stage');
  const cards = [...document.querySelectorAll(${JSON.stringify(g.hand)} + ' .card')];
  const rows = new Set(cards.map((e) => Math.round(e.getBoundingClientRect().top))).size;
  return {
    vh: innerHeight, stage, hand: box(${JSON.stringify(g.hand)}), actions: box(${JSON.stringify(g.actions)}),
    board: box(${JSON.stringify(g.board)}), cards: cards.length, rows,
    cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
  };
})())`;

const rows = [];
const failures = [];
await runWithQaRuntime({
  name: 'kg-fold-audit', vitePort: VITE_PORT, cdpPort: CDP_PORT, chromePath: CHROME,
  chromeArgs: ['--disable-gpu', '--hide-scrollbars'], failures,
}, async () => {
  for (let i = 0; i < 400; i++) {
    try { const r = await fetch(`${BASE}?game=durak`); if (r.ok) break; } catch { /* not up yet */ }
    await sleep(250);
  }
  const owned = await openOwnedPage(CDP_PORT, CdpSession);
  const cdp = owned.cdp;
  for (const g of GAMES.filter((x) => !ONLY || x.tag === ONLY)) {
    for (const vp of VIEWPORTS) {
      await applyViewport(owned, vp, { screenWidth: vp.w, screenHeight: vp.h });
      await cdp.send('Page.navigate', { url: `${BASE}?${g.q}&panel=none` });
      for (let i = 0; i < 80; i++) {
        if (await cdp.evaluate(`!!document.querySelector('.game-stage') && !!document.querySelector(${JSON.stringify(g.hand)})`)) break;
        await sleep(100);
      }
      await sleep(500);
      const r = JSON.parse(await cdp.evaluate(probe(g)));
      const last = r.actions ?? r.hand;
      const row = {
        game: g.tag, vp: vp.tag,
        screens: r.stage ? +(r.stage.h / r.vh).toFixed(2) : null,
        handTop: r.hand?.t ?? null, reachBottom: last?.b ?? null,
        // > 0 = this many px of the hand/action row are below the first screen.
        belowFold: last ? Math.max(0, last.b - r.vh) : null,
        boardH: r.board?.h ?? null, cards: r.cards, rows: r.rows, cardW: r.cardW, overflowX: r.overflowX,
      };
      rows.push(row);
      console.log(`${g.tag.padEnd(10)} ${vp.tag.padEnd(9)} screens=${String(row.screens).padEnd(5)} hand@${String(row.handTop).padEnd(5)} reach.bottom=${String(row.reachBottom).padEnd(5)} belowFold=${String(row.belowFold).padEnd(5)} board.h=${String(row.boardH).padEnd(5)} cards=${row.cards} rows=${row.rows} cardW=${row.cardW}${row.overflowX ? ' OVERFLOW-X' : ''}`);
      if (SHOTS) {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: true });
        const data = shot?.result?.data ?? shot?.data;
        if (data) writeFileSync(join(SHOTS, `${g.tag}-${vp.tag}.jpg`), Buffer.from(data, 'base64'));
      }
    }
  }
});
if (SHOTS) writeFileSync(join(SHOTS, 'fold-audit.json'), JSON.stringify(rows, null, 1));
if (failures.length) console.log('runtime notes:', failures.join(' | '));
if (ASSERT) {
  const bad = [];
  for (const r of rows) {
    const known = ON_SHELL[r.game];
    if (!known) continue;                                   // not on the shell yet
    const fits = r.screens != null && r.screens <= 1.005 && r.belowFold === 0 && !r.overflowX;
    if (known.includes(r.vp)) {
      if (fits) bad.push(`${r.game} ${r.vp}: now FITS — remove it from the known-debt list`);
      continue;
    }
    if (r.screens == null) bad.push(`${r.game} ${r.vp}: no .game-stage rendered`);
    else if (!fits) bad.push(`${r.game} ${r.vp}: ${r.screens} screens, ${r.belowFold}px of the hand/actions below the fold${r.overflowX ? ', horizontal overflow' : ''}`);
  }
  const asserted = rows.filter((r) => ON_SHELL[r.game] && !ON_SHELL[r.game].includes(r.vp)).length;
  if (bad.length) {
    console.log(['', `FOLD BUDGET FAILED (${bad.length}):`, ...bad.map((b) => `  - ${b}`)].join('\n'));
    process.exit(1);
  }
  console.log(['', `FOLD BUDGET OK — ${asserted} game×viewport checks: one screen, hand and actions inside it.`].join('\n'));
}
