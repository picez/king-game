// ---------------------------------------------------------------------------
// Fifty-One LAYOUT QA gate (Stage 38.0.4).
//
//   node scripts/fiftyone-layout-qa.mjs [--legacy] [--shots <dir>] [--only <substr>]
//
// The owner hit two real defects on a phone: a 4-card meld was CLIPPED (the block was
// capped at 18rem while four 72px cards plus gaps need ~320px, and the row scrolled
// inside itself), and the floating social cluster sat ON TOP of the melds.
//
// This gate renders the REAL FiftyOneGameScreen in a REAL browser (scripts/layout-harness/
// fiftyone.html) and asserts on actual `getBoundingClientRect()` values — screenshots are
// evidence, not the assertion. `--legacy` re-applies the pre-fix CSS so the RED can be
// reproduced on demand instead of being described.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const WebSocket = createRequire(`${process.cwd()}/package.json`)('ws');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9252;
const VITE_PORT = 5199;
const BASE = `http://localhost:${VITE_PORT}/scripts/layout-harness/fiftyone.html`;

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const LEGACY = args.includes('--legacy');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fetchJson = (p) => new Promise((res, rej) => get(`http://127.0.0.1:${CDP_PORT}${p}`, (r) => {
  let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)));
}).on('error', rej));

async function waitHttp(url, timeout = 90000) {
  const start = Date.now();
  for (;;) {
    try { await new Promise((res, rej) => get(url, (r) => { r.resume(); res(r.statusCode); }).on('error', rej)); return; }
    catch { if (Date.now() - start > timeout) throw new Error(`not up: ${url}`); await sleep(200); }
  }
}
async function waitDevtools(timeout = 15000) {
  const start = Date.now();
  for (;;) {
    try { return await fetchJson('/json/version'); }
    catch { if (Date.now() - start > timeout) throw new Error('chrome devtools not up'); await sleep(150); }
  }
}

class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); }
  open() {
    return new Promise((res) => {
      this.ws.on('open', res);
      this.ws.on('message', (m) => {
        const o = JSON.parse(m.toString());
        if (o.id && this.pending.has(o.id)) { this.pending.get(o.id)(o); this.pending.delete(o.id); }
      });
    });
  }
  send(method, params = {}, timeoutMs = 12000) {
    const id = ++this.id;
    return new Promise((res) => {
      const done = (v) => { clearTimeout(timer); this.pending.delete(id); res(v); };
      const timer = setTimeout(() => done({ __timeout: true }), timeoutMs);
      this.pending.set(id, done);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r?.__timeout) return undefined;
    return r.result?.result?.value;
  }
}

// --- the in-page probe -------------------------------------------------------
const PROBE = `JSON.stringify((() => {
  const S = 0.5;
  const vw = window.innerWidth;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const live = (r) => r.w > 0.5 && r.h > 0.5;
  const all = (sel) => [...document.querySelectorAll(sel)].map(rect).filter(live);
  const one = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = rect(el); return live(r) ? r : null; };
  const hit = (a, b) => !!a && !!b && a.l < b.r - S && b.l < a.r - S && a.t < b.b - S && b.t < a.b - S;
  const ov = (a, b) => Math.round(Math.min(a.r, b.r) - Math.max(a.l, b.l)) + 'x' + Math.round(Math.min(a.b, b.b) - Math.max(a.t, b.t));

  const v = [];
  const add = (kind, detail) => v.push(kind + ': ' + detail);

  const melds = [...document.querySelectorAll('.fiftyone-meld')];
  const prompt = one('.fiftyone-prompt');
  const actions = one('.fiftyone-actions');
  const hand = one('.hand-reorder') || one('.fiftyone-hand') || one('.hand');
  const cluster = one('.social-controls');
  const panels = [...all('.chat-drawer'), ...all('.reaction-bar')];

  melds.forEach((meld, mi) => {
    const row = meld.querySelector('.fiftyone-meld__cards');
    if (!row) return;
    const rowRect = rect(row);
    const cards = [...row.children].map(rect).filter(live);
    const label = 'meld' + mi + '(' + cards.length + ')';

    // 1. every card must be FULLY inside its row's visible box — no clipping…
    for (const cd of cards) {
      if (cd.l < rowRect.l - S || cd.r > rowRect.r + S) add('card-clipped', label + ' ' + Math.round(cd.l) + '..' + Math.round(cd.r) + ' vs row ' + Math.round(rowRect.l) + '..' + Math.round(rowRect.r));
      if (cd.w < 28) add('card-squeezed', label + ' ' + Math.round(cd.w) + 'px');
    }
    // …and the row must not hide anything behind an internal scroll.
    if (row.scrollWidth > Math.ceil(rowRect.w) + 1) add('meld-inner-scroll', label + ' ' + row.scrollWidth + '>' + Math.round(rowRect.w));

    // 2. no two cards of a meld may overlap, and a positive gap must remain.
    const sorted = [...cards].sort((a, b) => (a.t - b.t) || (a.l - b.l));
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      if (hit(a, b)) add('card-overlap', label + ' ' + ov(a, b));
      const sameRow = Math.abs(a.t - b.t) < 2;
      if (sameRow && b.l - a.r < 1) add('no-gap', label + ' ' + Math.round(b.l - a.r) + 'px');
    }
    // 3. a wrapped row must not spill out of its own meld block.
    const mr = rect(meld);
    for (const cd of cards) {
      if (cd.b > mr.b + S) add('card-outside-meld', label);
    }
  });

  // 4. meld blocks must not intersect each other.
  const mrs = melds.map(rect).filter(live);
  for (let i = 0; i < mrs.length; i++) {
    for (let j = i + 1; j < mrs.length; j++) if (hit(mrs[i], mrs[j])) add('meld-overlap', i + '|' + j + ' ' + ov(mrs[i], mrs[j]));
  }

  // 5. the social cluster + its panels must not cover the game content.
  const content = [...mrs, prompt, actions, hand].filter(Boolean);
  if (cluster) for (const cEl of content) if (hit(cluster, cEl)) add('social-over-content', ov(cluster, cEl));
  for (const p of panels) for (const cEl of content) if (hit(p, cEl)) add('panel-over-content', ov(p, cEl));

  // 6. page-level horizontal overflow + touch targets.
  if (document.documentElement.scrollWidth > vw + 1) add('page-overflow-x', document.documentElement.scrollWidth + '>' + vw);
  for (const b of document.querySelectorAll('.social-controls button, .fiftyone-meld__ctrls button')) {
    const r = rect(b);
    if (live(r) && (r.w < 43.5 || r.h < 43.5)) add('touch-target', (b.textContent || '?').trim().slice(0, 12) + ' ' + Math.round(r.w) + 'x' + Math.round(r.h));
  }

  return { violations: v, melds: melds.length, hasPrompt: !!prompt };
})())`;

const VIEWPORTS = [
  { tag: '360', w: 360, h: 800, mobile: true },
  { tag: '390', w: 390, h: 844, mobile: true },
  { tag: 'desktop', w: 1280, h: 900, mobile: false },
];

function scenarios() {
  const out = [];
  for (const players of [2, 3, 4]) {
    out.push({ name: `${players}p`, q: `players=${players}` });
    out.push({ name: `${players}p-social`, q: `players=${players}&social=${LEGACY ? 'float' : 'dock'}` });
  }
  out.push({ name: '4p-rtl', q: 'players=4&dir=rtl&lang=ar' });
  out.push({ name: '4p-rtl-social', q: `players=4&dir=rtl&lang=ar&social=${LEGACY ? 'float' : 'dock'}` });
  return out.map((s) => ({ ...s, q: LEGACY ? `${s.q}&legacy=1` : s.q }));
}

async function run() {
  let alreadyUp = false;
  try { await waitHttp(`${BASE}?players=4`, 1500); alreadyUp = true; } catch { /* start one */ }
  const vite = alreadyUp ? null : spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(VITE_PORT), '--strictPort'],
    { stdio: 'ignore', shell: process.platform === 'win32' });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${process.env.TEMP || '/tmp'}/kg-f51-qa`, 'about:blank',
  ], { stdio: 'ignore' });

  const failures = [];
  let checks = 0;
  try {
    await waitHttp(`${BASE}?players=4`, 90000);
    await waitDevtools();
    for (const vp of VIEWPORTS) {
      const targets = await fetchJson('/json');
      const page = targets.find((t) => t.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile, screenWidth: vp.w, screenHeight: vp.h });
      console.log(`\n[${vp.tag} ${vp.w}x${vp.h}]${LEGACY ? ' (LEGACY / RED)' : ''}`);

      for (const sc of scenarios().filter((x) => !ONLY || x.name.includes(ONLY))) {
        await cdp.send('Page.navigate', { url: `${BASE}?${sc.q}` });
        let mounted = false;
        for (let i = 0; i < 50; i++) {
          if (await cdp.evaluate(`!!document.querySelector('.fiftyone-meld')`)) { mounted = true; break; }
          await sleep(100);
        }
        await sleep(140);
        if (!mounted) { failures.push(`${vp.tag} ${sc.name}: NO melds rendered (harness broken)`); continue; }

        const res = JSON.parse(await cdp.evaluate(PROBE));
        checks++;
        for (const violation of res.violations) failures.push(`${vp.tag} ${sc.name}: ${violation}`);
        if (SHOTS) {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          if (shot?.result?.data) writeFileSync(`${SHOTS}/${LEGACY ? 'RED-' : ''}${vp.tag}-${sc.name}.png`, Buffer.from(shot.result.data, 'base64'));
        }
        console.log(`  ${sc.name.padEnd(16)} ${res.violations.length ? `FAIL(${res.violations.length}) ${res.violations.slice(0, 2).join(' | ')}` : 'ok'}`);
      }
    }
  } finally {
    chrome.kill();
    if (vite) vite.kill();
  }

  console.log(`\n${checks} Fifty-One layout checks run.`);
  if (failures.length) {
    console.log(`\n${failures.length} VIOLATION(S):`);
    for (const f of failures.slice(0, 50)) console.log('  - ' + f);
    if (failures.length > 50) console.log(`  … ${failures.length - 50} more`);
    process.exitCode = 1;
  } else {
    console.log('FIFTY-ONE LAYOUT OK — melds fully visible, no overlap, social clear of the game.');
  }
}

await run();
