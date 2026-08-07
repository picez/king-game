// ---------------------------------------------------------------------------
// Profile → Statistics ONLINE TRACKER layout QA gate (Stage 38.0.6).
//
//   node scripts/profile-tracker-qa.mjs [--shots <dir>] [--only <substr>]
//
// Mounts the REAL `OnlineTrackerPanel` inside the REAL Profile → Statistics containers
// (scripts/layout-harness/tracker.html) and asserts on actual `getBoundingClientRect()`
// values in a real browser, after `document.fonts.ready` and two animation frames.
//
// What it proves (the owner's mobile/RTL requirements):
//   • no page-level horizontal overflow at 360 / 390;
//   • the chip strip scrolls INSIDE itself — the page never does;
//   • the two category cards stack vertically on a phone and never overlap;
//   • every chip is a ≥44×44 touch target;
//   • the tracker never overlaps the detailed statistics panel below it;
//   • numbers stay inside their card (no clipping) in LTR and Arabic RTL, and with
//     browser text scaling turned up.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const WebSocket = createRequire(`${process.cwd()}/package.json`)('ws');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9253;
const VITE_PORT = 5198;
const BASE = `http://localhost:${VITE_PORT}/scripts/layout-harness/tracker.html`;

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
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
  close() { try { this.ws.close(); } catch { /* already gone */ } }
  open() {
    return new Promise((res) => {
      this.ws.on('open', res);
      this.ws.on('message', (m) => {
        const o = JSON.parse(m.toString());
        if (o.id && this.pending.has(o.id)) { this.pending.get(o.id)(o); this.pending.delete(o.id); }
      });
    });
  }
  send(method, params = {}, timeoutMs = 20000) {
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

const SETTLE = `(async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  for (let i = 0; i < 60 && window.__trackerReady !== true; i++) await new Promise(r => setTimeout(r, 50));
  await new Promise((r) => requestAnimationFrame(() => r()));
  await new Promise((r) => requestAnimationFrame(() => r()));
  return { ready: window.__trackerReady === true };
})()`;

const PROBE = `JSON.stringify((() => {
  const S = 0.5;
  const vw = window.innerWidth;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const live = (r) => r.w > 0.5 && r.h > 0.5;
  const all = (sel, root) => [...(root || document).querySelectorAll(sel)].filter((e) => live(rect(e)));
  const one = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = rect(el); return live(r) ? r : null; };
  const hit = (a, b) => !!a && !!b && a.l < b.r - S && b.l < a.r - S && a.t < b.b - S && b.t < a.b - S;
  const ov = (a, b) => Math.round(Math.min(a.r, b.r) - Math.max(a.l, b.l)) + 'x' + Math.round(Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const inside = (c, p) => c.l >= p.l - S && c.r <= p.r + S && c.t >= p.t - S && c.b <= p.b + S;

  const v = [];
  const add = (kind, detail) => v.push(kind + ': ' + detail);

  const section = one('.online-tracker');
  if (!section) return { violations: ['tracker-missing: .online-tracker did not render'], cards: 0, chips: 0 };

  const strip = document.querySelector('.online-tracker__chips');
  const chips = all('.online-tracker__chip');
  const cards = all('.tracker-card');
  const note = one('.online-tracker__note');
  const detailed = one('#probe-detailed');
  const selector = one('.segmented--sub');

  // 1. the chip strip scrolls INSIDE itself; every chip is a real tap target.
  if (strip) {
    const sr = rect(strip);
    if (sr.r > vw + 1 || sr.l < -1) add('chips-off-screen', Math.round(sr.l) + '..' + Math.round(sr.r) + ' vs ' + vw);
    if (strip.scrollHeight > Math.ceil(strip.clientHeight) + 2) add('chips-vertical-scroll', strip.scrollHeight + '>' + strip.clientHeight);
  }
  for (const c of chips) {
    const r = rect(c);
    if (r.w < 43.5 || r.h < 43.5) add('touch-target', (c.textContent || '?').trim().slice(0, 10) + ' ' + Math.round(r.w) + 'x' + Math.round(r.h));
  }
  // Chips must not overlap each other.
  const crs = chips.map(rect);
  for (let i = 0; i < crs.length; i++) {
    for (let j = i + 1; j < crs.length; j++) if (hit(crs[i], crs[j])) add('chip-overlap', i + '|' + j + ' ' + ov(crs[i], crs[j]));
  }

  // 2. the two category cards: never overlapping, stacked on a phone, inside the section.
  const cardRects = cards.map(rect);
  for (let i = 0; i < cardRects.length; i++) {
    for (let j = i + 1; j < cardRects.length; j++) {
      if (hit(cardRects[i], cardRects[j])) add('card-overlap', i + '|' + j + ' ' + ov(cardRects[i], cardRects[j]));
    }
    if (!inside(cardRects[i], section)) add('card-outside-section', 'card' + i);
    if (cardRects[i].r > vw + 1) add('card-off-screen', 'card' + i + ' ' + Math.round(cardRects[i].r) + '>' + vw);
  }
  if (cardRects.length === 2 && vw < 560) {
    // On a phone they must be one under the other, not side by side.
    if (Math.abs(cardRects[0].t - cardRects[1].t) < 4) add('cards-not-stacked', 'both at y=' + Math.round(cardRects[0].t));
  }

  // 3. every number + label stays inside its own card (nothing clipped).
  cards.forEach((card, ci) => {
    const cr = rect(card);
    for (const el of all('.tracker-stat, .tracker-stat__value, .tracker-stat__label', card)) {
      const r = rect(el);
      if (!inside(r, cr)) add('stat-outside-card', 'card' + ci + ' ' + (el.textContent || '').trim().slice(0, 12));
    }
    for (const el of all('.tracker-stat__value, .tracker-stat__label', card)) {
      if (el.scrollWidth > Math.ceil(el.clientWidth) + 1) {
        add('stat-clipped', 'card' + ci + ' "' + (el.textContent || '').trim().slice(0, 10) + '" ' + el.scrollWidth + '>' + el.clientWidth);
      }
    }
  });

  // 4. the tracker never covers the selector or the detailed statistics below it.
  for (const [name, other] of [['selector', selector], ['detailed', detailed]]) {
    if (other && hit(section, other)) add('tracker-over-' + name, ov(section, other));
  }
  if (detailed && section.b > detailed.t + S) add('tracker-below-boundary', Math.round(section.b) + '>' + Math.round(detailed.t));
  if (note && !inside(note, section)) add('note-outside-section', '');

  // 5. no page-level horizontal overflow anywhere.
  if (document.documentElement.scrollWidth > vw + 1) add('page-overflow-x', document.documentElement.scrollWidth + '>' + vw);
  const panel = document.querySelector('.drawer__panel');
  if (panel && panel.scrollWidth > panel.clientWidth + 1) add('panel-overflow-x', panel.scrollWidth + '>' + panel.clientWidth);

  // 6. nothing renders NaN / Infinity / undefined.
  const text = section.__proto__ ? document.querySelector('.online-tracker').textContent : '';
  for (const bad of ['NaN', 'Infinity', 'undefined', 'null']) {
    if (text.includes(bad)) add('bad-number', bad);
  }

  return {
    violations: v, cards: cards.length, chips: chips.length,
    selected: (document.querySelector('.online-tracker__chip--active') || {}).textContent || null,
  };
})())`;

const VIEWPORTS = [
  { tag: '360', w: 360, h: 800, mobile: true },
  { tag: '390', w: 390, h: 844, mobile: true },
  { tag: 'desktop', w: 1280, h: 900, mobile: false },
];

function scenarios() {
  return [
    { name: 'overall', q: 'state=ok' },
    { name: 'king', q: 'state=ok&sel=king' },
    { name: 'fifty-one', q: 'state=ok&sel=fifty-one' },
    { name: 'big-numbers', q: 'state=ok&big=1' },
    { name: 'empty', q: 'state=empty' },
    { name: 'unauth', q: 'state=unauth' },
    { name: 'unavailable', q: 'state=unavailable' },
    { name: 'zoom', q: 'state=ok&big=1&fontScale=21' },
    { name: 'rtl', q: 'state=ok&dir=rtl&lang=ar' },
    { name: 'rtl-big', q: 'state=ok&big=1&dir=rtl&lang=ar' },
    { name: 'rtl-game', q: 'state=ok&dir=rtl&lang=ar&sel=tarneeb' },
    { name: 'de', q: 'state=ok&lang=de' },
    { name: 'uk', q: 'state=ok&lang=uk' },
  ];
}

async function run() {
  let alreadyUp = false;
  try { await waitHttp(`${BASE}?state=ok`, 1500); alreadyUp = true; } catch { /* start one */ }
  const vite = alreadyUp ? null : spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(VITE_PORT), '--strictPort'],
    { stdio: 'ignore', shell: process.platform === 'win32' });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${process.env.TEMP || '/tmp'}/kg-tracker-qa`, 'about:blank',
  ], { stdio: 'ignore' });

  const failures = [];
  let checks = 0;
  try {
    await waitHttp(`${BASE}?state=ok`, 90000);
    await waitDevtools();
    for (const vp of VIEWPORTS) {
      const targets = await fetchJson('/json');
      const page = targets.find((t) => t.type === 'page');
      const cdp = new CDP(page.webSocketDebuggerUrl);
      await cdp.open();
      await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile, screenWidth: vp.w, screenHeight: vp.h });
      console.log(`\n[${vp.tag} ${vp.w}x${vp.h}]`);

      for (const sc of scenarios().filter((x) => !ONLY || x.name.includes(ONLY))) {
        await cdp.send('Page.navigate', { url: `${BASE}?${sc.q}` });
        let mounted = false;
        for (let i = 0; i < 60; i++) {
          if (await cdp.evaluate(`!!document.querySelector('.online-tracker')`)) { mounted = true; break; }
          await sleep(100);
        }
        if (!mounted) { failures.push(`${vp.tag} ${sc.name}: the tracker did not render`); continue; }
        const settled = await cdp.evaluate(SETTLE);
        if (!settled || settled.ready !== true) failures.push(`${vp.tag} ${sc.name}: harness never signalled ready`);

        const res = JSON.parse(await cdp.evaluate(PROBE));
        checks++;
        // A data scenario must actually render both category cards.
        const expectsCards = /state=ok|state=empty/.test(sc.q);
        if (expectsCards && res.cards !== 2) failures.push(`${vp.tag} ${sc.name}: expected 2 category cards, got ${res.cards}`);
        if (expectsCards && res.chips !== 7) failures.push(`${vp.tag} ${sc.name}: expected 7 chips, got ${res.chips}`);
        for (const violation of res.violations) failures.push(`${vp.tag} ${sc.name}: ${violation}`);
        if (SHOTS) {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
          if (shot?.result?.data) writeFileSync(`${SHOTS}/${vp.tag}-${sc.name}.png`, Buffer.from(shot.result.data, 'base64'));
        }
        console.log(`  ${sc.name.padEnd(14)} c${res.cards}/ch${res.chips} ${res.violations.length ? `FAIL(${res.violations.length}) ${res.violations.slice(0, 2).join(' | ')}` : 'ok'}`);
      }
      cdp.close();          // an open CDP socket keeps node's event loop alive forever
    }
  } finally {
    chrome.kill();
    if (vite) vite.kill();
  }

  console.log(`\n${checks} online-tracker layout checks run.`);
  if (failures.length) {
    const byKind = new Map();
    for (const f of failures) {
      const kind = (f.match(/: ([a-z][a-z-]+):/) ?? [, 'other'])[1];
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    console.log(`\n${failures.length} VIOLATION(S) by kind:`);
    for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(5)}  ${kind}`);
    console.log('\nfirst 60:');
    for (const f of failures.slice(0, 60)) console.log('  - ' + f);
    return 1;
  }
  console.log('ONLINE TRACKER LAYOUT OK — no overflow, no overlap, cards stacked on a phone, 44px chips.');
  return 0;
}

process.exit(await run());
