// ---------------------------------------------------------------------------
// Poker LAYOUT QA gate (Stage 38.0.3).
//
//   node scripts/poker-layout-qa.mjs [--shots <dir>] [--keep]
//
// Stage 38.0.2 verified the table with an SSR-only harness and so MISSED two real
// defects the owner hit in production:
//   1. the fixed social/utility cluster floats ON TOP of the poker action controls;
//   2. at 4 players the side seat pods sit ON the community board / pot.
//
// This gate renders the REAL components in a REAL browser (scripts/layout-harness,
// served by vite dev) and asserts pairwise rectangle NON-intersection on actual
// `getBoundingClientRect()` values — screenshots are evidence, not the assertion.
// It exits non-zero on any violation, so it can be run as a pre-commit check.
//
// Matrix: 2/3/4/5/6 seats × preflop/flop/turn/river × 360/390/desktop × LTR/RTL,
// plus long names, folded/all-in/out states, the local screen, and the panels open
// (history / chat), which is where the owner's overlap actually shows up.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const WebSocket = createRequire(`${process.cwd()}/package.json`)('ws');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9251;
const VITE_PORT = 5199;
const BASE = `http://localhost:${VITE_PORT}/scripts/layout-harness/index.html`;

const args = process.argv.slice(2);
const SHOTS = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
/** `--only <substring>` narrows the matrix while iterating on one scenario family. */
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The captures worth keeping as owner evidence (a shot per check is far too slow). */
const SHOT_SET = new Set([
  '360/4p-flop/closed', '390/4p-river/closed', '390/4p-rtl/closed',
  '360/4p-rebuy/closed', '390/4p-rebuy/closed', '390/4p-rebuy-poor/closed',
  '390/4p-rebuy-rtl/closed', '360/4p-rebuy-local/closed', '390/6p-rebuy/closed',
  '390/2p-river/closed', '390/6p-flop/closed', '390/6p-states/closed',
  '390/4p-river/history-open', '390/4p-river/chat-open', '390/4p-local/closed',
  'desktop/6p-river/closed', '360/4p-flop/history-open',
]);
const fetchJson = (p) => new Promise((res, rej) => get(`http://127.0.0.1:${CDP_PORT}${p}`, (r) => {
  let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d)));
}).on('error', rej));

async function waitHttp(url, timeout = 60000) {
  const start = Date.now();
  for (;;) {
    try {
      await new Promise((res, rej) => get(url, (r) => { r.resume(); res(r.statusCode); }).on('error', rej));
      return;
    } catch { if (Date.now() - start > timeout) throw new Error(`not up: ${url}`); await sleep(200); }
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
  /** Every call is time-boxed: a CDP reply that never arrives (it happens around a
   *  navigation) must not wedge the whole gate. */
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
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result?.result?.value;
  }
}

// --- the in-page probe -------------------------------------------------------
// Every assertion is a real rectangle test. `slack` of 0.5px absorbs sub-pixel
// rounding only. A hidden/zero-size element is skipped (it cannot overlap anything).
const PROBE = `JSON.stringify((() => {
  const S = 0.5;
  const vw = window.innerWidth;
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const live = (r) => r.w > 0.5 && r.h > 0.5;
  const all = (sel) => [...document.querySelectorAll(sel)].map(rect).filter(live);
  const one = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = rect(el); return live(r) ? r : null; };
  const hit = (a, b) => !!a && !!b && a.l < b.r - S && b.l < a.r - S && a.t < b.b - S && b.t < a.b - S;
  const overlap = (a, b) => Math.round(Math.min(a.r, b.r) - Math.max(a.l, b.l)) + 'x' + Math.round(Math.min(a.b, b.b) - Math.max(a.t, b.t));

  const pods = [...document.querySelectorAll('.poker-pod')];
  const podRects = pods.map(rect);
  const podName = (i) => (pods[i].querySelector('.poker-pod__name')?.textContent || ('#' + i)).slice(0, 18);
  const board = one('.poker-board');
  const info = one('.poker-center__info');
  const topbar = one('.poker-topbar');
  const actions = one('.poker-actions');
  const table = one('.poker-table');
  // Every control a player MUST be able to see and press.
  const critical = [
    ...all('.poker-actions__primary button'), ...all('.poker-wager-go'),
    ...all('.poker-amount-input'), ...all('.poker-preset'), ...all('.poker-slider'),
  ];
  // Floating / in-flow social + utility surfaces.
  const cluster = one('.room-social__bar') || one('.social-controls') || one('.poker-social-toolbar');
  const clusterBtns = [...document.querySelectorAll('.room-social__bar button, .social-controls button, .poker-social-toolbar button, .poker-local-utility button')];
  // (38.0.14) EVERY social surface is in flow again, chat included — so the chat is back
  // in this list: it may never cover the board, the bet controls or the action row.
  const panels = [
    ...all('.poker-log-panel'), ...all('.chat-panel'), ...all('.reaction-bar'),
  ];
  const chatPanel = one('.chat-panel');
  // The rebuy panel is IN FLOW: it must not intersect the table, the toolbar or the controls.
  const rebuy = one('.poker-rebuy');
  const rebuyBtns = [...document.querySelectorAll('.poker-rebuy button')];
  const localUtil = one('.poker-local-utility');

  const v = [];
  const add = (kind, detail) => v.push(kind + ': ' + detail);

  // 1. seat pods vs the community board / pot / each other / topbar / actions
  podRects.forEach((p, i) => {
    if (hit(p, board)) add('pod-over-board', podName(i) + ' ' + overlap(p, board));
    if (hit(p, info)) add('pod-over-pot', podName(i) + ' ' + overlap(p, info));
    if (hit(p, topbar)) add('pod-over-topbar', podName(i));
    if (hit(p, actions)) add('pod-over-actions', podName(i) + ' ' + overlap(p, actions));
    for (let j = i + 1; j < podRects.length; j++) {
      if (hit(p, podRects[j])) add('pod-over-pod', podName(i) + '|' + podName(j) + ' ' + overlap(p, podRects[j]));
    }
  });

  // 2. the social/utility cluster must never sit on the table or the controls
  if (cluster) {
    if (hit(cluster, actions)) add('cluster-over-actions', overlap(cluster, actions));
    if (hit(cluster, table)) add('cluster-over-table', overlap(cluster, table));
    for (const c of critical) if (hit(cluster, c)) add('cluster-over-control', overlap(cluster, c));
  }
  if (localUtil) {
    if (hit(localUtil, actions)) add('localutil-over-actions', overlap(localUtil, actions));
    if (hit(localUtil, table)) add('localutil-over-table', overlap(localUtil, table));
  }

  // 3. an OPEN IN-FLOW panel (history / reactions) must not cover the controls or the table
  for (const p of panels) {
    for (const c of critical) if (hit(p, c)) add('panel-over-control', overlap(p, c));
    if (hit(p, actions)) add('panel-over-actions', overlap(p, actions));
  }
  // 3b. (38.0.14) The chat is NOT a modal: no backdrop may exist, it must stay inside the
  // viewport sideways, and it must never sit on the table or the betting controls (that
  // is already covered by the in-flow panel loop above).
  if (chatPanel) {
    if (document.querySelector('.chat-dialog-backdrop, .social-sheet-backdrop')) add('chat-backdrop', 'present');
    if (chatPanel.l < -S || chatPanel.r > vw + S) add('chat-outside-viewport', Math.round(chatPanel.l) + '..' + Math.round(chatPanel.r));
    if (hit(chatPanel, table)) add('chat-over-table', overlap(chatPanel, table));
  }

  if (rebuy) {
    if (hit(rebuy, table)) add('rebuy-over-table', overlap(rebuy, table));
    if (hit(rebuy, actions)) add('rebuy-over-actions', overlap(rebuy, actions));
    if (cluster && hit(rebuy, cluster)) add('rebuy-over-toolbar', overlap(rebuy, cluster));
    for (const c of critical) if (hit(rebuy, c)) add('rebuy-over-control', overlap(rebuy, c));
    for (const b of rebuyBtns) {
      const r = rect(b);
      if (live(r) && (r.w < 43.5 || r.h < 43.5)) add('rebuy-touch-target', Math.round(r.w) + 'x' + Math.round(r.h));
    }
  }

  // 4. board cards must be inside the board and not squeezed away
  const boardCards = all('.poker-board .poker-card');
  for (const c of boardCards) {
    if (c.w < 20) add('board-card-squeezed', Math.round(c.w) + 'px');
    if (board && (c.l < board.l - S || c.r > board.r + S)) add('board-card-clipped', Math.round(c.l) + '..' + Math.round(c.r));
  }

  // 5. page-level horizontal overflow + off-screen elements
  if (document.documentElement.scrollWidth > vw + 1) add('page-overflow-x', document.documentElement.scrollWidth + '>' + vw);
  podRects.forEach((p, i) => { if (p.l < -S || p.r > vw + S) add('pod-offscreen', podName(i)); });

  // 6. touch targets
  for (const b of clusterBtns) {
    const r = rect(b);
    if (live(r) && (r.w < 43.5 || r.h < 43.5)) add('touch-target', (b.getAttribute('aria-label') || b.textContent || '?').trim().slice(0, 14) + ' ' + Math.round(r.w) + 'x' + Math.round(r.h));
  }

  return {
    violations: v,
    counts: { pods: podRects.length, critical: critical.length, panels: panels.length, clusterBtns: clusterBtns.length },
    hasCluster: !!cluster, hasActions: !!actions,
  };
})())`;

// `CHAT` is a logical target: the chat FAB is identified by its glyph, never by
// position — the row also holds a "leave game" button whose window.confirm() would
// block the page (and therefore every later CDP call) if it were clicked by accident.

const CLICK = (sel) => (sel === 'CHAT'
  ? `(()=>{const g=String.fromCodePoint(128172);const b=[...document.querySelectorAll('.social-controls__row .social-fab')].find(x=>x.textContent.includes(g));if(b){b.click();return true}return false})()`
  : `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(e){e.click();return true}return false})()`);


const VIEWPORTS = [
  { tag: '360', w: 360, h: 800, mobile: true },
  { tag: '390', w: 390, h: 844, mobile: true },
  { tag: 'desktop', w: 1280, h: 900, mobile: false },
];

/** name → query string. Kept small but representative of the required matrix. */
function scenarios() {
  const out = [];
  for (let seats = 2; seats <= 6; seats++) {
    // Every seat count sees an empty and a full board; 4 and 6 (the tightest side-seat
    // geometry) additionally see the intermediate streets.
    const streets = seats === 4 || seats === 6
      ? ['preflop', 'flop', 'turn', 'river'] : ['preflop', 'river'];
    for (const street of streets) out.push({ name: `${seats}p-${street}`, q: `seats=${seats}&street=${street}` });
  }
  out.push({ name: '4p-rtl', q: 'seats=4&street=river&dir=rtl&lang=ar' });
  out.push({ name: '6p-rtl', q: 'seats=6&street=flop&dir=rtl&lang=ar' });
  out.push({ name: '6p-longnames', q: 'seats=6&street=river&names=long' });
  out.push({ name: '4p-longnames', q: 'seats=4&street=flop&names=long' });
  out.push({ name: '6p-states', q: 'seats=6&street=turn&states=1' });
  out.push({ name: '4p-states-rtl', q: 'seats=4&street=turn&states=1&dir=rtl&lang=ar' });
  out.push({ name: '4p-local', q: 'seats=4&street=flop&local=1' });
  // §17 rebuy window — the panel must never cover the toolbar, table or controls.
  out.push({ name: '4p-rebuy', q: 'seats=4&street=river&rebuy=1' });
  out.push({ name: '6p-rebuy', q: 'seats=6&street=river&rebuy=1' });
  out.push({ name: '4p-rebuy-local', q: 'seats=4&street=river&rebuy=1&local=1' });
  out.push({ name: '4p-rebuy-poor', q: 'seats=4&street=river&rebuy=1&poor=1' });
  out.push({ name: '4p-rebuy-rtl', q: 'seats=4&street=river&rebuy=1&dir=rtl&lang=ar' });
  return out;
}

/** Panel states driven through the REAL controls. */
const PANEL_STEPS = [
  { name: 'closed', steps: [] },
  { name: 'history-open', steps: ['.poker-log-fab'] },
  { name: 'chat-open', steps: ['CHAT'] },
];

async function run() {
  // Reuse an already-running dev server when there is one (handy while iterating);
  // otherwise start our own and shut it down at the end.
  let alreadyUp = false;
  try { await waitHttp(`${BASE}?seats=4`, 1500); alreadyUp = true; } catch { /* start one */ }
  const vite = alreadyUp ? null : spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(VITE_PORT), '--strictPort'],
    { stdio: 'ignore', shell: process.platform === 'win32' });
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${process.env.TEMP || '/tmp'}/kg-layout-qa`, 'about:blank',
  ], { stdio: 'ignore' });

  const failures = [];
  let checks = 0;
  try {
    await waitHttp(`${BASE}?seats=4`, 90000);
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
        const isLocal = sc.q.includes('local=1');
        await cdp.send('Page.navigate', { url: `${BASE}?${sc.q}` });
        // A native confirm() would block the renderer and wedge every later CDP call.
        await cdp.evaluate('window.confirm = () => false; window.alert = () => {};');
        // Wait for the REAL action controls to mount before measuring anything —
        // probing a half-mounted page would silently under-report.
        let mounted = false;
        for (let i = 0; i < 50; i++) {
          // During a rebuy window there are no betting controls at all (that is the
          // point), so the panel is an equally valid readiness signal.
          if (await cdp.evaluate(`!!document.querySelector('.poker-actions, .poker-rebuy')`)) { mounted = true; break; }
          await sleep(100);
        }
        await sleep(120);
        if (!mounted) { failures.push(`${vp.tag} ${sc.name}: NO action controls rendered (harness broken)`); continue; }

        const steps = isLocal ? PANEL_STEPS.slice(0, 2) : PANEL_STEPS;
        for (const ps of steps) {
          // Toggle INTO this panel state through the real control, then back out.
          for (const sel of ps.steps) await cdp.evaluate(CLICK(sel));
          if (ps.steps.length) await sleep(140);

          const res = JSON.parse(await cdp.evaluate(PROBE));
          checks++;
          const label = `${sc.name}/${ps.name}`;
          for (const violation of res.violations) failures.push(`${vp.tag} ${label}: ${violation}`);
          if (SHOTS && SHOT_SET.has(`${vp.tag}/${sc.name}/${ps.name}`)) {
            const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
            if (shot?.result?.data) writeFileSync(`${SHOTS}/${vp.tag}-${sc.name}-${ps.name}.png`, Buffer.from(shot.result.data, 'base64'));
          }
          console.log(`  ${label.padEnd(26)} ${res.violations.length ? `FAIL(${res.violations.length}) ${res.violations.slice(0, 2).join(' | ')}` : 'ok'}`);

          for (const sel of ps.steps) await cdp.evaluate(CLICK(sel));   // close again
          if (ps.steps.length) await sleep(90);
        }
      }
    }
  } finally {
    chrome.kill();
    if (vite) vite.kill();
  }

  console.log(`\n${checks} layout checks run.`);
  if (failures.length) {
    console.log(`\n${failures.length} VIOLATION(S):`);
    for (const f of failures.slice(0, 60)) console.log('  - ' + f);
    if (failures.length > 60) console.log(`  … ${failures.length - 60} more`);
    process.exitCode = 1;
  } else {
    console.log('LAYOUT OK — no pod/board/pot/control intersections, no overflow, touch targets ≥44px.');
  }
}

await run();
